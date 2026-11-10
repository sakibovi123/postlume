"""The studio assistant: an LLM with tools that plans, writes, renders and edits episodic videos."""

import json
import re
import secrets
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from django.db.models import F
from pydantic import ValidationError as PydanticError
from rest_framework.exceptions import APIException

import providers
from apps.accounts.exceptions import InsufficientCredits
from apps.billing import service as billing
from apps.billing.models import Action
from pipeline import jobs
from providers.base import ProviderError
from providers.media import public_url, video_dir

from . import ai, services, tasks
from .dto import story_dto
from .models import Brief, ChatMessage, Project, Scene, Video, VideoStatus
from .schemas import CreativeBrief
from .styles import GENRES, MUSIC_MOODS, STYLE_PRESETS, VOICES

MAX_STEPS = 10
SFX_CREDITS = 1
HISTORY = 40
WORDS_PER_SECOND = 2.6


class ToolError(Exception):
    pass


def _fn(name, description, properties, required=()):
    return {"type": "function", "function": {"name": name, "description": description, "parameters": {
        "type": "object", "properties": properties, "required": list(required)}}}


INT = {"type": "integer"}
NUM = {"type": "number"}
STR = {"type": "string"}
EPISODES = {"type": "array", "items": INT}

TOOLS = [
    _fn("plan_series", "Save the series plan (also for a single video: episodeCount 1). Call only once you know "
        "the episode count and episode length.", {
            "title": STR, "premise": {**STR, "description": "The story idea in 1-3 sentences"},
            "episodeCount": {**INT, "minimum": 1, "maximum": 20},
            "episodeSeconds": {**INT, "minimum": 15, "maximum": 180},
            "genre": {"type": "string", "enum": GENRES},
            "stylePreset": {"type": "string", "enum": list(STYLE_PRESETS)},
            "customStyle": STR, "aspectRatio": {"type": "string", "enum": ["9:16", "16:9", "1:1"]},
            "voiceId": {"type": "string", "enum": [v["id"] for v in VOICES]},
            "musicMood": {"type": "string", "enum": MUSIC_MOODS}, "narration": {"type": "boolean"},
        }, ["title", "premise", "episodeCount", "episodeSeconds", "genre", "stylePreset", "aspectRatio"]),
    _fn("write_episodes", "Write the full story for every episode (or only the listed ones) in the background. "
        "The user is told in the chat when it finishes.", {"episodes": EPISODES}),
    _fn("rewrite_episode", "Rewrite one episode's story with an instruction.",
        {"episode": INT, "instruction": STR}, ["episode", "instruction"]),
    _fn("render_episodes", "Start making videos. mode 'all' queues every episode without a video (or the listed "
        "ones); mode 'one_by_one' renders only the next episode. Only call after the user agreed.", {
            "mode": {"type": "string", "enum": ["all", "one_by_one"]},
            "tier": {"type": "string", "enum": ["lite", "standard", "premium"]}, "episodes": EPISODES,
        }, ["mode"]),
    _fn("retry_episode", "Retry a failed episode render from the step that failed.", {"episode": INT}, ["episode"]),
    _fn("get_episode", "Full details of one episode: script and every scene with its prompts.", {"episode": INT},
        ["episode"]),
    _fn("edit_scene", "Regenerate one scene's visuals and/or narration. imagePrompt must be a complete standalone "
        "prompt: start from the scene's current imagePrompt (get_episode) and change only what was asked.", {
            "episode": INT, "scene": INT, "imagePrompt": STR, "motionPrompt": STR, "narration": STR,
        }, ["episode", "scene"]),
    _fn("edit_caption", "Change the on-screen caption text of a scene (narration audio stays the same).",
        {"episode": INT, "scene": INT, "text": STR}, ["episode", "scene", "text"]),
    _fn("trim_scene", "Cut seconds off the start and/or end of a scene. Values are totals, not increments.",
        {"episode": INT, "scene": INT, "cutStartSeconds": NUM, "cutEndSeconds": NUM}, ["episode", "scene"]),
    _fn("delete_scene", "Remove a scene from an episode.", {"episode": INT, "scene": INT}, ["episode", "scene"]),
    _fn("move_scene", "Move a scene to a new position (1-based).", {"episode": INT, "scene": INT, "position": INT},
        ["episode", "scene", "position"]),
    _fn("insert_scene", "Add a new scene at a position (1-based; use scene count + 1 to append). Write narration "
        "that fits the story and a complete imagePrompt describing the characters and setting.", {
            "episode": INT, "position": INT, "narration": STR, "imagePrompt": STR, "motionPrompt": STR,
        }, ["episode", "position", "narration", "imagePrompt"]),
    _fn("add_sound_effect", "Add a sound effect under a scene, e.g. 'door creaks open, distant thunder'. An empty "
        "description removes it.", {"episode": INT, "scene": INT, "description": STR}, ["episode", "scene"]),
    _fn("set_audio", "Change voice, background music or captions for some episodes (default: all with videos).", {
        "episodes": EPISODES, "voiceId": {"type": "string", "enum": [v["id"] for v in VOICES]},
        "musicMood": {"type": "string", "enum": MUSIC_MOODS}, "captions": {"type": "boolean"},
    }),
]

