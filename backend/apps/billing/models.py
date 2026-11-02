from django.db import models

from apps.accounts.models import Organization

PLANS = {
    "free": {"name": "Free", "monthly_credits": 30, "tiers": ["lite"], "max_seconds": 60},
    "creator": {"name": "Creator", "monthly_credits": 300, "tiers": ["lite", "standard"], "max_seconds": 90},
    "studio": {"name": "Studio", "monthly_credits": 1500, "tiers": ["lite", "standard", "premium"], "max_seconds": 180},
}


class Subscription(models.Model):
    organization = models.OneToOneField(Organization, on_delete=models.CASCADE, related_name="subscription")
    plan = models.CharField(max_length=16, default="free")
    credits_balance = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def plan_info(self):
        return PLANS[self.plan]


class Action(models.TextChoices):
    STORY_GENERATE = "story_generate"
    VIDEO_RENDER = "video_render"
    SCENE_REGENERATE = "scene_regenerate"
    VIDEO_REASSEMBLE = "video_reassemble"
    GRANT = "grant"
    REFUND = "refund"


class UsageLedger(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="ledger")
    action = models.CharField(max_length=32, choices=Action.choices)
    credits = models.IntegerField(help_text="Negative for charges, positive for grants and refunds")
    idempotency_key = models.CharField(max_length=200, unique=True)
    estimated_cost_usd = models.DecimalField(max_digits=10, decimal_places=4, default=0)
    refunded = models.BooleanField(default=False)
    video_id = models.BigIntegerField(null=True, blank=True)
    story_id = models.BigIntegerField(null=True, blank=True)
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
