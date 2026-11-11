import math
import tempfile
import time
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from rest_framework.exceptions import APIException, NotFound, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Role
from apps.accounts.permissions import require_role
from apps.billing import service as billing
from apps.billing.models import Action
from apps.studio import ai
from apps.studio.views import GenerationThrottle
from providers.base import ProviderError, hide_provider

from . import fal_api, runner, shots
from .models import Generation

MAX_UPLOAD = 100 * 1024 * 1024


class FalUnavailable(APIException):
    status_code = 502
    default_code = "provider_error"


def _fal(fn, *args):
    try:
        return fn(*args)
    except ProviderError as e:
        raise FalUnavailable(str(e))


def generation_dto(g):
    elapsed_from = g.started_at or g.created_at
    elapsed_to = g.finished_at or None
    return {
        "id": g.id, "endpointId": g.endpoint_id, "category": g.category, "modelName": g.model_name,
        "input": g.input, "status": g.status, "queuePosition": g.queue_position, "logs": g.logs, "media": g.media,
        "costUsd": float(g.cost_usd), "credits": g.credits, "error": g.error, "createdAt": g.created_at,
        "startedAt": g.started_at, "finishedAt": g.finished_at,
        "plan": {"totalSeconds": g.plan["totalSeconds"], "clipSeconds": g.plan["clipSeconds"], "count": g.plan["count"],
                 "done": sum(1 for s in g.plan["shots"] if s.get("done"))} if g.plan else None,
        "seconds": round(((elapsed_to.timestamp() if elapsed_to else time.time()) - elapsed_from.timestamp()), 1),
    }


class CategoriesView(APIView):
    def get(self, request):
        require_role(request, Role.VIEWER)
        return Response({"categories": fal_api.CATEGORIES, "configured": bool(settings.FAL_KEY),
                         "usdPerCredit": settings.USD_PER_CREDIT, "chargeCredits": settings.GENERATE_CHARGE_CREDITS,
                         "bestVideoModel": settings.VIDEO_MODEL_BEST})


class ModelsView(APIView):
    def get(self, request):
        require_role(request, Role.VIEWER)
        category = request.query_params.get("category") or "text-to-video"
        if category not in fal_api.CATEGORY_IDS:
            raise ValidationError({"category": "Unknown category."})
        return Response(_fal(fal_api.list_models, category))


class ModelSchemaView(APIView):
    def get(self, request):
        require_role(request, Role.VIEWER)
        endpoint = (request.query_params.get("endpoint") or "").strip()
        if not endpoint or len(endpoint) > 200:
            raise ValidationError({"endpoint": "Required."})
        return Response(_fal(fal_api.model_info, endpoint))


class UploadView(APIView):
    parser_classes = [MultiPartParser]

    def post(self, request):
        require_role(request, Role.CREATOR)
        f = request.FILES.get("file")
        if not f:
            raise ValidationError({"file": "Required."})
        if f.size > MAX_UPLOAD:
            raise ValidationError({"file": "Files must be under 100 MB."})
        import fal_client

        suffix = Path(f.name).suffix[:10]
        with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
            for chunk in f.chunks():
                tmp.write(chunk)
            tmp.flush()
            try:
                url = fal_client.upload_file(tmp.name)
            except Exception as e:
                raise FalUnavailable(f"Upload failed: {hide_provider(e)}")
        return Response({"url": url, "name": f.name, "contentType": f.content_type}, status=201)


class GenerationsView(APIView):
    throttle_classes = [GenerationThrottle]

    def get(self, request):
        m = require_role(request, Role.VIEWER)
        qs = Generation.objects.filter(organization=m.organization)
        if request.query_params.get("category"):
            qs = qs.filter(category=request.query_params["category"])
        gens = list(qs[:60])
        for g in gens:
            runner.ensure_running(g)
        return Response([generation_dto(g) for g in gens])

    def post(self, request):
        m = require_role(request, Role.CREATOR)
        endpoint = (request.data.get("endpointId") or "").strip()
        values = request.data.get("input") or {}
        if not endpoint or not isinstance(values, dict):
            raise ValidationError({"endpointId": "Pick a model and fill in its inputs."})
        info = _fal(fal_api.model_info, endpoint)
        names = {f["name"] for f in info["fields"]}
        clean = {k: v for k, v in values.items() if k in names and v not in (None, "", [])}
        for f in info["fields"]:
            if f["required"] and f["name"] not in clean and f["default"] is not None:
                clean[f["name"]] = f["default"]
        missing = [f["title"] for f in info["fields"] if f["required"] and f["name"] not in clean and f["default"] is None]
        if missing:
            raise ValidationError({"input": f"Missing: {', '.join(missing)}"})
        text = " ".join(str(v) for k, v in clean.items() if isinstance(v, str) and not k.endswith("url"))
        if text:
            ai.moderate(text)
        plan = None
        total = request.data.get("totalSeconds")
        clip = shots.clip_seconds(info)
        if total is not None and clip:
            try:
                total = float(total)
            except (TypeError, ValueError):
                raise ValidationError({"totalSeconds": "Must be a number."})
            if not 1 <= total <= shots.MAX_TOTAL_SECONDS:
                raise ValidationError({"totalSeconds": f"Must be between 1 and {shots.MAX_TOTAL_SECONDS} seconds."})
            if total > clip:
                count = math.ceil(total / clip - 1e-9)
                clean["duration"] = shots.duration_value(info, clip)
                plan = {"totalSeconds": total, "clipSeconds": clip, "count": count, "shots": []}
        usd, _exact = fal_api.estimate(info, clean)
        if plan and usd is not None:
            usd = round(usd * plan["count"], 4)
        credits, key = 0, ""
        if settings.GENERATE_CHARGE_CREDITS:
            credits = fal_api.credits_for(usd)
            key = request.data.get("idempotencyKey") or f"gen:{m.organization_id}:{int(time.time() * 1000)}"
            billing.charge(m.organization, Action.GENERATE, credits, key, note=f"Generate · {endpoint}"[:200])
        gen = Generation.objects.create(
            organization=m.organization, created_by=request.user, endpoint_id=endpoint,
            category=info.get("category") or request.data.get("category") or "",
            model_name=(request.data.get("modelName") or endpoint)[:200], input=clean,
            cost_usd=Decimal(str(usd or 0)), credits=credits, charge_key=key, plan=plan,
        )
        runner.ensure_running(gen)
        gen.refresh_from_db()
        return Response(generation_dto(gen), status=201)


class GenerationDetailView(APIView):
    def _get(self, request, pk, minimum=Role.VIEWER):
        m = require_role(request, minimum)
        g = Generation.objects.filter(organization=m.organization, pk=pk).first()
        if not g:
            raise NotFound("Generation not found.")
        return g

    def get(self, request, pk):
        g = self._get(request, pk)
        runner.ensure_running(g)
        return Response(generation_dto(g))

    def delete(self, request, pk):
        g = self._get(request, pk, Role.CREATOR)
        if g.status in ("queued", "running"):
            raise ValidationError({"detail": "Wait for the generation to finish before deleting it."})
        import shutil

        shutil.rmtree(Path(settings.MEDIA_ROOT) / "generations" / str(g.pk), ignore_errors=True)
        g.delete()
        return Response(status=204)
