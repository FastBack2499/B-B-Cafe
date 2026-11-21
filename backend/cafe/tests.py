import uuid
from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.utils import timezone

from .calculations import TEHRAN, ledger
from .models import Category, ManualSale, Order, OrderItem, Product, Transaction


class CafeWorkflows(TestCase):
    @classmethod
    def setUpTestData(cls):
        users = get_user_model()
        cls.owner = users.objects.create_superuser(username="manager", password="initial-owner-test-password")
        cls.barista = users.objects.create_user(username="worker", password="initial-barista-test-password")
        cls.product = Product.objects.create(
            code=1, name="قهوه", price=80, material_cost=30,
            category=Category.objects.create(slug="espresso", name="قهوه", position=1),
        )

    def staff_url(self, path):
        return "/api/staff/" + settings.STAFF_ROUTE_KEY + path

    def json(self, client, path, body, method="post"):
        return getattr(client, method)(self.staff_url(path), body, content_type="application/json")

    def order(self, client, **changes):
        return self.json(client, "/orders", {
            "request_id": str(uuid.uuid4()),
            "items": [{"id": self.product.pk, "quantity": 2, "price": "80"}],
            **changes,
        })

    def test_secret_auth_and_csrf(self):
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(client.get("/api/staff/wrong/session").status_code, 404)
        self.assertEqual(client.get(self.staff_url("/orders")).status_code, 401)
        token = client.get(self.staff_url("/session")).json()["csrf"]
        login_data = {"username": self.barista.username, "password": "initial-barista-test-password"}
        self.assertEqual(self.json(client, "/session", login_data).status_code, 403)
        response = client.post(self.staff_url("/session"), login_data, content_type="application/json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.json()["user"]["role"], "barista")
        self.assertEqual(client.get(self.staff_url("/accounts")).status_code, 403)
        menu = client.get("/api/menu").json()
        self.assertNotIn("cost", menu["products"][0])
        self.assertEqual(menu["settings"], {"currency": "تومان", "multiplier": 1000})

    def test_password_change_is_owner_only(self):
        self.client.force_login(self.barista)
        denied = self.json(self.client, "/password", {
            "current": "initial-barista-test-password",
            "password": "a-new-barista-password-777",
        })
        self.assertEqual(denied.status_code, 403)
        self.barista.refresh_from_db()
        self.assertTrue(self.barista.check_password("initial-barista-test-password"))

        self.client.force_login(self.owner)
        changed = self.json(self.client, "/password", {
            "current": "initial-owner-test-password",
            "password": "a-new-manager-password-999",
        })
        self.assertEqual(changed.status_code, 200)
        self.owner.refresh_from_db()
        self.assertTrue(self.owner.check_password("a-new-manager-password-999"))

    def test_percentage_and_fixed_discounts_combine(self):
        self.client.force_login(self.barista)
        identifier = str(uuid.uuid4())
        receipt = self.order(self.client, request_id=identifier, discount="10", discount_percent="12.50")
        self.assertEqual(receipt.status_code, 200)
        self.assertEqual(Decimal(receipt.json()["discount"]), Decimal(30))
        self.assertEqual(Decimal(receipt.json()["total"]), Decimal(130))
        same = self.order(self.client, request_id=identifier, discount="10.0", discount_percent="12.5")
        self.assertEqual(same.json()["id"], receipt.json()["id"])
        self.assertEqual(self.order(self.client, request_id=identifier, discount="10", discount_percent="20").status_code, 409)

        for discount, percent in [("0", "101"), ("0", "-1"), ("0", "abc"), ("1", "100")]:
            with self.subTest(discount=discount, percent=percent):
                self.assertEqual(self.order(self.client, discount=discount, discount_percent=percent).status_code, 400)
        self.assertEqual(Order.objects.count(), 1)

    def test_order_retry_price_and_settlement_snapshots(self):
        self.client.force_login(self.barista)
        identifier = str(uuid.uuid4())
        submitted = self.order(self.client, request_id=identifier, discount="10")
        self.assertEqual(submitted.status_code, 200)
        order_id = submitted.json()["id"]
        self.assertEqual(self.order(self.client, request_id=identifier, discount="10").json()["id"], order_id)
        self.assertEqual(Order.objects.count(), 1)
        self.assertNotIn("cost", submitted.json()["items"][0])
        Product.objects.filter(pk=self.product.pk).update(price=100, material_cost=40)
        self.assertEqual(self.order(self.client).status_code, 409)

        self.client.force_login(self.owner)
        self.assertEqual(self.client.get(self.staff_url("/orders")).json()["orders"][0]["id"], order_id)
        closure = {"id": order_id, "action": "first", "status": "paid", "payment": "cash", "request_id": str(uuid.uuid4())}
        self.assertEqual(self.json(self.client, "/orders/close", closure).json(), {"closed": 1})
        self.assertEqual(self.json(self.client, "/orders/close", closure).json(), {"closed": 1})
        Product.objects.filter(pk=self.product.pk).update(material_cost=500)
        line = OrderItem.objects.get()
        self.assertEqual((line.unit_price, line.unit_cost), (Decimal(80), Decimal(40)))

        day = timezone.localdate(timezone=TEHRAN)
        today = str(day)
        report = self.client.get(self.staff_url("/reports/sales"), {"start": today, "end": today}).json()
        self.assertEqual((Decimal(report["sales"]), Decimal(report["profit"])), (Decimal(150), Decimal(70)))
        yesterday = str(day - timedelta(days=1))
        self.assertEqual(self.client.get(self.staff_url("/reports/sales"),
                                        {"start": yesterday, "end": yesterday}).json()["orders"], 0)

    def test_cancel_retains_details_and_excludes_sale(self):
        self.client.force_login(self.barista)
        order_id = self.order(self.client).json()["id"]
        data = {"id": order_id, "action": "one", "status": "cancelled", "request_id": str(uuid.uuid4())}
        self.assertEqual(self.json(self.client, "/orders/close", data).status_code, 200)
        history = self.client.get(self.staff_url("/orders"), {"status": "history"}).json()["orders"]
        self.assertEqual(history[0]["status"], "cancelled")
        self.assertEqual(history[0]["items"][0]["quantity"], 2)

    def test_fair_withdrawals_and_month_carry(self):
        for person, kind, amount in [
            ("mehdi", "deposit", 100), ("roham", "deposit", 60), ("mehdi", "purchase", 20),
            ("mehdi", "payroll", 15), ("kamyar", "deposit", 8), ("mehdi", "withdraw", 10),
        ]:
            Transaction.objects.create(year=1405, month=8, amount=amount, person=person, kind=kind)
        month, following_month = ledger(1405)[7:9]
        self.assertEqual(month["cash"], 123)
        self.assertEqual(month["receivable"], 12)
        self.assertEqual(month["mehdi_available"], Decimal("76.5"))
        self.assertEqual(month["roham_available"], Decimal("46.5"))
        self.assertEqual(following_month["opening"], 123)
        self.assertEqual(following_month["receivable"], 12)

    def test_cash_transaction_accepts_unimported_entries(self):
        fields = {
            "year": "1405", "month": "8", "day": "30", "person": "mehdi",
            "kind": "deposit", "amount": "11250000", "note": "",
        }
        self.client.force_login(self.owner)
        saved = self.json(self.client, "/accounts/transaction", fields)
        self.assertEqual(saved.status_code, 200)
        entry = Transaction.objects.get()
        self.assertEqual((entry.day, entry.amount, entry.source_key), (30, 11250000, None))
        saved = self.json(self.client, f"/accounts/transaction/{entry.pk}", {**fields, "day": ""}, "patch")
        self.assertEqual(saved.status_code, 200)
        entry.refresh_from_db()
        self.assertIsNone(entry.day)
        invalid = self.json(self.client, "/accounts/transaction", {**fields, "day": "31"})
        self.assertEqual(invalid.status_code, 400)
        self.assertIn("روز", invalid.json()["error"])
        self.assertEqual(Transaction.objects.count(), 1)

    def test_staff_manual_sale_appears_in_owner_report_once(self):
        values = {"day": "۱۴۰۵/۰۸/۳۰", "amount": "125000", "request_id": str(uuid.uuid4())}
        self.assertEqual(self.json(self.client, "/orders/manual", values).status_code, 401)
        self.client.force_login(self.barista)
        entry = self.json(self.client, "/orders/manual", values)
        self.assertEqual(entry.status_code, 200)
        self.assertEqual(self.json(self.client, "/orders/manual", values).json(), entry.json())
        self.assertEqual(self.json(self.client, "/orders/manual", {**values, "amount": "125001"}).status_code, 409)
        self.assertEqual(self.json(self.client, "/orders/manual", {**values, "day": "1405/08/31"}).status_code, 400)
        self.assertEqual(self.client.get(self.staff_url("/reports/sales")).status_code, 403)
        self.assertEqual(self.json(self.client, "/reports/manual", values).status_code, 403)
        self.assertEqual(ManualSale.objects.count(), 1)
        self.assertEqual(ManualSale.objects.get().date, date(2026, 11, 21))

        self.client.force_login(self.owner)
        report = self.client.get(self.staff_url("/reports/sales"), {
            "start": "1405/08/30", "end": "1405/08/30",
        }).json()
        self.assertEqual(report["manual"][0]["id"], entry.json()["id"])
        self.assertEqual(Decimal(report["manual_total"]), Decimal("125000"))

    def test_retried_bulk_close_does_not_close_later_orders(self):
        self.client.force_login(self.owner)
        self.assertEqual(self.order(self.client).status_code, 200)
        self.assertEqual(self.order(self.client).status_code, 200)
        operation = {"action": "all", "status": "paid", "payment": "card", "request_id": str(uuid.uuid4())}
        self.assertEqual(self.json(self.client, "/orders/close", operation).json(), {"closed": 2})
        later_id = self.order(self.client).json()["id"]
        self.assertEqual(self.json(self.client, "/orders/close", operation).json(), {"closed": 2})
        self.assertEqual(Order.objects.get(pk=later_id).status, "open")
