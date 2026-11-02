from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from apps.accounts import views as acc
from apps.billing import views as bill
from apps.social import views as soc
from apps.studio import views as st

api = [
    path("auth/csrf", acc.CsrfView.as_view()),
    path("auth/register", acc.RegisterView.as_view()),
    path("auth/login", acc.LoginView.as_view()),
    path("auth/logout", acc.LogoutView.as_view()),
    path("auth/me", acc.MeView.as_view()),
    path("orgs", acc.OrganizationsView.as_view()),
    path("orgs/<int:org_id>/switch", acc.SwitchOrganizationView.as_view()),
    path("orgs/current/members", acc.MembersView.as_view()),
    path("orgs/current/members/<int:member_id>", acc.MemberDetailView.as_view()),
    path("orgs/current/invitations", acc.InvitationsView.as_view()),
    path("invitations/<str:token>/accept", acc.AcceptInvitationView.as_view()),
    path("social", soc.SocialListView.as_view()),
    path("social/<int:account_id>", soc.SocialDetailView.as_view()),
    path("social/<str:platform>/connect", soc.ConnectView.as_view()),
    path("social/<str:platform>/callback", soc.CallbackView.as_view()),
    path("styles", st.StylesView.as_view()),
    path("projects", st.ProjectsView.as_view()),
    path("projects/<int:pk>", st.ProjectDetailView.as_view()),
    path("projects/<int:pk>/messages", st.MessagesView.as_view()),
    path("projects/<int:pk>/brief", st.BriefView.as_view()),
    path("projects/<int:pk>/stories", st.StoriesView.as_view()),
    path("stories/<int:pk>", st.StoryDetailView.as_view()),
    path("stories/<int:pk>/rewrite", st.StoryRewriteView.as_view()),
    path("stories/<int:pk>/restore", st.StoryRestoreView.as_view()),
    path("stories/<int:pk>/videos", st.StartRenderView.as_view()),
    path("videos", st.VideosView.as_view()),
    path("videos/<int:pk>", st.VideoDetailView.as_view()),
    path("videos/<int:pk>/retry", st.RetryView.as_view()),
    path("videos/<int:pk>/reassemble", st.ReassembleView.as_view()),
    path("videos/<int:pk>/duplicate", st.DuplicateView.as_view()),
    path("videos/<int:pk>/download", st.DownloadView.as_view()),
    path("videos/<int:pk>/scenes/<int:scene_id>", st.SceneDetailView.as_view()),
    path("videos/<int:pk>/scenes/<int:scene_id>/regenerate", st.SceneRegenerateView.as_view()),
    path("billing", bill.BillingView.as_view()),
    path("billing/quotes", bill.QuotesView.as_view()),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include(api)),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
