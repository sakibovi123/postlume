STYLE_PRESETS = {
    "animated_3d": {
        "label": "3D animated",
        "guide": "high-quality 3D animated film look, soft global illumination, expressive original characters, "
                 "rounded shapes, rich saturated colors, shallow depth of field",
    },
    "cartoon": {
        "label": "Cartoon",
        "guide": "2D cartoon, bold clean outlines, bright flat colors, simple shading, playful exaggerated poses",
    },
    "anime_2d": {
        "label": "2D anime",
        "guide": "2D anime style, cel shading, detailed painted backgrounds, dramatic lighting, expressive eyes",
    },
    "cinematic": {
        "label": "Cinematic",
        "guide": "cinematic live-action film still, anamorphic lens, film grain, teal and orange color grade, "
                 "dramatic lighting, 35mm",
    },
    "storybook": {
        "label": "Watercolor storybook",
        "guide": "children's storybook watercolor illustration, soft paper texture, gentle pastel palette, "
                 "warm and friendly characters",
    },
    "comic": {
        "label": "Comic",
        "guide": "comic book panel art, inked line work, halftone shading, strong silhouettes, dynamic angles",
    },
    "documentary": {
        "label": "Realistic documentary",
        "guide": "realistic documentary photography, natural light, authentic textures, muted grounded colors",
    },
    "custom": {"label": "Custom", "guide": ""},
}

GENRES = ["horror", "motivational", "kids", "history", "sci-fi", "comedy", "facts", "fantasy", "mystery"]
VOICES = [
    {"id": "af_heart", "label": "Warm female"},
    {"id": "am_michael", "label": "Calm male"},
    {"id": "am_fenrir", "label": "Deep male"},
    {"id": "af_bella", "label": "Bright female"},
    {"id": "bf_emma", "label": "British female"},
    {"id": "bm_george", "label": "British male"},
]
MUSIC_MOODS = ["none", "calm", "uplifting", "suspense", "dark", "playful", "epic"]

ASPECT_SIZES = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080)}


def style_guide(preset, custom=""):
    base = STYLE_PRESETS.get(preset, STYLE_PRESETS["custom"])["guide"]
    return ", ".join(x for x in [base, custom or ""] if x)
