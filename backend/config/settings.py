import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env(name, default=None):
    return os.environ.get(name, default)


def env_bool(name, default=False):
    return env(name, str(default)).lower() in ("1", "true", "yes", "on")


SECRET_KEY = env("DJANGO_SECRET_KEY", "dev-insecure-change-me")
DEBUG = env_bool("DJANGO_DEBUG", True)
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "apps.accounts",
    "apps.billing",
    "apps.social",
    "apps.studio",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
        "OPTIONS": {"timeout": 20, "init_command": "PRAGMA journal_mode=WAL;"},
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# The Next.js dev server proxies /api/* and /media/* here, so the browser sees one origin.
PUBLIC_APP_URL = env("PUBLIC_APP_URL", "http://localhost:3000")
CSRF_TRUSTED_ORIGINS = [o for o in env("CSRF_TRUSTED_ORIGINS", PUBLIC_APP_URL).split(",") if o]
if DEBUG:
    CSRF_TRUSTED_ORIGINS += [f"http://{h}:{p}" for h in ("localhost", "127.0.0.1") for p in range(3000, 3006)]
SESSION_COOKIE_NAME = "tl_session"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 14

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_RATES": {"generation": "30/min"},
    "EXCEPTION_HANDLER": "apps.accounts.exceptions.api_exception_handler",
}

TOKEN_ENCRYPTION_KEY = env("TOKEN_ENCRYPTION_KEY", "")
if not DEBUG and (not TOKEN_ENCRYPTION_KEY or SECRET_KEY.startswith("dev-")):
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured("Set DJANGO_SECRET_KEY and TOKEN_ENCRYPTION_KEY when DJANGO_DEBUG is off.")

# Providers: "fake" runs the whole pipeline offline for $0.
LLM_PROVIDER = env("LLM_PROVIDER", "fake")  # fake | openrouter
IMAGE_PROVIDER = env("IMAGE_PROVIDER", "fake")  # fake | fal
VIDEO_PROVIDER = env("VIDEO_PROVIDER", "fake")  # fake | fal
TTS_PROVIDER = env("TTS_PROVIDER", "fake")  # fake | fal

OPENROUTER_API_KEY = env("OPENROUTER_API_KEY", "")
LLM_BASE_URL = env("LLM_BASE_URL", "https://openrouter.ai/api/v1")
LLM_CHAT_MODEL = env("LLM_CHAT_MODEL", "google/gemini-2.5-flash")
LLM_STORY_MODEL = env("LLM_STORY_MODEL", "anthropic/claude-sonnet-5.5")

FAL_KEY = env("FAL_KEY", "")
FAL_IMAGE_MODEL = env("FAL_IMAGE_MODEL", "fal-ai/flux/schnell")
FAL_IMAGE_REF_MODEL = env("FAL_IMAGE_REF_MODEL", "fal-ai/bytedance/seedream/v4.5/edit")
FAL_VIDEO_MODEL_STANDARD = env("FAL_VIDEO_MODEL_STANDARD", "fal-ai/kling-video/v2.5-turbo/pro/image-to-video")
FAL_VIDEO_MODEL_PREMIUM = env("FAL_VIDEO_MODEL_PREMIUM", "fal-ai/kling-video/v3/pro/image-to-video")
FAL_TTS_MODEL = env("FAL_TTS_MODEL", "fal-ai/kokoro/american-english")
FAL_STT_MODEL = env("FAL_STT_MODEL", "fal-ai/whisper")

# Rough USD estimates for the ledger; update after the model spike.
COST_ESTIMATES = {
    "image": float(env("COST_IMAGE_USD", "0.006")),
    "image_ref": float(env("COST_IMAGE_REF_USD", "0.04")),
    "video_second_standard": float(env("COST_VIDEO_SECOND_STANDARD_USD", "0.07")),
    "video_second_premium": float(env("COST_VIDEO_SECOND_PREMIUM_USD", "0.112")),
    "tts_1k_chars": float(env("COST_TTS_1K_CHARS_USD", "0.02")),
}

FFMPEG_BIN = env("FFMPEG_BIN", "")
MAX_CONCURRENT_RENDERS_PER_ORG = int(env("MAX_CONCURRENT_RENDERS_PER_ORG", "2"))

OAUTH = {
    "youtube": {"client_id": env("GOOGLE_CLIENT_ID", ""), "client_secret": env("GOOGLE_CLIENT_SECRET", "")},
    "facebook": {"client_id": env("META_APP_ID", ""), "client_secret": env("META_APP_SECRET", "")},
    "instagram": {"client_id": env("INSTAGRAM_APP_ID", ""), "client_secret": env("INSTAGRAM_APP_SECRET", "")},
}
META_GRAPH_VERSION = env("META_GRAPH_VERSION", "v21.0")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}