SYSTEM = f"""You are the Postlume assistant: a smart, friendly creative partner. You can talk about anything, and
when the user wants to make videos you plan, write, produce and edit episodic story videos end to end by calling tools.

Talking with the user:
- Answer whatever the user actually asked, directly and correctly, like a knowledgeable friend: greetings, small
  talk, the date or time (it's in the context below), general knowledge, advice, brainstorming ideas, feedback on
  their plans. Don't dodge questions or claim you can't know something that's in your context.
- Don't push the video workflow. Only bring up episodes, lengths or the next step when the user wants to create
  something or is clearly in the middle of a project. Never repeat the same pitch twice.
- Match the user's tone and language, but don't copy nicknames or slang back at them.

Making videos:
1. You need the idea, the number of episodes and the length of each episode. If the user hasn't given the number
   of episodes or the episode length, ask for both in one short question (offer options such as 1, 3, 5 or 10
   episodes and 30, 60 or 90 seconds) before planning. A single video is 1 episode. Pick everything else yourself
   (style, genre, 9:16 unless they mention YouTube or landscape, voice, music) and mention your picks briefly.
   If preferredStylePreset is set in the project state, the user picked that look, so use it.
2. Then call plan_series and write_episodes in the same turn. Writing runs in the background; say it's underway.
3. When the episodes are written, ask whether to start making the videos. State the credit cost and ask whether
   to render all episodes at once or one at a time. Call render_episodes only after the user says yes. Use the
   lite tier unless they ask for higher quality and their plan includes it.
4. Once videos exist, carry out edit commands with the edit tools. Episode and scene numbers are 1-based, as the
   user sees them. Call get_episode when you need scene details. Several edits in one turn are applied together
   in a single re-render, so do them all before replying. Edits need the episode's video to be finished.
   Make all of the user's requested edits in ONE batch of parallel tool calls, numbering scenes exactly as in
   the project state: the numbers stay valid for the whole batch even if a move or delete in it reorders scenes.

Rules:
- Check the credits in the project state before costly actions. If there aren't enough, say so and suggest fewer
  episodes, shorter episodes or upgrading the plan.
- The project state is refreshed after your tool calls, so it already includes your own changes; describe what
  you changed, not how the state looks afterwards.
- Never claim something happened unless a tool returned ok. If a tool returns an error, explain it plainly.
- If the user names copyrighted or franchise characters, swap in original characters with new names and designs
  that share only a broad archetype, and say so in one sentence.
- {ai.SAFETY_RULES}
- Reply in plain conversational text, usually under 90 words. No headings or tables.
- When there's a natural next step, end with one line: [[suggestions: reply 1 | reply 2 | reply 3]] giving 2-3
  short things the user might say next. Leave it out for casual chat or simple answers."""


def context_line(client):
    from datetime import datetime
    from zoneinfo import ZoneInfo

    tz_name = (client or {}).get("timezone") or "UTC"
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz, tz_name = ZoneInfo("UTC"), "UTC"
    now = datetime.now(tz)
    return f"Current date and time for the user: {now:%A, %d %B %Y, %I:%M %p} ({tz_name})."


