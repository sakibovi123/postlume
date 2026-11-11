"""fal.ai catalog, input schemas and pricing, turned into a shape the frontend can render as a form."""

import math

import httpx
from django.conf import settings
from django.core.cache import cache

from providers.base import ProviderError

API = "https://api.fal.ai/v1"
OPENAPI = "https://fal.ai/api/openapi/queue/openapi.json"

CATEGORIES = [
    {"id": "text-to-video", "label": "Text to Video", "output": "video"},
    {"id": "image-to-video", "label": "Image to Video", "output": "video"},
    {"id": "video-to-video", "label": "Video to Video", "output": "video"},
    {"id": "text-to-image", "label": "Text to Image", "output": "image"},
    {"id": "image-to-image", "label": "Image to Image", "output": "image"},
    {"id": "text-to-audio", "label": "Text to Audio", "output": "audio"},
    {"id": "text-to-speech", "label": "Text to Speech", "output": "audio"},
]
CATEGORY_IDS = {c["id"] for c in CATEGORIES}

PRIMARY = {
    "prompt", "negative_prompt", "text", "duration", "aspect_ratio", "resolution", "image_size", "num_images",
    "generate_audio", "voice", "style", "lyrics", "mode",
}
LONG_TEXT = {"prompt", "negative_prompt", "text", "lyrics", "script", "style_prompt"}


def _headers():
    if not settings.FAL_KEY:
        raise ProviderError("FAL_KEY is not set.")
    return {"Authorization": f"Key {settings.FAL_KEY}"}


def _get(url, params, auth=True):
    try:
        r = httpx.get(url, params=params, headers=_headers() if auth else None, timeout=30)
    except httpx.HTTPError as e:
        raise ProviderError(f"fal request failed: {e}") from e
    if r.status_code >= 400:
        raise ProviderError(f"fal returned {r.status_code}: {r.text[:300]}")
    return r.json()


def list_models(category):
    key = f"fal:models:{category}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    out, cursor = [], None
    for _ in range(20):
        params = {"category": category, "status": "active", "limit": 100}
        if cursor:
            params["cursor"] = cursor
        data = _get(f"{API}/models", params)
        for m in data.get("models", []):
            meta = m.get("metadata") or {}
            out.append({
                "id": m["endpoint_id"], "name": meta.get("display_name") or m["endpoint_id"],
                "description": meta.get("description") or "", "thumbnail": meta.get("thumbnail_url") or "",
                "tags": meta.get("tags") or [], "category": meta.get("category") or category,
                "featured": bool(meta.get("highlighted") or meta.get("pinned")), "date": meta.get("date") or "",
            })
        cursor = data.get("next_cursor")
        if not data.get("has_more") or not cursor:
            break
    featured = [m for m in out if m["featured"]]
    rest = sorted((m for m in out if not m["featured"]), key=lambda m: m["date"], reverse=True)
    out = featured + rest
    cache.set(key, out, 60 * 30)
    return out


def price(endpoint_id):
    key = f"fal:price:{endpoint_id}"
    cached = cache.get(key)
    if cached is not None:
        return cached or None
    try:
        data = _get(f"{API}/models/pricing", {"endpoint_id": endpoint_id})
        p = next(iter(data.get("prices") or []), None)
    except ProviderError:
        return None  # e.g. rate limited: don't cache, so the next request can price it
    result = {"unitPrice": float(p["unit_price"]), "unit": p["unit"], "currency": p.get("currency", "USD")} if p else {}
    cache.set(key, result, 60 * 60 * 6)
    return result or None


def prices(endpoint_ids):
    """Price many models in one request (the pricing API rate-limits one-by-one lookups) and cache each."""
    todo = [e for e in endpoint_ids if cache.get(f"fal:price:{e}") is None]
    for i in range(0, len(todo), 50):
        chunk = todo[i:i + 50]
        try:
            r = httpx.get(f"{API}/models/pricing", params=[("endpoint_id", e) for e in chunk], headers=_headers(),
                          timeout=30)
        except httpx.HTTPError:
            return
        if r.status_code >= 400:
            return
        found = {p["endpoint_id"]: p for p in r.json().get("prices") or []}
        for e in chunk:
            p = found.get(e)
            cache.set(f"fal:price:{e}", {"unitPrice": float(p["unit_price"]), "unit": p["unit"],
                                         "currency": p.get("currency", "USD")} if p else {}, 60 * 60 * 6)


def model_info(endpoint_id):
    key = f"fal:schema:{endpoint_id}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    doc = _get(OPENAPI, {"endpoint_id": endpoint_id}, auth=False)
    meta = (doc.get("info") or {}).get("x-fal-metadata") or {}
    schemas = (doc.get("components") or {}).get("schemas") or {}
    body = (((doc.get("paths") or {}).get(f"/{endpoint_id}") or {}).get("post") or {}).get("requestBody") or {}
    ref = (((body.get("content") or {}).get("application/json") or {}).get("schema") or {}).get("$ref", "")
    input_schema = _resolve({"$ref": ref}, schemas) if ref else next(
        (s for n, s in schemas.items() if n.endswith("Input")), None)
    if not input_schema:
        raise ProviderError(f"Could not read the input schema for {endpoint_id}.")
    info = {
        "id": endpoint_id, "category": meta.get("category") or "",
        "thumbnail": meta.get("thumbnailUrl") or "", "fields": fields(input_schema, schemas),
        "price": price(endpoint_id),
    }
    cache.set(key, info, 60 * 60 * 6 if info["price"] else 60)
    return info


