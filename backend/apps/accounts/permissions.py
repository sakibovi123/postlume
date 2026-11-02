from rest_framework.exceptions import NotFound, PermissionDenied

from .models import Membership, Role


def current_membership(request):
    """Active org comes from the X-Org-Id header, then the session, then the user's first org."""
    qs = Membership.objects.select_related("organization").filter(user=request.user)
    org_id = request.headers.get("X-Org-Id") or request.session.get("org_id")
    membership = qs.filter(organization_id=org_id).first() if org_id else None
    membership = membership or qs.order_by("created_at").first()
    if membership is None:
        raise NotFound("You are not a member of any organization.")
    return membership


def require_role(request, minimum=Role.VIEWER):
    membership = current_membership(request)
    if not membership.has_role(minimum):
        raise PermissionDenied(f"Requires the {minimum} role or higher.")
    return membership
