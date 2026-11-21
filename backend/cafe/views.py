import csv
import hashlib
import json
import uuid
from datetime import datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
from functools import wraps
from hmac import compare_digest

import jdatetime
from django import forms
from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import DataError, IntegrityError, transaction
from django.db.models import Count, F, Q, Sum
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.utils.crypto import salted_hmac
from django.middleware.csrf import get_token

from .calculations import MONTHS, TEHRAN, catalog, current_jalali, jalali_date, ledger, product_cost
from .models import (
    CafeSettings, Category, Ingredient, LoginThrottle, ManualSale, OpeningBalance, Order, OrderClosure, OrderItem,
    Product, RecipeItem, SalesTarget, Transaction,
)

MONEY = forms.DecimalField(min_value=0, max_digits=16, decimal_places=4)
OPTIONAL_MONEY = forms.DecimalField(min_value=0, max_digits=16, decimal_places=4, required=False)
DISCOUNT_PERCENT = forms.DecimalField(min_value=0, max_value=100, max_digits=5, decimal_places=2, required=False)


class ApiError(Exception):
    def __init__(self, message, status=400):
        self.message = message
        self.status = status


def api(*methods, staff=False, owner=False, public=False):
    def decorate(view):
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            key = kwargs.pop("key", None)
            try:
                if key is not None and not compare_digest(key.encode(), settings.STAFF_ROUTE_KEY.encode()):
                    raise ApiError("صفحه پیدا نشد.", 404)
                if request.method not in methods:
                    raise ApiError("روش درخواست معتبر نیست.", 405)
                if staff and not request.user.is_authenticated:
                    raise ApiError("ابتدا وارد حساب شوید.", 401)
                if owner and not request.user.is_superuser:
                    raise ApiError("این بخش فقط برای مدیر است.", 403)
                if request.method in ("POST", "PATCH"):
                    if request.content_type != "application/json":
                        raise ApiError("نوع داده درخواست معتبر نیست.", 415)
                    request.data = json.loads(request.body)
                    if not isinstance(request.data, dict):
                        raise ApiError("داده درخواست معتبر نیست.")
                result = view(request, *args, **kwargs)
                response = result if isinstance(result, HttpResponse) else JsonResponse(result)
            except ApiError as error:
                response = JsonResponse({"error": error.message}, status=error.status)
            except (DataError, ValueError, TypeError, ValidationError, OverflowError):
                response = JsonResponse({"error": "مقادیر واردشده معتبر نیستند."}, status=400)
            except IntegrityError:
                response = JsonResponse({"error": "این رکورد با اطلاعات موجود تداخل دارد."}, status=409)
            response["Cache-Control"] = "public, max-age=30, stale-while-revalidate=60" if public and response.status_code == 200 else "private, no-store"
            if not public:
                response["X-Robots-Tag"] = "noindex, nofollow, noarchive"
            return response
        return wrapped
    return decorate


def csrf_failure(request, reason=""):
    response = JsonResponse({"error": "اعتبار نشست پایان یافته است. صفحه را دوباره بارگذاری کنید."}, status=403)
    response["Cache-Control"] = "private, no-store"
    return response


def clean(field, data, name):
    if not hasattr(data, "get"):
        raise ApiError("ساختار داده معتبر نیست.")
    try:
        return field.clean(data.get(name))
    except ValidationError as error:
        raise ApiError(f"مقدار «{name_labels.get(name, name)}» معتبر نیست.") from error


name_labels = {
    "name": "نام", "price": "قیمت", "cost": "هزینه", "amount": "مبلغ", "day": "روز", "code": "کد",
    "start": "شروع بازه", "end": "پایان بازه", "note": "یادداشت", "description": "توضیح",
    "quantity": "مقدار", "unit": "واحد", "currency": "عنوان واحد پول", "discount": "تخفیف",
    "discount_percent": "تخفیف درصدی",
}


