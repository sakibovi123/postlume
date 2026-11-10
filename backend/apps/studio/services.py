import time

from django.conf import settings
from django.db import transaction
from django.db.models import Max
from rest_framework.exceptions import PermissionDenied, Throttled, ValidationError

from apps.billing import service as billing
from apps.billing.models import Action
from pipeline import jobs

from .models import Brief, ChatMessage, Project, Story, Video, VideoStatus

ACTIVE = [s for s in VideoStatus.values if s not in (VideoStatus.READY, VideoStatus.FAILED)]
RUNNING = [s for s in ACTIVE if s != VideoStatus.WAITING]


def save_story(project, brief, data, source, episode=1, synopsis=""):
    data = data if isinstance(data, dict) else data.model_dump()
    version = (project.stories.aggregate(v=Max("version"))["v"] or 0) + 1
    return Story.objects.create(
        project=project, brief=brief, version=version, episode=episode, synopsis=synopsis or data.get("synopsis", ""),
        title=data["title"][:200], logline=data["logline"], hook=data["hook"], script=data["script"],
        characters=data["characters"], estimated_seconds=int(data.get("estimatedSeconds") or 0), source=source,
    )


def create_brief(project, brief):
    b = Brief.objects.create(
        project=project, style_preset=brief.stylePreset, custom_style=brief.customStyle or "", idea=brief.idea,
        genre=brief.genre, aspect_ratio=brief.aspectRatio, target_seconds=brief.targetSeconds,
        language=brief.language, voice_id=brief.voiceId or "", music_mood=brief.musicMood or "",
        narration=brief.narration, raw=brief.model_dump(),
    )
    project.style_preset = brief.stylePreset
    project.save(update_fields=["style_preset", "updated_at"])
    return b


def latest_stories(project):
    latest = {}
    for s in project.stories.order_by("version"):
        latest[s.episode] = s
    return latest


def check_plan(org, tier, seconds):
    if tier not in billing.CREDITS_PER_10S:
        raise ValidationError({"tier": "Must be lite, standard or premium."})
    plan = billing.subscription_for(org).plan_info
    if tier not in plan["tiers"]:
        raise PermissionDenied(f"The {plan['name']} plan doesn't include the {tier} tier.")
    if seconds > plan["max_seconds"]:
        raise PermissionDenied(f"The {plan['name']} plan allows videos up to {plan['max_seconds']} seconds.")


def approve(story):
    if story.status != "approved":
        story.project.stories.filter(episode=story.episode).exclude(pk=story.pk).update(status="draft")
        story.status = "approved"
        story.save(update_fields=["status"])


def create_video(org, user, story, tier, aspect=None, voice_id=None, music_mood=None, captions=True, wait=False,
                 key=None):
    seconds = story.brief.target_seconds
    with transaction.atomic():
        approve(story)
        v = Video.objects.create(
            project=story.project, story=story, created_by=user, tier=tier, aspect_ratio=aspect or story.brief.aspect_ratio,
            voice_id=voice_id or story.brief.voice_id or "af_heart",
            music_mood=music_mood or story.brief.music_mood or "none", captions=captions,
            status=VideoStatus.WAITING if wait else VideoStatus.QUEUED,
        )
        key = key or f"{'episode' if wait else 'video'}:{v.id}"
        label = f"Episode {story.episode}, " if wait else ""
        billing.charge(org, Action.VIDEO_RENDER, billing.video_credits(tier, seconds), key, video_id=v.id,
                       story_id=story.id, note=f"{label}{tier.title()} video, {seconds}s")
        v.charge_key = key
        v.save(update_fields=["charge_key"])
        if not wait:
            jobs.enqueue(v, "planning", charge_key=key)
    return v


def start_render(org, user, story, tier, **kwargs):
    check_plan(org, tier, story.brief.target_seconds)
    running = Video.objects.filter(project__organization=org, status__in=RUNNING).count()
    if running >= settings.MAX_CONCURRENT_RENDERS_PER_ORG:
        raise Throttled(detail=f"Up to {settings.MAX_CONCURRENT_RENDERS_PER_ORG} renders can run at once.")
    return create_video(org, user, story, tier, **kwargs)


