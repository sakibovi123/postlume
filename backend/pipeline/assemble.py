import secrets
import shutil
import textwrap
from pathlib import Path

from django.conf import settings
from PIL import Image, ImageDraw

from apps.studio.styles import ASPECT_SIZES
from providers.fake import _font
from providers.media import local_path, public_url, run_ffmpeg, video_dir

FPS = 30
MUSIC_DIR = Path(settings.BASE_DIR) / "assets" / "music"


def caption_chunks(scene, max_words=3):
    words = scene.words or []
    if scene.caption_text and words:
        custom = scene.caption_text.split()
        start, end = words[0]["start"], words[-1]["end"]
        step = (end - start) / max(1, len(custom))
        words = [{"word": w, "start": start + i * step, "end": start + (i + 1) * step} for i, w in enumerate(custom)]
    chunks = []
    for i in range(0, len(words), max_words):
        group = words[i:i + max_words]
        chunks.append({"text": " ".join(w["word"] for w in group), "start": group[0]["start"], "end": group[-1]["end"]})
    for a, b in zip(chunks, chunks[1:]):
        a["end"] = b["start"]
    return chunks


def caption_png(text, width, dest):
    font = _font(int(width * 0.07))
    lines = textwrap.wrap(text.upper(), width=16) or [""]
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    line_h = int(width * 0.085)
    img = Image.new("RGBA", (width, line_h * len(lines) + 40), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        w = probe.textlength(line, font=font)
        draw.text(((width - w) / 2, 20 + i * line_h), line, font=font, fill=(255, 255, 255),
                  stroke_width=max(4, width // 160), stroke_fill=(0, 0, 0))
    img.save(dest)
    return dest, img.height


def end_card_png(title, w, h, dest):
    img = Image.new("RGB", (w, h), (14, 12, 22))
    draw = ImageDraw.Draw(img)
    font, small = _font(int(min(w, h) * 0.07)), _font(int(min(w, h) * 0.035))
    lines = textwrap.wrap(title, width=18)
    y = h * 0.42 - len(lines) * min(w, h) * 0.045
    for line in lines:
        lw = draw.textlength(line, font=font)
        draw.text(((w - lw) / 2, y), line, font=font, fill=(255, 255, 255))
        y += min(w, h) * 0.09
    tag = "Made with Postlume"
    draw.text(((w - draw.textlength(tag, font=small)) / 2, y + 30), tag, font=small, fill=(255, 122, 107))
    img.save(dest)
    return dest


def zoompan_expr(camera, frames, idx):
    cam = (camera or "").lower()
    n = max(1, frames - 1)
    center = "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
    if "left" in cam:
        return f"z='1.15':x='(iw-iw/zoom)*(1-on/{n})':y='ih/2-(ih/zoom/2)'"
    if "right" in cam:
        return f"z='1.15':x='(iw-iw/zoom)*on/{n}':y='ih/2-(ih/zoom/2)'"
    if "tilt" in cam or "up" in cam:
        return f"z='1.15':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-on/{n})'"
    if "out" in cam or (not cam and idx % 2):
        return f"z='1.18-0.18*on/{n}':{center}"
    return f"z='1+0.18*on/{n}':{center}"


def render_segment(scene, w, h, work, captions=True):
    dur = scene.duration_ms / 1000
    frames = int(dur * FPS)
    audio = local_path(scene.audio_url)
    clip = local_path(scene.clip_url) if scene.clip_url else None
    out = work / f"seg_{scene.idx:02d}.mp4"
    inputs, filters = [], []
    if clip and clip.exists():
        inputs += ["-stream_loop", "-1", "-i", str(clip)]
        filters.append(f"[0:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},fps={FPS},"
                       f"trim=duration={dur},setpts=PTS-STARTPTS,setsar=1[base]")
    else:
        inputs += ["-i", str(local_path(scene.keyframe_url))]
        filters.append(f"[0:v]scale={w * 2}:{h * 2}:force_original_aspect_ratio=increase,crop={w * 2}:{h * 2},"
                       f"zoompan={zoompan_expr(scene.camera, frames, scene.idx)}:d={frames}:s={w}x{h}:fps={FPS},"
                       f"trim=end_frame={frames},setsar=1[base]")
    inputs += ["-i", str(audio)]
    last = "base"
    if captions:
        y = int(h * (0.66 if h > w else 0.76))
        for i, c in enumerate(caption_chunks(scene)):
            png, _ = caption_png(c["text"], w, work / f"cap_{scene.idx:02d}_{i:02d}.png")
            inputs += ["-i", str(png)]
            filters.append(f"[{last}][{_input_index(inputs)}:v]overlay=0:{y}:"
                           f"enable='between(t,{c['start']:.3f},{c['end']:.3f})'[v{i}]")
            last = f"v{i}"
    fade_out = max(0, dur - 0.25)
    filters.append(f"[{last}]fade=t=in:st=0:d=0.2,fade=t=out:st={fade_out:.3f}:d=0.25,format=yuv420p[vout]")
    voice = f"aresample=44100,aformat=channel_layouts=stereo,apad,atrim=duration={dur}"
    sfx = local_path(scene.sfx_url) if scene.sfx_url else None
    if sfx and sfx.exists():
        inputs += ["-i", str(sfx)]
        filters.append(f"[1:a]{voice}[narr]")
        filters.append(f"[{_input_index(inputs)}:a]aresample=44100,aformat=channel_layouts=stereo,volume=0.7,"
                       f"apad,atrim=duration={dur}[fx]")
        filters.append("[narr][fx]amix=inputs=2:duration=first:normalize=0[aout]")
    else:
        filters.append(f"[1:a]{voice}[aout]")
    run_ffmpeg([
        *inputs, "-filter_complex", ";".join(filters), "-map", "[vout]", "-map", "[aout]",
        "-t", f"{dur:.3f}", "-r", str(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
        "-c:a", "aac", "-b:a", "160k", str(out),
    ])
    if scene.trim_start_ms or scene.trim_end_ms:
        cut = work / f"seg_{scene.idx:02d}_cut.mp4"
        run_ffmpeg([
            "-ss", f"{scene.trim_start_ms / 1000:.3f}", "-i", str(out), "-t", f"{scene.effective_ms / 1000:.3f}",
            "-af", "afade=t=out:st={:.3f}:d=0.2".format(max(0, scene.effective_ms / 1000 - 0.2)),
            "-r", str(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", "-b:a", "160k",
            str(cut),
        ])
        return cut
    return out


def _input_index(inputs):
    return inputs.count("-i") - 1


def render_end_card(title, w, h, work, seconds=2.0):
    png = end_card_png(title, w, h, work / "endcard.png")
    out = work / "seg_99_end.mp4"
    run_ffmpeg([
        "-loop", "1", "-framerate", str(FPS), "-t", str(seconds), "-i", str(png),
        "-f", "lavfi", "-t", str(seconds), "-i", "anullsrc=r=44100:cl=stereo",
        "-vf", f"fade=t=in:st=0:d=0.3,format=yuv420p,setsar=1", "-r", str(FPS),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", "-b:a", "160k", "-shortest", str(out),
    ])
    return out


def find_music(mood):
    if not mood or mood == "none" or not MUSIC_DIR.exists():
        return None
    for ext in ("mp3", "m4a", "wav", "ogg"):
        files = sorted(MUSIC_DIR.glob(f"{mood}*.{ext}"))
        if files:
            return files[0]
    return None


def render(video, on_progress=lambda f: None):
    w, h = ASPECT_SIZES[video.aspect_ratio]
    base = video_dir(video.id)
    work = base / "work"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir()
    scenes = list(video.scenes.all())
    segments = []
    for i, scene in enumerate(scenes):
        segments.append(render_segment(scene, w, h, work, captions=video.captions))
        on_progress(0.05 + 0.8 * (i + 1) / len(scenes))
    segments.append(render_end_card(video.story.title, w, h, work))
    listing = work / "list.txt"
    listing.write_text("".join(f"file '{s.name}'\n" for s in segments))
    joined = work / "joined.mp4"
    run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(joined)])

    final = base / f"postlume_{video.id}_{secrets.token_hex(3)}.mp4"
    music = find_music(video.music_mood)
    if music:
        run_ffmpeg([
            "-i", str(joined), "-stream_loop", "-1", "-i", str(music), "-filter_complex",
            "[0:a]asplit=2[v1][v2];[1:a]volume=0.35,aformat=channel_layouts=stereo[m];"
            "[m][v1]sidechaincompress=threshold=0.03:ratio=10:attack=20:release=400[duck];"
            "[v2][duck]amix=inputs=2:duration=first:normalize=0[a]",
            "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
            "-movflags", "+faststart", str(final),
        ])
    else:
        run_ffmpeg(["-i", str(joined), "-c", "copy", "-movflags", "+faststart", str(final)])
    on_progress(0.95)

    thumb = base / f"thumb_{secrets.token_hex(3)}.jpg"
    run_ffmpeg(["-ss", "0.8", "-i", str(final), "-frames:v", "1", "-q:v", "3", str(thumb)])
    # taleloop_ is the filename prefix of renders made before the rename to Postlume.
    for old in [*base.glob("postlume_*.mp4"), *base.glob("taleloop_*.mp4")]:
        if old != final:
            old.unlink(missing_ok=True)
    for old in base.glob("thumb_*.jpg"):
        if old != thumb:
            old.unlink(missing_ok=True)
    shutil.rmtree(work, ignore_errors=True)
    total_ms = sum(s.effective_ms for s in scenes) + 2000
    return {"output_url": public_url(final), "thumbnail_url": public_url(thumb), "duration_ms": total_ms}
