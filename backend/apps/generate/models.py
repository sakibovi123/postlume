from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.db import models

from apps.accounts.models import Organization


class Generation(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="generations")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    endpoint_id = models.CharField(max_length=200)
    category = models.CharField(max_length=40, blank=True)
    model_name = models.CharField(max_length=200, blank=True)
    input = models.JSONField(default=dict, encoder=DjangoJSONEncoder)
    status = models.CharField(max_length=16, default="queued")  # queued | running | done | failed
    request_id = models.CharField(max_length=100, blank=True)
    queue_position = models.IntegerField(null=True, blank=True)
    logs = models.JSONField(default=list)
    output = models.JSONField(null=True, blank=True, encoder=DjangoJSONEncoder)
    plan = models.JSONField(null=True, blank=True)  # long videos: {"totalSeconds", "clipSeconds", "shots": [...]}
    media = models.JSONField(default=list)  # [{"type": "video", "url": local, "remote": fal url}]
    cost_usd = models.DecimalField(max_digits=10, decimal_places=4, default=0)
    credits = models.IntegerField(default=0)
    charge_key = models.CharField(max_length=200, blank=True)
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
