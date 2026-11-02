"""Offline providers so the full pipeline can be developed and tested for $0."""

import hashlib
import random
import re
import textwrap
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from apps.studio.schemas import CreativeBrief, DirectorReply, ScenePlan, StoryOut

from .base import ImageResult, TtsResult, VideoResult, even_word_timings

WORDS_PER_SECOND = 2.6

PRESET_WORDS = {
    "animated_3d": ["3d", "pixar", "animated"], "cartoon": ["cartoon"], "anime_2d": ["anime"],
    "cinematic": ["cinematic", "movie", "film"], "storybook": ["watercolor", "storybook", "kids"],
    "comic": ["comic"], "documentary": ["documentary", "realistic"],
}
GENRE_WORDS = ["horror", "motivational", "kids", "history", "sci-fi", "comedy", "facts", "fantasy", "mystery"]


def _sentences(text):
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s.strip()]


class FakeLlm:
    name = "fake-llm"

    def structured(self, kind, system, messages, schema, hint=None):
        hint = hint or {}
        if schema is DirectorReply:
            return self._director(messages, hint), 0.0
        if schema is StoryOut:
            return self._story(hint), 0.0
        if schema is ScenePlan:
            return self._scenes(hint), 0.0
        raise NotImplementedError(schema)

    def _director(self, messages, hint):
        text = " ".join(m["content"] for m in messages if m["role"] == "user").lower()
        last = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        preset = hint.get("stylePreset") or next(
            (p for p, words in PRESET_WORDS.items() if any(w in text for w in words)), "cartoon"
        )
        aspect = "16:9" if any(w in text for w in ["16:9", "youtube video", "landscape"]) else (
            "1:1" if "square" in text or "1:1" in text else "9:16"
        )
        seconds = 30
        m = re.search(r"(\d+)\s*(s\b|sec|second|min)", text)
        if m:
            seconds = int(m.group(1)) * (60 if m.group(2).startswith("min") else 1)
        seconds = max(15, min(180, seconds))
        genre = next((g for g in GENRE_WORDS if g in text), "fantasy")
        brief = CreativeBrief(
            stylePreset=preset, idea=last.strip()[:2000] or "A short original story", genre=genre,
            aspectRatio=aspect, targetSeconds=seconds, musicMood="calm", voiceId="af_heart",
        )
        reply = (
            f"Here's a brief for a {seconds}-second {genre} video in the {preset.replace('_', ' ')} style "
            f"({aspect}). Confirm it, or tell me what to change."
        )
        return DirectorReply(reply=reply, brief=brief)

    def _story(self, hint):
        brief = hint["brief"]
        idea = brief["idea"].rstrip(".")
        seconds = brief["targetSeconds"]
        instruction = (hint.get("instruction") or "").lower()
        if "shorter" in instruction:
            seconds = max(15, int(seconds * 0.7))
        target_words = int(seconds * WORDS_PER_SECOND)
        hero = "Mira"
        lines = [
            f"Nobody believed {hero} when she said the old lighthouse was humming again.",
            f"It all began with an idea: {idea}.",
            f"{hero} packed a lantern, a notebook, and far too many snacks.",
            "The path was steep, the wind was loud, and the sea kept whispering her name.",
            "At the top she found a door that had not been opened in a hundred years.",
            "Behind it, a tiny glowing creature was trying very hard to fix a broken star.",
            f"{hero} knelt down, opened her notebook, and together they read the old instructions.",
            "Piece by piece, the star began to shine, and the humming turned into music.",
            "When dawn came, the whole town looked up and saw a new light over the water.",
            f"And {hero} learned that the strangest sounds sometimes lead to the best friends.",
        ]
        rng = random.Random(f"{idea}:{instruction}")
        script, words = [], 0
        while words < target_words:
            for line in lines:
                if words >= target_words:
                    break
                script.append(line)
                words += len(line.split())
            lines = lines[2:] + [rng.choice(lines)]
        hook = script[0] if "hook" not in instruction else "What if a lighthouse could sing?"
        story = StoryOut(
            title=f"The Humming Lighthouse{' (revised)' if instruction else ''}",
            logline=f"A curious girl follows a strange sound and discovers {idea.lower()}.",
            hook=hook,
            characters=[
                {"name": hero, "role": "protagonist",
                 "visualDescription": "10-year-old girl, curly dark hair, yellow raincoat, red boots, freckles"},
                {"name": "Pip", "role": "sidekick",
                 "visualDescription": "tiny round glowing blue creature with big eyes and stubby arms"},
            ],
            script=" ".join(script),
            estimatedSeconds=round(words / WORDS_PER_SECOND),
        )
        return story

    def _scenes(self, hint):
        story, guide = hint["story"], hint["styleGuide"]
        chars = {c["name"]: c["visualDescription"] for c in story["characters"]}
        groups, cur = [], []
        for s in _sentences(story["script"]):
            cur.append(s)
            if len(" ".join(cur).split()) >= 14:
                groups.append(" ".join(cur))
                cur = []
        if cur:
            groups.append(" ".join(cur))
        if len(groups) < 2:
            groups = groups * 2
        scenes = []
        cameras = ["slow push in", "pan left", "slow pull out", "pan right", "tilt up"]
        for i, g in enumerate(groups[:20]):
            present = [n for n in chars if n in g] or list(chars)[:1]
            desc = "; ".join(f"{n}: {chars[n]}" for n in present)
            scenes.append({
                "narration": g,
                "durationSeconds": min(10, max(2, len(g.split()) / WORDS_PER_SECOND)),
                "shot": f"Scene {i + 1}: {g[:80]}",
                "camera": cameras[i % len(cameras)],
                "characters": present,
                "imagePrompt": f"{guide}. {desc}. {g}",
                "motionPrompt": f"{cameras[i % len(cameras)]}, gentle natural motion",
            })
        return ScenePlan(styleGuide=guide, scenes=scenes)


