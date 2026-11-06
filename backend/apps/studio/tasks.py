"""Background generation tasks (director chat, story writing) with live, streamed progress."""

import logging
import threading
import time
from datetime import timedelta

from django.conf import settings
from django.db import close_old_connections, connection
from django.utils import timezone
from rest_framework.exceptions import APIException

from providers.base import ProviderError

from .models import GenerationTask
from .partial_json import parse_partial

log = logging.getLogger("postlume.tasks")
STALE_AFTER = timedelta(minutes=10)
WORDS_PER_SECOND = 2.6

STAGES = {
    "director": [
        ("reading", "Reading your idea"),
        ("reply", "Thinking it through"),
        ("brief", "Drafting the creative brief"),
        ("saving", "Saving"),
    ],
    "story": [
        ("brief", "Reading your brief"),
        ("title", "Naming the story"),
        ("logline", "Writing the logline"),
        ("hook", "Writing a 3-second hook"),
        ("characters", "Creating original characters"),
        ("script", "Writing the narration"),
        ("checking", "Safety check"),
        ("saving", "Saving the story"),
    ],
}
STAGES["rewrite"] = [("brief", "Reading the current draft"), *STAGES["story"][1:]]

STORY_PROGRESS = {"title": 8, "logline": 14, "hook": 20, "characters": 28, "script": 45, "estimatedSeconds": 92}


def task_dto(t):
    status, error = t.status, t.error
    if status in ("queued", "running") and t.updated_at < timezone.now() - STALE_AFTER:
        status, error = "failed", "The generation was interrupted. Please try again."
    return {
        "id": t.id, "projectId": t.project_id, "kind": t.kind, "status": status, "stage": t.stage,
        "progress": t.progress, "stages": [{"id": i, "label": label} for i, label in STAGES[t.kind]],
        "partial": t.partial, "result": t.result, "error": error, "createdAt": t.created_at,
    }


def active_tasks(project):
    since = timezone.now() - STALE_AFTER
    return [task_dto(t) for t in project.tasks.filter(status__in=["queued", "running"], updated_at__gte=since)]


class Reporter:
    """Turns streamed LLM text into stage, progress and a partial result, saved at a throttled rate."""

    def __init__(self, task, target_words=0):
        self.task = task
        self.target_words = target_words
        self._last_write = 0.0

    def stage(self, stage, progress=None):
        self.task.stage = stage
        if progress is not None:
            self.task.progress = max(self.task.progress, progress)
        self._save(force=True)

    def stream(self, text):
        partial = parse_partial(text)
        if not partial:
            return
        field = next(reversed(partial), None)
        if self.task.kind == "director":
            stage = "brief" if "brief" in partial else "reply"
            progress = 75 if stage == "brief" else min(60, 20 + len(partial.get("reply") or "") // 6)
        else:
            stage = "script" if field == "estimatedSeconds" else field
            progress = STORY_PROGRESS.get(field, self.task.progress)
            if field == "script" and self.target_words:
                words = len(str(partial.get("script") or "").split())
                progress = 45 + int(45 * min(1.0, words / self.target_words))
        self.task.partial = partial
        self.task.stage = stage if stage in dict(STAGES[self.task.kind]) else self.task.stage
        self.task.progress = max(self.task.progress, progress)
        self._save()

    def _save(self, force=False):
        now = time.monotonic()
        if not force and now - self._last_write < 0.3:
            return
        self._last_write = now
        self.task.status = "running"
        self.task.save(update_fields=["status", "stage", "progress", "partial", "updated_at"])


def target_words(brief_raw):
    return int((brief_raw or {}).get("targetSeconds", 30) * WORDS_PER_SECOND)


def start(project, kind, fn, words=0):
    task = GenerationTask.objects.create(project=project, kind=kind, stage=STAGES[kind][0][0], progress=3)
    if settings.TASKS_EAGER:
        _run(task.pk, fn, words)
        task.refresh_from_db()
        return task
    threading.Thread(target=_run, args=(task.pk, fn, words), daemon=True, name=f"task-{task.pk}").start()
    return task


def _run(task_id, fn, words):
    if not settings.TASKS_EAGER:
        close_old_connections()
    try:
        task = GenerationTask.objects.get(pk=task_id)
        try:
            result = fn(Reporter(task, words))
        except Exception as e:
            task.status, task.error = "failed", _message(e)
            task.save(update_fields=["status", "error", "updated_at"])
            if not isinstance(e, (ProviderError, APIException)):
                log.exception("task %s failed", task_id)
            return
        task.status, task.stage, task.progress, task.result = "done", "saving", 100, result
        task.save(update_fields=["status", "stage", "progress", "result", "updated_at"])
    finally:
        if not settings.TASKS_EAGER:
            connection.close()


def _message(exc):
    if isinstance(exc, APIException):
        detail = exc.detail
        if isinstance(detail, dict):
            return str(detail.get("detail") or next(iter(detail.values()), exc))
        return str(detail)
    if isinstance(exc, ProviderError):
        return str(exc)
    return "Something went wrong while generating. Please try again."
