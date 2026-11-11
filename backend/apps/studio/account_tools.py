"""Read-only account lookups for Lumen.

Security: every function takes the caller's Membership (resolved from the logged-in request) and only queries rows
whose organization is that membership's organization, exactly like the matching API views. Nothing here writes,
and secrets (OAuth tokens, invite links, external ids, provider costs) are never returned.
"""

from django.db.models import Count, Q, Sum
from django.utils import timezone

from apps.accounts.models import Invitation, Membership, Role
from apps.billing import service as billing
from apps.billing.models import PLANS, UsageLedger
from apps.generate.models import Generation
from apps.social.models import SocialAccount
from providers.base import hide_provider

from .models import Project, Video
from .services import ACTIVE

MAX_ROWS = 50

ROLE_CAN = {
    Role.VIEWER: "view projects, videos, the library, team, plugins and billing",
    Role.CREATOR: "everything a viewer can, plus chat with Lumen, create projects, write stories, render, edit and "
                  "download videos, and run All models",
    Role.ADMIN: "everything a creator can, plus invite or remove members, change roles, connect or disconnect "
                "social accounts, change the plan and delete projects",
    Role.OWNER: "everything an admin can, plus make other people owners",
}


def _limit(limit):
    try:
        return max(1, min(int(limit or 20), MAX_ROWS))
    except (TypeError, ValueError):
        return 20


def _date(dt):
    return timezone.localtime(dt).strftime("%d %b %Y, %H:%M") if dt else None


def get_account(m: Membership):
    sub = billing.subscription_for(m.organization)
    plan = sub.plan_info
    others = (Membership.objects.filter(user=m.user).exclude(organization=m.organization)
              .select_related("organization").order_by("created_at"))
    return {
        "you": {"name": m.user.first_name or None, "email": m.user.email, "role": m.role,
                "youCan": ROLE_CAN.get(m.role, "")},
        "workspace": m.organization.name,
        "otherWorkspaces": [x.organization.name for x in others],
        "plan": {"id": sub.plan, "name": plan["name"], "monthlyCredits": plan["monthly_credits"],
                 "tiers": plan["tiers"], "maxSecondsPerVideo": plan["max_seconds"]},
        "credits": sub.credits_balance,
        "allPlans": {k: {"name": v["name"], "monthlyCredits": v["monthly_credits"], "tiers": v["tiers"],
                         "maxSecondsPerVideo": v["max_seconds"]} for k, v in PLANS.items()},
    }


def list_projects(m: Membership, current_id=None, search="", limit=20):
    qs = Project.objects.filter(organization=m.organization)
    if search:
        qs = qs.filter(title__icontains=search[:100])
    qs = qs.annotate(video_count=Count("videos", distinct=True)).order_by("-updated_at")[:_limit(limit)]
    return {"projects": [
        {"id": p.id, "title": p.title, "episodes": (p.series or {}).get("episodeCount"), "videos": p.video_count,
         "style": p.style_preset or None, "updated": _date(p.updated_at),
         **({"thisConversation": True} if p.id == current_id else {})}
        for p in qs
    ]}


def list_videos(m: Membership, status="", project_id=None, limit=20):
    qs = Video.objects.filter(project__organization=m.organization).select_related("project", "story")
    if status == "in_progress":
        qs = qs.filter(status__in=ACTIVE)
    elif status:
        qs = qs.filter(status=status)
    if project_id:
        qs = qs.filter(project_id=project_id)
    qs = qs.order_by("-created_at")[:_limit(limit)]
    return {"videos": [
        {"id": v.id, "project": v.project.title, "episode": v.story.episode, "title": v.story.title,
         "status": v.status, "progress": v.progress, "tier": v.tier, "aspectRatio": v.aspect_ratio,
         "seconds": round(v.duration_ms / 1000), "created": _date(v.created_at)}
        for v in qs
    ]}


def list_generations(m: Membership, status="", limit=20):
    qs = Generation.objects.filter(organization=m.organization)
    if status:
        qs = qs.filter(status=status)
    qs = qs.order_by("-created_at")[:_limit(limit)]
    return {"generations": [
        {"id": g.id, "model": hide_provider(g.model_name or g.endpoint_id), "category": g.category,
         "status": g.status, "prompt": str((g.input or {}).get("prompt") or "")[:160], "credits": g.credits,
         "error": hide_provider(g.error[:160]) or None, "created": _date(g.created_at)}
        for g in qs
    ]}


def get_usage(m: Membership, limit=20):
    org = m.organization
    month_start = timezone.localtime().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month = UsageLedger.objects.filter(organization=org, created_at__gte=month_start).aggregate(
        spent=Sum("credits", filter=Q(credits__lt=0)), added=Sum("credits", filter=Q(credits__gt=0)))
    rows = UsageLedger.objects.filter(organization=org).order_by("-created_at")[:_limit(limit)]
    return {
        "creditsBalance": billing.subscription_for(org).credits_balance,
        "thisMonth": {"creditsSpent": -(month["spent"] or 0), "creditsAdded": month["added"] or 0},
        "recent": [{"action": e.action, "credits": e.credits, "note": e.note, "refunded": e.refunded,
                    "date": _date(e.created_at)} for e in rows],
    }


def list_team(m: Membership):
    members = Membership.objects.filter(organization=m.organization).select_related("user").order_by("created_at")
    invites = Invitation.objects.filter(organization=m.organization, accepted_at__isnull=True).order_by("-created_at")
    return {
        "members": [{"name": x.user.first_name or None, "email": x.user.email, "role": x.role,
                     "joined": _date(x.created_at), **({"you": True} if x.user_id == m.user_id else {})}
                    for x in members],
        "pendingInvitations": [{"email": i.email, "role": i.role, "sent": _date(i.created_at)} for i in invites],
    }


def list_connected_accounts(m: Membership):
    accounts = SocialAccount.objects.filter(organization=m.organization).exclude(status="disconnected")
    return {"accounts": [
        {"platform": a.platform, "handle": a.handle, "name": a.display_name, "status": a.status,
         "connected": _date(a.created_at)}
        for a in accounts.order_by("platform", "created_at")
    ]}
