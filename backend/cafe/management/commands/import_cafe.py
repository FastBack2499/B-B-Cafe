from collections import defaultdict
from datetime import datetime, time
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Max
from django.db import connection, transaction
from openpyxl import load_workbook

from cafe.calculations import MONTHS, TEHRAN, jalali_date
from cafe.models import Category, ManualSale, OpeningBalance, Order, OrderItem, Product, SalesTarget, Transaction

CATEGORIES = [
    ("espresso", "بار گرم اسپرسو"), ("iced", "بار سرد اسپرسو"), ("matcha", "ماچا بار"),
    ("hot", "نوشیدنی گرم"), ("mocktail", "ماکتل"), ("shake", "شیک"),
    ("tea", "چای و دمنوش"), ("bakery", "کیک و کوکی"), ("breakfast", "صبحانه"),
]
PRODUCT_CATEGORIES = {
    **dict.fromkeys([1, 2, 3, 4, 11, 12, 13, 14, 16], "espresso"),
    **dict.fromkeys([5, 6, 7, 8, 9, 10, 25], "iced"),
    **dict.fromkeys([15, 21, 22, 23], "hot"),
    **dict.fromkeys([17, 18], "bakery"),
    **dict.fromkeys([19, 20, 24], "tea"),
    **dict.fromkeys(range(26, 32), "shake"),
}
ALIASES = {"لاته دبل": 8, "لاته تک": 7, "آمریکانو دبل": 6, "هات جاکلت": 15}


