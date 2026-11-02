import json
import logging
import re

import httpx
from django.conf import settings
from pydantic import ValidationError

from .base import ProviderError

log = logging.getLogger(__name__)


def _extract_json(text):
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fenced:
        text = fenced.group(1)
    start, end = text.find("{"), text.rfind("}")
    return text[start:end + 1] if start != -1 else text


class OpenRouterLlm:
    """Works with OpenRouter or any OpenAI-compatible endpoint (e.g. Ollama via LLM_BASE_URL)."""

    name = "openrouter"

    def structured(self, kind, system, messages, schema, hint=None):
        model = settings.LLM_STORY_MODEL if kind == "story" else settings.LLM_CHAT_MODEL
        convo = [{"role": "system", "content": system}, *messages]
        total_cost = 0.0
        for attempt in range(2):
            data = self._call(model, convo, schema)
            total_cost += float((data.get("usage") or {}).get("cost") or 0)
            content = data["choices"][0]["message"].get("content") or ""
            try:
                return schema.model_validate(json.loads(_extract_json(content))), total_cost
            except (json.JSONDecodeError, ValidationError) as e:
                log.warning("LLM output failed validation (attempt %s): %s", attempt + 1, e)
                convo = [*convo, {"role": "assistant", "content": content},
                         {"role": "user", "content": f"That JSON was invalid: {e}. Reply with corrected JSON only."}]
        raise ProviderError("The model did not return valid structured output.")

    def _call(self, model, messages, schema):
        if not settings.OPENROUTER_API_KEY and "openrouter.ai" in settings.LLM_BASE_URL:
            raise ProviderError("OPENROUTER_API_KEY is not set.")
        body = {
            "model": model,
            "messages": messages,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema.__name__, "schema": schema.model_json_schema()},
            },
            "usage": {"include": True},
        }
        headers = {
            "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
            "HTTP-Referer": settings.PUBLIC_APP_URL,
            "X-Title": "Taleloop",
        }
        try:
            r = httpx.post(f"{settings.LLM_BASE_URL}/chat/completions", json=body, headers=headers, timeout=180)
        except httpx.HTTPError as e:
            raise ProviderError(f"LLM request failed: {e}") from e
        if r.status_code >= 400:
            raise ProviderError(f"LLM returned {r.status_code}: {r.text[:500]}")
        return r.json()