def build_state(project, org):
    sub = billing.subscription_for(org)
    plan = sub.plan_info
    series = project.series or {}
    outline = series.get("outline") or {}
    stories = services.latest_stories(project)
    videos = services.episode_videos(project)
    count = series.get("episodeCount") or max([*stories, *videos, 0])
    writing = any(t["kind"] == "series" for t in tasks.active_tasks(project))
    episodes = []
    for n in range(1, count + 1):
        st, v = stories.get(n), videos.get(n)
        planned = (outline.get("episodes") or [])[n - 1:n]
        item = {"episode": n, "title": st.title if st else (planned[0]["title"] if planned else ""),
                "written": bool(st), "words": len(st.script.split()) if st else 0}
        if v:
            item["video"] = {"status": v.status, "progress": v.progress, "tier": v.tier,
                             "seconds": round(v.duration_ms / 1000), "voice": v.voice_id, "music": v.music_mood,
                             "captions": v.captions, "error": v.error[:200]}
            if v.status not in services.ACTIVE:
                item["video"]["scenes"] = [
                    {"scene": s.idx + 1, "seconds": round(s.effective_ms / 1000, 1), "narration": s.narration[:90],
                     **({"trimmed": True} if s.trim_start_ms or s.trim_end_ms else {}),
                     **({"sfx": s.sfx_prompt} if s.sfx_prompt else {})}
                    for s in v.scenes.all()
                ]
        episodes.append(item)
    return {
        "credits": sub.credits_balance,
        "plan": {"name": plan["name"], "tiers": plan["tiers"], "maxSecondsPerVideo": plan["max_seconds"]},
        "pricing": {"writePerEpisode": billing.STORY_CREDITS, "renderPer10Seconds": billing.CREDITS_PER_10S,
                    "regenerateScenePer10Seconds": billing.CREDITS_PER_10S, "reRender": billing.REASSEMBLE_CREDITS,
                    "soundEffect": SFX_CREDITS},
        "preferredStylePreset": project.style_preset or None,
        "series": {k: series.get(k) for k in ("title", "premise", "episodeCount", "episodeSeconds")} if series else None,
        "logline": outline.get("logline"),
        "writingInProgress": writing,
        "renderMode": project.render_mode or None,
        "episodes": episodes,
    }


def _history(project):
    msgs = list(project.messages.order_by("-created_at", "-id")[:HISTORY])[::-1]
    out = []
    for m in msgs:
        text = m.content.get("text", "")
        actions = [a.get("label") for a in m.content.get("actions") or [] if a.get("label")]
        if actions:
            text += f"\n(Done this turn: {'; '.join(actions)})"
        out.append({"role": m.role, "content": text})
    return out


def split_suggestions(text):
    m = re.search(r"\[\[\s*suggestions?\s*:(.*?)\]\]", text, re.S | re.I)
    if not m:
        return text.strip(), []
    options = [o.strip() for o in m.group(1).split("|") if o.strip()][:3]
    return (text[:m.start()] + text[m.end():]).strip(), options


def clean_title(title):
    return re.sub(r"^\s*(episode|ep\.?|part)\s*\d+\s*[:\-–—.]\s*", "", title, flags=re.I).strip() or title


def _api_message(e):
    if isinstance(e, InsufficientCredits):
        return f"Not enough credits: this needs {e.needed} and the balance is {e.balance}."
    return tasks._message(e)