class Command(BaseCommand):
    help = "Import cafe menu, sales and accounting workbooks without running macros."

    def add_arguments(self, parser):
        parser.add_argument("--menu", required=True)
        parser.add_argument("--accounting", required=True)
        parser.add_argument("--dry-run", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        menu = load_workbook(options["menu"], read_only=True, data_only=True)
        accounting = load_workbook(options["accounting"], read_only=True, data_only=True)
        try:
            sheets = {name.lower(): menu[name] for name in menu.sheetnames}
            categories = {
                slug: Category.objects.get_or_create(slug=slug, defaults={"name": name, "position": position})[0]
                for position, (slug, name) in enumerate(CATEGORIES)
            }
            costs = {
                row[0]: row[2] for row in sheets["محاسبات منو"].values if isinstance(row[0], int)
            }
            products = {}
            draft = []
            pending_rows = []
            for index, row in enumerate(sheets["sheet1"].values, 1):
                if index == 1:
                    continue
                pending_rows.append((index, *row[15:18]))
                for offset in (0, 6):
                    code, name, price, quantity = row[offset:offset + 4]
                    if not name:
                        continue
                    product, _ = Product.objects.get_or_create(code=code, defaults={
                        "name": name.strip(), "price": price, "material_cost": costs.get(code),
                        "category": categories[PRODUCT_CATEGORIES.get(code, "hot")],
                    })
                    products[code] = product
                    if quantity:
                        draft.append((code, name, quantity))
            if draft:
                self.stdout.write(self.style.WARNING(
                    f"Workbook has {len(draft)} unsubmitted quantity selection(s); no invoice is issued for draft selections."
                ))

            names = {p.name: p for p in products.values()}
            names.update({name: products[code] for name, code in ALIASES.items() if code in products})
            sales = defaultdict(list)
            for index, row in enumerate(sheets["sheet2"].values, 1):
                if index == 1 or not any(value is not None for value in row[:5]):
                    continue
                day, clock, name, qty, price = row[:5]
                if not isinstance(day, datetime) or not isinstance(clock, time) or not name or not qty or price is None:
                    raise CommandError(f"Invalid historical sale on sheet2 row {index}.")
                closed_at = datetime.combine(day.date(), clock, tzinfo=TEHRAN)
                number = row[11] or ""
                key = f"pos:{closed_at.isoformat()}:{number or index}"
                sales[key].append((closed_at, number, name, qty, price, row[7]))

            line_count = 0
            largest_number = 0
            for key, lines in sales.items():
                closed_at, number = lines[0][:2]
                if isinstance(number, str) and number.startswith("Order #") and number[7:].isdigit():
                    largest_number = max(largest_number, int(number[7:]))
                total = sum(Decimal(str(price)) * qty for _, _, _, qty, price, _ in lines)
                order, created = Order.objects.get_or_create(legacy_key=key, defaults={
                    "closed_at": closed_at, "legacy_number": number, "status": Order.Status.PAID,
                    "payment": Order.Payment.OTHER, "subtotal": total, "total": total,
                })
                if created:
                    Order.objects.filter(pk=order.pk).update(created_at=closed_at)
                    OrderItem.objects.bulk_create([
                        OrderItem(order=order, product=names.get(name), name=name, quantity=qty,
                                  unit_price=price, unit_cost=cost, line_total=Decimal(str(price)) * qty)
                        for _, _, name, qty, price, cost in lines
                    ])
                line_count += len(lines)

            pending_count = 0
            receipt = None
            for index, label, value, price in pending_rows:
                if label is None and value is None and price is None:
                    continue
                if isinstance(label, str) and label.startswith("Order #") and label[7:].isdigit():
                    if receipt is not None:
                        raise CommandError(f"Unfinished receipt above menu row {index}.")
                    created_at = value if isinstance(value, datetime) else datetime.fromisoformat(value)
                    created_at = created_at.replace(tzinfo=TEHRAN)
                    receipt = (label, created_at, [])
                    largest_number = max(largest_number, int(label[7:]))
                elif receipt and (label, value, price) == ("Item", "Quantity", "Price"):
                    continue
                elif receipt and label == "Total Price:":
                    number, created_at, items = receipt
                    total = sum(price * quantity for _, quantity, price in items)
                    if not items or value is None or total != Decimal(str(value)):
                        raise CommandError(f"Receipt total does not match menu row {index}.")
                    order, created = Order.objects.get_or_create(
                        legacy_key=f"pending:{created_at.isoformat()}:{number}",
                        defaults={"legacy_number": number, "subtotal": total, "total": total},
                    )
                    if created:
                        Order.objects.filter(pk=order.pk).update(created_at=created_at)
                        OrderItem.objects.bulk_create([
                            OrderItem(order=order, product=names.get(name), name=name, quantity=quantity,
                                      unit_price=price, line_total=price * quantity)
                            for name, quantity, price in items
                        ])
                    pending_count += 1
                    receipt = None
                elif receipt and isinstance(label, str) and isinstance(value, int) and value > 0 and price is not None:
                    receipt[2].append((label, value, Decimal(str(price))))
                else:
                    raise CommandError(f"Invalid receipt entry on menu row {index}.")
            if receipt is not None:
                raise CommandError("The pending receipt section ends before its last total.")

            # Start web receipts above both historical receipt numbers and imported database IDs.
            if connection.vendor == "postgresql" and largest_number and not Order.objects.filter(legacy_key__isnull=True).exists():
                next_number = max(largest_number, Order.objects.aggregate(number=Max("pk"))["number"]) + 1
                with connection.cursor() as cursor:
                    table = connection.ops.quote_name(Order._meta.db_table)
                    cursor.execute(f"ALTER TABLE {table} ALTER COLUMN id RESTART WITH {next_number}")

            manual_count = 0
            for index, row in enumerate(sheets["دستی"].values, 1):
                if index == 1 or row[1] is None:
                    continue
                ManualSale.objects.get_or_create(source_key=f"manual:{index}", defaults={
                    "date": row[0].date(), "amount": row[1],
                })
                manual_count += 1

            report = sheets["حساب ماه"]
            start, end, target = (report[cell].value for cell in ("C4", "G4", "A7"))
            if start and end and target is not None:
                SalesTarget.objects.get_or_create(start=start.date(), end=end.date(), defaults={"amount": target})

            people = {"مهدي": Transaction.Person.MEHDI, **{label: k for k, label in Transaction.Person.choices}}
            kinds = {label: k for k, label in Transaction.Kind.choices}
            year = 1405
            first_month = accounting[MONTHS[0]]
            OpeningBalance.objects.get_or_create(year=year, defaults={
                "cash": first_month["B4"].value or 0, "receivable": first_month["N6"].value or 0,
            })
            movement_count = 0
            undated = 0
            for month, sheet_name in enumerate(MONTHS, 1):
                for index, row in enumerate(accounting[sheet_name].values, 1):
                    if index < 10 or not any(value is not None for value in row[:4]):
                        continue
                    day, person, kind, amount = row[:4]
                    if not person or not kind or amount is None:
                        raise CommandError(f"Incomplete account movement on {sheet_name} row {index}.")
                    parsed = jalali_date(day) if day else None
                    if parsed and (parsed.year, parsed.month) != (year, month):
                        raise CommandError(f"Date does not match {sheet_name} row {index}.")
                    Transaction.objects.get_or_create(source_key=f"ledger:{year}:{month}:{index}", defaults={
                        "year": year, "month": month, "day": parsed.day if parsed else None,
                        "person": people[person], "kind": kinds[kind], "amount": amount,
                    })
                    movement_count += 1
                    undated += parsed is None
            self.stdout.write(self.style.SUCCESS(
                f"Workbook records: {len(products)} products, {len(sales)} receipts, {line_count} sale lines, "
                f"{pending_count} pending receipts, {manual_count} manual sales, {movement_count} movements ({undated} without day)."
            ))
            if options["dry_run"]:
                transaction.set_rollback(True)
        finally:
            menu.close()
            accounting.close()
