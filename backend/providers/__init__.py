from functools import cache

from django.conf import settings


@cache
def llm():
    if settings.LLM_PROVIDER == "openrouter":
        from .openrouter import OpenRouterLlm

        return OpenRouterLlm()
    from .fake import FakeLlm

    return FakeLlm()


@cache
def image():
    if settings.IMAGE_PROVIDER == "fal":
        from .fal import FalImage

        return FalImage()
    from .fake import FakeImage

    return FakeImage()


@cache
def video():
    if settings.VIDEO_PROVIDER == "fal":
        from .fal import FalVideo

        return FalVideo()
    from .fake import FakeVideo

    return FakeVideo()


@cache
def tts():
    if settings.TTS_PROVIDER == "fal":
        from .fal import FalTts

        return FalTts()
    from .fake import FakeTts

    return FakeTts()