class Agent:
    def __init__(self, project, membership, user, client=None):
        self.p, self.org, self.user = project, membership.organization, user
        self.client = client or {}
        self.actions = []
        self.edits = {}
        self.numbering = {}

    def run(self, rep):
        messages, cost, text = _history(self.p), 0.0, ""
        rep.stage("thinking", 10)
        for step in range(MAX_STEPS):
            state = build_state(self.p, self.org)
            system = f"{SYSTEM}\n\n{context_line(self.client)}\n\nProject state (refreshed every turn):\n{json.dumps(state)}"
            out, c = providers.llm().agent(system, messages, TOOLS, state=state)
            cost += c
            if not out["tool_calls"]:
                text = out["content"]
                break
            messages = [*messages, out["raw"]]
            self.numbering = {}
            for call in out["tool_calls"]:
                result = self.call(call["name"], call["arguments"], rep, min(90, 20 + step * 10))
                messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})
            self.p.refresh_from_db()
        else:
            text = "I've done what I could this turn. Tell me what to do next."
        self.flush_edits()
        return (text or "Done."), cost

    def call(self, name, args, rep, progress):
        fn = getattr(self, f"t_{name}", None)
        if not fn:
            return {"ok": False, "error": f"Unknown tool {name}."}
        rep.activity(name.replace("_", " ").capitalize(), progress)
        try:
            return {"ok": True, **(fn(**(args or {})) or {})}
        except TypeError as e:
            return {"ok": False, "error": f"Bad arguments: {e}"}
        except ToolError as e:
            return {"ok": False, "error": str(e)}
        except (APIException, InsufficientCredits, ProviderError) as e:
            return {"ok": False, "error": _api_message(e)}

    def _act(self, kind, label, **extra):
        self.actions.append({"type": kind, "label": label, **extra})

    def _balance(self):
        return billing.subscription_for(self.org).credits_balance

    def _afford(self, credits):
        pending = sum(max(billing.REASSEMBLE_CREDITS, e["credits"]) for e in self.edits.values())
        balance = self._balance()
        if credits + pending > balance:
            raise ToolError(f"Not enough credits: this needs {credits + pending} and the balance is {balance}.")

    def _brief(self):
        series = self.p.series or {}
        b = Brief.objects.filter(project=self.p, pk=series.get("briefId")).first() if series else None
        b = b or self.p.briefs.order_by("-created_at").first()
        if not b:
            raise ToolError("There's no plan yet. Call plan_series first.")
        return b

    def t_plan_series(self, title, premise, episodeCount, episodeSeconds, genre="fantasy", stylePreset="cinematic",
                      aspectRatio="9:16", voiceId="af_heart", musicMood="suspense", narration=True, customStyle=None):
        if not 1 <= int(episodeCount) <= 20:
            raise ToolError("Episode count must be between 1 and 20.")
        try:
            brief = CreativeBrief.model_validate({
                "stylePreset": stylePreset, "customStyle": customStyle, "idea": premise, "genre": genre,
                "aspectRatio": aspectRatio, "targetSeconds": int(episodeSeconds), "voiceId": voiceId,
                "musicMood": musicMood, "narration": narration,
            })
        except PydanticError as e:
            raise ToolError(f"Invalid plan: {e.errors(include_url=False)[0]['msg']}")
        ai.moderate(f"{title} {premise} {customStyle or ''}")
        plan = billing.subscription_for(self.org).plan_info
        if brief.targetSeconds > plan["max_seconds"]:
            raise ToolError(f"The {plan['name']} plan allows episodes up to {plan['max_seconds']} seconds.")
        b = services.create_brief(self.p, brief)
        self.p.series = {"title": title[:200], "premise": premise, "episodeCount": int(episodeCount),
                         "episodeSeconds": brief.targetSeconds, "briefId": b.id}
        self.p.title = title[:200]
        self.p.save(update_fields=["series", "title", "updated_at"])
        n = int(episodeCount)
        self._act("plan", f"Planned {n} episode{'s' if n > 1 else ''} of {brief.targetSeconds}s")
        return {"writeCost": n * billing.STORY_CREDITS, "credits": self._balance()}

    def t_write_episodes(self, episodes=None):
        series = self.p.series or {}
        if not series:
            raise ToolError("There's no plan yet. Call plan_series first.")
        if any(t["kind"] == "series" for t in tasks.active_tasks(self.p)):
            raise ToolError("Episodes are already being written.")
        total = series["episodeCount"]
        nums = sorted({int(n) for n in episodes}) if episodes else list(range(1, total + 1))
        if any(n < 1 or n > total for n in nums):
            raise ToolError(f"Episodes are numbered 1 to {total}.")
        self._afford(len(nums) * billing.STORY_CREDITS)
        brief, stamp = self._brief(), int(time.time() * 1000)
        entries = {n: billing.charge(self.org, Action.STORY_GENERATE, billing.STORY_CREDITS,
                                     f"episode-story:{self.p.id}:{n}:{stamp}", note=f"Episode {n} story")
                   for n in nums}
        fresh = not episodes or not series.get("outline")
        project = self.p
        task = tasks.start(project, "series", lambda rep: write_series(rep, project, brief, nums, entries, fresh))
        self._act("writing", f"Writing {len(nums)} episode{'s' if len(nums) > 1 else ''}", taskId=task.id)
        return {"started": True, "episodes": nums}

    def t_rewrite_episode(self, episode, instruction):
        story = services.latest_stories(self.p).get(int(episode))
        if not story:
            raise ToolError(f"Episode {episode} isn't written yet.")
        ai.moderate(instruction)
        self._afford(billing.STORY_CREDITS)
        key = f"rewrite:{story.id}:{int(time.time() * 1000)}"
        entry = billing.charge(self.org, Action.STORY_GENERATE, billing.STORY_CREDITS, key,
                               note=f"Episode {episode} rewrite")
        outline = (self.p.series or {}).get("outline")
        try:
            if outline and int(episode) <= len(outline["episodes"]):
                out, cost = ai.write_episode(story.brief.raw, outline, int(episode), story_dto(story), instruction)
            else:
                out, cost = ai.write_story(story.brief.raw, story_dto(story), instruction)
            ai.moderate(f"{out.title} {out.script}")
        except Exception:
            billing.refund(entry, "Refund: rewrite failed")
            raise
        data = {**out.model_dump(), "title": clean_title(out.title)}
        new = services.save_story(self.p, story.brief, data, "rewrite", episode=story.episode, synopsis=story.synopsis)
        billing.add_cost(key, cost)
        self._act("rewrite", f"Rewrote episode {episode}")
        return {"title": new.title, "words": len(new.script.split())}

    def t_render_episodes(self, mode="all", tier=None, episodes=None):
        series = self.p.series or {}
        stories = services.latest_stories(self.p)
        total = series.get("episodeCount") or max(stories, default=0)
        if not total:
            raise ToolError("Nothing is written yet.")
        tier = tier or self.p.render_tier or "lite"
        latest = services.episode_videos(self.p)
        open_eps = [n for n in range(1, total + 1) if n not in latest or latest[n].status == VideoStatus.FAILED]
        if episodes:
            nums = sorted({int(n) for n in episodes})
        else:
            nums = open_eps[:1] if mode == "one_by_one" else open_eps
        if not nums:
            raise ToolError("Every episode already has a video. Name the episodes to render again.")
        busy = [n for n in nums if n in latest and latest[n].status in services.ACTIVE]
        if busy:
            raise ToolError(f"Episode {busy[0]} is already rendering.")
        missing = [n for n in nums if n not in stories]
        if missing:
            raise ToolError(f"Episode {missing[0]} isn't written yet.")
        seconds = stories[nums[0]].brief.target_seconds
        services.check_plan(self.org, tier, seconds)
        cost = sum(billing.video_credits(tier, stories[n].brief.target_seconds) for n in nums)
        self._afford(cost)
        for n in nums:
            services.create_video(self.org, self.user, stories[n], tier, wait=True)
        self.p.render_mode, self.p.render_tier = mode, tier
        self.p.save(update_fields=["render_mode", "render_tier", "updated_at"])
        services.kick(self.org.id)
        label = f"episode {nums[0]}" if len(nums) == 1 else f"episodes {nums[0]}-{nums[-1]}"
        self._act("render", f"Started rendering {label} ({tier})", episodes=nums)
        return {"episodes": nums, "creditsCharged": cost, "creditsLeft": self._balance()}

    def t_retry_episode(self, episode):
        v = services.episode_videos(self.p).get(int(episode))
        if not v or v.status != VideoStatus.FAILED:
            raise ToolError(f"Episode {episode} has no failed video to retry.")
        failed = v.jobs.filter(status="failed").order_by("-id").first()
        credits = billing.REASSEMBLE_CREDITS if failed and failed.step == "assembling" else \
            billing.video_credits(v.tier, v.story.brief.target_seconds)
        self._afford(credits)
        key = f"retry:{v.id}:{int(time.time() * 1000)}"
        billing.charge(self.org, Action.VIDEO_RENDER, credits, key, video_id=v.id, note=f"Retry episode {episode}")
        jobs.retry(v, charge_key=key)
        self._act("render", f"Retrying episode {episode}", episodes=[int(episode)])
        return {"creditsCharged": credits}

    def t_get_episode(self, episode):
        n = int(episode)
        story = services.latest_stories(self.p).get(n)
        v = services.episode_videos(self.p).get(n)
        if not story:
            raise ToolError(f"Episode {episode} isn't written yet.")
        data = {"title": story.title, "synopsis": story.synopsis, "script": story.script,
                "characters": story.characters}
        if v:
            data["video"] = {"status": v.status, "styleGuide": v.style_guide, "scenes": [
                {"scene": s.idx + 1, "seconds": round(s.effective_ms / 1000, 1), "narration": s.narration,
                 "caption": s.caption_text, "imagePrompt": s.image_prompt, "motionPrompt": s.motion_prompt,
                 "characters": s.characters, "cutStartSeconds": s.trim_start_ms / 1000,
                 "cutEndSeconds": s.trim_end_ms / 1000, "soundEffect": s.sfx_prompt}
                for s in v.scenes.all()]}
        return data

    def _video(self, episode):
        v = services.episode_videos(self.p).get(int(episode))
        if not v:
            raise ToolError(f"Episode {episode} has no video yet.")
        if v.status in services.ACTIVE and v.id not in self.edits:
            raise ToolError(f"Episode {episode} is still rendering. Edit it once it's finished.")
        if not v.scenes.exists():
            raise ToolError(f"Episode {episode} has no scenes to edit yet.")
        self.numbering.setdefault(v.id, list(v.scenes.order_by("idx").values_list("pk", flat=True)))
        return v

    def _scene(self, v, number):
        """Scene numbers in one batch of tool calls refer to the order before that batch, even after moves."""
        pks = self.numbering.get(v.id) or list(v.scenes.order_by("idx").values_list("pk", flat=True))
        n = int(number)
        if not 1 <= n <= len(pks):
            raise ToolError(f"That episode has {len(pks)} scenes; there's no scene {number}.")
        s = Scene.objects.filter(pk=pks[n - 1]).first()
        if not s:
            raise ToolError(f"Scene {number} was already deleted.")
        return s

    def _edit(self, v, note, credits=0, usd=0.0):
        self._afford(credits)
        e = self.edits.setdefault(v.id, {"credits": 0, "usd": 0.0, "notes": [], "episode": v.story.episode})
        e["credits"] += credits
        e["usd"] += usd
        e["notes"].append(note)

    def t_edit_scene(self, episode, scene, imagePrompt=None, motionPrompt=None, narration=None):
        v = self._video(episode)
        s = self._scene(v, scene)
        if not (imagePrompt or motionPrompt or narration):
            raise ToolError("Give a new imagePrompt, motionPrompt or narration.")
        credits = billing.video_credits(v.tier, s.duration_ms / 1000)
        self._afford(credits)
        if imagePrompt:
            ai.moderate(imagePrompt)
            s.image_prompt = imagePrompt
        if motionPrompt:
            s.motion_prompt = motionPrompt
        narration = (narration or "").strip()
        if narration and narration != s.narration:
            ai.moderate(narration)
            s.narration, s.audio_url, s.words, s.caption_text = narration, "", [], ""
            s.trim_start_ms = s.trim_end_ms = 0
        s.keyframe_url = s.keyframe_remote_url = s.clip_url = ""
        s.save()
        self._edit(v, f"regenerated scene {scene}", credits)
        return {"creditsCharged": credits}

    def t_edit_caption(self, episode, scene, text):
        v = self._video(episode)
        s = self._scene(v, scene)
        ai.moderate(text)
        s.caption_text = text.strip()
        s.save(update_fields=["caption_text"])
        self._edit(v, f"new caption on scene {scene}")

    def t_trim_scene(self, episode, scene, cutStartSeconds=0, cutEndSeconds=0):
        v = self._video(episode)
        s = self._scene(v, scene)
        start, end = int(max(0, float(cutStartSeconds or 0)) * 1000), int(max(0, float(cutEndSeconds or 0)) * 1000)
        if s.duration_ms - start - end < 1000:
            raise ToolError(f"Scene {scene} is {s.duration_ms / 1000:.1f}s; at least 1 second has to remain. "
                            "Delete the scene instead to remove it.")
        s.trim_start_ms, s.trim_end_ms = start, end
        s.save(update_fields=["trim_start_ms", "trim_end_ms"])
        self._edit(v, f"trimmed scene {scene}")
        return {"sceneSeconds": round(s.effective_ms / 1000, 1)}

    def _reorder(self, v, ordered):
        Scene.objects.filter(video=v).update(idx=F("idx") + 1000)
        for i, s in enumerate(ordered):
            Scene.objects.filter(pk=s.pk).update(idx=i)

    def t_delete_scene(self, episode, scene):
        v = self._video(episode)
        s = self._scene(v, scene)
        if v.scenes.count() <= 1:
            raise ToolError("An episode needs at least one scene.")
        s.delete()
        self._reorder(v, list(v.scenes.order_by("idx")))
        self._edit(v, f"deleted scene {scene}")
        return {"scenesLeft": v.scenes.count()}

    def t_move_scene(self, episode, scene, position):
        v = self._video(episode)
        s = self._scene(v, scene)
        ordered = [x for x in v.scenes.order_by("idx") if x.pk != s.pk]
        pos = min(max(1, int(position)), len(ordered) + 1)
        ordered.insert(pos - 1, s)
        self._reorder(v, ordered)
        self._edit(v, f"moved scene {scene} to {pos}")

    def t_insert_scene(self, episode, position, narration, imagePrompt, motionPrompt=""):
        v = self._video(episode)
        narration, imagePrompt = narration.strip(), imagePrompt.strip()
        if not narration or not imagePrompt:
            raise ToolError("A new scene needs narration and an imagePrompt.")
        ai.moderate(f"{narration} {imagePrompt}")
        seconds = min(10, max(2, len(narration.split()) / WORDS_PER_SECOND))
        credits = billing.video_credits(v.tier, seconds)
        self._afford(credits)
        guide = v.style_guide or ""
        prompt = imagePrompt if not guide or guide[:40].lower() in imagePrompt.lower() else f"{guide}. {imagePrompt}"
        names = [c["name"] for c in v.story.characters if c["name"].lower() in f"{narration} {imagePrompt}".lower()]
        ordered = list(v.scenes.order_by("idx"))
        pos = min(max(1, int(position)), len(ordered) + 1)
        new = Scene.objects.create(video=v, idx=10000, narration=narration, duration_ms=int(seconds * 1000),
                                   shot=narration[:120], camera="slow push in", characters=names, image_prompt=prompt,
                                   motion_prompt=motionPrompt or "slow push in, gentle natural motion")
        ordered.insert(pos - 1, new)
        self._reorder(v, ordered)
        self._edit(v, f"added a scene at {pos}", credits)
        return {"creditsCharged": credits, "scenes": len(ordered)}

    def t_add_sound_effect(self, episode, scene, description=""):
        v = self._video(episode)
        s = self._scene(v, scene)
        description = (description or "").strip()
        if not description:
            s.sfx_prompt = s.sfx_url = ""
            s.save(update_fields=["sfx_prompt", "sfx_url"])
            self._edit(v, f"removed the sound effect on scene {scene}")
            return {}
        ai.moderate(description)
        self._afford(SFX_CREDITS)
        dest = video_dir(v.id) / f"sfx_{s.idx}_{secrets.token_hex(3)}.wav"
        path, usd = providers.sfx().generate(description, s.effective_ms / 1000, dest)
        s.sfx_prompt, s.sfx_url = description[:300], public_url(path)
        s.save(update_fields=["sfx_prompt", "sfx_url"])
        self._edit(v, f"sound effect on scene {scene}", SFX_CREDITS, usd)
        return {"creditsCharged": SFX_CREDITS}

    def t_set_audio(self, episodes=None, voiceId=None, musicMood=None, captions=None):
        if voiceId and voiceId not in {v["id"] for v in VOICES}:
            raise ToolError("Unknown voice.")
        if musicMood and musicMood not in MUSIC_MOODS:
            raise ToolError("Unknown music mood.")
        if voiceId is None and musicMood is None and captions is None:
            raise ToolError("Say what to change: voiceId, musicMood or captions.")
        latest = services.episode_videos(self.p)
        nums = sorted({int(n) for n in episodes}) if episodes else \
            [n for n, v in latest.items() if v.status == VideoStatus.READY]
        if not nums:
            raise ToolError("No finished episodes to change yet.")
        changed = []
        for n in nums:
            v = self._video(n)
            if voiceId and voiceId != v.voice_id:
                v.voice_id = voiceId
                v.scenes.update(audio_url="", words=[], trim_start_ms=0, trim_end_ms=0)
            if musicMood:
                v.music_mood = musicMood
            if captions is not None:
                v.captions = bool(captions)
            v.save(update_fields=["voice_id", "music_mood", "captions", "updated_at"])
            parts = [p for p, on in [("voice", voiceId), ("music", musicMood), ("captions", captions is not None)] if on]
            self._edit(v, f"new {' and '.join(parts)}")
            changed.append(n)
        return {"episodes": changed}

    def flush_edits(self):
        for vid, e in self.edits.items():
            v = Video.objects.get(pk=vid)
            scenes = list(v.scenes.all())
            if any(not s.keyframe_url for s in scenes):
                step = "keyframes"
            elif any(not s.audio_url for s in scenes):
                step = "voice"
            else:
                step = "assembling"
            credits = max(billing.REASSEMBLE_CREDITS, e["credits"])
            key = f"edit:{v.id}:{int(time.time() * 1000)}"
            action = Action.VIDEO_REASSEMBLE if step == "assembling" and not e["credits"] else Action.SCENE_REGENERATE
            billing.charge(self.org, action, credits, key, video_id=v.id,
                           note=f"Episode {e['episode']}: {', '.join(e['notes'])}"[:255])
            billing.add_cost(key, e["usd"])
            Video.objects.filter(pk=v.pk).update(status=VideoStatus.QUEUED, error="",
                                                 progress=80 if step == "assembling" else 15)
            jobs.enqueue(v, step, chain=step != "assembling", charge_key=key)
            self._act("edit", f"Episode {e['episode']}: {', '.join(e['notes'])}", videoId=v.id,
                      episode=e["episode"])
        self.edits = {}


