import time

from django.db import transaction
from django.http import FileResponse
from pydantic import ValidationError as PydanticError
from rest_framework.exceptions import APIException, NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import Role
from apps.accounts.permissions import require_role
from apps.billing import service as billing
from apps.billing.models import Action
from django.conf import settings
from pipeline import jobs
from providers.base import ProviderError
from providers.media import local_path

from . import ai, services, tasks
from .agent import Agent, split_suggestions
from .services import ACTIVE
from .dto import brief_dto, message_dto, project_dto, scene_dto, story_dto, video_dto
from .models import Brief, ChatMessage, GenerationTask, Project, Scene, Story, Video, VideoStatus
from .schemas import CreativeBrief
from .styles import GENRES, MUSIC_MOODS, STYLE_PRESETS, VOICES

class GenerationThrottle(UserRateThrottle):
    scope = "generation"


class ProviderFailed(APIException):
    status_code = 502
    default_code = "provider_error"


def _project(request, pk, minimum=Role.VIEWER):
    m = require_role(request, minimum)
    p = Project.objects.filter(organization=m.organization, pk=pk).first()
    if not p:
        raise NotFound("Project not found.")
    return m, p


def _story(request, pk, minimum=Role.VIEWER):
    m = require_role(request, minimum)
    s = Story.objects.select_related("brief", "project").filter(project__organization=m.organization, pk=pk).first()
    if not s:
        raise NotFound("Story not found.")
    return m, s


def _video(request, pk, minimum=Role.VIEWER):
    m = require_role(request, minimum)
    v = Video.objects.select_related("story__brief").filter(project__organization=m.organization, pk=pk).first()
    if not v:
        raise NotFound("Video not found.")
    return m, v


