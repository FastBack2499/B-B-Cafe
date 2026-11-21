from django.urls import include, path

from cafe import views

staff = [
    path("session", views.session),
    path("password", views.password_change),
    path("menu", views.staff_menu),
    path("orders", views.orders),
    path("orders/close", views.close_orders),
    path("lines/<int:identifier>/cost", views.fix_cost),
    path("manage/menu", views.manage_menu),
    path("manage/menu/<int:identifier>", views.update_product),
    path("manage/categories", views.categories),
    path("manage/categories/<slug:slug>", views.categories),
    path("manage/currency", views.menu_settings),
    path("manage/ingredients", views.ingredients),
    path("manage/ingredients/<int:identifier>", views.ingredients),
    path("reports/sales", views.sales_report),
    path("reports/target", views.target),
    path("reports/manual", views.manual_sale),
    path("reports/manual/<int:identifier>", views.manual_sale),
    path("accounts", views.accounts),
    path("accounts/transaction", views.movement),
    path("accounts/transaction/<int:identifier>", views.movement),
    path("accounts/opening", views.opening_balance),
    path("export/<slug:kind>", views.export),
]
urlpatterns = [path("api/menu", views.public_menu), path("api/staff/<slug:key>/", include(staff))]
