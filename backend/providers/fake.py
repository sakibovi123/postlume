"""Offline providers so the full pipeline can be developed and tested for $0."""

import hashlib
import random
import re
import textwrap
import time
import wave
from pathlib import Path

import json

from django.conf import settings
from PIL import Image, ImageDraw, ImageFont

from apps.studio.schemas import CreativeBrief, DirectorReply, ScenePlan, SeriesOutline, StoryOut

from .base import ImageResult, TtsResult, VideoResult, even_word_timings

WORDS_PER_SECOND = 2.6

PRESET_WORDS = {
    "animated_3d": ["3d", "pixar", "animated"], "cartoon": ["cartoon"], "anime_action": ["anime fight", "anime battle", "shonen"],
    "anime_2d": ["anime"],
    "cinematic": ["cinematic", "movie", "film"], "storybook": ["watercolor", "storybook", "kids"],
    "comic": ["comic"], "documentary": ["documentary", "realistic"],
}
GENRE_WORDS = ["horror", "motivational", "kids", "history", "sci-fi", "comedy", "facts", "fantasy", "mystery"]


def _sentences(text):
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s.strip()]


class FakeLlm:
    name = "fake-llm"

    def structured(self, kind, system, messages, schema, hint=None, on_text=None):
        hint = hint or {}
        if schema is DirectorReply:
            out = self._director(messages, hint)
        elif schema is StoryOut:
            out = self._story(hint)
            if hint.get("episode"):
                out.title = f"Episode {hint['episode']}: {hint['brief']['idea'].split(':')[0]}"[:200]
                out.characters = hint["characters"]
        elif schema is SeriesOutline:
            out = self._series(hint)
        elif schema is ScenePlan:
            out = self._scenes(hint)
        elif "shotCount" in hint:
            out = schema(shots=[f"{hint['prompt']} (shot {i + 1} of {hint['shotCount']})" for i in range(hint["shotCount"])])
        else:
            raise NotImplementedError(schema)
        if on_text:
            self._stream(out, on_text, settings.FAKE_LLM_STREAM_SECONDS * (0.5 if schema is DirectorReply else 1))
        return out, 0.0

    def _stream(self, out, on_text, seconds):
        text = out.model_dump_json() if hasattr(out, "model_dump_json") else json.dumps(out)
        step = 8
        pause = seconds / max(1, len(text) / step)
        for i in range(step, len(text) + step, step):
            on_text(text[:i])
            if pause:
                time.sleep(pause)

    def _series(self, hint):
        series, brief = hint["series"], hint["brief"]
        beats = ["The first sign", "Something follows", "The locked room", "Old letters", "No way out",
                 "The truth surfaces", "Turning the tables", "The last night", "Into the dark", "Dawn"]
        episodes = [{"title": beats[i % len(beats)] + (f" ({i // len(beats) + 1})" if i >= len(beats) else ""),
                     "synopsis": f"Part {i + 1} of the story: {brief['idea'][:160]}"}
                    for i in range(series["episodeCount"])]
        return SeriesOutline(
            title=series.get("title") or "Untitled series", logline=f"A {brief['genre']} series: {brief['idea'][:150]}",
            characters=[{"name": "Mira", "role": "protagonist",
                         "visualDescription": "10-year-old girl, curly dark hair, yellow raincoat, red boots"},
                        {"name": "Pip", "role": "sidekick",
                         "visualDescription": "tiny round glowing blue creature with big eyes and stubby arms"}],
            episodes=episodes,
        )

    def agent(self, system, messages, tools, state=None):
        return FakeAgent(messages, state or {}).turn(), 0.0

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


def _num(pattern, text, default=None, cast=int):
    m = re.search(pattern, text)
    return cast(m.group(1)) if m else default


