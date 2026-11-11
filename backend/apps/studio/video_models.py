"""AI video models Lumen can offer for animating scenes, priced in Postlume credits.

The provider is an implementation detail: nothing returned from here names it, and model keys have the
provider's namespace stripped (see `public_key` / `endpoint`). Live catalog and prices come from the same
catalog the All models page uses; when that's unavailable (no API key, demo mode) we fall back to the two
models configured in settings.
"""

import logging
import math
import re
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings
from django.core.cache import cache

from apps.billing import service as billing
from providers.base import ProviderError, hide_provider

log = logging.getLogger(__name__)

PROVIDER_PREFIX = "fal-ai/"
CANDIDATES = 16
TOP = 5
SCENE_CLIP_SECONDS = 10
CACHE_KEY = "lumen:video-models:v1"

STYLE_WORDS = {
    "cinematic": ["cinematic", "film", "realistic", "photoreal"],
    "realistic": ["realistic", "photoreal", "cinematic"],
    "anime_2d": ["anime", "2d", "stylized", "cartoon"],
    "cartoon": ["cartoon", "stylized", "anime", "animation"],
    "animated_3d": ["3d", "animation", "pixar", "stylized"],
    "storybook": ["stylized", "illustration", "artistic"],
}

_SCRUB = re.compile(r"\b(on|via|from|by|using)\s+fal(\.ai)?\b|\bfal(\.ai)?(['’]s)?\b|\bfal-ai/?", re.I)
MIN_USD_PER_SECOND = 0.01  # anything cheaper is a price we couldn't read properly


def _scrub(text):
    """Model names/descriptions from the catalog: drop provider mentions entirely."""
    return hide_provider(re.sub(r"\s{2,}", " ", _SCRUB.sub("", text or "")).strip(" .,-"))


def public_key(endpoint_id):
    return endpoint_id[len(PROVIDER_PREFIX):] if endpoint_id.startswith(PROVIDER_PREFIX) else endpoint_id


def endpoint(key):
    """Turn a public model key back into the provider endpoint id. Only catalog models are accepted."""
    for m in catalog():
        if key in (m["key"], m["endpoint"]):
            return m
    return None


def _fallback():
    rates = settings.COST_ESTIMATES
    from .agent import _model_name

    return [
        {"endpoint": settings.FAL_VIDEO_MODEL_PREMIUM, "name": _model_name(settings.FAL_VIDEO_MODEL_PREMIUM),
         "blurb": "Top quality: the most realistic motion, lighting and detail.",
         "usdPerSecond": rates["video_second_premium"], "clipSeconds": SCENE_CLIP_SECONDS, "tags": ["cinematic", "realistic"]},
        {"endpoint": settings.FAL_VIDEO_MODEL_STANDARD, "name": _model_name(settings.FAL_VIDEO_MODEL_STANDARD),
         "blurb": "Fast, smooth, realistic motion at a good price.",
         "usdPerSecond": rates["video_second_standard"], "clipSeconds": SCENE_CLIP_SECONDS, "tags": ["cinematic"]},
    ]


def _describe(model):
    """Live catalog entry -> priced candidate, or None if it can't animate a still image or has no usable price."""
    from apps.generate import fal_api, shots

    try:
        info = fal_api.model_info(model["id"])
    except ProviderError:
        return None
    names = {f["name"] for f in info["fields"]}
    image = image_field(info)
    if "prompt" not in names or not image:
        return None
    # Skip special-purpose models that need inputs we can't supply (audio for lip-sync, masks, end frames…).
    if any(f["required"] and f["default"] is None and f["name"] not in ("prompt", image) for f in info["fields"]):
        return None
    clip = shots.clip_seconds(info) or 5
    clip = min(clip, SCENE_CLIP_SECONDS)
    values = {"duration": shots.duration_value(info, clip)} if "duration" in names else {}
    usd, _exact = fal_api.estimate(info, values)
    if not usd or usd / clip < MIN_USD_PER_SECOND:
        return None
    from .agent import MODEL_NAMES

    name = MODEL_NAMES.get(model["id"]) or _scrub(model["name"]) or public_key(model["id"])
    return {"endpoint": model["id"], "name": name,
            "blurb": _scrub(model["description"])[:180], "usdPerSecond": round(usd / clip, 4), "clipSeconds": clip,
            "tags": [t.lower() for t in model.get("tags") or []]}


def image_field(info):
    fields = info["fields"]
    preferred = next((f["name"] for f in fields if f["name"] in ("image_url", "start_image_url", "first_frame_url")), None)
    return preferred or next((f["name"] for f in fields if f.get("type") == "file" and f.get("accept") == "image"), None)


def catalog():
    cached = cache.get(CACHE_KEY)
    if cached is not None:
        return cached
    models = []
    if settings.FAL_KEY and settings.VIDEO_PROVIDER == "fal":
        from apps.generate import fal_api

        try:
            live = fal_api.list_models("image-to-video")
            configured = [m for m in live if m["id"] in (settings.FAL_VIDEO_MODEL_PREMIUM, settings.FAL_VIDEO_MODEL_STANDARD)]
            live = configured + [m for m in live[:CANDIDATES] if m not in configured]
            fal_api.prices([m["id"] for m in live])
            with ThreadPoolExecutor(max_workers=3) as pool:
                models = [m for m in pool.map(_describe, live) if m]
        except ProviderError as e:
            log.warning("Video model catalog unavailable: %s", e)
    if not models:
        models = _fallback()
    for m in models:
        m["key"] = public_key(m["endpoint"])
    cache.set(CACHE_KEY, models, 60 * 30 if len(models) >= TOP else 120)
    return models


def credits(model, seconds):
    """Credits for one episode: the lite pipeline (images, voice, music) plus the model's clip price."""
    clips = max(1, math.ceil(seconds / model["clipSeconds"]))
    usd = model["usdPerSecond"] * model["clipSeconds"] * clips
    return billing.video_credits("lite", seconds) + max(1, math.ceil(usd / settings.USD_PER_CREDIT))


def credits_for_key(key, seconds):
    m = endpoint(key)
    return credits(m, seconds) if m else None


def suggest(balance, seconds, episodes=1, style=""):
    """Top models the wallet can pay for at this length, best style fit first, plus the cheap lite option."""
    words = STYLE_WORDS.get(style, [style.lower()] if style else [])
    ranked = []
    for order, m in enumerate(catalog()):
        per = credits(m, seconds)
        text = " ".join([m["name"], m["blurb"], *m["tags"]]).lower()
        fit = sum(1 for w in words if w and w in text)
        ranked.append((per * episodes > balance, -fit, order, m, per))
    ranked.sort(key=lambda r: r[:3])
    options = [
        {"model": m["key"], "name": m["name"], "about": m["blurb"], "creditsPerEpisode": per,
         "creditsTotal": per * episodes, "affordable": not over}
        for over, _fit, _order, m, per in ranked
    ]
    affordable = [o for o in options if o["affordable"]][:TOP]
    lite = billing.video_credits("lite", seconds)
    return {
        "balance": balance,
        "episodes": episodes,
        "secondsPerEpisode": seconds,
        "options": affordable,
        "cheapestUnaffordable": None if affordable else next(iter(options), None),
        "lite": {"name": "Lite (no AI motion)", "about": "Still images with a slow camera pan and zoom. Fast and cheap.",
                 "creditsPerEpisode": lite, "creditsTotal": lite * episodes, "affordable": lite * episodes <= balance},
    }
