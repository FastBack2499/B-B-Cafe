import os
import re
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
DEBUG = os.environ.get("DJANGO_DEBUG") == "1"
SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
STAFF_ROUTE_KEY = os.environ["STAFF_ROUTE_KEY"]
if not DEBUG and (not re.fullmatch(r"[A-Za-z0-9_-]{24,128}", STAFF_ROUTE_KEY) or len(SECRET_KEY) < 50):
    raise ImproperlyConfigured("Generate independent private values for STAFF_ROUTE_KEY and DJANGO_SECRET_KEY.")
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
CSRF_TRUSTED_ORIGINS = [origin for origin in os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",") if origin]
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
DATABASES = {"default": dj_database_url.parse(os.environ["DATABASE_URL"], conn_max_age=0)}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
INSTALLED_APPS = ["django.contrib.auth", "django.contrib.contenttypes", "django.contrib.sessions", "cafe"]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
TEMPLATES = [{"BACKEND": "django.template.backends.django.DjangoTemplates", "APP_DIRS": True}]
CSRF_FAILURE_VIEW = "cafe.views.csrf_failure"
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
LANGUAGE_CODE = "fa"
TIME_ZONE = "Asia/Tehran"
USE_TZ = True
APPEND_SLASH = False
SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_HTTPONLY = CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_NAME = "bnb_session" if DEBUG else "__Host-bnb_session"
CSRF_COOKIE_NAME = "bnb_csrf" if DEBUG else "__Host-bnb_csrf"
SESSION_COOKIE_SAMESITE = CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 8 * 60 * 60
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = not DEBUG
SECURE_HSTS_SECONDS = 31536000 if not DEBUG else 0
SECURE_REFERRER_POLICY = "no-referrer"
X_FRAME_OPTIONS = "DENY"
DATA_UPLOAD_MAX_MEMORY_SIZE = 128 * 1024
