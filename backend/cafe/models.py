from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

NONNEGATIVE = MinValueValidator(0)


def money(**kwargs):
    return models.DecimalField(max_digits=16, decimal_places=4, validators=[NONNEGATIVE], **kwargs)


class Category(models.Model):
    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=80)
    position = models.PositiveSmallIntegerField()

    class Meta:
        ordering = ["position"]


class CafeSettings(models.Model):
    currency = models.CharField(max_length=24, default="تومان")
    display_multiplier = models.PositiveIntegerField(default=1000, validators=[MinValueValidator(1)])


class Product(models.Model):
    code = models.PositiveIntegerField(unique=True, validators=[MinValueValidator(1)])
    category = models.ForeignKey(Category, on_delete=models.PROTECT)
    name = models.CharField(max_length=150)
    description = models.CharField(max_length=300, blank=True)
    price = money(null=True, blank=True)
    material_cost = money(null=True, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["category__position", "code"]


class Ingredient(models.Model):
    name = models.CharField(max_length=100, unique=True)
    unit = models.CharField(max_length=32)
    unit_cost = money()

    class Meta:
        ordering = ["name"]


class RecipeItem(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="recipe")
    ingredient = models.ForeignKey(Ingredient, on_delete=models.PROTECT)
    quantity = models.DecimalField(max_digits=12, decimal_places=6, validators=[MinValueValidator(Decimal("0.000001"))])

    class Meta:
        constraints = [models.UniqueConstraint(fields=["product", "ingredient"], name="one_ingredient_per_product")]


class Order(models.Model):
    class Status(models.TextChoices):
        OPEN = "open", "در انتظار"
        PAID = "paid", "تسویه‌شده"
        CANCELLED = "cancelled", "لغوشده"

    class Payment(models.TextChoices):
        CASH = "cash", "نقدی"
        CARD = "card", "کارت‌خوان"
        TRANSFER = "transfer", "انتقال بانکی"
        OTHER = "other", "ثبت نشده"

    status = models.CharField(max_length=12, choices=Status, default=Status.OPEN)
    created_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    closed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    subtotal = money(default=0)
    discount = money(default=0)
    total = money(default=0)
    note = models.CharField(max_length=250, blank=True)
    payment = models.CharField(max_length=12, choices=Payment, blank=True)
    request_id = models.UUIDField(unique=True, null=True)
    request_hash = models.CharField(max_length=64, blank=True)
    legacy_key = models.CharField(max_length=180, unique=True, null=True)
    legacy_number = models.CharField(max_length=60, blank=True)

    class Meta:
        indexes = [models.Index(fields=["status", "closed_at"]), models.Index(fields=["status", "id"])]


class OrderItem(models.Model):
    order = models.ForeignKey(Order, related_name="items", on_delete=models.CASCADE)
    product = models.ForeignKey(Product, null=True, on_delete=models.SET_NULL)
    name = models.CharField(max_length=150)
    quantity = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    unit_price = money()
    unit_cost = money(null=True)
    line_total = money()


class OrderClosure(models.Model):
    key = models.UUIDField(primary_key=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    fingerprint = models.CharField(max_length=64)
    count = models.PositiveIntegerField(default=0)


class SalesTarget(models.Model):
    start = models.DateField()
    end = models.DateField()
    amount = money()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["start", "end"], name="one_target_per_range"),
            models.CheckConstraint(condition=models.Q(end__gte=models.F("start")), name="target_date_order"),
        ]


class ManualSale(models.Model):
    date = models.DateField(db_index=True)
    amount = money()
    note = models.CharField(max_length=200, blank=True)
    source_key = models.CharField(max_length=80, unique=True, null=True)


class Transaction(models.Model):
    class Person(models.TextChoices):
        MEHDI = "mehdi", "مهدی"
        ROHAM = "roham", "رهام"
        KAMYAR = "kamyar", "کامیار"

    class Kind(models.TextChoices):
        DEPOSIT = "deposit", "واریز به صندوق"
        WITHDRAW = "withdraw", "برداشت از صندوق"
        PURCHASE = "purchase", "خرید از صندوق"
        PAYROLL = "payroll", "پرداخت حقوق"

    year = models.PositiveSmallIntegerField(db_index=True)
    month = models.PositiveSmallIntegerField()
    day = models.PositiveSmallIntegerField(null=True, blank=True)
    person = models.CharField(max_length=12, choices=Person)
    kind = models.CharField(max_length=12, choices=Kind)
    amount = models.PositiveBigIntegerField(validators=[MinValueValidator(1)])
    note = models.CharField(max_length=250, blank=True)
    source_key = models.CharField(max_length=80, unique=True, null=True)

    class Meta:
        indexes = [models.Index(fields=["year", "month", "day"])]
        constraints = [models.CheckConstraint(condition=models.Q(month__range=(1, 12)), name="transaction_month_range")]


class OpeningBalance(models.Model):
    year = models.PositiveSmallIntegerField(unique=True)
    cash = models.BigIntegerField(default=0)
    mehdi = models.BigIntegerField(default=0)
    roham = models.BigIntegerField(default=0)
    receivable = models.BigIntegerField(default=0)


class LoginThrottle(models.Model):
    key = models.CharField(max_length=64, primary_key=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    until = models.DateTimeField(db_index=True)
