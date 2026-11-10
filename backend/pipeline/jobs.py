import logging
from decimal import Decimal
import traceback
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.billing import service as billing
from apps.studio.models import RenderJob, Video, VideoStatus

from .steps import STEPS

log = logging.getLogger("postlume.worker")
MAX_ATTEMPTS = 3
ORDER = RenderJob.STEPS


def enqueue(video, step, scene=None, chain=True, charge_key=""):
    return RenderJob.objects.create(
        video=video, scene=scene, step=step, chain=chain, charge_key=charge_key, run_after=timezone.now()
    )


def claim_next():
    now = timezone.now()
    for job in RenderJob.objects.filter(status="queued", run_after__lte=now).order_by("run_after", "id")[:5]:
        claimed = RenderJob.objects.filter(pk=job.pk, status="queued").update(
            status="running", attempts=job.attempts + 1
        )
        if claimed:
            job.refresh_from_db()
            return job
    return None


def run(job):
    video = Video.objects.select_related("story__brief").get(pk=job.video_id)
    log.info("job %s: video %s step %s scene %s (attempt %s)", job.pk, video.pk, job.step, job.scene_id, job.attempts)
    try:
        Video.objects.filter(pk=video.pk).update(status=job.step, error="")
        cost = STEPS[job.step](video, job.scene)
    except Exception as e:
        _failed(job, video, e)
        return
    with transaction.atomic():
        job.status, job.finished_at = "done", timezone.now()
        usd = Decimal(str(round(cost or 0, 4)))
        job.cost_usd += usd
        job.save(update_fields=["status", "finished_at", "cost_usd"])
        if cost:
            Video.objects.filter(pk=video.pk).update(cost_usd=F("cost_usd") + usd)
            billing.add_cost(job.charge_key, cost)
        if job.chain and job.step != "assembling":
            nxt = ORDER[ORDER.index(job.step) + 1]
            enqueue(video, nxt, scene=job.scene, chain=True, charge_key=job.charge_key)
    if job.step == "assembling":
        _finished(video.pk, job.charge_key, ok=True)


def _finished(video_id, charge_key, ok, error=""):
    from apps.studio import services

    try:
        services.on_render_finished(video_id, charge_key or "", ok, error)
    except Exception:
        log.exception("post-render hook failed for video %s", video_id)


def _failed(job, video, exc):
    detail = f"{type(exc).__name__}: {exc}"
    log.warning("job %s failed: %s\n%s", job.pk, detail, traceback.format_exc())
    if job.attempts < MAX_ATTEMPTS:
        job.status = "queued"
        job.error = detail
        job.run_after = timezone.now() + timedelta(seconds=5 * 2 ** job.attempts)
        job.save(update_fields=["status", "error", "run_after"])
        return
    job.status, job.error, job.finished_at = "failed", detail, timezone.now()
    job.save(update_fields=["status", "error", "finished_at"])
    Video.objects.filter(pk=video.pk).update(status=VideoStatus.FAILED, error=detail[:2000])
    from apps.billing.models import UsageLedger

    entry = UsageLedger.objects.filter(idempotency_key=job.charge_key).first() if job.charge_key else None
    billing.refund(entry, note=f"Refund: {job.step} failed")
    _finished(video.pk, job.charge_key, ok=False, error=str(exc))


def retry(video, charge_key=""):
    """Resume a failed video from the step that failed. Finished scenes are kept."""
    failed = video.jobs.filter(status="failed").order_by("-id").first()
    step = failed.step if failed else "planning"
    Video.objects.filter(pk=video.pk).update(status=VideoStatus.QUEUED, error="")
    return enqueue(video, step, scene=failed.scene if failed else None, chain=True, charge_key=charge_key)


def drain(max_jobs=1000):
    """Run queued jobs until the queue is empty; used by tests and `runworker --once`."""
    ran = 0
    while ran < max_jobs:
        job = claim_next()
        if job is None:
            pending = RenderJob.objects.filter(status="queued").order_by("run_after").first()
            if not pending:
                break
            RenderJob.objects.filter(pk=pending.pk).update(run_after=timezone.now())
            continue
        run(job)
        ran += 1
    return ran