def write_series(rep, project, brief, nums, entries, fresh):
    project.refresh_from_db()
    series = dict(project.series)
    total = series["episodeCount"]
    try:
        if fresh or not series.get("outline"):
            rep.update("outline", 5, total=len(nums), done=[])
            out, cost = ai.series_outline(brief.raw, series)
            outline = out.model_dump()
            for ep in outline["episodes"]:
                ep["title"] = clean_title(ep["title"])
            outline["episodes"] = (outline["episodes"] + [
                {"title": f"Episode {i + 1}", "synopsis": "The story continues."} for i in range(total)
            ])[:total]
            ai.moderate(json.dumps(outline))
            series["outline"] = outline
            series["title"] = outline["title"][:200]
            Project.objects.filter(pk=project.pk).update(series=series, title=outline["title"][:200])
    except Exception:
        for entry in entries.values():
            billing.refund(entry, "Refund: series planning failed")
        raise
    outline = series["outline"]
    rep.update("episodes", 12, total=len(nums), done=[], outline=outline)
    done, failed = [], []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(ai.write_episode, brief.raw, outline, n): n for n in nums}
        for fut in as_completed(futures):
            n = futures[fut]
            try:
                out, cost = fut.result()
                ai.moderate(f"{out.title} {out.script}")
                data = {**out.model_dump(), "characters": outline["characters"]}
                data["title"] = clean_title(data["title"])
                synopsis = outline["episodes"][n - 1]["synopsis"]
                story = services.save_story(project, brief, data, "generated", episode=n, synopsis=synopsis)
                entries[n].story_id = story.id
                entries[n].save(update_fields=["story_id"])
                billing.add_cost(entries[n].idempotency_key, cost)
                done.append(n)
            except Exception:
                billing.refund(entries[n], f"Refund: episode {n} failed")
                failed.append(n)
            rep.update("episodes", 12 + int(85 * (len(done) + len(failed)) / len(nums)), done=sorted(done),
                       failed=sorted(failed))
    project.refresh_from_db()
    _announce_written(project, brief, sorted(done), sorted(failed))
    return {"done": sorted(done), "failed": sorted(failed)}


