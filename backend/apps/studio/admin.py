from django.contrib import admin

from .models import Brief, ChatMessage, Project, RenderJob, Scene, Story, Video


@admin.register(RenderJob)
class RenderJobAdmin(admin.ModelAdmin):
    list_display = ("id", "video", "step", "scene", "status", "attempts", "cost_usd", "created_at")
    list_filter = ("status", "step")


@admin.register(Video)
class VideoAdmin(admin.ModelAdmin):
    list_display = ("id", "project", "tier", "status", "progress", "cost_usd", "created_at")


admin.site.register([Project, ChatMessage, Brief, Story, Scene])
