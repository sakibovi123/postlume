import json
import math

from pydantic import BaseModel

import providers
from apps.studio.ai import SAFETY_RULES

MAX_TOTAL_SECONDS = 600

SHOTS_SYSTEM = f"""You are a film director turning one video idea into a sequence of consecutive shots for an
AI text-to-video model that only makes short clips. Every shot is generated separately, so each prompt must stand
alone: repeat the full visual description of every character (look, outfit, colors), the setting and the visual
style in every shot so they stay consistent. Shots must flow as one continuous video with a clear beginning,
escalation and ending, varied camera angles and actions, and no repeated shots. Keep any sound or dialogue cues
from the idea. {SAFETY_RULES}
Respond only with JSON matching the schema."""


class ShotList(BaseModel):
    shots: list[str]


def clip_seconds(info):
    """Longest clip the model accepts, or None when it has no duration setting."""
    field = next((f for f in info["fields"] if f["name"] == "duration"), None)
    if not field:
        return None
    if field.get("options"):
        nums = [float(o) for o in field["options"] if str(o).replace(".", "", 1).isdigit()]
        return max(nums) if nums else None
    if field.get("max"):
        return math.floor(field["max"])
    return None


def duration_value(info, seconds):
    """The duration value in the type the model expects (enum strings stay strings)."""
    field = next(f for f in info["fields"] if f["name"] == "duration")
    for o in field.get("options") or []:
        if str(o).replace(".", "", 1).isdigit() and float(o) == seconds:
            return o
    return int(seconds) if field["type"] == "integer" or float(seconds).is_integer() else seconds


def plan_shots(prompt, count, clip):
    content = f"Video idea:\n{prompt}\n\nWrite exactly {count} shots of about {clip:g} seconds each."
    out, _cost = providers.llm().structured("story", SHOTS_SYSTEM, [{"role": "user", "content": content}], ShotList,
                                            hint={"shotCount": count, "prompt": prompt})
    shots = [s.strip() for s in out.shots if s.strip()][:count]
    while len(shots) < count:
        shots.append(f"{prompt} (continued, shot {len(shots) + 1} of {count})")
    return shots
