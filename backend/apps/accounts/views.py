from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.billing.service import subscription_for

from .models import Invitation, Membership, Organization, Role
from .permissions import current_membership, require_role

User = get_user_model()


def org_dto(membership):
    return {"id": membership.organization_id, "name": membership.organization.name, "role": membership.role}


def me_dto(request):
    user = request.user
    memberships = Membership.objects.select_related("organization").filter(user=user).order_by("created_at")
    active = current_membership(request) if memberships else None
    return {
        "user": {"id": user.id, "email": user.email, "name": user.first_name},
        "organizations": [org_dto(m) for m in memberships],
        "activeOrganization": org_dto(active) if active else None,
    }


def create_org(user, name):
    org = Organization.objects.create(name=name)
    Membership.objects.create(organization=org, user=user, role=Role.OWNER)
    subscription_for(org)
    return org


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(min_length=8)
    name = serializers.CharField(max_length=80, required=False, allow_blank=True)
    organizationName = serializers.CharField(max_length=120, required=False, allow_blank=True)
    inviteToken = serializers.CharField(required=False, allow_blank=True)


@method_decorator(ensure_csrf_cookie, name="get")
class CsrfView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"ok": True})


class SignupStatusView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"enabled": settings.SIGNUP_ENABLED})


class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        s = RegisterSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        email = s.validated_data["email"].lower()
        if not settings.SIGNUP_ENABLED and not Invitation.objects.filter(
            token=s.validated_data.get("inviteToken") or "", email=email, accepted_at__isnull=True
        ).exists():
            raise PermissionDenied("Sign-ups are closed. You need an invitation sent to this email address.")
        if User.objects.filter(username=email).exists():
            raise ValidationError({"email": "An account with this email already exists."})
        try:
            validate_password(s.validated_data["password"])
        except DjangoValidationError as e:
            raise ValidationError({"password": list(e.messages)})
        with transaction.atomic():
            user = User.objects.create_user(
                username=email, email=email, password=s.validated_data["password"],
                first_name=s.validated_data.get("name", ""),
            )
            token = s.validated_data.get("inviteToken")
            if not (token and _accept_invite(user, token)):
                create_org(user, s.validated_data.get("organizationName") or f"{email.split('@')[0]}'s studio")
        login(request, user)
        return Response(me_dto(request), status=status.HTTP_201_CREATED)


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        email = (request.data.get("email") or "").lower()
        user = authenticate(request, username=email, password=request.data.get("password") or "")
        if user is None:
            return Response({"error": "invalid_credentials", "detail": "Wrong email or password."}, status=401)
        login(request, user)
        return Response(me_dto(request))


class LogoutView(APIView):
    def post(self, request):
        logout(request)
        return Response({"ok": True})


class MeView(APIView):
    def get(self, request):
        return Response(me_dto(request))


class OrganizationsView(APIView):
    def get(self, request):
        return Response(me_dto(request)["organizations"])

    def post(self, request):
        name = (request.data.get("name") or "").strip()
        if not name:
            raise ValidationError({"name": "Required."})
        org = create_org(request.user, name)
        request.session["org_id"] = org.id
        return Response(me_dto(request), status=201)


class SwitchOrganizationView(APIView):
    def post(self, request, org_id):
        if not Membership.objects.filter(user=request.user, organization_id=org_id).exists():
            raise NotFound()
        request.session["org_id"] = org_id
        return Response(me_dto(request))


class MembersView(APIView):
    def get(self, request):
        m = require_role(request, Role.VIEWER)
        members = Membership.objects.select_related("user").filter(organization=m.organization).order_by("created_at")
        invites = Invitation.objects.filter(organization=m.organization, accepted_at__isnull=True)
        return Response({
            "members": [
                {"id": x.id, "userId": x.user_id, "email": x.user.email, "name": x.user.first_name, "role": x.role}
                for x in members
            ],
            "invitations": [
                {"id": i.id, "email": i.email, "role": i.role, "token": i.token if m.has_role(Role.ADMIN) else None}
                for i in invites
            ],
        })


class MemberDetailView(APIView):
    def patch(self, request, member_id):
        m = require_role(request, Role.ADMIN)
        target = Membership.objects.filter(organization=m.organization, id=member_id).first()
        if not target:
            raise NotFound()
        role = request.data.get("role")
        if role not in Role.values or (role == Role.OWNER and m.role != Role.OWNER):
            raise ValidationError({"role": "Invalid role."})
        if target.role == Role.OWNER and m.role != Role.OWNER:
            raise PermissionDenied("Only owners can change an owner.")
        target.role = role
        target.save(update_fields=["role"])
        return Response({"ok": True})

    def delete(self, request, member_id):
        m = require_role(request, Role.ADMIN)
        target = Membership.objects.filter(organization=m.organization, id=member_id).first()
        if not target:
            raise NotFound()
        if target.role == Role.OWNER:
            raise PermissionDenied("Owners can't be removed.")
        target.delete()
        return Response(status=204)


class InvitationsView(APIView):
    def post(self, request):
        m = require_role(request, Role.ADMIN)
        email = (request.data.get("email") or "").lower().strip()
        role = request.data.get("role") or Role.CREATOR
        if not email or role not in (Role.ADMIN, Role.CREATOR, Role.VIEWER):
            raise ValidationError({"detail": "Email and a valid role are required."})
        invite = Invitation.objects.create(organization=m.organization, email=email, role=role, invited_by=request.user)
        return Response({"id": invite.id, "email": invite.email, "role": invite.role, "token": invite.token}, status=201)


def _accept_invite(user, token):
    invite = Invitation.objects.filter(token=token, accepted_at__isnull=True).first()
    if not invite or invite.email != user.email:
        return False
    Membership.objects.get_or_create(organization=invite.organization, user=user, defaults={"role": invite.role})
    invite.accepted_at = timezone.now()
    invite.save(update_fields=["accepted_at"])
    return True


class AcceptInvitationView(APIView):
    def post(self, request, token):
        if not _accept_invite(request.user, token):
            raise NotFound("Invitation not found or not addressed to you.")
        return Response(me_dto(request))
