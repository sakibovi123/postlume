from dataclasses import dataclass, field
from pathlib import Path


class ProviderError(Exception):
    pass


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
