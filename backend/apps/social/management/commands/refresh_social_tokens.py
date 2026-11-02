from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.social import oauth
from apps.social.models import SocialAccount


class Command(BaseCommand):
    help = "Renew social tokens that expire within the next few days. Run it from cron."

    def handle(self, *args, **options):
        soon = timezone.now() + timedelta(days=5)
        accounts = SocialAccount.objects.filter(status="active", token_expires_at__lte=soon)
        for account in accounts:
            try:
                oauth.refresh(account)
                self.stdout.write(f"refreshed {account.platform} {account.handle}")
            except oauth.OAuthError as e:
                account.status = "needs_reconnect"
                account.save(update_fields=["status", "updated_at"])
                self.stdout.write(f"needs reconnect: {account.platform} {account.handle} ({e})")
