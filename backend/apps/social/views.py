import logging
import secrets
from urllib.parse import urlencode

from django.conf import settings
from django.shortcuts import redirect
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Role
from apps.accounts.permissions import require_role

from . import oauth
from .models import SocialAccount

log = logging.getLogger(__name__)
PLATFORMS = {"youtube", "facebook", "instagram"}


def account_dto(a):
    return {
        "id": a.id, "platform": a.platform, "externalId": a.external_id, "handle": a.handle,
        "displayName": a.display_name, "avatarUrl": a.avatar_url, "status": a.status,
        "tokenExpiresAt": a.token_expires_at, "scopes": a.scopes, "createdAt": a.created_at,
    }


def _back(**params):
    return redirect(f"{settings.PUBLIC_APP_URL}/settings/connections?{urlencode(params)}")


class SocialListView(APIView):
    def get(self, request):
        m = require_role(request, Role.VIEWER)
        accounts = SocialAccount.objects.filter(organization=m.organization).exclude(status="disconnected")
        return Response({
            "accounts": [account_dto(a) for a in accounts.order_by("platform", "created_at")],
            "configured": {p: bool(settings.OAUTH[p]["client_id"]) for p in PLATFORMS},
        })


class SocialDetailView(APIView):
    def delete(self, request, account_id):
        m = require_role(request, Role.ADMIN)
        account = SocialAccount.objects.filter(organization=m.organization, id=account_id).first()
        if not account:
            raise NotFound()
        account.status = "disconnected"
        account.access_token = ""
        account.refresh_token = ""
        account.save()
        return Response(status=204)


class ConnectView(APIView):
    def get(self, request, platform):
        if platform not in PLATFORMS:
            raise NotFound()
        m = require_role(request, Role.ADMIN)
        state = secrets.token_urlsafe(24)
        request.session["oauth_flow"] = {"state": state, "platform": platform, "org_id": m.organization_id}
        try:
            return redirect(oauth.authorize_url(platform, state))
        except oauth.OAuthError as e:
            return _back(error=str(e), platform=platform)


class CallbackView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, platform):
        flow = request.session.pop("oauth_flow", None)
        if not request.user.is_authenticated or not flow or flow["platform"] != platform:
            return _back(error="Your connect session expired. Please try again.", platform=platform)
        if not secrets.compare_digest(flow["state"], request.GET.get("state", "")):
            return _back(error="OAuth state mismatch.", platform=platform)
        if request.GET.get("error"):
            return _back(error=request.GET.get("error_description") or request.GET["error"], platform=platform)
        try:
            found = oauth.exchange(platform, request.GET.get("code", ""))
        except oauth.OAuthError as e:
            log.warning("oauth exchange failed: %s", e)
            return _back(error=str(e), platform=platform)
        for item in found:
            account, _ = SocialAccount.objects.get_or_create(
                organization_id=flow["org_id"], platform=platform, external_id=item["external_id"]
            )
            account.handle = item["handle"]
            account.display_name = item["display_name"]
            account.avatar_url = item["avatar_url"]
            account.access_token = item["access_token"]
            if item["refresh_token"]:
                account.refresh_token = item["refresh_token"]
            account.token_expires_at = item["expires_at"]
            account.scopes = item["scopes"]
            account.status = "active"
            account.save()
        return _back(connected=platform, count=len(found))
