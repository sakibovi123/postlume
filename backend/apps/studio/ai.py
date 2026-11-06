import json
import re

from rest_framework.exceptions import ValidationError

import providers

from .schemas import DirectorReply, ScenePlan, StoryOut
from .styles import GENRES, MUSIC_MOODS, STYLE_PRESETS, VOICES

BLOCKED_TERMS = [
    "spider-man", "spiderman", "batman", "superman", "mickey mouse", "elsa", "pikachu", "harry potter",
    "darth vader", "iron man", "shrek", "sonic the hedgehog", "mario",
]
SAFETY_RULES = (
    "Safety rules: only original characters, never copyrighted or trademarked characters (a style like 'movie-like' "
    "is fine, a named franchise character is not). No real people in harmful, sexual or defamatory situations. "
    "No sexual content involving minors under any circumstances. Keep violence non-graphic."
)


def moderate(text):
    lowered = text.lower()
    hit = next((t for t in BLOCKED_TERMS if re.search(rf"\b{re.escape(t)}\b", lowered)), None)
    if hit:
        raise ValidationError({
            "error": "moderation",
            "detail": f"'{hit}' is a copyrighted character. Describe an original character instead.",
        })


DIRECTOR_SYSTEM = f"""You are the Postlume director, a friendly creative partner who helps creators plan short story videos.
Collect: style preset, the story idea, genre, target platform/aspect ratio, length in seconds, narration voice and music mood.
Style presets: {json.dumps({k: v["label"] for k, v in STYLE_PRESETS.items()})}
Genres: {", ".join(GENRES)}. Aspect ratios: 9:16 (Reels/Shorts/TikTok), 16:9 (YouTube), 1:1.
Lengths: 15 to 180 seconds. Voices: {json.dumps(VOICES)}. Music moods: {", ".join(MUSIC_MOODS)}.
Ask a short clarifying question only when something important (mainly the idea) is missing; otherwise pick sensible
defaults (9:16, 30 seconds, af_heart, a fitting mood) and propose a complete brief right away.
Whenever you have enough to propose or update the brief, include it in "brief"; otherwise set "brief" to null.
Keep "reply" under 80 words and tell the user they can confirm the brief or ask for changes.
If the user names copyrighted or franchise characters, do not stop or ask them for alternatives: invent original
characters with new names and new designs that only share a broad archetype (e.g. "a reckless fire-wielding young
mage" vs "an ancient, calm warlord"), never the franchise's names, signature outfits, symbols or powers by name.
Propose the full brief with them in "idea" right away and say in one short sentence that you swapped in originals.
The video has narration and background music only; there are no sound effects. If asked for sound effects, say so
briefly and choose a fitting music mood instead (e.g. "epic" for fights).
{SAFETY_RULES}
Respond only with JSON matching the schema."""

STORY_SYSTEM = f"""You are an award-winning short-form storyteller writing narration for a faceless story video.
Write for the ear: short vivid sentences, a strong hook in the first 3 seconds, a clear arc and a satisfying ending.
Narration speed is about 2.6 words per second, so the script length must match the target duration.
Create at most 5 original characters. Each visualDescription must be a precise, reusable visual description
(age, build, hair, clothing, colors, distinctive features) so every scene can draw the same character.
{SAFETY_RULES}
Respond only with JSON matching the schema."""

SCENE_SYSTEM = """You are a storyboard artist splitting a narration script into scenes for an AI video pipeline.
Rules:
- Use every word of the script exactly once, in order, split across the scenes' "narration" fields.
- 4 to 20 scenes, each 2 to 10 seconds of narration (about 2.6 words per second).
- imagePrompt: a complete standalone image prompt that starts with the style guide, then includes the full
  visualDescription of every character present, then the setting, action, composition and lighting. No text in images.
- motionPrompt: a short description of camera movement and subject motion for image-to-video.
- characters: names of the characters visible in the scene.
Respond only with JSON matching the schema."""


def director_reply(project, history, style_preset="", on_text=None):
    messages = [{"role": m.role, "content": m.content.get("text", "")} for m in history]
    system = DIRECTOR_SYSTEM
    if style_preset:
        system += f"\nThe user picked the '{style_preset}' preset in the style picker; use it unless they say otherwise."
    return providers.llm().structured("chat", system, messages, DirectorReply, hint={"stylePreset": style_preset},
                                      on_text=on_text)


def write_story(brief_raw, previous=None, instruction="", on_text=None):
    content = f"Creative brief:\n{json.dumps(brief_raw, indent=2)}"
    if previous:
        content += f"\n\nCurrent story:\n{json.dumps(previous, indent=2)}\n\nRevise it: {instruction}"
    hint = {"brief": brief_raw, "story": previous, "instruction": instruction}
    return providers.llm().structured("story", STORY_SYSTEM, [{"role": "user", "content": content}], StoryOut,
                                      hint=hint, on_text=on_text)


def plan_scenes(story_raw, guide, target_seconds):
    content = (
        f"Style guide: {guide}\nTarget length: {target_seconds} seconds\n"
        f"Characters: {json.dumps(story_raw['characters'])}\n\nScript:\n{story_raw['script']}"
    )
    hint = {"story": story_raw, "styleGuide": guide}
    return providers.llm().structured("story", SCENE_SYSTEM, [{"role": "user", "content": content}], ScenePlan,
                                      hint=hint)