def string(data, key, size, required=True):
    value = data.get(key)
    if value is not None and (not isinstance(value, str) or "\x00" in value):
        raise ApiError("متن واردشده معتبر نیست.")
    return clean(forms.CharField(max_length=size, required=required), data, key)


def integer(data, key, lo, hi, required=True):
    return clean(forms.IntegerField(min_value=lo, max_value=hi, required=required), data, key)


def obj(query, **kwargs):
    result = query.filter(**kwargs).first()
    if result is None:
        raise ApiError("رکورد پیدا نشد.", 404)
    return result


def me(request):
    if request.user.is_authenticated:
        return {
            "id": request.user.pk, "name": request.user.first_name or request.user.username,
            "role": "owner" if request.user.is_superuser else "barista",
        }
    return None


@api("GET", "POST", "DELETE")
def session(request):
    if request.method == "POST":
        username = string(request.data, "username", 150)
        password = request.data.get("password")
        if not isinstance(password, str) or not 0 < len(password) <= 512:
            raise ApiError("نام کاربری یا رمز عبور نادرست است.", 401)
        now = timezone.now()
        key = salted_hmac("cafe-login", username.casefold(), algorithm="sha256").hexdigest()
        with transaction.atomic():
            slot, _ = LoginThrottle.objects.select_for_update().get_or_create(key=key, defaults={"until": now})
            if slot.until <= now:
                slot.attempts, slot.until = 0, now + timedelta(minutes=15)
            if slot.attempts >= 8:
                raise ApiError("تلاش‌های زیادی انجام شده است. کمی بعد دوباره امتحان کنید.", 429)
            slot.attempts += 1
            slot.save(update_fields=["attempts", "until"])
        user = authenticate(request, username=username, password=password)
        if user is None:
            raise ApiError("نام کاربری یا رمز عبور نادرست است.", 401)
        LoginThrottle.objects.filter(pk=key).delete()
        login(request, user)
    elif request.method == "DELETE":
        logout(request)
    return {"user": me(request), "csrf": get_token(request)}


@api("POST", staff=True, owner=True)
def password_change(request):
    current = request.data.get("current")
    password = request.data.get("password")
    if not isinstance(current, str) or len(current) > 512 or not request.user.check_password(current):
        raise ApiError("رمز عبور فعلی درست نیست.")
    if not isinstance(password, str) or len(password) > 512:
        raise ApiError("رمز عبور جدید معتبر نیست.")
    try:
        validate_password(password, request.user)
    except ValidationError as error:
        raise ApiError("رمز جدید باید حداقل ۱۲ نویسه داشته باشد و قابل حدس نباشد.") from error
    request.user.set_password(password)
    request.user.save(update_fields=["password"])
    login(request, request.user)
    return {"csrf": get_token(request)}


def settings_data():
    config = CafeSettings.objects.filter(pk=1).first() or CafeSettings()
    return {"currency": config.currency, "multiplier": config.display_multiplier}


def product_data(product, management=False):
    data = {
        "id": product.id, "code": product.code, "name": product.name, "description": product.description,
        "category": product.category.slug, "category_name": product.category.name,
        "price": product.price, "active": product.active,
    }
    if management:
        cost = product_cost(product)
        profit = product.price - cost if product.price is not None and cost is not None else None
        data.update(cost=product.material_cost, effective_cost=cost, profit=profit,
                    margin=(profit / product.price * 100) if profit is not None and product.price else None,
                    recipe=[{"ingredient": item.ingredient_id, "quantity": item.quantity} for item in product.recipe.all()])
    return data


def menu_data(management=False):
    products = catalog() if management else Product.objects.filter(active=True).select_related("category")
    return {
        "products": [product_data(product, management) for product in products],
        "categories": list(Category.objects.order_by("position", "slug").values("slug", "name", "position")),
        "settings": settings_data(),
    }