def _announce_written(project, brief, done, failed):
    series = project.series
    total = series["episodeCount"]
    if not done:
        text = "I couldn't write the episodes this time, and your credits were refunded. Want me to try again?"
        suggestions = ["Try again"]
    else:
        per = billing.video_credits(project.render_tier or "lite", brief.target_seconds)
        what = f"All {total} episodes" if len(done) == total and total > 1 else (
            "The story" if total == 1 else f"Episode{'s' if len(done) > 1 else ''} {', '.join(map(str, done))}")
        text = (f"{what} of \"{series['title']}\" {'are' if len(done) > 1 else 'is'} written. Read them on the "
                f"right. Shall I start making the video{'s' if len(done) > 1 else ''}? On the lite tier that's "
                f"{per} credit{'s' if per != 1 else ''} per episode ({per * len(done)} total).")
        if failed:
            text += f" Episode{'s' if len(failed) > 1 else ''} {', '.join(map(str, failed))} failed and were refunded."
        suggestions = (["Yes, make all episodes", "One at a time", "Rewrite episode 1"] if len(done) > 1
                       else ["Yes, make the video", "Rewrite it first"])
    msg = ChatMessage.objects.create(project=project, role="assistant",
                                     content={"text": text, "suggestions": suggestions})
    Project.objects.filter(pk=project.pk).update(updated_at=msg.created_at)
