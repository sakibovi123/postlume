from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.db import models

from apps.accounts.models import Organization


class Project(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="projects")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    title = models.CharField(max_length=200, default="Untitled project")
    style_preset = models.CharField(max_length=32, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class ChatMessage(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=16)  # user | assistant
    content = models.JSONField()  # {"text": str, "brief": dict | None}
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class Brief(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="briefs")
    style_preset = models.CharField(max_length=32)
    custom_style = models.TextField(blank=True)
    idea = models.TextField()
    genre = models.CharField(max_length=64)
    aspect_ratio = models.CharField(max_length=8)
    target_seconds = models.IntegerField()
    language = models.CharField(max_length=16, default="en")
    voice_id = models.CharField(max_length=64, blank=True)
    music_mood = models.CharField(max_length=64, blank=True)
    narration = models.BooleanField(default=True)
    raw = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)


class Story(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="stories")
    brief = models.ForeignKey(Brief, on_delete=models.PROTECT, related_name="stories")
    version = models.IntegerField()
    title = models.CharField(max_length=200)
    logline = models.TextField()
    hook = models.TextField()
    script = models.TextField()
    characters = models.JSONField(default=list)
    estimated_seconds = models.IntegerField(default=0)
    status = models.CharField(max_length=16, default="draft")  # draft | approved
    source = models.CharField(max_length=16, default="generated")  # generated | rewrite | edit | restore
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("project", "version")
        ordering = ["-version"]


class VideoStatus(models.TextChoices):
    QUEUED = "queued"
    PLANNING = "planning"
    REFERENCES = "references"
    KEYFRAMES = "keyframes"
    CLIPS = "clips"
    VOICE = "voice"
    ASSEMBLING = "assembling"
    READY = "ready"
    FAILED = "failed"


class Video(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="videos")
    story = models.ForeignKey(Story, on_delete=models.PROTECT, related_name="videos")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    tier = models.CharField(max_length=16)  # lite | standard | premium
    aspect_ratio = models.CharField(max_length=8)
    status = models.CharField(max_length=16, choices=VideoStatus.choices, default=VideoStatus.QUEUED)
    progress = models.IntegerField(default=0)
    style_guide = models.TextField(blank=True)
    references = models.JSONField(default=dict)  # {"style": url, "characters": {name: url}}
    voice_id = models.CharField(max_length=64, blank=True)
    music_mood = models.CharField(max_length=64, blank=True)
    captions = models.BooleanField(default=True)
    output_url = models.CharField(max_length=500, blank=True)
    thumbnail_url = models.CharField(max_length=500, blank=True)
    duration_ms = models.IntegerField(default=0)
    cost_usd = models.DecimalField(max_digits=10, decimal_places=4, default=0)
    charge_key = models.CharField(max_length=200, blank=True)
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class Scene(models.Model):
    video = models.ForeignKey(Video, on_delete=models.CASCADE, related_name="scenes")
    idx = models.IntegerField()
    narration = models.TextField()
    caption_text = models.TextField(blank=True)
    duration_ms = models.IntegerField()
    shot = models.TextField(blank=True)
    camera = models.CharField(max_length=120, blank=True)
    characters = models.JSONField(default=list)
    image_prompt = models.TextField()
    motion_prompt = models.TextField(blank=True)
    keyframe_url = models.CharField(max_length=1000, blank=True)
    keyframe_remote_url = models.CharField(max_length=1000, blank=True)
    clip_url = models.CharField(max_length=1000, blank=True)
    audio_url = models.CharField(max_length=1000, blank=True)
    words = models.JSONField(default=list)  # [{"word", "start", "end"}] in seconds, relative to the scene
    status = models.CharField(max_length=16, default="pending")

    class Meta:
        ordering = ["idx"]
        unique_together = ("video", "idx")


class RenderJob(models.Model):
    STEPS = ["planning", "references", "keyframes", "clips", "voice", "assembling"]

    video = models.ForeignKey(Video, on_delete=models.CASCADE, related_name="jobs")
    scene = models.ForeignKey(Scene, on_delete=models.CASCADE, null=True, blank=True, related_name="jobs")
    step = models.CharField(max_length=16)
    chain = models.BooleanField(default=True, help_text="Enqueue the next step when this one finishes")
    charge_key = models.CharField(max_length=200, blank=True, help_text="Ledger entry refunded if the chain fails")
    status = models.CharField(max_length=16, default="queued")  # queued | running | done | failed
    attempts = models.IntegerField(default=0)
    provider = models.CharField(max_length=64, blank=True)
    cost_usd = models.DecimalField(max_digits=10, decimal_places=4, default=0)
    error = models.TextField(blank=True)
    run_after = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at", "id"]


class GenerationTask(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="tasks")
    kind = models.CharField(max_length=16)  # director | story | rewrite
    status = models.CharField(max_length=16, default="queued")  # queued | running | done | failed
    stage = models.CharField(max_length=32, blank=True)
    progress = models.IntegerField(default=0)
    partial = models.JSONField(default=dict, encoder=DjangoJSONEncoder)
    result = models.JSONField(null=True, blank=True, encoder=DjangoJSONEncoder)
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
