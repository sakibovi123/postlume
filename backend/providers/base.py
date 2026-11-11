import re
from dataclasses import dataclass, field
from pathlib import Path

_PROVIDER = re.compile(r"\bfal-ai/|\bfal(?:\.ai|_client|-ai)?\b|\bFAL_KEY\b", re.I)


def hide_provider(text):
    """Users must never see which infrastructure provider runs the models."""
    text = _PROVIDER.sub(lambda m: "" if m.group(0).lower().endswith("/") else "the AI service"
                         if m.group(0).upper() != "FAL_KEY" else "the AI service key", str(text or ""))
    return re.sub(r"\s{2,}", " ", text).strip()


class ProviderError(Exception):
    def __init__(self, message=""):
        super().__init__(hide_provider(message))


@dataclass
class ImageResult:
    path: Path
    remote_url: str = ""
    cost_usd: float = 0.0
    provider: str = ""


@dataclass
class VideoResult:
    path: Path | None
    cost_usd: float = 0.0
    provider: str = ""


@dataclass
class TtsResult:
    path: Path
    duration: float
    words: list = field(default_factory=list)
    cost_usd: float = 0.0
    provider: str = ""


def even_word_timings(text, duration, offset=0.0):
    words = text.split()
    if not words:
        return []
    step = duration / len(words)
    return [
        {"word": w, "start": round(offset + i * step, 3), "end": round(offset + (i + 1) * step, 3)}
        for i, w in enumerate(words)
    ]
