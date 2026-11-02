from django.contrib import admin

from .models import Invitation, Membership, Organization

admin.site.register([Organization, Membership, Invitation])
