import shutil
import tempfile
from pathlib import Path
from unittest import mock

from django.conf import settings
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.billing.models import Subscription, UsageLedger
from apps.studio.models import RenderJob, Video
from pipeline import jobs

TMP_MEDIA = tempfile.mkdtemp(prefix="taleloop-test-")


@override_settings(MEDIA_ROOT=TMP_MEDIA)
class FlowTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TMP_MEDIA, ignore_errors=True)

    def setUp(self):
        self.c = APIClient()
        r = self.c.post("/api/v1/auth/register", {"email": "a@example.com", "password": "s3cret-pass!"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.org_id = r.json()["activeOrganization"]["id"]

    def balance(self):
        return Subscription.objects.get(organization_id=self.org_id).credits_balance

    def make_story(self, seconds=15):
        p = self.c.post("/api/v1/projects", {"stylePreset": "cartoon"}, format="json").json()
        r = self.c.post(f"/api/v1/projects/{p['id']}/messages",
                        {"text": f"A {seconds} second kids story about a brave snail"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        brief = r.json()["assistantMessage"]["brief"]
        self.assertEqual(brief["stylePreset"], "cartoon")
        r = self.c.post(f"/api/v1/projects/{p['id']}/brief", {"brief": brief}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        r = self.c.post(f"/api/v1/projects/{p['id']}/stories", {}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return p, r.json()

    def test_me_and_billing(self):
        me = self.c.get("/api/v1/auth/me").json()
        self.assertEqual(me["user"]["email"], "a@example.com")
        self.assertEqual(me["activeOrganization"]["role"], "owner")
        self.assertEqual(self.c.get("/api/v1/billing").json()["creditsBalance"], 30)

    def test_full_lite_render(self):
        p, story = self.make_story()
        self.assertEqual(self.balance(), 29)
        r = self.c.patch(f"/api/v1/stories/{story['id']}", {"hook": "A snail dreamed of the sky."}, format="json")
        edited = r.json()
        self.assertEqual(edited["version"], 2)
        self.c.patch(f"/api/v1/stories/{edited['id']}", {"status": "approved"}, format="json")
        r = self.c.post(f"/api/v1/stories/{edited['id']}/videos", {"tier": "lite"}, format="json")
        self.assertEqual(r.status_code, 202, r.content)
        vid = r.json()["id"]
        self.assertEqual(self.balance(), 27)
        jobs.drain()
        v = self.c.get(f"/api/v1/videos/{vid}").json()
        self.assertEqual(v["status"], "ready", v["error"])
        self.assertEqual(v["progress"], 100)
        self.assertGreaterEqual(len(v["scenes"]), 2)
        out = Path(TMP_MEDIA) / v["outputUrl"].removeprefix("/media/")
        self.assertTrue(out.exists() and out.stat().st_size > 10_000)
        r = self.c.get(f"/api/v1/videos/{vid}/download")
        self.assertEqual(r.status_code, 200)

        scene = v["scenes"][0]
        r = self.c.post(f"/api/v1/videos/{vid}/scenes/{scene['id']}/regenerate",
                        {"imagePrompt": "a snail on a mountain top"}, format="json")
        self.assertEqual(r.status_code, 202, r.content)
        jobs.drain()
        v2 = self.c.get(f"/api/v1/videos/{vid}").json()
        self.assertEqual(v2["status"], "ready")
        self.assertNotEqual(v2["scenes"][0]["keyframeUrl"], scene["keyframeUrl"])
        self.assertEqual(v2["scenes"][1]["keyframeUrl"], v["scenes"][1]["keyframeUrl"])

    def test_failure_refunds_and_retry(self):
        _, story = self.make_story()
        before = self.balance()
        with mock.patch("pipeline.steps.assemble.render", side_effect=RuntimeError("boom")):
            vid = self.c.post(f"/api/v1/stories/{story['id']}/videos", {"tier": "lite"}, format="json").json()["id"]
            self.assertEqual(self.balance(), before - 2)
            jobs.drain()
        v = Video.objects.get(pk=vid)
        self.assertEqual(v.status, "failed")
        self.assertEqual(RenderJob.objects.filter(video=v, step="assembling").first().attempts, 3)
        self.assertEqual(self.balance(), before)
        r = self.c.post(f"/api/v1/videos/{vid}/retry")
        self.assertEqual(r.status_code, 202, r.content)
        jobs.drain()
        self.assertEqual(Video.objects.get(pk=vid).status, "ready")
        self.assertEqual(self.balance(), before - 1)

    def test_charge_is_idempotent_and_blocks_when_empty(self):
        _, story = self.make_story()
        Subscription.objects.filter(organization_id=self.org_id).update(credits_balance=3)
        body = {"tier": "lite", "idempotencyKey": "same-key"}
        r1 = self.c.post(f"/api/v1/stories/{story['id']}/videos", body, format="json")
        self.assertEqual(r1.status_code, 202)
        self.assertEqual(UsageLedger.objects.filter(idempotency_key="same-key").count(), 1)
        self.assertEqual(self.balance(), 1)
        r = self.c.post(f"/api/v1/stories/{story['id']}/videos", {"tier": "lite"}, format="json")
        self.assertEqual(r.status_code, 402)
        self.assertEqual(r.json()["error"], "insufficient_credits")

    def test_plan_gates_tier_and_moderation(self):
        p, story = self.make_story()
        r = self.c.post(f"/api/v1/stories/{story['id']}/videos", {"tier": "premium"}, format="json")
        self.assertEqual(r.status_code, 403)
        r = self.c.post(f"/api/v1/projects/{p['id']}/messages", {"text": "Batman fights Superman"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("copyrighted", r.json()["detail"])

    def test_viewer_cannot_generate_and_orgs_are_isolated(self):
        p, _ = self.make_story()
        other = APIClient()
        other.post("/api/v1/auth/register", {"email": "b@example.com", "password": "s3cret-pass!"}, format="json")
        self.assertEqual(other.get(f"/api/v1/projects/{p['id']}").status_code, 404)
        invite = self.c.post("/api/v1/orgs/current/invitations", {"email": "b@example.com", "role": "viewer"},
                             format="json").json()
        r = other.post(f"/api/v1/invitations/{invite['token']}/accept")
        self.assertEqual(r.status_code, 200)
        other.post(f"/api/v1/orgs/{self.org_id}/switch")
        self.assertEqual(other.get(f"/api/v1/projects/{p['id']}").status_code, 200)
        r = other.post(f"/api/v1/projects/{p['id']}/stories", {}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_social_tokens_encrypted(self):
        from apps.social.models import SocialAccount

        a = SocialAccount(organization_id=self.org_id, platform="youtube", external_id="x")
        a.access_token = "secret-token"
        a.save()
        self.assertNotIn("secret-token", SocialAccount.objects.get(pk=a.pk).access_token_enc)
        self.assertEqual(SocialAccount.objects.get(pk=a.pk).access_token, "secret-token")
        r = self.c.get("/api/v1/social").json()
        self.assertNotIn("secret-token", str(r))
        r = self.c.get("/api/v1/social/youtube/connect")
        self.assertEqual(r.status_code, 302)
        self.assertIn("not+configured", r["Location"])