def _resolve(node, schemas, depth=0):
    while isinstance(node, dict) and "$ref" in node and depth < 10:
        name = node["$ref"].rsplit("/", 1)[-1]
        extra = {k: v for k, v in node.items() if k != "$ref"}
        node = {**schemas.get(name, {}), **extra}
        depth += 1
    return node


def _media_kind(name):
    n = name.lower()
    for kind in ("image", "video", "audio"):
        if kind in n:
            return kind
    if any(w in n for w in ("mask", "face", "reference", "start_frame", "end_frame", "frame")):
        return "image"
    return "any"


def _field(name, raw, schemas, required):
    node = _resolve(raw, schemas)
    nullable = False
    if "anyOf" in node or "oneOf" in node:
        options = [_resolve(o, schemas) for o in node.get("anyOf") or node.get("oneOf")]
        nullable = any(o.get("type") == "null" for o in options)
        options = [o for o in options if o.get("type") != "null"]
        enum_opt = next((o for o in options if o.get("enum")), None)
        merged = enum_opt or (options[0] if len(options) == 1 else None)
        base = {k: v for k, v in node.items() if k not in ("anyOf", "oneOf")}
        node = {**merged, **base} if merged else {**base, "type": "object"}
    kind = node.get("type")
    f = {
        "name": name, "title": node.get("title") or name.replace("_", " ").capitalize(),
        "description": node.get("description") or "", "default": node.get("default"),
        "required": name in required, "nullable": nullable,
    }
    if isinstance(f["default"], (dict, list)) and kind not in ("object", "array"):
        f["default"] = None
    if node.get("enum"):
        f.update(type="enum", options=node["enum"])
    elif kind == "boolean":
        f["type"] = "boolean"
    elif kind in ("integer", "number"):
        f.update(type=kind, min=node.get("minimum", node.get("exclusiveMinimum")),
                 max=node.get("maximum", node.get("exclusiveMaximum")))
    elif kind == "string" and name.endswith("url"):
        f.update(type="file", accept=_media_kind(name))
    elif kind == "array" and name.endswith("urls"):
        items = _resolve(node.get("items") or {}, schemas)
        if items.get("type") == "string":
            f.update(type="files", accept=_media_kind(name), maxItems=node.get("maxItems"))
        else:
            f["type"] = "json"
    elif kind == "string":
        f["type"] = "text" if (name in LONG_TEXT or (node.get("maxLength") or 0) > 300) else "string"
        f["maxLength"] = node.get("maxLength")
    else:
        f["type"] = "json"
    f["advanced"] = not (f["required"] or name in PRIMARY or f["type"] in ("file", "files"))
    return f


def fields(schema, schemas):
    props = schema.get("properties") or {}
    order = schema.get("x-fal-order-properties") or list(props)
    order = [n for n in order if n in props] + [n for n in props if n not in order]
    required = set(schema.get("required") or [])
    hidden = {"sync_mode", "webhook_url"}
    return [_field(n, props[n], schemas, required) for n in order if n not in hidden]


def _number(value, fallback):
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        digits = "".join(c for c in value if c.isdigit() or c == ".")
        try:
            return float(digits)
        except ValueError:
            return fallback
    return fallback


def estimate(info, values):
    """Best-effort USD estimate from fal's unit price; exact billing depends on fal."""
    p = info.get("price")
    if not p:
        return None, True
    unit = p["unit"].lower()
    defaults = {f["name"]: f.get("default") for f in info["fields"]}
    merged = {**defaults, **{k: v for k, v in values.items() if v not in (None, "")}}
    exact = True
    if unit.startswith("second"):
        qty = _number(merged.get("duration") or merged.get("num_frames") and merged["num_frames"] / 24, 5.0)
    elif unit.rstrip("s") in ("video", "image", "request", "generation", "unit", "call"):
        qty = _number(merged.get("num_images") or merged.get("num_outputs") or 1, 1.0)
    elif "character" in unit:
        per = _number(unit, 1.0) or 1.0
        text = str(merged.get("prompt") or merged.get("text") or "")
        qty = max(1, len(text)) / per
    elif "megapixel" in unit:
        qty, exact = _number(merged.get("num_images") or 1, 1.0), False
    else:
        qty, exact = 1.0, False
    return round(p["unitPrice"] * qty, 4), exact


def credits_for(usd):
    if usd is None:
        return 1
    return max(1, math.ceil(usd / settings.USD_PER_CREDIT))
