import secrets

from django.db import transaction

import providers
from apps.studio import ai
from apps.studio.models import Scene, Video, VideoStatus
from apps.studio.styles import ASPECT_SIZES, style_guide
from providers.media import public_url, video_dir

from . import assemble

STEP_PROGRESS = {
    "planning": (2, 10), "references": (10, 18), "keyframes": (18, 45),
    "clips": (45, 70), "voice": (70, 85), "assembling": (85, 99),
}


def set_progress(video, step, fraction=0.0):
    lo, hi = STEP_PROGRESS[step]
    Video.objects.filter(pk=video.pk).update(status=step, progress=int(lo + (hi - lo) * fraction))


def _story_raw(story):
    return {"title": story.title, "logline": story.logline, "hook": story.hook, "script": story.script,
            "characters": story.characters, "estimatedSeconds": story.estimated_seconds}


def planning(video, scene=None):
    if video.scenes.exists():
        return 0.0
    story, brief = video.story, video.story.brief
    guide = style_guide(brief.style_preset, brief.custom_style)
    plan, cost = ai.plan_scenes(_story_raw(story), guide, brief.target_seconds)
    with transaction.atomic():
        video.style_guide = plan.styleGuide or guide
        video.save(update_fields=["style_guide", "updated_at"])
        Scene.objects.bulk_create([
            Scene(video=video, idx=i, narration=s.narration, duration_ms=int(s.durationSeconds * 1000), shot=s.shot,
                  camera=s.camera, characters=s.characters, image_prompt=s.imagePrompt, motion_prompt=s.motionPrompt)
            for i, s in enumerate(plan.scenes)
        ])
    return cost


def references(video, scene=None):
    """Character sheets keep characters consistent across scenes. Lite skips them to stay cheap."""
    if video.tier == "lite":
        return 0.0
    refs = dict(video.references or {})
    chars = refs.setdefault("characters", {})
    for other in Video.objects.filter(project=video.project).exclude(pk=video.pk).order_by("-id"):
        for name, ref in ((other.references or {}).get("characters") or {}).items():
            chars.setdefault(name, ref)
    out_dir = video_dir(video.id) / "refs"
    out_dir.mkdir(exist_ok=True)
    cost = 0.0
    main = video.story.characters[:3]
    for i, c in enumerate(main):
        if c["name"] in chars:
            continue
        prompt = (f"{video.style_guide}. Character reference sheet of {c['name']}: {c['visualDescription']}. "
                  "Full body, front view, neutral pose, plain light background, no text.")
        res = providers.image().generate(prompt, 1024, 1024, out_dir / f"char_{i}_{secrets.token_hex(3)}.png")
        chars[c["name"]] = {"url": public_url(res.path), "remote": res.remote_url}
        cost += res.cost_usd
        video.references = refs
        video.save(update_fields=["references", "updated_at"])
        set_progress(video, "references", (i + 1) / max(1, len(main)))
    return cost


def _scenes(video, scene):
    return [scene] if scene else list(video.scenes.all())


def keyframes(video, scene=None):
    w, h = ASPECT_SIZES[video.aspect_ratio]
    chars = (video.references or {}).get("characters", {})
    cost, todo = 0.0, [s for s in _scenes(video, scene) if not s.keyframe_url]
    for n, s in enumerate(todo):
        refs = [chars[c]["remote"] for c in s.characters if c in chars and chars[c].get("remote")]
        res = providers.image().generate(s.image_prompt, w, h, video_dir(video.id) / f"key_{s.idx}_{secrets.token_hex(3)}.png",
                                         reference_urls=refs)
        s.keyframe_url, s.keyframe_remote_url = public_url(res.path), res.remote_url
        s.save(update_fields=["keyframe_url", "keyframe_remote_url"])
        cost += res.cost_usd
        set_progress(video, "keyframes", (n + 1) / len(todo))
    return cost


def clips(video, scene=None):
    if video.tier == "lite":
        return 0.0
    from providers.media import local_path

    cost, todo = 0.0, [s for s in _scenes(video, scene) if not s.clip_url]
    for n, s in enumerate(todo):
        res = providers.video().animate(local_path(s.keyframe_url), s.keyframe_remote_url, s.motion_prompt,
                                        s.duration_ms / 1000, video.tier, video_dir(video.id) / f"clip_{s.idx}_{secrets.token_hex(3)}.mp4")
        if res.path:
            s.clip_url = public_url(res.path)
            s.save(update_fields=["clip_url"])
        cost += res.cost_usd
        set_progress(video, "clips", (n + 1) / len(todo))
    return cost


def voice(video, scene=None):
    cost, todo = 0.0, [s for s in _scenes(video, scene) if not s.audio_url]
    narration = video.story.brief.narration
    for n, s in enumerate(todo):
        dest = video_dir(video.id) / f"voice_{s.idx}_{secrets.token_hex(3)}.wav"
        if narration:
            res = providers.tts().speak(s.narration, video.voice_id, dest)
            s.words, cost = res.words, cost + res.cost_usd
            s.duration_ms = max(2000, int(res.duration * 1000) + 250)
        else:
            from providers.fake import FakeTts

            res = FakeTts().speak(s.narration, "", dest)
            s.words = res.words
        s.audio_url = public_url(res.path)
        s.save(update_fields=["audio_url", "words", "duration_ms"])
        set_progress(video, "voice", (n + 1) / len(todo))
    return cost


def assembling(video, scene=None):
    set_progress(video, "assembling", 0.05)
    result = assemble.render(video, on_progress=lambda f: set_progress(video, "assembling", f))
    Video.objects.filter(pk=video.pk).update(
        status=VideoStatus.READY, progress=100, output_url=result["output_url"],
        thumbnail_url=result["thumbnail_url"], duration_ms=result["duration_ms"], error="",
    )
    return 0.0


STEPS = {
    "planning": planning, "references": references, "keyframes": keyframes,
    "clips": clips, "voice": voice, "assembling": assembling,
}
