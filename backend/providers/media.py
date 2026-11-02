import re
import shutil
import subprocess
import wave
from functools import cache
from pathlib import Path

import httpx
from django.conf import settings


@cache
def ffmpeg_bin():
    if settings.FFMPEG_BIN:
        return settings.FFMPEG_BIN
    found = shutil.which("ffmpeg")
    if found:
        return found
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def run_ffmpeg(args, timeout=900):
    cmd = [ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-y", *args]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr.strip()[-1500:]}")


def media_duration(path):
    proc = subprocess.run([ffmpeg_bin(), "-hide_banner", "-i", str(path)], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", proc.stderr)
    if not m:
        raise RuntimeError(f"Could not read duration of {path}")
    h, mnt, s = m.groups()
    return int(h) * 3600 + int(mnt) * 60 + float(s)


def wav_duration(path):
    with wave.open(str(path)) as w:
        return w.getnframes() / float(w.getframerate())


def to_wav(src, dest):
    run_ffmpeg(["-i", str(src), "-ac", "1", "-ar", "44100", str(dest)])
    return dest


def download(url, dest):
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.stream("GET", url, timeout=300, follow_redirects=True) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)
    return dest


def video_dir(video_id):
    d = Path(settings.MEDIA_ROOT) / "videos" / str(video_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def public_url(path):
    rel = Path(path).resolve().relative_to(Path(settings.MEDIA_ROOT).resolve())
    return f"{settings.MEDIA_URL}{rel.as_posix()}"


def local_path(url):
    if not url.startswith(settings.MEDIA_URL):
        return None
    return Path(settings.MEDIA_ROOT) / url[len(settings.MEDIA_URL):].split("?")[0]
