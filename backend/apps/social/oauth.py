from datetime import timedelta
from urllib.parse import urlencode

import httpx
from django.conf import settings
from django.utils import timezone


class OAuthError(Exception):
    pass


def redirect_uri(platform):
    return f"{settings.PUBLIC_APP_URL}/api/v1/social/{platform}/callback"


def creds(platform):
    c = settings.OAUTH[platform]
    if not c["client_id"] or not c["client_secret"]:
        raise OAuthError(f"{platform} OAuth is not configured. Add its client id and secret to backend/.env.")
    return c


def _graph(path):
    return f"https://graph.facebook.com/{settings.META_GRAPH_VERSION}{path}"


def _check(resp):
    if resp.status_code >= 400:
        raise OAuthError(f"{resp.request.url.host} returned {resp.status_code}: {resp.text[:300]}")
    return resp.json()


SCOPES = {
    "youtube": ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
    "facebook": ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
    "instagram": ["instagram_business_basic", "instagram_business_content_publish"],
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
        base = "https://www.instagram.com/oauth/authorize"
        params = {
            "client_id": c["client_id"], "redirect_uri": redirect_uri(platform), "response_type": "code",
            "scope": ",".join(SCOPES[platform]), "state": state,
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


def _instagram(http, c, code):
    short = _check(http.post("https://api.instagram.com/oauth/access_token", data={
        "client_id": c["client_id"], "client_secret": c["client_secret"], "grant_type": "authorization_code",
        "redirect_uri": redirect_uri("instagram"), "code": code,
    }))
    long = _check(http.get("https://graph.instagram.com/access_token", params={
        "grant_type": "ig_exchange_token", "client_secret": c["client_secret"], "access_token": short["access_token"],
    }))
    me = _check(http.get("https://graph.instagram.com/me", params={
        "fields": "user_id,username,name,profile_picture_url", "access_token": long["access_token"],
    }))
    return [{
        "external_id": str(me.get("user_id") or short.get("user_id")), "handle": me.get("username", ""),
        "display_name": me.get("name", ""), "avatar_url": me.get("profile_picture_url", ""),
        "access_token": long["access_token"], "refresh_token": "",
        "expires_at": timezone.now() + timedelta(seconds=long.get("expires_in", 5184000)),
        "scopes": SCOPES["instagram"],
    }]


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
        elif account.platform == "instagram":
            tok = _check(http.get("https://graph.instagram.com/refresh_access_token", params={
                "grant_type": "ig_refresh_token", "access_token": account.access_token,
            }))
            account.access_token = tok["access_token"]
            account.token_expires_at = timezone.now() + timedelta(seconds=tok.get("expires_in", 5184000))
        else:
            _check(http.get(_graph("/me"), params={"access_token": account.access_token}))
    account.status = "active"
    account.save()
