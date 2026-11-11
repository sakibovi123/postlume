import shutil
import tempfile

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.billing.models import Subscription
from apps.billing.service import video_credits
from apps.studio.models import Video
from pipeline import jobs

TMP_MEDIA = tempfile.mkdtemp(prefix="postlume-agent-test-")


@override_settings(SIGNUP_ENABLED=True, MEDIA_ROOT=TMP_MEDIA, TASKS_EAGER=True, FAKE_LLM_STREAM_SECONDS=0,
                   MAX_CONCURRENT_RENDERS_PER_ORG=2)
class AssistantTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TMP_MEDIA, ignore_errors=True)

    def setUp(self):
        self.c = APIClient()
        r = self.c.post("/api/v1/auth/register", {"email": "a@example.com", "password": "s3cret-pass!"}, format="json")
        self.org_id = r.json()["activeOrganization"]["id"]
        self.p = self.c.post("/api/v1/projects", {}, format="json").json()

    def balance(self):
        return Subscription.objects.get(organization_id=self.org_id).credits_balance

    def say(self, text):
        r = self.c.post(f"/api/v1/projects/{self.p['id']}/messages", {"text": text}, format="json")
        self.assertEqual(r.status_code, 202, r.content)
        task = r.json()["task"]
        self.assertEqual(task["status"], "done", task)
        return task["result"]["assistantMessage"]

    def project(self):
        return self.c.get(f"/api/v1/projects/{self.p['id']}").json()

    def last_message(self):
        return self.project()["messages"][-1]

    def write_series(self, text="A horror story about a haunted lighthouse, 3 episodes, 15 seconds each"):
        msg = self.say(text)
        self.assertEqual([a["type"] for a in msg["actions"]], ["plan", "writing"])
        return self.project()

    def test_asks_for_episode_count_and_length_first(self):
        msg = self.say("Hey assistant, I need a horror story")
        self.assertIn("how many episodes", msg["text"])
        self.assertIn("how long", msg["text"])
        self.assertTrue(msg["suggestions"])
        self.assertEqual(self.project()["stories"], [])
        before = self.balance()
        self.say("3 episodes, 15 seconds each")
        p = self.project()
        self.assertEqual(p["series"]["episodeCount"], 3)
        self.assertEqual(sorted(s["episode"] for s in p["stories"]), [1, 2, 3])
        self.assertEqual(self.balance(), before - 3)
        self.assertEqual({s["characters"][0]["name"] for s in p["stories"]}, {"Mira"})
        written = [m for m in p["messages"] if "are written" in m["text"]]
        self.assertEqual(len(written), 1)
        self.assertIn("Shall I start making the videos", written[0]["text"])

    def test_one_at_a_time_then_rest_all_at_once(self):
        self.write_series()
        msg = self.say("Yes, start making them")
        self.assertIn("All at once", msg["suggestions"])
        before = self.balance()
        msg = self.say("One at a time")
        self.assertEqual(msg["actions"][0]["episodes"], [1])
        self.assertEqual(self.balance(), before - 2)
        jobs.drain()
        videos = Video.objects.filter(project_id=self.p["id"])
        self.assertEqual([v.status for v in videos], ["ready"])
        self.assertIn("Episode 1 is ready", self.last_message()["text"])
        self.assertIn("Start episode 2", self.last_message()["suggestions"])

        msg = self.say("Make the rest all at once")
        self.assertEqual(msg["actions"][0]["episodes"], [2, 3])
        statuses = sorted(Video.objects.filter(project_id=self.p["id"]).values_list("status", flat=True))
        self.assertEqual(statuses, ["queued", "queued", "ready"])
        jobs.drain()
        self.assertEqual(set(Video.objects.filter(project_id=self.p["id"]).values_list("status", flat=True)), {"ready"})
        self.assertIn("All done: 3 of 3 episodes are ready", self.last_message()["text"])

    def test_render_waits_for_free_slots(self):
        self.write_series("A kids story, 5 episodes, 15 seconds each")
        self.say("Yes, make all episodes")
        statuses = list(Video.objects.filter(project_id=self.p["id"]).order_by("id").values_list("status", flat=True))
        self.assertEqual(statuses, ["queued", "queued", "waiting", "waiting", "waiting"])
        jobs.drain()
        self.assertEqual(Video.objects.filter(project_id=self.p["id"], status="ready").count(), 5)

    def ready_episode(self):
        self.write_series("A mystery, 1 episode, 30 seconds")
        self.say("Yes, make the video")
        jobs.drain()
        v = Video.objects.get(project_id=self.p["id"])
        self.assertEqual(v.status, "ready")
        return v

    def edit(self, text):
        before = self.balance()
        msg = self.say(text)
        self.assertEqual(msg["actions"][-1]["type"], "edit", msg)
        jobs.drain()
        v = Video.objects.get(project_id=self.p["id"])
        self.assertEqual(v.status, "ready", v.error)
        self.assertIn("Episode 1 is updated", self.last_message()["text"])
        return v, before - self.balance()

    def test_structural_edits(self):
        v = self.ready_episode()
        scenes = list(v.scenes.values_list("narration", flat=True))
        self.assertGreaterEqual(len(scenes), 3)
        old_ms = v.duration_ms

        v, spent = self.edit("Cut 1 second from the end of scene 1 of episode 1")
        self.assertEqual(spent, 1)
        self.assertEqual(v.scenes.get(idx=0).trim_end_ms, 1000)
        self.assertEqual(v.duration_ms, old_ms - 1000)

        v, _ = self.edit("Delete scene 2")
        self.assertEqual(list(v.scenes.values_list("narration", flat=True)), [scenes[0], *scenes[2:]])

        v, _ = self.edit("Move scene 3 to the start")
        self.assertEqual(v.scenes.get(idx=0).narration, scenes[3])

        v, spent = self.edit("Add a new scene at the end")
        self.assertEqual(v.scenes.count(), len(scenes))
        last = v.scenes.order_by("-idx").first()
        self.assertTrue(last.keyframe_url and last.audio_url)
        self.assertGreaterEqual(spent, 1)

    def test_scene_and_audio_edits(self):
        v = self.ready_episode()
        scene = v.scenes.get(idx=1)
        v, spent = self.edit("Make scene 2 darker with fog")
        self.assertNotEqual(v.scenes.get(idx=1).keyframe_url, scene.keyframe_url)
        self.assertIn("darker with fog", v.scenes.get(idx=1).image_prompt)
        self.assertEqual(spent, video_credits("lite", scene.duration_ms / 1000))

        v, spent = self.edit("Add a creaking door sound effect to scene 1")
        self.assertTrue(v.scenes.get(idx=0).sfx_url)
        self.assertEqual(spent, 1)

        v, _ = self.edit("Change the music to epic")
        self.assertEqual(v.music_mood, "epic")
        old_voice = v.voice_id
        v, _ = self.edit("Use a different voice")
        self.assertNotEqual(v.voice_id, old_voice)
        self.assertTrue(all(s.audio_url for s in v.scenes.all()))

        v, _ = self.edit('Change the caption on scene 1 to "Do not look back"')
        self.assertEqual(v.scenes.get(idx=0).caption_text, "Do not look back")

    def test_scene_numbers_hold_for_a_whole_batch(self):
        from apps.accounts.models import Membership
        from apps.studio.agent import Agent
        from apps.studio.models import Project

        v = self.ready_episode()
        names = list(v.scenes.order_by("idx").values_list("narration", flat=True))
        m = Membership.objects.get(organization_id=self.org_id)
        a = Agent(Project.objects.get(pk=self.p["id"]), m, m.user)
        a.t_move_scene(1, len(names), 1)
        a.t_trim_scene(1, 2, cutEndSeconds=1)
        a.t_delete_scene(1, 3)
        order = list(v.scenes.order_by("idx").values_list("narration", "trim_end_ms"))
        self.assertEqual(order[0], (names[-1], 0))
        self.assertEqual(order[1], (names[0], 0))
        self.assertEqual(order[2], (names[1], 1000))
        self.assertNotIn(names[2], [n for n, _ in order])

    def test_edit_errors_are_explained(self):
        v = self.ready_episode()
        before = self.balance()
        msg = self.say("Delete scene 40")
        self.assertIn("there's no scene 40", msg["text"])
        self.assertEqual(self.balance(), before)
        self.assertEqual(Video.objects.get(pk=v.pk).status, "ready")

    def test_not_enough_credits(self):
        self.write_series("A horror story, 10 episodes, 60 seconds each")
        Subscription.objects.filter(organization_id=self.org_id).update(credits_balance=5)
        msg = self.say("Yes, make all episodes")
        self.assertIn("Not enough credits", msg["text"])
        self.assertFalse(Video.objects.filter(project_id=self.p["id"]).exists())
        self.assertEqual(self.balance(), 5)

    def test_failed_episode_render_is_refunded_and_reported(self):
        from unittest import mock

        self.write_series("A horror story, 1 episode, 15 seconds")
        before = self.balance()
        with mock.patch("pipeline.steps.assemble.render", side_effect=RuntimeError("boom")):
            self.say("Yes, make the video")
            jobs.drain()
        self.assertEqual(self.balance(), before)
        self.assertIn("Episode 1 failed to render", self.last_message()["text"])
        self.say("Retry episode 1")
        jobs.drain()
        self.assertEqual(Video.objects.get(project_id=self.p["id"]).status, "ready")

    def test_viewers_cannot_chat(self):
        other = APIClient()
        other.post("/api/v1/auth/register", {"email": "b@example.com", "password": "s3cret-pass!"}, format="json")
        invite = self.c.post("/api/v1/orgs/current/invitations", {"email": "b@example.com", "role": "viewer"},
                             format="json").json()
        other.post(f"/api/v1/invitations/{invite['token']}/accept")
        other.post(f"/api/v1/orgs/{self.org_id}/switch")
        r = other.post(f"/api/v1/projects/{self.p['id']}/messages", {"text": "3 episodes, 15s"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_suggestions_are_split_from_text(self):
        from apps.studio.agent import split_suggestions

        text, options = split_suggestions("Ready!\n[[suggestions: Yes | No | Later ]]")
        self.assertEqual(text, "Ready!")
        self.assertEqual(options, ["Yes", "No", "Later"])
        self.assertEqual(split_suggestions("Plain"), ("Plain", []))

    # --- Picking an AI video model -------------------------------------------------------------------------

    def agent(self):
        from apps.accounts.models import Membership
        from apps.studio.agent import Agent
        from apps.studio.models import Project

        m = Membership.objects.get(organization_id=self.org_id)
        return Agent(Project.objects.get(pk=self.p["id"]), m, m.user)

    def set_balance(self, credits):
        Subscription.objects.filter(organization_id=self.org_id).update(credits_balance=credits)

    def test_suggests_models_the_wallet_can_pay_for(self):
        import json

        self.write_series()
        self.set_balance(1000)
        out = self.agent().call("suggest_video_models", {}, _Rep(), 50)
        self.assertTrue(out["ok"], out)
        self.assertTrue(1 <= len(out["options"]) <= 5)
        for o in out["options"]:
            self.assertTrue(o["affordable"])
            self.assertLessEqual(o["creditsTotal"], 1000)
            self.assertEqual(o["creditsTotal"], o["creditsPerEpisode"] * 3)
        self.assertIn("lite", out)
        self.assertNotIn("fal", json.dumps(out).lower())

    def test_no_model_fits_a_small_wallet(self):
        self.write_series()
        self.set_balance(6)  # enough for lite (2 credits x 3 episodes), not for any AI video model
        out = self.agent().call("suggest_video_models", {}, _Rep(), 50)
        self.assertEqual(out["options"], [])
        self.assertIsNotNone(out["cheapestUnaffordable"])
        self.assertTrue(out["lite"]["affordable"])

    def test_renders_with_the_picked_model_and_charges_its_price(self):
        self.write_series()
        self.set_balance(1000)
        agent = self.agent()
        option = agent.call("suggest_video_models", {}, _Rep(), 50)["options"][0]
        out = agent.call("render_episodes", {"mode": "all", "model": option["model"]}, _Rep(), 50)
        self.assertTrue(out["ok"], out)
        self.assertEqual(out["creditsCharged"], option["creditsTotal"])
        self.assertEqual(self.balance(), 1000 - option["creditsTotal"])
        videos = Video.objects.filter(project_id=self.p["id"])
        self.assertEqual(videos.count(), 3)
        self.assertTrue(all(v.model.endswith(option["model"]) for v in videos))
        jobs.drain()
        self.assertTrue(all(v.status == "ready" for v in Video.objects.filter(project_id=self.p["id"])))

    def test_rejects_unknown_models(self):
        self.write_series()
        self.set_balance(1000)
        out = self.agent().call("render_episodes", {"mode": "all", "model": "made-up/model"}, _Rep(), 50)
        self.assertFalse(out["ok"])
        self.assertEqual(Video.objects.filter(project_id=self.p["id"]).count(), 0)

    def test_provider_name_is_hidden_from_errors(self):
        from providers.base import ProviderError, hide_provider

        self.assertNotIn("fal", str(ProviderError("fal fal-ai/kling-video/v3 failed: FAL_KEY is not set")).lower())
        self.assertEqual(hide_provider("plain error"), "plain error")


class _Rep:
    def activity(self, *a, **k):
        pass

    def stage(self, *a, **k):
        pass
