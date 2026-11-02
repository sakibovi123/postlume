from typing import Literal, Optional

from pydantic import BaseModel, Field

StylePreset = Literal["animated_3d", "cartoon", "anime_2d", "cinematic", "storybook", "comic", "documentary", "custom"]


class CreativeBrief(BaseModel):
    stylePreset: StylePreset
    customStyle: Optional[str] = Field(default=None, max_length=500)
    idea: str = Field(min_length=3, max_length=2000)
    genre: str
    aspectRatio: Literal["9:16", "16:9", "1:1"]
    targetSeconds: int = Field(ge=15, le=180)
    language: str = "en"
    narration: bool = True
    voiceId: Optional[str] = None
    musicMood: Optional[str] = None


class DirectorReply(BaseModel):
    reply: str
    brief: Optional[CreativeBrief] = None


class Character(BaseModel):
    name: str
    role: str
    visualDescription: str


class StoryOut(BaseModel):
    title: str
    logline: str
    hook: str
    characters: list[Character] = Field(max_length=5)
    script: str
    estimatedSeconds: int


class ScenePlanItem(BaseModel):
    narration: str
    durationSeconds: float = Field(ge=2, le=10)
    shot: str
    camera: str
    characters: list[str]
    imagePrompt: str
    motionPrompt: str


class ScenePlan(BaseModel):
    styleGuide: str
    scenes: list[ScenePlanItem] = Field(min_length=2, max_length=20)