@api("GET", public=True)
def public_menu(request):
    return menu_data()


@api("GET", staff=True)
def staff_menu(request):
    return menu_data()


@api("GET", "POST", owner=True, staff=True)
def manage_menu(request):
    if request.method == "POST":
        return save_product(request)
    return menu_data(management=True)


@api("PATCH", owner=True, staff=True)
def update_product(request, identifier):
    return save_product(request, identifier)


@transaction.atomic
def save_product(request, identifier=None):
    data = request.data
    product = obj(Product.objects.select_for_update(), pk=identifier) if identifier else Product()
    product.code = integer(data, "code", 1, 999999)
    product.name = string(data, "name", 150)
    product.category = obj(Category.objects, slug=string(data, "category", 50))
    product.price = clean(OPTIONAL_MONEY, data, "price")
    product.material_cost = clean(OPTIONAL_MONEY, data, "cost")
    product.description = string(data, "description", 300, False)
    if not isinstance(data.get("active"), bool):
        raise ApiError("وضعیت محصول معتبر نیست.")
    product.active = data["active"]
    recipe = data.get("recipe", [])
    if not isinstance(recipe, list) or len(recipe) > 100:
        raise ApiError("رسپی معتبر نیست.")
    amounts = {}
    for entry in recipe:
        ingredient = integer(entry, "ingredient", 1, 2**31 - 1)
        if ingredient in amounts:
            raise ApiError("هر ماده فقط یک‌بار در رسپی ثبت می‌شود.")
        amounts[ingredient] = clean(forms.DecimalField(min_value=Decimal("0.000001"),
                                    max_digits=12, decimal_places=6), entry, "quantity")
    if len(Ingredient.objects.in_bulk(amounts)) != len(amounts):
        raise ApiError("یکی از مواد اولیه پیدا نشد.")
    product.full_clean()
    product.save()
    product.recipe.all().delete()
    RecipeItem.objects.bulk_create([
        RecipeItem(product=product, ingredient_id=ingredient, quantity=quantity)
        for ingredient, quantity in amounts.items()
    ])
    return product_data(obj(catalog(), pk=product.pk), True)


@api("POST", "PATCH", "DELETE", owner=True, staff=True)
def categories(request, slug=None):
    category = obj(Category.objects, slug=slug) if slug else Category(slug=f"menu-{uuid.uuid4().hex[:12]}")
    if request.method == "DELETE":
        if category.product_set.exists():
            raise ApiError("ابتدا آیتم‌های این دسته را به دسته دیگری منتقل کنید.", 409)
        category.delete()
    else:
        category.name = string(request.data, "name", 80)
        category.position = integer(request.data, "position", 0, 1000)
        category.full_clean()
        category.save()
    return {"saved": True}


@api("GET", "POST", "PATCH", owner=True, staff=True)
def ingredients(request, identifier=None):
    if request.method != "GET":
        data = request.data
        item = obj(Ingredient.objects, pk=identifier) if identifier else Ingredient()
        item.name = string(data, "name", 100)
        item.unit = string(data, "unit", 32)
        item.unit_cost = clean(MONEY, data, "cost")
        item.full_clean()
        item.save()
    return {"items": list(Ingredient.objects.values("id", "name", "unit", "unit_cost"))}


@api("POST", owner=True, staff=True)
def menu_settings(request):
    CafeSettings.objects.update_or_create(pk=1, defaults={
        "currency": string(request.data, "currency", 24),
        "display_multiplier": integer(request.data, "multiplier", 1, 1000000),
    })
    return settings_data()


def order_data(order, owner):
    return {
        "id": order.id, "legacy_number": order.legacy_number, "status": order.status,
        "created": order.created_at, "closed": order.closed_at, "creator": (
            order.created_by.first_name or order.created_by.username if order.created_by else ""
        ),
        "note": order.note, "subtotal": order.subtotal, "discount": order.discount,
        "total": order.total, "payment": order.payment,
        "items": [{
            "id": item.id, "name": item.name, "quantity": item.quantity, "price": item.unit_price,
            "line_total": item.line_total, **({"cost": item.unit_cost} if owner else {}),
        } for item in order.items.all()],
    }


