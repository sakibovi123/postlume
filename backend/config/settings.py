import os
import sys
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
# Writable data (SQLite + rendered media). On Railway this is a volume mounted at /data.
DATA_DIR = Path(env("DATA_DIR", str(BASE_DIR)))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# The frontend proxies to the backend over Railway's private network (*.railway.internal).
ALLOWED_HOSTS = [h for h in env("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,.railway.internal,.up.railway.app,healthcheck.railway.app").split(",") if h]

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
    "apps.generate",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
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

if env("DATABASE_URL"):
    import dj_database_url

    DATABASES = {"default": dj_database_url.parse(env("DATABASE_URL"), conn_max_age=60, conn_health_checks=True)}
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": DATA_DIR / "db.sqlite3",
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
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(env("MEDIA_ROOT", str(DATA_DIR / "media")))
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# The Next.js dev server proxies /api/* and /media/* here, so the browser sees one origin.
PUBLIC_APP_URL = env("PUBLIC_APP_URL", "http://localhost:8020").strip().rstrip("/")
if PUBLIC_APP_URL and not PUBLIC_APP_URL.startswith("http"):
    PUBLIC_APP_URL = f"https://{PUBLIC_APP_URL}"
CSRF_TRUSTED_ORIGINS = [o for o in env("CSRF_TRUSTED_ORIGINS", PUBLIC_APP_URL).split(",") if o]
if env("RAILWAY_PUBLIC_DOMAIN"):
    CSRF_TRUSTED_ORIGINS.append(f"https://{env('RAILWAY_PUBLIC_DOMAIN')}")
if not env("PUBLIC_APP_URL") and not DEBUG:
    # Fallback until PUBLIC_APP_URL is set; the CSRF token and SameSite cookies still apply.
    CSRF_TRUSTED_ORIGINS.append("https://*.up.railway.app")
if DEBUG:
    CSRF_TRUSTED_ORIGINS += [f"http://{h}:{p}" for h in ("localhost", "127.0.0.1") for p in [*range(3000, 3006), 8020]]
SESSION_COOKIE_NAME = "tl_session"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 14
if not DEBUG and PUBLIC_APP_URL.startswith("https://"):
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_RATES": {"generation": "30/min"},
    "EXCEPTION_HANDLER": "apps.accounts.exceptions.api_exception_handler",
}

# Optional: when empty, a key is derived from DJANGO_SECRET_KEY (so rotating that key invalidates stored tokens).
TOKEN_ENCRYPTION_KEY = env("TOKEN_ENCRYPTION_KEY", "")
if not DEBUG and SECRET_KEY.startswith("dev-"):
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured("Set DJANGO_SECRET_KEY to a long random value when DJANGO_DEBUG is off.")

# Providers: "fake" runs the whole pipeline offline for $0.
LLM_PROVIDER = env("LLM_PROVIDER", "fake")  # fake | openrouter
# Chat and story generation run in background threads; tests run them inline.
TASKS_EAGER = env_bool("TASKS_EAGER", False)
# How long the fake LLM takes to "stream" a reply, so the live UI can be developed offline.
FAKE_LLM_STREAM_SECONDS = float(env("FAKE_LLM_STREAM_SECONDS", "4"))
IMAGE_PROVIDER = env("IMAGE_PROVIDER", "fake")  # fake | fal
VIDEO_PROVIDER = env("VIDEO_PROVIDER", "fake")  # fake | fal
TTS_PROVIDER = env("TTS_PROVIDER", "fake")  # fake | fal

for _name, _value, _allowed in [("LLM_PROVIDER", LLM_PROVIDER, ("fake", "openrouter")),
                                ("IMAGE_PROVIDER", IMAGE_PROVIDER, ("fake", "fal")),
                                ("VIDEO_PROVIDER", VIDEO_PROVIDER, ("fake", "fal")),
                                ("TTS_PROVIDER", TTS_PROVIDER, ("fake", "fal"))]:
    if _value not in _allowed:
        from django.core.exceptions import ImproperlyConfigured

        raise ImproperlyConfigured(f"{_name}={_value!r} is not valid; use one of: {', '.join(_allowed)}")

# The test suite must never call paid providers, whatever .env says.
if len(sys.argv) > 1 and sys.argv[1] == "test":
    LLM_PROVIDER = IMAGE_PROVIDER = VIDEO_PROVIDER = TTS_PROVIDER = "fake"

OPENROUTER_API_KEY = env("OPENROUTER_API_KEY", "")
LLM_BASE_URL = env("LLM_BASE_URL", "https://openrouter.ai/api/v1")
LLM_CHAT_MODEL = env("LLM_CHAT_MODEL", "google/gemini-2.5-flash")
LLM_STORY_MODEL = env("LLM_STORY_MODEL", "anthropic/claude-sonnet-5.5")

FAL_KEY = env("FAL_KEY", "")
# Generate page: credits are charged from fal's listed price at this rate.
USD_PER_CREDIT = float(env("USD_PER_CREDIT", "0.05"))
GENERATE_POLL_SECONDS = float(env("GENERATE_POLL_SECONDS", "2"))
GENERATE_CHARGE_CREDITS = env_bool("GENERATE_CHARGE_CREDITS", False)
VIDEO_MODEL_BEST = env("VIDEO_MODEL_BEST", "minimax/h3-max/text-to-video")
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
SIGNUP_ENABLED = env_bool("SIGNUP_ENABLED", False)
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
