import logging
from datetime import timedelta
from urllib.parse import urlencode

import httpx
from django.conf import settings
from django.utils import timezone


log = logging.getLogger(__name__)


class OAuthError(Exception):
    pass


def redirect_uri(platform):
    return f"{settings.PUBLIC_APP_URL}/api/v1/social/{platform}/callback"


def is_configured(platform):
    c = settings.OAUTH[platform]
    return bool(c["client_id"] and c["client_secret"] and c.get("config_id", True))


def creds(platform):
    if not is_configured(platform):
        raise OAuthError(f"{platform} OAuth is not configured. See backend/.env.example for the required keys.")
    return settings.OAUTH[platform]


def _graph(path):
    return f"https://graph.facebook.com/{settings.META_GRAPH_VERSION}{path}"


def _check(resp):
    if resp.status_code >= 400:
        raise OAuthError(f"{resp.request.url.host} returned {resp.status_code}: {resp.text[:300]}")
    return resp.json()


SCOPES = {
    "youtube": ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
    "facebook": ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
    "instagram": ["instagram_basic", "instagram_content_publish"],
}


def authorize_url(platform, state):
    c = creds(platform)
    if platform == "youtube":
        base = "https://accounts.google.com/o/oauth2/v2/auth"
        params = {
            "client_id": c["client_id"], "redirect_uri": redirect_uri(platform), "response_type": "code",
            "scope": " ".join(SCOPES[platform]), "access_type": "offline", "prompt": "consent",
            "include_granted_scopes": "true", "state": state,
        }
    elif platform == "facebook":
        base = f"https://www.facebook.com/{settings.META_GRAPH_VERSION}/dialog/oauth"
        params = {
            "client_id": c["client_id"], "redirect_uri": redirect_uri(platform), "response_type": "code",
            "scope": ",".join(SCOPES[platform]), "state": state,
        }
    else:
        # Unified login: permissions come from the Facebook Login for Business configuration.
        base = f"https://www.facebook.com/{settings.META_GRAPH_VERSION}/dialog/oauth"
        params = {
            "client_id": c["client_id"], "redirect_uri": redirect_uri(platform), "response_type": "code",
            "config_id": c["config_id"], "state": state,
        }
    return f"{base}?{urlencode(params)}"


def exchange(platform, code):
    """Returns a list of account dicts ready to upsert into SocialAccount."""
    c = creds(platform)
    with httpx.Client(timeout=20) as http:
        if platform == "youtube":
            return _youtube(http, c, code)
        if platform == "facebook":
            return _facebook(http, c, code)
        return _instagram(http, c, code)


def _youtube(http, c, code):
    tok = _check(http.post("https://oauth2.googleapis.com/token", data={
        "code": code, "client_id": c["client_id"], "client_secret": c["client_secret"],
        "redirect_uri": redirect_uri("youtube"), "grant_type": "authorization_code",
    }))
    data = _check(http.get(
        "https://www.googleapis.com/youtube/v3/channels",
        params={"part": "snippet", "mine": "true"},
        headers={"Authorization": f"Bearer {tok['access_token']}"},
    ))
    if not data.get("items"):
        raise OAuthError("This Google account has no YouTube channel.")
    accounts = []
    for ch in data["items"]:
        sn = ch["snippet"]
        accounts.append({
            "external_id": ch["id"], "handle": sn.get("customUrl", ""), "display_name": sn.get("title", ""),
            "avatar_url": sn.get("thumbnails", {}).get("default", {}).get("url", ""),
            "access_token": tok["access_token"], "refresh_token": tok.get("refresh_token", ""),
            "expires_at": timezone.now() + timedelta(seconds=tok.get("expires_in", 3600)),
            "scopes": tok.get("scope", "").split(),
        })
    return accounts