def order_query():
    return Order.objects.select_related("created_by").prefetch_related("items")


def apply_order_scope(request, qs):
    return qs if request.user.is_superuser else qs.filter(created_by=request.user)


@api("GET", "POST", staff=True)
def orders(request):
    if request.method == "POST":
        return create_order(request)
    status = request.GET.get("status", "open")
    qs = apply_order_scope(request, order_query())
    if status == "history":
        qs = qs.exclude(status=Order.Status.OPEN).order_by("-closed_at", "-id")
    elif status == "open":
        qs = qs.filter(status=Order.Status.OPEN).order_by("id")
    else:
        raise ApiError("وضعیت سفارش معتبر نیست.")
    page = integer(request.GET, "page", 1, 100000, False) or 1
    search = request.GET.get("q", "").strip()[:100]
    if search:
        qs = qs.filter(Q(legacy_number__icontains=search) | Q(note__icontains=search) |
                       Q(items__name__icontains=search) | Q(pk=int(search) if search.isascii() and search.isdecimal() and len(search) < 18 else 0)).distinct()
    start = (page - 1) * 30
    rows = list(qs[start:start + 31])
    return {"orders": [order_data(order, request.user.is_superuser) for order in rows[:30]], "more": len(rows) > 30}


def create_order(request):
    data = request.data
    raw_items = data.get("items")
    if not isinstance(raw_items, list) or not 0 < len(raw_items) <= 100:
        raise ApiError("حداقل یک آیتم به سفارش اضافه کنید.")
    quantities = {}
    expected_prices = {}
    for row in raw_items:
        identifier = integer(row, "id", 1, 2**31 - 1)
        if identifier in quantities:
            raise ApiError("هر محصول باید یک ردیف داشته باشد.")
        quantities[identifier] = integer(row, "quantity", 1, 999)
        expected_prices[identifier] = clean(MONEY, row, "price")
    request_id = uuid.UUID(string(data, "request_id", 36))
    fixed_discount = clean(OPTIONAL_MONEY, data, "discount") or Decimal(0)
    discount_percent = clean(DISCOUNT_PERCENT, data, "discount_percent") or Decimal(0)
    note = string(data, "note", 250, False)
    fingerprint_fields = (
        sorted(quantities.items()), sorted((key, price.normalize()) for key, price in expected_prices.items()),
        fixed_discount.normalize(), note,
    )
    if discount_percent:
        fingerprint_fields += (discount_percent.normalize(),)
    fingerprint = hashlib.sha256(repr(fingerprint_fields).encode()).hexdigest()

    def previous():
        existing = order_query().filter(request_id=request_id).first()
        if existing is not None and (existing.created_by_id != request.user.pk or existing.request_hash != fingerprint):
            raise ApiError("این درخواست قبلاً برای سفارش دیگری ثبت شده است.", 409)
        return order_data(existing, request.user.is_superuser) if existing is not None else None

    try:
        with transaction.atomic():
            existing = previous()
            if existing is not None:
                return existing
            products = list(Product.objects.filter(pk__in=quantities, active=True, price__isnull=False))
            if len(products) != len(quantities) or any(p.price != expected_prices[p.pk] for p in products):
                raise ApiError("منو یا قیمت تغییر کرده است. سفارش را دوباره بررسی کنید.", 409)
            subtotal = sum(p.price * quantities[p.pk] for p in products)
            clean(MONEY, {"amount": subtotal}, "amount")
            percentage_discount = (subtotal * discount_percent / 100).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            discount = fixed_discount + percentage_discount
            if discount > subtotal:
                raise ApiError("مجموع تخفیف نمی‌تواند بیشتر از مبلغ سفارش باشد.")
            total = subtotal - discount
            created = Order.objects.create(created_by=request.user, request_id=request_id, request_hash=fingerprint,
                                           subtotal=subtotal, discount=discount, total=total, note=note)
            OrderItem.objects.bulk_create([
                OrderItem(order=created, product=p, name=p.name, quantity=quantities[p.pk], unit_price=p.price,
                          line_total=p.price * quantities[p.pk])
                for p in products
            ])
            return order_data(obj(order_query(), pk=created.pk), request.user.is_superuser)
    except IntegrityError:
        existing = previous()
        if existing is None:
            raise
        return existing