def _llm(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ProviderError as e:
        raise ProviderFailed(str(e))


def _save_story(project, brief, out, source, like=None):
    episode, synopsis = (like.episode, like.synopsis) if like else (1, "")
    return services.save_story(project, brief, out, source, episode=episode, synopsis=synopsis)


class StylesView(APIView):
    def get(self, request):
        return Response({
            "presets": [{"id": k, "label": v["label"], "guide": v["guide"]} for k, v in STYLE_PRESETS.items()],
            "genres": GENRES, "voices": VOICES, "musicMoods": MUSIC_MOODS,
            "aspectRatios": ["9:16", "16:9", "1:1"], "lengths": [15, 30, 60, 90, 180],
            "providers": {"llm": settings.LLM_PROVIDER, "image": settings.IMAGE_PROVIDER,
                          "video": settings.VIDEO_PROVIDER, "tts": settings.TTS_PROVIDER},
        })


class ProjectsView(APIView):
    def get(self, request):
        m = require_role(request, Role.VIEWER)
        projects = Project.objects.filter(organization=m.organization).order_by("-updated_at")[:200]
        return Response([project_dto(p) for p in projects])

    def post(self, request):
        m = require_role(request, Role.CREATOR)
        preset = request.data.get("stylePreset") or ""
        if preset and preset not in STYLE_PRESETS:
            raise ValidationError({"stylePreset": "Unknown preset."})
        p = Project.objects.create(
            organization=m.organization, created_by=request.user,
            title=(request.data.get("title") or "Untitled project")[:200], style_preset=preset,
        )
        return Response(project_dto(p, detail=True), status=201)


class ProjectDetailView(APIView):
    def get(self, request, pk):
        _, p = _project(request, pk)
        return Response(project_dto(p, detail=True))

    def patch(self, request, pk):
        _, p = _project(request, pk, Role.CREATOR)
        if "title" in request.data:
            p.title = (request.data["title"] or "Untitled project")[:200]
        if "stylePreset" in request.data:
            p.style_preset = request.data["stylePreset"] or ""
        p.save()
        return Response(project_dto(p))

    def delete(self, request, pk):
        _, p = _project(request, pk, Role.ADMIN)
        p.delete()
        return Response(status=204)


class MessagesView(APIView):
    throttle_classes = [GenerationThrottle]

    def post(self, request, pk):
        m, p = _project(request, pk, Role.CREATOR)
        text = (request.data.get("text") or "").strip()
        if not text:
            raise ValidationError({"text": "Required."})
        if any(t["kind"] == "agent" for t in tasks.active_tasks(p)):
            raise ValidationError({"detail": "The assistant is still working on your last message."})
        if len(text) > 4000:
            raise ValidationError({"text": "Keep messages under 4000 characters."})
        ai.moderate(text)
        if request.data.get("stylePreset") in STYLE_PRESETS:
            p.style_preset = request.data["stylePreset"]
        user_msg = ChatMessage.objects.create(project=p, role="user", content={"text": text})
        if p.title == "Untitled project":
            p.title = text[:60]
        p.save()
        assistant = Agent(p, m, request.user, client={"timezone": str(request.data.get("timezone") or "")[:64]})

        def work(rep):
            text, cost = _llm(assistant.run, rep)
            rep.stage("saving", 96)
            text, suggestions = split_suggestions(text)
            bot_msg = ChatMessage.objects.create(project=p, role="assistant", content={
                "text": text, "actions": assistant.actions, "suggestions": suggestions})
            Project.objects.filter(pk=p.pk).update(updated_at=bot_msg.created_at)
            return {"userMessage": message_dto(user_msg), "assistantMessage": message_dto(bot_msg)}

        task = tasks.start(p, "agent", work)
        return Response({"task": tasks.task_dto(task), "userMessage": message_dto(user_msg)}, status=202)


class BriefView(APIView):
    def post(self, request, pk):
        _, p = _project(request, pk, Role.CREATOR)
        try:
            brief = CreativeBrief.model_validate(request.data.get("brief") or request.data)
        except PydanticError as e:
            raise ValidationError({"brief": e.errors(include_url=False, include_context=False)})
        ai.moderate(f"{brief.idea} {brief.customStyle or ''}")
        return Response(brief_dto(services.create_brief(p, brief)), status=201)


class StoriesView(APIView):
    throttle_classes = [GenerationThrottle]

    def post(self, request, pk):
        m, p = _project(request, pk, Role.CREATOR)
        brief_id = request.data.get("briefId")
        brief = (p.briefs.filter(pk=brief_id) if brief_id else p.briefs.order_by("-created_at")).first()
        if not brief:
            raise ValidationError({"briefId": "Confirm a creative brief first."})
        key = request.data.get("idempotencyKey") or f"story:{p.id}:{brief.id}:{int(time.time() * 1000)}"
        entry = billing.charge(m.organization, Action.STORY_GENERATE, billing.STORY_CREDITS, key, note="Story")

        def work(rep):
            rep.stage("brief", 5)
            try:
                out, cost = _llm(ai.write_story, brief.raw, on_text=rep.stream)
                rep.stage("checking", 94)
                ai.moderate(f"{out.title} {out.script}")
            except Exception:
                billing.refund(entry, "Refund: story generation failed")
                raise
            rep.stage("saving", 97)
            story = _save_story(p, brief, out, "generated")
            entry.story_id = story.id
            entry.save(update_fields=["story_id"])
            billing.add_cost(key, cost)
            return story_dto(story)

        task = tasks.start(p, "story", work, tasks.target_words(brief.raw))
        return Response(tasks.task_dto(task), status=202)


class StoryDetailView(APIView):
    def get(self, request, pk):
        _, s = _story(request, pk)
        return Response(story_dto(s))

    def patch(self, request, pk):
        _, s = _story(request, pk, Role.CREATOR)
        fields = ["title", "logline", "hook", "script", "characters"]
        changes = {f: request.data[f] for f in fields if f in request.data}
        if changes:
            ai.moderate(" ".join(str(v) for v in changes.values()))
            data = {**story_dto(s), **changes}
            s = _save_story(s.project, s.brief, data, "edit", like=s)
        if request.data.get("status") == "approved":
            with transaction.atomic():
                s.project.stories.exclude(pk=s.pk).update(status="draft")
                s.status = "approved"
                s.save(update_fields=["status"])
        return Response(story_dto(s))


class StoryRewriteView(APIView):
    throttle_classes = [GenerationThrottle]

    def post(self, request, pk):
        m, s = _story(request, pk, Role.CREATOR)
        instruction = (request.data.get("instruction") or "").strip()
        if not instruction:
            raise ValidationError({"instruction": "Tell the AI what to change."})
        ai.moderate(instruction)
        key = request.data.get("idempotencyKey") or f"rewrite:{s.id}:{int(time.time() * 1000)}"
        entry = billing.charge(m.organization, Action.STORY_GENERATE, billing.STORY_CREDITS, key, note="Story rewrite")
        previous = story_dto(s)

        def work(rep):
            rep.stage("brief", 5)
            try:
                out, cost = _llm(ai.write_story, s.brief.raw, previous=previous, instruction=instruction,
                                 on_text=rep.stream)
                rep.stage("checking", 94)
                ai.moderate(f"{out.title} {out.script}")
            except Exception:
                billing.refund(entry, "Refund: rewrite failed")
                raise
            rep.stage("saving", 97)
            story = _save_story(s.project, s.brief, out, "rewrite", like=s)
            billing.add_cost(key, cost)
            return story_dto(story)

        task = tasks.start(s.project, "rewrite", work, tasks.target_words(s.brief.raw))
        return Response(tasks.task_dto(task), status=202)


class TaskView(APIView):
    def get(self, request, pk):
        m = require_role(request, Role.VIEWER)
        t = GenerationTask.objects.filter(project__organization=m.organization, pk=pk).first()
        if not t:
            raise NotFound("Task not found.")
        return Response(tasks.task_dto(t))


class StoryRestoreView(APIView):
    def post(self, request, pk):
        _, s = _story(request, pk, Role.CREATOR)
        return Response(story_dto(_save_story(s.project, s.brief, story_dto(s), "restore", like=s)), status=201)


class StartRenderView(APIView):
    throttle_classes = [GenerationThrottle]

    def post(self, request, pk):
        m, s = _story(request, pk, Role.CREATOR)
        aspect = request.data.get("aspectRatio") or s.brief.aspect_ratio
        if aspect not in ("9:16", "16:9", "1:1"):
            raise ValidationError({"aspectRatio": "Invalid aspect ratio."})
        v = services.start_render(
            m.organization, request.user, s, request.data.get("tier") or "lite", aspect=aspect,
            voice_id=request.data.get("voiceId"), music_mood=request.data.get("musicMood"),
            captions=bool(request.data.get("captions", True)), key=request.data.get("idempotencyKey"),
        )
        return Response(video_dto(v, scenes=True), status=202)


class VideosView(APIView):
    def get(self, request):
        m = require_role(request, Role.VIEWER)
        qs = Video.objects.select_related("story__brief").filter(project__organization=m.organization)
        if request.query_params.get("status"):
            qs = qs.filter(status=request.query_params["status"])
        if request.query_params.get("style"):
            qs = qs.filter(story__brief__style_preset=request.query_params["style"])
        if request.query_params.get("aspectRatio"):
            qs = qs.filter(aspect_ratio=request.query_params["aspectRatio"])
        return Response([video_dto(v) for v in qs.order_by("-created_at")[:200]])


class VideoDetailView(APIView):
    def get(self, request, pk):
        _, v = _video(request, pk)
        return Response(video_dto(v, scenes=True))

    def patch(self, request, pk):
        """Change voice, music or captions. Voice changes re-run TTS, then everything is re-assembled."""
        m, v = _video(request, pk, Role.CREATOR)
        if v.status in ACTIVE:
            raise ValidationError({"detail": "Wait for the current render to finish."})
        voice_changed = "voiceId" in request.data and request.data["voiceId"] != v.voice_id
        for field, attr in [("voiceId", "voice_id"), ("musicMood", "music_mood"), ("captions", "captions")]:
            if field in request.data:
                setattr(v, attr, request.data[field])
        v.save()
        if request.data.get("apply") is False:
            return Response(video_dto(v, scenes=True))
        return _reassemble(m, v, from_voice=voice_changed)

    def delete(self, request, pk):
        _, v = _video(request, pk, Role.CREATOR)
        if v.status in ACTIVE:
            raise ValidationError({"detail": "Can't delete a video while it's rendering."})
        import shutil

        from providers.media import video_dir

        shutil.rmtree(video_dir(v.id), ignore_errors=True)
        v.delete()
        return Response(status=204)


def _reassemble(m, v, from_voice=False):
    return Response(video_dto(services.reassemble(m.organization, v, from_voice), scenes=True), status=202)


class ReassembleView(APIView):
    def post(self, request, pk):
        m, v = _video(request, pk, Role.CREATOR)
        if v.status in ACTIVE:
            raise ValidationError({"detail": "Wait for the current render to finish."})
        if not v.scenes.exists():
            raise ValidationError({"detail": "Nothing to assemble yet."})
        return _reassemble(m, v)


class RetryView(APIView):
    def post(self, request, pk):
        m, v = _video(request, pk, Role.CREATOR)
        if v.status != VideoStatus.FAILED:
            raise ValidationError({"detail": "Only failed videos can be retried."})
        key = f"retry:{v.id}:{int(time.time() * 1000)}"
        failed = v.jobs.filter(status="failed").order_by("-id").first()
        credits = billing.REASSEMBLE_CREDITS if failed and failed.step == "assembling" else \
            billing.video_credits(v.tier, v.story.brief.target_seconds)
        billing.charge(m.organization, Action.VIDEO_RENDER, credits, key, video_id=v.id, note="Retry render")
        jobs.retry(v, charge_key=key)
        v.refresh_from_db()
        return Response(video_dto(v, scenes=True), status=202)


def _scene(v, scene_id):
    s = Scene.objects.filter(video=v, pk=scene_id).first()
    if not s:
        raise NotFound("Scene not found.")
    return s


class SceneDetailView(APIView):
    def patch(self, request, pk, scene_id):
        _, v = _video(request, pk, Role.CREATOR)
        s = _scene(v, scene_id)
        if "captionText" in request.data:
            s.caption_text = (request.data["captionText"] or "").strip()
        if "imagePrompt" in request.data:
            ai.moderate(request.data["imagePrompt"])
            s.image_prompt = request.data["imagePrompt"]
        if "motionPrompt" in request.data:
            s.motion_prompt = request.data["motionPrompt"]
        s.save()
        return Response(scene_dto(s))


class SceneRegenerateView(APIView):
    throttle_classes = [GenerationThrottle]

    def post(self, request, pk, scene_id):
        m, v = _video(request, pk, Role.CREATOR)
        if v.status in ACTIVE:
            raise ValidationError({"detail": "Wait for the current render to finish."})
        s = _scene(v, scene_id)
        if request.data.get("imagePrompt"):
            ai.moderate(request.data["imagePrompt"])
            s.image_prompt = request.data["imagePrompt"]
        if request.data.get("motionPrompt"):
            s.motion_prompt = request.data["motionPrompt"]
        narration = (request.data.get("narration") or "").strip()
        if narration and narration != s.narration:
            ai.moderate(narration)
            s.narration, s.audio_url, s.words, s.caption_text = narration, "", [], ""
        s.keyframe_url = s.keyframe_remote_url = s.clip_url = ""
        s.save()
        key = request.data.get("idempotencyKey") or f"scene:{s.id}:{int(time.time() * 1000)}"
        billing.charge(m.organization, Action.SCENE_REGENERATE, billing.video_credits(v.tier, s.duration_ms / 1000),
                       key, video_id=v.id, note=f"Regenerate scene {s.idx + 1}")
        Video.objects.filter(pk=v.pk).update(status=VideoStatus.QUEUED, error="")
        jobs.enqueue(v, "keyframes", scene=s, chain=True, charge_key=key)
        v.refresh_from_db()
        return Response(video_dto(v, scenes=True), status=202)


class DownloadView(APIView):
    def get(self, request, pk):
        _, v = _video(request, pk)
        path = local_path(v.output_url) if v.output_url else None
        if not path or not path.exists():
            raise NotFound("The video file isn't ready.")
        safe = "".join(c if c.isalnum() else "_" for c in v.story.title)[:60] or "postlume"
        return FileResponse(open(path, "rb"), as_attachment=True, filename=f"{safe}.mp4")


class DuplicateView(APIView):
    """'Make another like this': a new project seeded with the same brief."""

    def post(self, request, pk):
        m, v = _video(request, pk, Role.CREATOR)
        b = v.story.brief
        p = Project.objects.create(organization=m.organization, created_by=request.user,
                                   title=f"{v.story.title} (another)", style_preset=b.style_preset)
        raw = {**b.raw, "idea": f"Another story like '{v.story.title}': {b.idea}"[:2000]}
        ChatMessage.objects.create(project=p, role="assistant", content={
            "text": "Here's a brief based on your earlier video. Change the idea or confirm it to write a new story.",
            "brief": raw,
        })
        return Response(project_dto(p, detail=True), status=201)