def _facebook(http, c, code):
    short = _check(http.get(_graph("/oauth/access_token"), params={
        "client_id": c["client_id"], "client_secret": c["client_secret"],
        "redirect_uri": redirect_uri("facebook"), "code": code,
    }))
    long = _check(http.get(_graph("/oauth/access_token"), params={
        "grant_type": "fb_exchange_token", "client_id": c["client_id"], "client_secret": c["client_secret"],
        "fb_exchange_token": short["access_token"],
    }))
    pages = _check(http.get(_graph("/me/accounts"), params={
        "fields": "id,name,access_token,picture{url}", "access_token": long["access_token"],
    }))
    if not pages.get("data"):
        raise OAuthError("No Facebook Pages found. Postlume can only post to Pages you manage.")
    return [
        {
            "external_id": p["id"], "handle": p["name"], "display_name": p["name"],
            "avatar_url": p.get("picture", {}).get("data", {}).get("url", ""),
            "access_token": p["access_token"], "refresh_token": "", "expires_at": None,
            "scopes": SCOPES["facebook"],
        }
        for p in pages["data"]
    ]


def _instagram_ids(http, c, token):
    info = _check(http.get(_graph("/debug_token"), params={
        "input_token": token, "access_token": f"{c['client_id']}|{c['client_secret']}",
    })).get("data", {})
    log.warning("instagram debug_token: type=%s scopes=%s granular=%s",
                info.get("type"), info.get("scopes"), info.get("granular_scopes"))
    ids = set()
    for g in info.get("granular_scopes", []):
        if g.get("scope", "").startswith("instagram_"):
            ids.update(g.get("target_ids", []))
    if ids:
        return ids

    pages = _check(http.get(_graph("/me/accounts"), params={
        "fields": "name,instagram_business_account,connected_instagram_account", "access_token": token,
    })).get("data", [])
    log.warning("instagram me/accounts: %s", pages)
    for p in pages:
        ig = p.get("instagram_business_account") or p.get("connected_instagram_account")
        if ig:
            ids.add(ig["id"])
    if not ids:
        granted = ", ".join(info.get("scopes", [])) or "none"
        page_names = ", ".join(p.get("name", "?") for p in pages) or "none"
        raise OAuthError(
            f"Meta didn't return an Instagram professional account. Permissions granted: {granted}. "
            f"Pages shared: {page_names}. Link your Instagram Business/Creator account to a Facebook Page, "
            "then reconnect and select both the Page and the Instagram account."
        )
    return ids


def _instagram(http, c, code):
    tok = _check(http.get(_graph("/oauth/access_token"), params={
        "client_id": c["client_id"], "client_secret": c["client_secret"],
        "redirect_uri": redirect_uri("instagram"), "code": code,
    }))
    token, expires_in = tok["access_token"], tok.get("expires_in")
    if expires_in:
        long = http.get(_graph("/oauth/access_token"), params={
            "grant_type": "fb_exchange_token", "client_id": c["client_id"], "client_secret": c["client_secret"],
            "fb_exchange_token": token,
        })
        if long.status_code < 400:
            token, expires_in = long.json()["access_token"], long.json().get("expires_in")

    ids = _instagram_ids(http, c, token)
    accounts = []
    for ig_id in sorted(ids):
        me = _check(http.get(_graph(f"/{ig_id}"), params={
            "fields": "id,username,name,profile_picture_url", "access_token": token,
        }))
        accounts.append({
            "external_id": me["id"], "handle": me.get("username", ""), "display_name": me.get("name", ""),
            "avatar_url": me.get("profile_picture_url", ""), "access_token": token, "refresh_token": "",
            "expires_at": timezone.now() + timedelta(seconds=expires_in) if expires_in else None,
            "scopes": SCOPES["instagram"],
        })
    return accounts


def refresh(account):
    """Renews the token in place. Raises OAuthError if the user revoked access."""
    c = creds(account.platform)
    with httpx.Client(timeout=20) as http:
        if account.platform == "youtube":
            tok = _check(http.post("https://oauth2.googleapis.com/token", data={
                "client_id": c["client_id"], "client_secret": c["client_secret"],
                "refresh_token": account.refresh_token, "grant_type": "refresh_token",
            }))
            account.access_token = tok["access_token"]
            account.token_expires_at = timezone.now() + timedelta(seconds=tok.get("expires_in", 3600))
        else:
            _check(http.get(_graph("/me"), params={"access_token": account.access_token}))
    account.status = "active"
    account.save()