@api("POST", staff=True)
@transaction.atomic
def close_orders(request):
    data = request.data
    action = data.get("action")
    status = data.get("status")
    if status not in (Order.Status.PAID, Order.Status.CANCELLED):
        raise ApiError("وضعیت نهایی معتبر نیست.")
    payment = string(data, "payment", 12, False) if status == Order.Status.PAID else ""
    if status == Order.Status.PAID and payment not in Order.Payment.values:
        raise ApiError("روش پرداخت را انتخاب کنید.")
    if action not in ("one", "first", "all"):
        raise ApiError("عملیات معتبر نیست.")
    if action == "all" and not request.user.is_superuser:
        raise ApiError("فقط مدیر می‌تواند همه سفارش‌ها را یکجا ببندد.", 403)
    identifier = integer(data, "id", 1, 2**53 - 1) if action != "all" else None
    key = uuid.UUID(string(data, "request_id", 36))
    fingerprint = hashlib.sha256(repr((action, identifier, status, payment)).encode()).hexdigest()
    receipt, created = OrderClosure.objects.get_or_create(key=key, defaults={
        "user": request.user, "fingerprint": fingerprint,
    })
    if not created:
        if receipt.user_id != request.user.pk or receipt.fingerprint != fingerprint:
            raise ApiError("این درخواست قبلاً برای عملیات دیگری ثبت شده است.", 409)
        return {"closed": receipt.count}

    qs = apply_order_scope(request, Order.objects)
    locked = qs.filter(status=Order.Status.OPEN).select_for_update().order_by("id")
    if action == "one":
        selected = obj(qs.select_for_update(), pk=identifier)
        if selected.status != Order.Status.OPEN:
            raise ApiError("این سفارش قبلاً بسته شده است.", 409)
        keys = [selected.pk]
    elif action == "first":
        first = locked.values_list("pk", flat=True).first()
        if first != identifier:
            raise ApiError("صف سفارش‌ها تغییر کرده است. فهرست را دوباره بررسی کنید.", 409)
        keys = [first]
    else:
        keys = list(locked.values_list("pk", flat=True))

    if status == Order.Status.PAID and keys:
        items = list(OrderItem.objects.filter(order_id__in=keys))
        product_ids = {item.product_id for item in items if item.product_id is not None}
        costs = {product.pk: product_cost(product) for product in catalog().filter(pk__in=product_ids)}
        for item in items:
            item.unit_cost = costs.get(item.product_id)
        OrderItem.objects.bulk_update(items, ["unit_cost"], batch_size=500)

    receipt.count = qs.filter(pk__in=keys, status=Order.Status.OPEN).update(
        status=status, payment=payment, closed_at=timezone.now(), closed_by=request.user,
    )
    receipt.save(update_fields=["count"])
    return {"closed": receipt.count}


@api("PATCH", owner=True, staff=True)
def fix_cost(request, identifier):
    cost = clean(MONEY, request.data, "cost")
    count = OrderItem.objects.filter(pk=identifier, order__status=Order.Status.PAID, unit_cost__isnull=True).update(unit_cost=cost)
    if not count:
        raise ApiError("این قلم پیدا نشد یا هزینه آن قبلاً ثبت شده است.", 409)
    return {"updated": True}


