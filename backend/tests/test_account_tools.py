import json

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import Invitation, Membership, Role
from apps.generate.models import Generation
from apps.social.models import SocialAccount
from apps.studio.agent import Agent, models_info
from apps.studio.models import Project


@override_settings(SIGNUP_ENABLED=True)
class LumenAccountToolsTests(TestCase):
    """Lumen's lookups must only ever see the signed-in user's current workspace."""

    def register(self, email):
        c = APIClient()
        r = c.post("/api/v1/auth/register", {"email": email, "password": "s3cret-pass!"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        m = Membership.objects.get(user__email=email)
        return c, m

    def setUp(self):
        self.ca, self.ma = self.register("alice@example.com")
        self.cb, self.mb = self.register("bob@example.com")
        self.pa = Project.objects.create(organization=self.ma.organization, title="Alice lighthouse")
        Project.objects.create(organization=self.mb.organization, title="Bob secret project")
        SocialAccount.objects.create(organization=self.ma.organization, platform="youtube", external_id="ya",
                                     handle="alice_tube", access_token_enc="ALICE-TOKEN")
        SocialAccount.objects.create(organization=self.mb.organization, platform="instagram", external_id="ib",
                                     handle="bob_gram", access_token_enc="BOB-TOKEN")
        Generation.objects.create(organization=self.mb.organization, endpoint_id="fal-ai/x",
                                  input={"prompt": "bob private prompt"})
        Invitation.objects.create(organization=self.ma.organization, email="carol@example.com", role=Role.VIEWER)
        Invitation.objects.create(organization=self.mb.organization, email="dave@example.com", role=Role.VIEWER)
        self.agent = Agent(self.pa, self.ma, self.ma.user)

    def everything(self, agent):
        names = ["get_account", "list_projects", "list_videos", "list_generations", "get_usage", "list_team",
                 "list_connected_accounts"]
        out = {}
        for n in names:
            result = agent.call(n, {}, _Rep(), 50)
            self.assertTrue(result["ok"], (n, result))
            out[n] = result
        return json.dumps(out, default=str)

    def test_only_sees_own_workspace(self):
        dump = self.everything(self.agent)
        for leaked in ("Bob secret project", "bob_gram", "bob private prompt", "dave@example.com", "bob@example.com"):
            self.assertNotIn(leaked, dump)
        for own in ("Alice lighthouse", "alice_tube", "carol@example.com", "alice@example.com"):
            self.assertIn(own, dump)

    def test_never_returns_secrets(self):
        dump = self.everything(self.agent)
        token = Invitation.objects.get(email="carol@example.com").token
        for secret in ("ALICE-TOKEN", token, "external_id", "access_token"):
            self.assertNotIn(secret, dump)

    def test_scoped_to_the_active_workspace_when_user_has_several(self):
        # Alice joins Bob's workspace too; a membership in her own workspace still only sees her own data.
        Membership.objects.create(organization=self.mb.organization, user=self.ma.user, role=Role.CREATOR)
        dump = self.everything(self.agent)
        self.assertNotIn("Bob secret project", dump)
        self.assertIn(self.mb.organization.name, json.loads(dump)["get_account"]["otherWorkspaces"])

    def test_models_info_lists_each_tier(self):
        info = models_info()
        self.assertEqual(set(info["tiers"]), {"lite", "standard", "premium"})
        self.assertIn("Kling", info["tiers"]["premium"])


class _Rep:
    def activity(self, *a, **k):
        pass
