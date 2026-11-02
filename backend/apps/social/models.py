from django.db import models

from apps.accounts.models import Organization

from .crypto import decrypt, encrypt


class SocialAccount(models.Model):
    PLATFORMS = [("instagram", "Instagram"), ("facebook", "Facebook"), ("youtube", "YouTube")]
    STATUSES = [("active", "Active"), ("needs_reconnect", "Needs reconnect"), ("disconnected", "Disconnected")]

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="social_accounts")
    platform = models.CharField(max_length=16, choices=PLATFORMS)
    external_id = models.CharField(max_length=128)
    handle = models.CharField(max_length=255, blank=True)
    display_name = models.CharField(max_length=255, blank=True)
    avatar_url = models.URLField(max_length=1000, blank=True)
    access_token_enc = models.TextField(blank=True)
    refresh_token_enc = models.TextField(blank=True)
    token_expires_at = models.DateTimeField(null=True, blank=True)
    scopes = models.JSONField(default=list)
    status = models.CharField(max_length=20, choices=STATUSES, default="active")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("organization", "platform", "external_id")

    @property
    def access_token(self):
        return decrypt(self.access_token_enc)

    @access_token.setter
    def access_token(self, value):
        self.access_token_enc = encrypt(value)

    @property
    def refresh_token(self):
        return decrypt(self.refresh_token_enc)

    @refresh_token.setter
    def refresh_token(self, value):
        self.refresh_token_enc = encrypt(value)
