import getpass

from django.contrib.auth import get_user_model, password_validation
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Create a cafe barista account."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("--name", default="باریستا")

    def handle(self, *args, **options):
        user_model = get_user_model()
        user = user_model(username=options["username"], first_name=options["name"])
        password = getpass.getpass("Password: ")
        if password != getpass.getpass("Confirm password: "):
            raise CommandError("Passwords differ.")
        try:
            user.full_clean()
            password_validation.validate_password(password, user)
        except ValidationError as error:
            raise CommandError("; ".join(error.messages)) from error
        user.set_password(password)
        user.save()
        self.stdout.write(self.style.SUCCESS("Barista account created."))