def iso_day(data, key):
    value = data.get(key)
    if isinstance(value, str) and "/" in value:
        return jalali_date(value.strip()).togregorian()
    return clean(forms.DateField(input_formats=["%Y-%m-%d"]), data, key)


def sales_range(data, default=False):
    if default and not data.get("start") and not data.get("end"):
        now = current_jalali()
        next_month = jdatetime.date(now.year + int(now.month == 12), now.month % 12 + 1, 1)
        return jdatetime.date(now.year, now.month, 1).togregorian(), next_month.togregorian() - timedelta(days=1)
    start, end = (iso_day(data, field) for field in ("start", "end"))
    if end < start or (end - start).days > 366 or end.year >= 9999:
        raise ApiError("بازه تاریخ باید معتبر و حداکثر یک سال باشد.")
    return start, end


def time_bounds(start, end):
    return (datetime.combine(start, time.min, TEHRAN),
            datetime.combine(end + timedelta(days=1), time.min, TEHRAN))


@api("GET", owner=True, staff=True)
def sales_report(request):
    start, end = sales_range(request.GET, default=True)
    lower, upper = time_bounds(start, end)
    paid = Order.objects.filter(status=Order.Status.PAID, closed_at__gte=lower, closed_at__lt=upper)
    summary = paid.aggregate(sales=Sum("total", default=0), discount=Sum("discount", default=0), orders=Count("pk"))
    items = OrderItem.objects.filter(order__in=paid).values("name").annotate(
        sales=Sum("line_total"),
        material=Sum(F("unit_cost") * F("quantity"), default=0),
        missing=Sum("quantity", filter=Q(unit_cost__isnull=True), default=0),
        quantity=Sum("quantity"),
    ).order_by("-quantity", "name")
    products = list(items)
    missing = sum(row["missing"] for row in products)
    target = SalesTarget.objects.filter(start=start, end=end).values_list("amount", flat=True).first()
    manual = ManualSale.objects.filter(date__range=(start, end)).order_by("-date", "-pk")
    return {
        **summary, "start": start, "end": end, "target": target,
        "progress": summary["sales"] / target * 100 if target else None,
        "profit": summary["sales"] - sum(row["material"] for row in products) if not missing else None,
        "quantity": sum(row["quantity"] for row in products), "missing": missing, "products": products,
        "manual": list(manual.values("id", "date", "amount", "note")),
        "manual_total": manual.aggregate(amount=Sum("amount", default=0))["amount"],
        "targets": list(SalesTarget.objects.order_by("-start")[:24].values("start", "end", "amount")),
    }


@api("POST", owner=True, staff=True)
def target(request):
    start, end = sales_range(request.data)
    SalesTarget.objects.update_or_create(start=start, end=end,
                                        defaults={"amount": clean(MONEY, request.data, "amount")})
    return {"saved": True}


@api("POST", "PATCH", "DELETE", owner=True, staff=True)
def manual_sale(request, identifier=None):
    sale = obj(ManualSale.objects, pk=identifier) if identifier else ManualSale()
    if request.method == "DELETE":
        sale.delete()
    else:
        sale.date = iso_day(request.data, "day")
        sale.amount = clean(MONEY, request.data, "amount")
        sale.note = string(request.data, "note", 200, False)
        sale.save()
    return {"saved": True}


def ledger_scope(data):
    today = current_jalali()
    return (integer(data, "year", 1300, 1600, False) or today.year,
            integer(data, "month", 1, 12, False) or today.month)


