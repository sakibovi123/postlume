import math
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import F

from apps.accounts.exceptions import InsufficientCredits

from .models import PLANS, Action, Subscription, UsageLedger

CREDITS_PER_10S = {"lite": 1, "standard": 5, "premium": 10}
STORY_CREDITS = 1
REASSEMBLE_CREDITS = 1


def video_credits(tier, seconds):
    return max(1, math.ceil(seconds / 10) * CREDITS_PER_10S[tier])


def quotes():
    return {
        "story_generate": STORY_CREDITS,
        "video_reassemble": REASSEMBLE_CREDITS,
        "video_render_per_10s": CREDITS_PER_10S,
        "scene_regenerate_per_10s": CREDITS_PER_10S,
    }


def subscription_for(org):
    sub, created = Subscription.objects.get_or_create(organization=org)
    if created:
        grant(org, PLANS["free"]["monthly_credits"], f"signup:{org.id}", "Free plan credits")
        sub.refresh_from_db()
    return sub


def grant(org, credits, key, note=""):
    with transaction.atomic():
        try:
            entry = UsageLedger.objects.create(
                organization=org, action=Action.GRANT, credits=credits, idempotency_key=key, note=note
            )
        except IntegrityError:
            return UsageLedger.objects.get(idempotency_key=key)
        Subscription.objects.filter(organization=org).update(credits_balance=F("credits_balance") + credits)
    return entry


def charge(org, action, credits, key, *, video_id=None, story_id=None, note=""):
    """Idempotent: the same key always returns the same ledger entry and charges once."""
    existing = UsageLedger.objects.filter(idempotency_key=key).first()
    if existing:
        return existing
    subscription_for(org)
    with transaction.atomic():
        updated = Subscription.objects.filter(organization=org, credits_balance__gte=credits).update(
            credits_balance=F("credits_balance") - credits
        )
        if not updated:
            balance = Subscription.objects.get(organization=org).credits_balance
            raise InsufficientCredits(credits, balance)
        try:
            with transaction.atomic():
                return UsageLedger.objects.create(
                    organization=org,
                    action=action,
                    credits=-credits,
                    idempotency_key=key,
                    video_id=video_id,
                    story_id=story_id,
                    note=note,
                )
        except IntegrityError:
            Subscription.objects.filter(organization=org).update(credits_balance=F("credits_balance") + credits)
            return UsageLedger.objects.get(idempotency_key=key)


def refund(entry, note="Refund"):
    if entry is None or entry.credits >= 0 or entry.refunded:
        return None
    with transaction.atomic():
        claimed = UsageLedger.objects.filter(pk=entry.pk, refunded=False).update(refunded=True)
        if not claimed:
            return None
        Subscription.objects.filter(organization_id=entry.organization_id).update(
            credits_balance=F("credits_balance") - entry.credits
        )
        return UsageLedger.objects.create(
            organization_id=entry.organization_id,
            action=Action.REFUND,
            credits=-entry.credits,
            idempotency_key=f"refund:{entry.idempotency_key}",
            video_id=entry.video_id,
            story_id=entry.story_id,
            note=note,
        )


def add_cost(key, usd):
    if usd:
        UsageLedger.objects.filter(idempotency_key=key).update(
            estimated_cost_usd=F("estimated_cost_usd") + Decimal(str(round(usd, 4)))
        )
