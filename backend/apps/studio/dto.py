def brief_dto(b):
    return {"id": b.id, "projectId": b.project_id, **b.raw, "createdAt": b.created_at}


def message_dto(m):
    return {"id": m.id, "role": m.role, "text": m.content.get("text", ""), "brief": m.content.get("brief"),
            "createdAt": m.created_at}


def story_dto(s):
    return {
        "id": s.id, "projectId": s.project_id, "briefId": s.brief_id, "version": s.version, "title": s.title,
        "logline": s.logline, "hook": s.hook, "script": s.script, "characters": s.characters,
        "estimatedSeconds": s.estimated_seconds, "status": s.status, "source": s.source, "createdAt": s.created_at,
    }


def scene_dto(s):
    return {
        "id": s.id, "idx": s.idx, "narration": s.narration, "captionText": s.caption_text,
        "durationMs": s.duration_ms, "shot": s.shot, "camera": s.camera, "characters": s.characters,
        "imagePrompt": s.image_prompt, "motionPrompt": s.motion_prompt, "keyframeUrl": s.keyframe_url,
        "clipUrl": s.clip_url, "audioUrl": s.audio_url, "status": s.status,
    }


def video_dto(v, scenes=False):
    brief = v.story.brief
    data = {
        "id": v.id, "projectId": v.project_id, "storyId": v.story_id, "storyVersion": v.story.version,
        "title": v.story.title, "tier": v.tier, "aspectRatio": v.aspect_ratio, "stylePreset": brief.style_preset,
        "status": v.status, "progress": v.progress, "outputUrl": v.output_url, "thumbnailUrl": v.thumbnail_url,
        "durationMs": v.duration_ms, "voiceId": v.voice_id, "musicMood": v.music_mood, "captions": v.captions,
        "costUsd": float(v.cost_usd), "error": v.error, "createdAt": v.created_at, "updatedAt": v.updated_at,
    }
    if scenes:
        data["scenes"] = [scene_dto(s) for s in v.scenes.all()]
        data["references"] = v.references
    return data


def project_dto(p, detail=False):
    data = {"id": p.id, "title": p.title, "stylePreset": p.style_preset, "createdAt": p.created_at,
            "updatedAt": p.updated_at}
    latest = p.videos.order_by("-created_at").first()
    data["latestVideo"] = {"id": latest.id, "status": latest.status, "thumbnailUrl": latest.thumbnail_url} if latest else None
    if detail:
        data["messages"] = [message_dto(m) for m in p.messages.all()]
        data["briefs"] = [brief_dto(b) for b in p.briefs.order_by("-created_at")]
        data["stories"] = [story_dto(s) for s in p.stories.all()]
        data["videos"] = [video_dto(v) for v in p.videos.select_related("story__brief").order_by("-created_at")]
    return data
