from django.core.validators import MinValueValidator
from django.db import migrations, models


def set_toman_display(apps, schema_editor):
    settings = apps.get_model("cafe", "CafeSettings").objects.using(schema_editor.connection.alias)
    settings.get_or_create(pk=1, defaults={"currency": "تومان", "display_multiplier": 1000})
    settings.filter(pk=1, currency="واحد منو", display_multiplier=1).update(
        currency="تومان", display_multiplier=1000,
    )


class Migration(migrations.Migration):
    dependencies = [("cafe", "0002_orderclosure")]

    operations = [
        migrations.AlterField(
            model_name="cafesettings",
            name="currency",
            field=models.CharField(default="تومان", max_length=24),
        ),
        migrations.AlterField(
            model_name="cafesettings",
            name="display_multiplier",
            field=models.PositiveIntegerField(default=1000, validators=[MinValueValidator(1)]),
        ),
        migrations.RunPython(set_toman_display, migrations.RunPython.noop),
    ]
