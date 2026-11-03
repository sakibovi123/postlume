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

    def structured(self, kind, system, messages, schema, hint=None, on_text=None):
        model = settings.LLM_STORY_MODEL if kind == "story" else settings.LLM_CHAT_MODEL
        convo = [{"role": "system", "content": system}, *messages]
        total_cost = 0.0
        for attempt in range(2):
            if on_text:
                content, cost = self._stream(model, convo, schema, on_text)
                total_cost += cost
            else:
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

    def _body(self, model, messages, schema):
        if not settings.OPENROUTER_API_KEY and "openrouter.ai" in settings.LLM_BASE_URL:
            raise ProviderError("OPENROUTER_API_KEY is not set.")
        return {
            "model": model,
            "messages": messages,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema.__name__, "schema": schema.model_json_schema()},
            },
            "usage": {"include": True},
        }

    def _headers(self):
        return {
            "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
            "HTTP-Referer": settings.PUBLIC_APP_URL,
            "X-Title": "Taleloop",
        }

    def _stream(self, model, messages, schema, on_text):
        body = {**self._body(model, messages, schema), "stream": True}
        content, cost = "", 0.0
        try:
            with httpx.stream("POST", f"{settings.LLM_BASE_URL}/chat/completions", json=body,
                              headers=self._headers(), timeout=httpx.Timeout(180, read=90)) as r:
                if r.status_code >= 400:
                    r.read()
                    raise ProviderError(f"LLM returned {r.status_code}: {r.text[:500]}")
                for line in r.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        chunk = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    if chunk.get("error"):
                        raise ProviderError(f"LLM stream error: {str(chunk['error'])[:500]}")
                    cost += float((chunk.get("usage") or {}).get("cost") or 0)
                    for choice in chunk.get("choices") or []:
                        delta = (choice.get("delta") or {}).get("content") or ""
                        if delta:
                            content += delta
                            on_text(content)
        except httpx.HTTPError as e:
            raise ProviderError(f"LLM request failed: {e}") from e
        return content, cost

    def _call(self, model, messages, schema):
        body = self._body(model, messages, schema)
        try:
            r = httpx.post(f"{settings.LLM_BASE_URL}/chat/completions", json=body, headers=self._headers(), timeout=180)
        except httpx.HTTPError as e:
            raise ProviderError(f"LLM request failed: {e}") from e
        if r.status_code >= 400:
            raise ProviderError(f"LLM returned {r.status_code}: {r.text[:500]}")
        return r.json()