@api("GET", owner=True, staff=True)
def accounts(request):
    year, month = ledger_scope(request.GET)
    report = ledger(year)
    entries = Transaction.objects.filter(year=year, month=month).order_by(F("day").desc(nulls_last=True), "-id")
    withdrawals = Transaction.objects.filter(
        year=year, kind=Transaction.Kind.WITHDRAW, person__in=[Transaction.Person.MEHDI, Transaction.Person.ROHAM]
    ).order_by("-month", F("day").desc(nulls_last=True), "-id")
    fields = ("id", "year", "month", "day", "person", "kind", "amount", "note")
    first = report[0]
    opening = {"cash": first["opening"], "mehdi": first["opening_mehdi"],
               "roham": first["opening_roham"], "receivable": first["opening_receivable"]}
    return {
        "year": year, "month": month, "selected": report[month - 1], "months": report,
        "entries": list(entries.values(*fields)), "withdrawals": list(withdrawals.values(*fields)),
        "people": dict(Transaction.Person.choices), "kinds": dict(Transaction.Kind.choices), "opening": opening,
    }


@api("POST", "PATCH", "DELETE", owner=True, staff=True)
def movement(request, identifier=None):
    entry = obj(Transaction.objects, pk=identifier) if identifier else Transaction()
    if request.method == "DELETE":
        entry.delete()
    else:
        data = request.data
        entry.year = integer(data, "year", 1300, 1600)
        entry.month = integer(data, "month", 1, 12)
        entry.day = integer(data, "day", 1, 31, False)
        if entry.day is not None:
            jdatetime.date(entry.year, entry.month, entry.day)
        entry.person = string(data, "person", 12)
        entry.kind = string(data, "kind", 12)
        entry.amount = integer(data, "amount", 1, 10**12)
        entry.note = string(data, "note", 250, False)
        entry.full_clean()
        entry.save()
    return {"saved": True}


@api("POST", owner=True, staff=True)
def opening_balance(request):
    data = request.data
    year = integer(data, "year", 1300, 1600)
    balances = {field: integer(data, field, -10**12, 10**12) for field in ("cash", "mehdi", "roham", "receivable")}
    OpeningBalance.objects.update_or_create(year=year, defaults=balances)
    return {"saved": True}


def safe_csv(value):
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


@api("GET", owner=True, staff=True)
def export(request, kind):
    response = HttpResponse("\ufeff", content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{kind}.csv"'
    writer = csv.writer(response)
    if kind == "sales":
        start, end = sales_range(request.GET, default=True)
        lower, upper = time_bounds(start, end)
        qs = OrderItem.objects.filter(order__status=Order.Status.PAID, order__closed_at__gte=lower,
                                      order__closed_at__lt=upper).select_related("order").order_by("order__closed_at", "pk")
        writer.writerow(["تاریخ شمسی", "ساعت", "آیتم", "تعداد", "قیمت واحد", "جمع فروش", "متریال واحد", "شماره سفارش"])
        for item in qs.iterator():
            when = item.order.closed_at.astimezone(TEHRAN)
            writer.writerow([jdatetime.date.fromgregorian(date=when.date()).isoformat(), when.strftime("%H:%M:%S"),
                             safe_csv(item.name), item.quantity, item.unit_price, item.line_total, item.unit_cost,
                             safe_csv(item.order.legacy_number or item.order.id)])
    elif kind in ("accounts", "withdrawals"):
        year, _ = ledger_scope(request.GET)
        rows = Transaction.objects.filter(year=year).order_by("month", F("day").asc(nulls_first=True), "pk")
        if kind == "withdrawals":
            rows = rows.filter(kind=Transaction.Kind.WITHDRAW, person__in=[Transaction.Person.MEHDI, Transaction.Person.ROHAM])
        writer.writerow(["ماه", "تاریخ شمسی", "شخص", "نوع تراکنش", "مبلغ (تومان)", "یادداشت"])
        for row in rows.iterator():
            writer.writerow([MONTHS[row.month - 1], f"{row.year}/{row.month:02}/{row.day:02}" if row.day else "",
                             row.get_person_display(), row.get_kind_display(), row.amount, safe_csv(row.note)])
    else:
        raise ApiError("نوع خروجی معتبر نیست.", 404)
    return response