class FakeImage:
    name = "fake-image"

    def generate(self, prompt, width, height, dest, reference_urls=None):
        seed = int(hashlib.md5(prompt.encode()).hexdigest()[:8], 16)
        rng = random.Random(seed)
        c1 = tuple(rng.randint(30, 200) for _ in range(3))
        c2 = tuple(rng.randint(30, 200) for _ in range(3))
        img = Image.new("RGB", (width, height))
        draw = ImageDraw.Draw(img)
        for y in range(height):
            t = y / height
            draw.line([(0, y), (width, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(c1, c2)))
        for _ in range(12):
            r = rng.randint(width // 20, width // 6)
            x, y = rng.randint(0, width), rng.randint(0, height)
            draw.ellipse([x - r, y - r, x + r, y + r], outline=(255, 255, 255), width=3)
        font = _font(max(28, width // 30))
        body = "\n".join(textwrap.wrap(prompt.split(". ")[-1][:220], width=28))
        draw.multiline_text((width * 0.08, height * 0.12), f"[placeholder]\n{body}", fill=(255, 255, 255), font=font)
        dest = Path(dest)
        img.save(dest)
        return ImageResult(path=dest, cost_usd=0.0, provider=self.name)


class FakeVideo:
    name = "fake-video"

    def animate(self, image_path, image_remote_url, prompt, seconds, tier, dest):
        return VideoResult(path=None, provider=self.name)


class FakeTts:
    name = "fake-tts"

    def speak(self, text, voice, dest):
        duration = round(len(text.split()) / WORDS_PER_SECOND + 0.4, 2)
        rate = 22050
        with wave.open(str(dest), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(b"\x00\x00" * int(rate * duration))
        return TtsResult(path=Path(dest), duration=duration, words=even_word_timings(text, duration - 0.4, 0.2),
                         provider=self.name)


def _font(size):
    for candidate in ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc",
                      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default(size)
