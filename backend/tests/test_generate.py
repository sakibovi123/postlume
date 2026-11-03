import shutil
import tempfile
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.billing.models import Subscription
from apps.generate import fal_api

TMP_MEDIA = tempfile.mkdtemp(prefix="taleloop-gen-test-")

OPENAPI = {
    "info": {"x-fal-metadata": {"category": "text-to-video"}},
    "paths": {"/acme/video": {"post": {"requestBody": {"content": {"application/json": {
        "schema": {"$ref": "#/components/schemas/VideoInput"}}}}}}},
    "components": {"schemas": {
        "VideoInput": {
            "required": ["prompt", "mode"],
            "x-fal-order-properties": ["prompt", "duration", "image_url", "mode", "seed", "loras"],
            "properties": {
                "prompt": {"type": "string"},
                "duration": {"$ref": "#/components/schemas/Duration", "default": "5"},
                "image_url": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                "mode": {"type": "string", "default": "balanced"},
                "seed": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                "loras": {"type": "array", "items": {"type": "object"}},
            },
        },
        "Duration": {"enum": ["5", "10"], "type": "string"},
    }},
}


class FakeStatus:
    def __init__(self, logs=None, position=None):
        self.logs, self.position = logs or [], position


@override_settings(MEDIA_ROOT=TMP_MEDIA, TASKS_EAGER=True, FAL_KEY="test", GENERATE_POLL_SECONDS=0, USD_PER_CREDIT=0.05,
                   GENERATE_CHARGE_CREDITS=True)
class GenerateTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TMP_MEDIA, ignore_errors=True)

    def setUp(self):
        from django.core.cache import cache

        cache.clear()
        self.c = APIClient()
        r = self.c.post("/api/v1/auth/register", {"email": "g@example.com", "password": "s3cret-pass!"}, format="json")
        self.org_id = r.json()["activeOrganization"]["id"]
        self.balance = lambda: Subscription.objects.get(organization_id=self.org_id).credits_balance
        get = mock.patch.object(fal_api, "_get", side_effect=self.fake_get)
        get.start()
        self.addCleanup(get.stop)

    def fake_get(self, url, params, auth=True):
        if url == fal_api.OPENAPI:
            return OPENAPI
        if url.endswith("/models/pricing"):
            return {"prices": [{"unit_price": 0.07, "unit": "seconds", "currency": "USD"}]}
        return {"models": [{"endpoint_id": "acme/video", "metadata": {"display_name": "Acme", "highlighted": True}}],
                "has_more": False}

    def test_schema_is_turned_into_fields(self):
        info = self.c.get("/api/v1/generate/schema", {"endpoint": "acme/video"}).json()
        by = {f["name"]: f for f in info["fields"]}
        self.assertEqual([f["name"] for f in info["fields"]], ["prompt", "duration", "image_url", "mode", "seed", "loras"])
        self.assertEqual(by["prompt"]["type"], "text")
        self.assertEqual(by["duration"], {**by["duration"], "type": "enum", "options": ["5", "10"], "default": "5"})
        self.assertEqual(by["image_url"]["type"], "file")
        self.assertEqual(by["image_url"]["accept"], "image")
        self.assertTrue(by["seed"]["advanced"])
        self.assertEqual(by["loras"]["type"], "json")
        self.assertEqual(fal_api.estimate(info, {"duration": "10"}), (0.7, True))
        models = self.c.get("/api/v1/generate/models", {"category": "text-to-video"}).json()
        self.assertEqual(models[0]["id"], "acme/video")

    def run_generation(self, result=None, error=None):
        import fal_client

        with mock.patch("fal_client.submit", return_value=mock.Mock(request_id="req-1")), \
             mock.patch("fal_client.status", side_effect=[mock.Mock(spec=fal_client.Queued, position=2),
                                                          mock.Mock(spec=fal_client.InProgress, logs=[{"message": "denoising"}]),
                                                          mock.Mock(spec=fal_client.Completed)]), \
             mock.patch("fal_client.result", side_effect=error, return_value=result), \
             mock.patch("apps.generate.runner.download", side_effect=lambda url, dest: dest.write_bytes(b"x") or dest):
            return self.c.post("/api/v1/generations", {
                "endpointId": "acme/video", "modelName": "Acme", "input": {"prompt": "a fox", "duration": "10", "bogus": 1},
            }, format="json")

    def test_generation_runs_saves_media_and_charges(self):
        before = self.balance()
        r = self.run_generation({"video": {"url": "https://v3.fal.media/files/out.mp4", "content_type": "video/mp4"},
                                 "seed": 7})
        self.assertEqual(r.status_code, 201, r.content)
        g = r.json()
        self.assertEqual(g["status"], "done")
        self.assertEqual(g["input"], {"prompt": "a fox", "duration": "10", "mode": "balanced"})
        self.assertEqual(g["credits"], 14)
        self.assertEqual(self.balance(), before - 14)
        self.assertEqual(g["media"][0]["type"], "video")
        self.assertTrue(g["media"][0]["url"].startswith("/media/generations/"))
        self.assertEqual(self.c.get(g["media"][0]["url"]).status_code, 200)
        self.assertEqual(self.c.get("/api/v1/generations").json()[0]["id"], g["id"])

        other = APIClient()
        other.post("/api/v1/auth/register", {"email": "o@example.com", "password": "s3cret-pass!"}, format="json")
        self.assertEqual(other.get(f"/api/v1/generations/{g['id']}").status_code, 404)
        self.assertEqual(other.get(g["media"][0]["url"]).status_code, 404)

    def test_failure_refunds_credits(self):
        before = self.balance()
        r = self.run_generation(error=RuntimeError("content policy violation"))
        g = r.json()
        self.assertEqual(g["status"], "failed")
        self.assertIn("content policy", g["error"])
        self.assertEqual(self.balance(), before)

    def test_missing_required_input_and_moderation(self):
        r = self.c.post("/api/v1/generations", {"endpointId": "acme/video", "input": {}}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.c.post("/api/v1/generations", {"endpointId": "acme/video", "input": {"prompt": "batman dancing"}},
                        format="json")
        self.assertEqual(r.status_code, 400)

    @override_settings(GENERATE_CHARGE_CREDITS=False)
    def test_long_video_is_split_into_shots_and_stitched(self):
        import fal_client

        from providers.media import run_ffmpeg

        def make_clip(url, dest):
            run_ffmpeg(["-f", "lavfi", "-i", "color=c=blue:s=320x180:d=10", "-c:v", "libx264", str(dest)])
            return dest

        submitted = []
        with mock.patch("fal_client.submit", side_effect=lambda ep, arguments: submitted.append(arguments) or
                        mock.Mock(request_id=f"req-{len(submitted)}")), \
             mock.patch("fal_client.status", return_value=mock.Mock(spec=fal_client.Completed)), \
             mock.patch("fal_client.result", return_value={"video": {"url": "https://fal.media/c.mp4"}}), \
             mock.patch("apps.generate.runner.download", side_effect=make_clip):
            r = self.c.post("/api/v1/generations", {
                "endpointId": "acme/video", "input": {"prompt": "a fox runs"}, "totalSeconds": 25,
            }, format="json")
        g = r.json()
        self.assertEqual(g["status"], "done", g["error"])
        self.assertEqual(g["plan"], {"totalSeconds": 25, "clipSeconds": 10, "count": 3, "done": 3})
        self.assertEqual(len(submitted), 3)
        self.assertTrue(all(a["duration"] == "10" and "a fox runs" in a["prompt"] for a in submitted))
        self.assertEqual((g["credits"], g["costUsd"]), (0, 2.1))
        from providers.media import local_path, media_duration

        self.assertAlmostEqual(media_duration(local_path(g["media"][0]["url"])), 25, delta=0.6)
        r = self.c.post("/api/v1/generations", {"endpointId": "acme/video", "input": {"prompt": "x"}, "totalSeconds": 601},
                        format="json")
        self.assertEqual(r.status_code, 400)