def kick(org_id):
    """Start waiting episode renders while the org has free render slots."""
    with transaction.atomic():
        running = Video.objects.filter(project__organization_id=org_id, status__in=RUNNING).count()
        slots = settings.MAX_CONCURRENT_RENDERS_PER_ORG - running
        if slots <= 0:
            return
        waiting = Video.objects.filter(project__organization_id=org_id, status=VideoStatus.WAITING)
        for v in waiting.order_by("created_at", "id")[:slots]:
            if Video.objects.filter(pk=v.pk, status=VideoStatus.WAITING).update(status=VideoStatus.QUEUED, progress=0):
                jobs.enqueue(v, "planning", charge_key=v.charge_key)


def reassemble(org, v, from_voice=False):
    key = f"reassemble:{v.id}:{int(time.time() * 1000)}"
    billing.charge(org, Action.VIDEO_REASSEMBLE, billing.REASSEMBLE_CREDITS, key, video_id=v.id, note="Re-assemble")
    with transaction.atomic():
        if from_voice:
            v.scenes.update(audio_url="", words=[])
        Video.objects.filter(pk=v.pk).update(status=VideoStatus.QUEUED, progress=80, error="")
        jobs.enqueue(v, "voice" if from_voice else "assembling", chain=from_voice, charge_key=key)
    v.refresh_from_db()
    return v


def episode_videos(project):
    """Latest video per episode number."""
    latest = {}
    for v in project.videos.select_related("story").order_by("created_at", "id"):
        latest[v.story.episode] = v
    return latest


def _say(project, text, suggestions=None):
    msg = ChatMessage.objects.create(project=project, role="assistant",
                                     content={"text": text, "suggestions": suggestions or []})
    Project.objects.filter(pk=project.pk).update(updated_at=msg.created_at)


def on_render_finished(video_id, charge_key, ok, error=""):
    """Called by the worker when a render chain ends. Starts queued episodes and reports back in the chat."""
    v = Video.objects.select_related("project", "story").filter(pk=video_id).first()
    if not v:
        return
    kick(v.project.organization_id)
    p = v.project
    if not p.series:
        return
    n = v.story.episode
    total = p.series.get("episodeCount") or 1
    if charge_key.startswith("edit:"):
        if ok:
            _say(p, f"Done. Episode {n} is updated with your edits.", ["Download episode", "Make another change"])
        else:
            _say(p, f"I couldn't apply the edits to episode {n}: {error[:200]}. Your credits were refunded.",
                 [f"Retry episode {n}"])
        return
    if not charge_key.startswith(("episode:", "retry:")):
        return
    if not ok:
        _say(p, f"Episode {n} failed to render ({error[:160]}). Your credits for it were refunded.",
             [f"Retry episode {n}"])
    latest = episode_videos(p)
    pending = [e for e, x in latest.items() if x.status in ACTIVE]
    if p.render_mode == "one_by_one" and ok:
        rendered = {e for e, x in latest.items() if x.status == VideoStatus.READY}
        nxt = next((e for e in range(1, total + 1) if e not in latest), None)
        if nxt:
            _say(p, f"Episode {n} is ready. Watch it on the right. Tell me anything you'd like to change, "
                    f"or I can start episode {nxt}.", [f"Start episode {nxt}", "Make the rest all at once"])
        elif len(rendered) == total and not pending:
            _say(p, f"That's the whole series: all {total} episodes are ready. Ask me for any edits.",
                 ["Change the music", "Edit a scene"])
    elif ok and not pending:
        ready = sorted(e for e, x in latest.items() if x.status == VideoStatus.READY)
        failed = sorted(e for e, x in latest.items() if x.status == VideoStatus.FAILED)
        text = f"All done: {len(ready)} of {total} episodes are ready."
        if failed:
            text += f" Episode{'s' if len(failed) > 1 else ''} {', '.join(map(str, failed))} failed and were refunded."
        _say(p, text + " Watch them on the right and tell me any edits, like \"cut scene 2 of episode 1\".",
             ["Change the music", "Edit a scene"])
