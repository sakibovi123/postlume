import mimetypes
import os
import re
from pathlib import Path

from django.conf import settings
from django.db import connection
from django.http import FileResponse, Http404, HttpResponse, JsonResponse, StreamingHttpResponse
from django.views.decorators.http import require_GET

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


@require_GET
def health(request):
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
    return JsonResponse({"ok": True})


def _file_chunks(path, start, length, chunk=64 * 1024):
    with open(path, "rb") as f:
        f.seek(start)
        remaining = length
        while remaining > 0:
            data = f.read(min(chunk, remaining))
            if not data:
                break
            remaining -= len(data)
            yield data


def _can_view(request, path):
    if not request.user.is_authenticated:
        return False
    parts = path.split("/")
    if len(parts) < 3 or parts[0] != "videos" or not parts[1].isdigit():
        return False
    from apps.accounts.models import Membership
    from apps.studio.models import Video

    org_id = Video.objects.filter(pk=int(parts[1])).values_list("project__organization_id", flat=True).first()
    return org_id is not None and Membership.objects.filter(user=request.user, organization_id=org_id).exists()


@require_GET
def media(request, path):
    """Serves rendered media to org members, with HTTP Range support so browsers can seek in videos."""
    if not _can_view(request, path):
        raise Http404()
    root = Path(settings.MEDIA_ROOT).resolve()
    full = (root / path).resolve()
    if root not in full.parents or not full.is_file():
        raise Http404()
    size = full.stat().st_size
    content_type = mimetypes.guess_type(full.name)[0] or "application/octet-stream"
    match = RANGE_RE.fullmatch(request.headers.get("Range", "").strip())
    if not match:
        response = FileResponse(open(full, "rb"), content_type=content_type)
        response["Accept-Ranges"] = "bytes"
        response["Cache-Control"] = "private, max-age=3600"
        return response
    first, last = match.groups()
    if first:
        start, end = int(first), int(last) if last else size - 1
    else:
        start, end = max(0, size - int(last or 0)), size - 1
    end = min(end, size - 1)
    if start > end or start >= size:
        response = HttpResponse(status=416)
        response["Content-Range"] = f"bytes */{size}"
        return response
    length = end - start + 1
    response = StreamingHttpResponse(_file_chunks(full, start, length), status=206, content_type=content_type)
    response["Content-Length"] = str(length)
    response["Content-Range"] = f"bytes {start}-{end}/{size}"
    response["Accept-Ranges"] = "bytes"
    response["Cache-Control"] = "private, max-age=3600"
    return response


os.makedirs(settings.MEDIA_ROOT, exist_ok=True)
