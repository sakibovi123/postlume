"""Submits a generation to fal's queue and tracks it in a background thread until the output is saved."""

import logging
import threading
import time
from pathlib import Path

from django.conf import settings
from django.db import close_old_connections, connection
from django.utils import timezone

from apps.billing import service as billing
from apps.billing.models import UsageLedger
import re
import subprocess

from providers.media import download, ffmpeg_bin, public_url, run_ffmpeg

from . import shots as shot_planner
from .models import Generation

log = logging.getLogger("postlume.generate")
_active = set()
_lock = threading.Lock()
MEDIA_EXT = {".mp4": "video", ".webm": "video", ".mov": "video", ".png": "image", ".jpg": "image", ".jpeg": "image",
             ".webp": "image", ".gif": "image", ".mp3": "audio", ".wav": "audio", ".m4a": "audio", ".ogg": "audio",
             ".flac": "audio"}


def generation_dir(gen_id):
    d = Path(settings.MEDIA_ROOT) / "generations" / str(gen_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def ensure_running(gen):
    if gen.status in ("done", "failed"):
        return
    if settings.TASKS_EAGER:
        _track(gen.pk)
        return
    with _lock:
        if gen.pk in _active:
            return
        _active.add(gen.pk)
    threading.Thread(target=_thread, args=(gen.pk,), daemon=True, name=f"gen-{gen.pk}").start()


def _thread(gen_id):
    close_old_connections()
    try:
        _track(gen_id)
    finally:
        with _lock:
            _active.discard(gen_id)
        connection.close()


def _track(gen_id):
    import fal_client

    gen = Generation.objects.get(pk=gen_id)
    try:
        if gen.plan:
            _track_long(gen)
            return
        if not gen.request_id:
            handle = fal_client.submit(gen.endpoint_id, arguments=gen.input)
            gen.request_id = handle.request_id
            gen.save(update_fields=["request_id", "updated_at"])
        while True:
            status = fal_client.status(gen.endpoint_id, gen.request_id, with_logs=True)
            if isinstance(status, fal_client.Completed):
                break
            if isinstance(status, fal_client.Queued):
                gen.status, gen.queue_position = "queued", status.position
            else:
                gen.status, gen.queue_position = "running", None
                gen.started_at = gen.started_at or timezone.now()
                lines = [str(entry.get("message", "")).strip() for entry in (status.logs or [])]
                gen.logs = [line for line in lines if line][-6:] or gen.logs
            gen.save(update_fields=["status", "queue_position", "started_at", "logs", "updated_at"])
            time.sleep(settings.GENERATE_POLL_SECONDS)
        result = fal_client.result(gen.endpoint_id, gen.request_id)
        gen.output = result
        gen.media = _save_media(gen, result)
        if not gen.media:
            raise RuntimeError("fal finished but returned no media files.")
        gen.status, gen.queue_position, gen.finished_at = "done", None, timezone.now()
        gen.save(update_fields=["output", "media", "status", "queue_position", "finished_at", "updated_at"])
    except Exception as e:
        log.warning("generation %s failed: %s", gen_id, e)
        gen.status, gen.error, gen.finished_at = "failed", _message(e), timezone.now()
        gen.save(update_fields=["status", "error", "finished_at", "updated_at"])
        entry = UsageLedger.objects.filter(idempotency_key=gen.charge_key).first() if gen.charge_key else None
        billing.refund(entry, note="Refund: generation failed")


FRIENDLY = {
    "content_policy_violation": "The model's content checker blocked this prompt. Named characters from existing "
    "shows (anime, cartoons, games) and real people are usually blocked — describe original characters instead "
    "(look, outfit, powers) and try again.",
    "prompt_rejected": "This model refused the prompt. Google and some other providers block named characters "
    "from movies, comics or games, real people, and violence (hitting, slapping, fighting). Describe original "
    "characters and tone down the action, or try a different model such as Kling or MiniMax.",
}


def _message(exc):
    detail = None
    response = getattr(exc, "response", None)
    if response is not None:
        try:
            detail = response.json().get("detail")
        except Exception:
            detail = None
    if isinstance(detail, list) and detail and isinstance(detail[0], dict):
        kind = detail[0].get("type") or getattr(exc, "error_type", None)
        if kind == "invalid_request" and "prompt" in (detail[0].get("loc") or []) and "different inputs" in str(detail[0].get("msg")):
            kind = "prompt_rejected"
        text = FRIENDLY.get(kind) or detail[0].get("msg") or str(exc)
    elif isinstance(detail, str):
        text = detail
    else:
        text = FRIENDLY.get(getattr(exc, "error_type", None) or "") or str(exc).strip() or type(exc).__name__
    if "content_policy_violation" in text:
        text = FRIENDLY["content_policy_violation"]
    return text[:1500]


def find_media(node, found=None):
    found = [] if found is None else found
    if isinstance(node, dict):
        url = node.get("url")
        if isinstance(url, str) and url.startswith("http"):
            kind = (node.get("content_type") or "").split("/")[0]
            if kind not in ("video", "image", "audio"):
                kind = MEDIA_EXT.get(Path(url.split("?")[0]).suffix.lower(), "")
            if kind and all(m["remote"] != url for m in found):
                found.append({"type": kind, "remote": url})
        for value in node.values():
            find_media(value, found)
    elif isinstance(node, list):
        for value in node:
            find_media(value, found)
    return found


def _save_media(gen, result):
    saved = []
    for i, item in enumerate(find_media(result)):
        suffix = Path(item["remote"].split("?")[0]).suffix.lower()
        if suffix not in MEDIA_EXT:
            suffix = {"video": ".mp4", "image": ".png", "audio": ".mp3"}[item["type"]]
        dest = generation_dir(gen.pk) / f"output_{i}{suffix}"
        try:
            download(item["remote"], dest)
            saved.append({**item, "url": public_url(dest)})
        except Exception as e:
            log.warning("could not save %s: %s", item["remote"], e)
            saved.append({**item, "url": item["remote"]})
    return saved


MAX_IN_FLIGHT = 6
MAX_TRIES = 2


def _track_long(gen):
    """Generates every shot as its own clip, then stitches them into one video."""
    import fal_client

    plan = gen.plan
    key = "prompt" if "prompt" in gen.input else "text"
    if not plan["shots"]:
        gen.status, gen.started_at, gen.logs = "running", timezone.now(), [f"Planning {plan['count']} shots…"]
        gen.save(update_fields=["status", "started_at", "logs", "updated_at"])
        prompts = shot_planner.plan_shots(gen.input[key], plan["count"], plan["clipSeconds"])
        plan["shots"] = [{"prompt": p, "requestId": "", "done": False, "tries": 0} for p in prompts]
        gen.save(update_fields=["plan", "updated_at"])

    clips = generation_dir(gen.pk) / "clips"
    clips.mkdir(exist_ok=True)
    while True:
        pending = [s for s in plan["shots"] if not s["done"]]
        if not pending:
            break
        in_flight = [s for s in pending if s["requestId"]]
        for shot in [s for s in pending if not s["requestId"]][: max(0, MAX_IN_FLIGHT - len(in_flight))]:
            handle = fal_client.submit(gen.endpoint_id, arguments={**gen.input, key: shot["prompt"]})
            shot["requestId"], shot["tries"] = handle.request_id, shot["tries"] + 1
        for i, shot in enumerate(plan["shots"]):
            if shot["done"] or not shot["requestId"]:
                continue
            try:
                status = fal_client.status(gen.endpoint_id, shot["requestId"])
                if not isinstance(status, fal_client.Completed):
                    continue
                result = fal_client.result(gen.endpoint_id, shot["requestId"])
                video = next((m for m in find_media(result) if m["type"] == "video"), None)
                if not video:
                    raise RuntimeError("fal returned no video for a shot.")
                download(video["remote"], clips / f"clip_{i:03d}.mp4")
                shot["done"] = True
            except Exception as e:
                if shot["tries"] >= MAX_TRIES:
                    raise RuntimeError(f"Shot {i + 1} failed: {_message(e)}") from e
                log.warning("generation %s shot %s failed, retrying: %s", gen.pk, i, e)
                shot["requestId"] = ""
        done = sum(1 for s in plan["shots"] if s["done"])
        gen.status, gen.queue_position = "running", None
        gen.started_at = gen.started_at or timezone.now()
        gen.logs = [f"Clips ready: {done}/{plan['count']}"]
        gen.save(update_fields=["plan", "status", "queue_position", "started_at", "logs", "updated_at"])
        if done < plan["count"]:
            time.sleep(settings.GENERATE_POLL_SECONDS)

    gen.logs = [f"Stitching {plan['count']} clips…"]
    gen.save(update_fields=["logs", "updated_at"])
    final = stitch(sorted(clips.glob("clip_*.mp4")), generation_dir(gen.pk) / "output.mp4", plan["totalSeconds"])
    gen.media = [{"type": "video", "url": public_url(final), "remote": ""}]
    gen.status, gen.finished_at, gen.logs = "done", timezone.now(), []
    gen.save(update_fields=["media", "status", "finished_at", "logs", "updated_at"])


def _probe(path):
    proc = subprocess.run([ffmpeg_bin(), "-hide_banner", "-i", str(path)], capture_output=True, text=True)
    size = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", proc.stderr)
    return (int(size.group(1)), int(size.group(2))) if size else (1280, 720), "Audio:" in proc.stderr


def stitch(paths, dest, total_seconds):
    """Normalizes every clip to the first clip's size, 24 fps and stereo audio, then joins them."""
    (w, h), _ = _probe(paths[0])
    w, h = w - w % 2, h - h % 2
    parts = []
    for i, path in enumerate(paths):
        _, has_audio = _probe(path)
        part = dest.parent / f"part_{i:03d}.mp4"
        audio_in = [] if has_audio else ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]
        run_ffmpeg([
            "-i", str(path), *audio_in,
            "-vf", f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,fps=24,"
                   "format=yuv420p,setsar=1",
            "-map", "0:v:0", "-map", "0:a:0" if has_audio else "1:a:0", "-shortest",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-ar", "44100", "-ac", "2",
            str(part),
        ])
        parts.append(part)
    listing = dest.parent / "parts.txt"
    listing.write_text("".join(f"file '{p.name}'\n" for p in parts))
    run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(listing), "-t", f"{total_seconds:g}", "-c", "copy",
                "-movflags", "+faststart", str(dest)], timeout=1800)
    for p in parts:
        p.unlink(missing_ok=True)
    listing.unlink(missing_ok=True)
    return dest
