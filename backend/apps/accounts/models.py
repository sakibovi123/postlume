import secrets

from django.conf import settings
from django.db import models


class Role(models.TextChoices):
    OWNER = "owner"
    ADMIN = "admin"
    CREATOR = "creator"
    VIEWER = "viewer"


ROLE_RANK = {Role.VIEWER: 0, Role.CREATOR: 1, Role.ADMIN: 2, Role.OWNER: 3}


class Organization(models.Model):
    name = models.CharField(max_length=120)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Membership(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.CREATOR)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("organization", "user")

    def has_role(self, minimum):
        return ROLE_RANK[self.role] >= ROLE_RANK[minimum]


def _token():
    return secrets.token_urlsafe(24)


class Invitation(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="invitations")
    email = models.EmailField()
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.CREATOR)
    token = models.CharField(max_length=64, unique=True, default=_token)
    invited_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
