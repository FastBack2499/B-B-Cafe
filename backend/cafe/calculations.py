from decimal import Decimal
from zoneinfo import ZoneInfo

import jdatetime
from django.db.models import Sum
from django.utils import timezone

from .models import OpeningBalance, Product, Transaction

TEHRAN = ZoneInfo("Asia/Tehran")
MONTHS = (
    "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
    "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
)
DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def current_jalali():
    return jdatetime.date.fromgregorian(date=timezone.localdate(timezone=TEHRAN))


def jalali_date(value):
    parts = value.translate(DIGITS).replace("-", "/").split("/")
    return jdatetime.date(*(int(part) for part in parts))


def catalog():
    return Product.objects.select_related("category").prefetch_related("recipe__ingredient")


def product_cost(product):
    recipe = list(product.recipe.all())
    if recipe:
        return sum(item.quantity * item.ingredient.unit_cost for item in recipe).quantize(
            Decimal("0.0001"), rounding="ROUND_HALF_UP"
        )
    return product.material_cost


def ledger(year):
    opening = OpeningBalance.objects.filter(year__lte=year).order_by("-year").first()
    origin = opening.year if opening else min(1405, year)
    cash, mehdi, roham, receivable = (
        (opening.cash, opening.mehdi, opening.roham, opening.receivable) if opening else (0, 0, 0, 0)
    )
    totals = {}
    for row in Transaction.objects.filter(year__range=(origin, year)).values(
        "year", "month", "person", "kind"
    ).annotate(total=Sum("amount")):
        totals.setdefault((row["year"], row["month"]), {})[(row["person"], row["kind"])] = row["total"]

    report = []
    for period_year in range(origin, year + 1):
        cumulative_purchases = cumulative_repayments = 0
        for month in range(1, 13):
            amounts = totals.get((period_year, month), {})
            persons = Transaction.Person
            kinds = Transaction.Kind
            deposits, withdrawals, purchases, payroll = (
                sum(amounts.get((person, kind), 0) for person in persons) for kind in kinds
            )
            repayment = amounts.get((persons.KAMYAR, kinds.DEPOSIT), 0)
            start, start_receivable = cash, receivable
            start_mehdi, start_roham = mehdi, roham
            cash += deposits - withdrawals - purchases - payroll
            receivable += purchases - repayment
            mehdi_withdrawal = amounts.get((persons.MEHDI, kinds.WITHDRAW), 0)
            roham_withdrawal = amounts.get((persons.ROHAM, kinds.WITHDRAW), 0)
            mehdi += amounts.get((persons.MEHDI, kinds.DEPOSIT), 0) - mehdi_withdrawal
            roham += amounts.get((persons.ROHAM, kinds.DEPOSIT), 0) - roham_withdrawal
            difference = mehdi - roham
            cumulative_purchases += purchases
            cumulative_repayments += repayment
            if period_year == year:
                report.append({
                    "month": month, "name": MONTHS[month - 1], "opening": start, "cash": cash,
                    "deposits": deposits, "withdrawals": withdrawals, "purchases": purchases, "payroll": payroll,
                    "repayment": repayment, "receivable": receivable, "opening_receivable": start_receivable,
                    "mehdi": mehdi, "roham": roham, "difference": difference,
                    "opening_mehdi": start_mehdi, "opening_roham": start_roham,
                    "mehdi_withdrawal": mehdi_withdrawal, "roham_withdrawal": roham_withdrawal,
                    "mehdi_available": max(0, min(cash, Decimal(cash + difference) / 2)),
                    "roham_available": max(0, min(cash, Decimal(cash - difference) / 2)),
                    "cumulative_purchases": cumulative_purchases, "cumulative_repayments": cumulative_repayments,
                })
    return report
