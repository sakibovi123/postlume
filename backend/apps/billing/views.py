import time

from django.db.models import Sum
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Role
from apps.accounts.permissions import require_role

from . import service
from .models import PLANS, UsageLedger


def billing_dto(org):
    sub = service.subscription_for(org)
    ledger = UsageLedger.objects.filter(organization=org)[:50]
    spent = UsageLedger.objects.filter(organization=org).aggregate(usd=Sum("estimated_cost_usd"))["usd"] or 0
    return {
        "plan": sub.plan,
        "planInfo": sub.plan_info,
        "creditsBalance": sub.credits_balance,
        "plans": PLANS,
        "quotes": service.quotes(),
        "providerCostUsd": float(spent),
        "usage": [
            {
                "id": e.id, "action": e.action, "credits": e.credits, "note": e.note, "refunded": e.refunded,
                "videoId": e.video_id, "storyId": e.story_id,
                "estimatedCostUsd": float(e.estimated_cost_usd), "createdAt": e.created_at,
            }
            for e in ledger
        ],
    }


class BillingView(APIView):
    def get(self, request):
        m = require_role(request, Role.VIEWER)
        return Response(billing_dto(m.organization))

    def patch(self, request):
        """Demo plan switch until a payment provider is wired in."""
        m = require_role(request, Role.ADMIN)
        plan = request.data.get("plan")
        if plan not in PLANS:
            raise ValidationError({"plan": "Unknown plan."})
        sub = service.subscription_for(m.organization)
        sub.plan = plan
        sub.save(update_fields=["plan", "updated_at"])
        service.grant(
            m.organization, PLANS[plan]["monthly_credits"],
            f"plan:{m.organization.id}:{plan}:{int(time.time())}", f"{PLANS[plan]['name']} plan credits (demo)",
        )
        return Response(billing_dto(m.organization))


class QuotesView(APIView):
    def get(self, request):
        return Response(service.quotes())
