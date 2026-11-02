from django.contrib import admin

from .models import SocialAccount


@admin.register(SocialAccount)
class SocialAccountAdmin(admin.ModelAdmin):
    list_display = ("platform", "handle", "organization", "status", "token_expires_at")
    exclude = ("access_token_enc", "refresh_token_enc")
