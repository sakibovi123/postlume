import logging
from pathlib import Path

from django.conf import settings

from .base import ImageResult, ProviderError, TtsResult, VideoResult, even_word_timings
from .media import download, to_wav, wav_duration

log = logging.getLogger(__name__)
COST = settings.COST_ESTIMATES


def _subscribe(model, arguments):
    import fal_client

    if not settings.FAL_KEY:
        raise ProviderError("FAL_KEY is not set.")
    try:
        return fal_client.subscribe(model, arguments=arguments)
    except Exception as e:
        raise ProviderError(f"fal {model} failed: {e}") from e


def upload(path):
    import fal_client

    return fal_client.upload_file(str(path))


class FalImage:
    name = "fal"

    def generate(self, prompt, width, height, dest, reference_urls=None):
        size = {"width": width, "height": height}
        if reference_urls and settings.FAL_IMAGE_REF_MODEL:
            model = settings.FAL_IMAGE_REF_MODEL
            out = _subscribe(model, {"prompt": prompt, "image_urls": reference_urls[:4], "image_size": size,
                                     "num_images": 1})
            cost = COST["image_ref"]
        else:
            model = settings.FAL_IMAGE_MODEL
            out = _subscribe(model, {"prompt": prompt, "image_size": size, "num_images": 1})
            cost = COST["image"]
        url = out["images"][0]["url"]
        download(url, dest)
        return ImageResult(path=Path(dest), remote_url=url, cost_usd=cost, provider=model)


class FalVideo:
    name = "fal"

    def animate(self, image_path, image_remote_url, prompt, seconds, tier, dest):
        if tier == "lite":
            return VideoResult(path=None, provider="pan-zoom")
        model = settings.FAL_VIDEO_MODEL_PREMIUM if tier == "premium" else settings.FAL_VIDEO_MODEL_STANDARD
        clip_seconds = 5 if seconds <= 5.5 else 10
        out = _subscribe(model, {
            "prompt": prompt, "image_url": image_remote_url or upload(image_path), "duration": str(clip_seconds),
        })
        download(out["video"]["url"], dest)
        rate = COST["video_second_premium"] if tier == "premium" else COST["video_second_standard"]
        return VideoResult(path=Path(dest), cost_usd=clip_seconds * rate, provider=model)


class FalTts:
    name = "fal"

    def speak(self, text, voice, dest):
        out = _subscribe(settings.FAL_TTS_MODEL, {"prompt": text, "voice": voice or "af_heart"})
        audio_url = out["audio"]["url"]
        raw = Path(dest).with_suffix(".src")
        download(audio_url, raw)
        to_wav(raw, dest)
        raw.unlink(missing_ok=True)
        duration = wav_duration(dest)
        words = self._words(audio_url, text, duration)
        cost = len(text) / 1000 * COST["tts_1k_chars"]
        return TtsResult(path=Path(dest), duration=duration, words=words, cost_usd=cost,
                         provider=settings.FAL_TTS_MODEL)

    def _words(self, audio_url, text, duration):
        try:
            out = _subscribe(settings.FAL_STT_MODEL, {"audio_url": audio_url, "chunk_level": "word"})
            words = [
                {"word": c["text"].strip(), "start": c["timestamp"][0], "end": c["timestamp"][1] or duration}
                for c in out.get("chunks", []) if c.get("text", "").strip()
            ]
            if words:
                return words
        except ProviderError as e:
            log.warning("word timestamps failed, using even spacing: %s", e)
        return even_word_timings(text, duration)