class FakeAgent:
    """Rule-based stand-in for the tool-calling assistant, so the studio works offline and in tests."""

    def __init__(self, messages, state):
        self.messages, self.state = messages, state
        last = max((i for i, m in enumerate(messages) if m["role"] == "user"), default=-1)
        self.text = (messages[last]["content"] if last >= 0 else "").lower()
        self.results = [json.loads(m["content"]) for m in messages[last + 1:] if m["role"] == "tool"]
        self.all_user = " ".join(m["content"] for m in messages if m["role"] == "user").lower()

    def reply(self, text, suggestions=()):
        if suggestions:
            text += f"\n[[suggestions: {' | '.join(suggestions)}]]"
        return {"content": text, "tool_calls": [], "raw": {"role": "assistant", "content": text}}

    def calls(self, *calls):
        items = [{"id": f"call_{i}_{random.randint(0, 1 << 30)}", "name": n, "arguments": a} for i, (n, a) in enumerate(calls)]
        raw = {"role": "assistant", "content": "", "tool_calls": [
            {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": json.dumps(c["arguments"])}}
            for c in items]}
        return {"content": "", "tool_calls": items, "raw": raw}

    def turn(self):
        if self.results:
            errors = [r["error"] for r in self.results if not r.get("ok")]
            if errors:
                return self.reply(f"I hit a problem: {errors[0]}", ["Try something else"])
            return self.reply(self.summary(), self.next_suggestions())
        st, t = self.state, self.text
        if not st.get("series"):
            return self.plan()
        if st.get("writingInProgress"):
            return self.reply("I'm still writing the episodes. I'll post here as soon as they're done.")
        episodes = st.get("episodes") or []
        has_video = any(e.get("video") for e in episodes)
        ep = _num(r"episode\s*(\d+)", t)
        if "rewrite" in t and ep:
            return self.calls(("rewrite_episode", {"episode": ep, "instruction": t}))
        if "retry" in t and ep:
            return self.calls(("retry_episode", {"episode": ep}))
        wants_render = any(w in t for w in ["yes", "start", "make", "render", "go ahead", "sure", "next", "rest",
                                            "one at a time", "all at once"])
        if wants_render and not _num(r"scene\s*(\d+)", t):
            mode = "one_by_one" if any(w in t for w in ["one at a time", "one by one", "next", "start episode"]) else (
                "all" if any(w in t for w in ["all", "rest", "every"]) or len(episodes) == 1 else None)
            if mode is None:
                return self.reply("Great! Should I make all episodes at once, or one at a time so you can review "
                                  "each before the next?", ["All at once", "One at a time"])
            args = {"mode": mode, "tier": "lite"}
            if ep and "start episode" in t:
                args["episodes"] = [ep]
            return self.calls(("render_episodes", args))
        if not has_video:
            return self.reply("The episodes are written. Want me to start making the videos?",
                              ["Yes, make all episodes", "One at a time"])
        return self.edit(ep)

    def plan(self):
        t = self.all_user
        count = _num(r"(\d+)\s*-?\s*(?:episodes?|parts?)", t)
        if count is None and any(w in t for w in ["single video", "one video", "a video"]):
            count = 1
        seconds = _num(r"(\d+)\s*(?:s\b|sec|second)", t)
        minutes = _num(r"(\d+)\s*(?:min|minute)", t)
        seconds = seconds or (minutes * 60 if minutes else None)
        if count is None or seconds is None:
            missing = [w for w, v in [("how many episodes", count), ("how long each episode should be", seconds)] if v is None]
            return self.reply(f"Love it. Before I write: {' and '.join(missing)}?",
                              ["5 episodes, 60 seconds each", "10 episodes, 30 seconds each", "1 video, 60 seconds"])
        genre = next((g for g in ["horror", "kids", "sci-fi", "comedy", "mystery", "history", "motivational"] if g in t), "fantasy")
        preset = next((p for p, words in PRESET_WORDS.items() if any(w in t for w in words)), "cinematic")
        idea = next((m["content"] for m in self.messages if m["role"] == "user"), "An original story")
        plan = {"title": f"The {genre.title()} Tapes" if genre != "fantasy" else "The Humming Lighthouse",
                "premise": idea[:400], "episodeCount": max(1, min(20, count)),
                "episodeSeconds": max(15, min(180, seconds)), "genre": genre, "stylePreset": preset,
                "aspectRatio": "16:9" if "youtube" in t or "landscape" in t else "9:16", "voiceId": "am_fenrir"
                if genre == "horror" else "af_heart", "musicMood": "dark" if genre == "horror" else "calm"}
        return self.calls(("plan_series", plan), ("write_episodes", {}))

    def edit(self, ep):
        t, st = self.text, self.state
        ready = [e for e in st.get("episodes") or [] if (e.get("video") or {}).get("scenes")]
        if not ready:
            return self.reply("The videos are still rendering. I'll let you know when they're ready.")
        ep = ep or ready[-1]["episode"]
        scene = _num(r"scene\s*(\d+)", t)
        voices = ["af_heart", "am_michael", "am_fenrir", "af_bella", "bf_emma", "bm_george"]
        if "voice" in t:
            current = (ready[-1]["video"] or {}).get("voice")
            return self.calls(("set_audio", {"voiceId": next(v for v in voices if v != current)}))
        mood = next((m for m in ["calm", "uplifting", "suspense", "dark", "playful", "epic", "none"] if m in t), None)
        if "music" in t:
            return self.calls(("set_audio", {"musicMood": mood or "suspense"}))
        if "caption" in t and scene is None:
            return self.calls(("set_audio", {"captions": not any(w in t for w in ["off", "remove", "hide", "no "])}))
        if any(w in t for w in ["add a scene", "add scene", "new scene", "insert", "extend"]):
            count = len(next(e for e in ready if e["episode"] == ep)["video"]["scenes"])
            return self.calls(("insert_scene", {"episode": ep, "position": count + 1,
                                                "narration": "And then, in the silence, something answered back.",
                                                "imagePrompt": "dark hallway, a door slowly opening, moonlight"}))
        if scene is None:
            return self.reply("Tell me which scene to change, e.g. \"cut 2 seconds from scene 3 of episode 1\".",
                              ["Delete scene 1", "Change the music"])
        if any(w in t for w in ["sound", "sfx", "effect"]):
            return self.calls(("add_sound_effect", {"episode": ep, "scene": scene, "description": t[:200]}))
        if any(w in t for w in ["delete", "remove", "drop"]):
            return self.calls(("delete_scene", {"episode": ep, "scene": scene}))
        if "move" in t:
            pos = 1 if "start" in t or "beginning" in t else _num(r"to\s*(?:position\s*)?(\d+)", t, 1)
            return self.calls(("move_scene", {"episode": ep, "scene": scene, "position": pos}))
        if any(w in t for w in ["trim", "cut", "shorten"]):
            secs = _num(r"(\d+(?:\.\d+)?)\s*(?:s\b|sec|second)", t, 1.0, float)
            key = "cutStartSeconds" if any(w in t for w in ["start", "beginning"]) else "cutEndSeconds"
            return self.calls(("trim_scene", {"episode": ep, "scene": scene, key: secs}))
        if "caption" in t:
            quoted = re.search(r"[\"“](.+?)[\"”]", self.messages[-1]["content"])
            return self.calls(("edit_caption", {"episode": ep, "scene": scene,
                                                "text": quoted.group(1) if quoted else t[:80]}))
        return self.calls(("edit_scene", {"episode": ep, "scene": scene, "imagePrompt": f"cinematic still, {t}"}))

    def summary(self):
        r = self.results[-1]
        if "writeCost" in r or r.get("started"):
            n = (self.state.get("series") or {}).get("episodeCount") or len(r.get("episodes") or [])
            return f"Plan saved. I'm writing all {n} episodes now; I'll post here when they're ready."
        if "creditsLeft" in r:
            eps = r["episodes"]
            return (f"Rendering {'episode ' + str(eps[0]) if len(eps) == 1 else f'{len(eps)} episodes'} now "
                    f"({r['creditsCharged']} credits). I'll tell you when {'it is' if len(eps) == 1 else 'they are'} ready.")
        if "title" in r and "words" in r:
            return f"Rewrote it: \"{r['title']}\" ({r['words']} words)."
        return "On it. I'm applying your edit now and will let you know when the new version is ready."

    def next_suggestions(self):
        r = self.results[-1]
        if "creditsLeft" in r:
            return ["Change the music", "Make the voice deeper"]
        return []


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


class FakeSfx:
    name = "fake-sfx"

    def generate(self, description, seconds, dest):
        from .media import run_ffmpeg

        run_ffmpeg(["-f", "lavfi", "-i", f"anoisesrc=d={max(0.5, seconds):.2f}:c=pink:a=0.08", "-ar", "44100",
                    str(dest)])
        return Path(dest), 0.0


def _font(size):
    for candidate in ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc",
                      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default(size)
