# Postlume

AI content studio: chat with an AI director, approve a story, and render it into a finished video.
Phase 1 per [requirements.md](requirements.md), with a Django backend and a Next.js frontend.

```text
browser ──▶ frontend (Next.js 16, :8020) ──proxy /api, /media──▶ backend (Django + DRF, :8000)
                                                                   │  SQLite (db.sqlite3)
                                                                   └─ jobs table ──▶ worker (manage.py runworker)
                                                                        LLM / image / video / TTS providers + FFmpeg
```

## Quick start

Needs Python 3.12+, [uv](https://docs.astral.sh/uv/), Node 20+ and pnpm. FFmpeg ships with the
`imageio-ffmpeg` package, so no Homebrew install is needed. A system `ffmpeg` on your PATH is used if present.

```bash
./setup.sh      # venv, dependencies, backend/.env, migrations, pnpm install
./dev.sh        # Django :8000 + render worker + Next.js :8020  (PORT=8021 ./dev.sh to change)
```

Sign-ups are off by default, so for a new local account add `SIGNUP_ENABLED=true` to `backend/.env` first. Open http://localhost:8020/signup, create an account, and make a video. By default every provider is `fake`, so the whole
pipeline (chat → brief → story → scenes → keyframes → voice → captions → MP4) runs offline for $0 with
placeholder images and silent narration.

## Deploying

See [DEPLOY.md](DEPLOY.md) for Railway: two services (frontend + backend) built from their Dockerfiles,
with a volume for SQLite and videos.

## Switching to real AI providers

Edit `backend/.env`:

| Setting | Values | Notes |
|---|---|---|
| `LLM_PROVIDER` | `fake` / `openrouter` | Needs `OPENROUTER_API_KEY`. `LLM_CHAT_MODEL` handles chat; `LLM_STORY_MODEL` writes the story and scene plan. Pick models that support structured outputs. `LLM_BASE_URL` also accepts any OpenAI-compatible endpoint, such as Ollama. |
| `IMAGE_PROVIDER` | `fake` / `fal` | Needs `FAL_KEY`. FLUX schnell for keyframes; Seedream edit when character references exist. |
| `VIDEO_PROVIDER` | `fake` / `fal` | Used only for the Standard and Premium tiers. Lite always uses FFmpeg pan & zoom. |
| `TTS_PROVIDER` | `fake` / `fal` | Kokoro TTS, plus Whisper for word timestamps (captions). |

fal model ids change often, so check each one on fal.ai before switching. Rough provider costs are logged
per job and shown on the Billing page (`COST_*` settings).

Music: drop royalty-free tracks named by mood (e.g. `calm.mp3`) into `backend/assets/music/`. The voice
ducks the music automatically.

## What's included

- **Auth & orgs**: email/password sessions, organizations, roles (owner/admin/creator/viewer),
  invite links, and an org switcher.
- **Connections**: OAuth connect, disconnect and token refresh for Instagram (Business Login), Facebook
  Pages and YouTube. Tokens are Fernet-encrypted at rest. Refresh with `python manage.py refresh_social_tokens` (cron).
- **Director chat**: style presets, a structured Creative Brief, and an editable brief form.
- **Stories**: generate, edit, AI rewrite with an instruction, regenerate, version history and restore, approve.
- **Render pipeline**: idempotent jobs (planning → references → keyframes → clips → voice → assembling)
  with 3 retries and backoff. A failure keeps finished scenes, and Retry resumes from the failed step.
- **Editing after render**: regenerate one scene, change voice, music or captions, edit caption text,
  then re-assemble without redoing other scenes.
- **Library**: filters, player, download, "make another like this", delete.
- **Credits**: per-action charges with idempotency keys, automatic refunds on failure, plan gates by tier
  and length, a demo plan switch, a usage ledger, and provider-cost tracking.
- **Safety**: copyrighted-character blocklist on prompts and outputs, plus safety rules in every LLM prompt.

## Tests

```bash
cd backend && .venv/bin/python manage.py test tests
```

These run the full flow with fake providers and real FFmpeg: render, scene regenerate, failure refund +
retry, idempotent charging, plan gates, moderation, org isolation and roles, and token encryption.

## Not done yet

- Streaming chat responses (replies arrive whole).
- "Continue with Google" login.
- Email delivery for invites (copy the link from the Team page).
- Publishing and scheduling (Phase 2) and Autopilot (Phase 3).
- Object storage (S3/R2) for media. Videos live on the backend volume for now.
