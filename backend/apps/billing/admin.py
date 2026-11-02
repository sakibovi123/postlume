from django.contrib import admin

from .models import Subscription, UsageLedger

admin.site.register([Subscription, UsageLedger])
