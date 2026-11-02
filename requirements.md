# Taleloop — Requirements & Phase 1 Plan

> AI content studio: connect Instagram, Facebook and YouTube, chat with an AI to pick a video style (or write your own prompt), get a strong story, and turn that story into a finished video. Publishing and scheduling come in Phase 2.

- **Domain:** taleloop.ai (taleloop.com is taken)
- **Status:** planning
- **Date:** 2026-10-27

---

## 1. Product overview

### Core loop
1. **Connect** Instagram, Facebook Page and YouTube channel (OAuth).
2. **Chat** with the AI director: choose a video type (animated, cartoon, 2D, cinematic/movie-style, etc.), length, aspect ratio and tone, or type a free-form prompt.
3. **Story**: the AI writes a story. The user reads it, edits it, or asks for changes in chat, then approves it.
4. **Video**: the approved story is split into scenes, and each scene is rendered (visuals, voiceover, music, captions). The scenes are stitched into one MP4.
5. *(Phase 2)* **Publish / schedule** to the connected accounts. *(Phase 3)* **Autopilot**: a recurring series that generates and posts on a schedule.

### Who it's for
Faceless-channel creators, small brands, and kids/storytelling channels: anyone who wants a steady stream of short story videos without filming or editing.

### Phase 1 scope
| In | Out (later phases) |
|---|---|
| Accounts, organizations, OAuth connection to IG / FB / YT (store tokens, show connected status) | Actually posting/scheduling to the platforms (Phase 2) |
| AI chat with style presets + custom prompt | Autopilot series, analytics (Phase 3) |
| Story generation + editing + approval | Long-form (> 3 min) "movies" |
| Story → scene plan → rendered video (9:16 and 16:9) | Lip-synced talking characters, custom voice cloning |
| Video library, preview, download | Team collaboration features beyond basic roles |
| Credit metering per generation | Payment provider checkout (use a demo plan switch, as mergedguard does) |

Connecting accounts is included in Phase 1 because it is cheap to build and starts the long Meta/Google app review early (see §8).

---

## 2. Architecture (same pattern as mergedguard)

The frontend and backend are fully separated. Three independently deployable services plus a shared contract package:

```text
browser ──HTTP──▶ apps/web (Next.js 15, Vercel)        UI only, NEXT_PUBLIC_API_URL
browser ──HTTP──▶ apps/api (Fastify 5, Railway)        owns DB, auth, OAuth tokens, LLM, credits, secrets
                      │
                      └──job queue──▶ apps/worker (Node + FFmpeg, Railway)  ──callback──▶ apps/api
                                         calls image/video/TTS providers, assembles MP4,
                                         uploads to Supabase Storage
```

- **`packages/shared`**: Zod schemas, types and DTOs, the only code shared between web and api.
- **`apps/web`**: Next.js 15 App Router, Tailwind, Lucide. No secrets, no SDKs, and every call goes through `lib/api.ts`.
- **`apps/api`**: Fastify 5 + TypeScript. Supabase (service role), auth (Supabase Auth brokered by the API with an httpOnly session cookie), OAuth for social platforms, LLM story planner, credit billing.
- **`apps/worker`**: long-running render jobs (minutes, not seconds). It pulls jobs from a queue, calls the generation providers, runs FFmpeg, uploads the results and reports progress to the API.
- **Queue**: Postgres-backed (`pg-boss` or a `jobs` table with `for update skip locked`), so Phase 1 needs no extra infrastructure. Move to Redis/BullMQ if throughput needs it.
- **Storage**: Supabase Storage buckets `story-assets` (keyframes, clips, audio) and `videos` (final MP4s + thumbnails), served through signed URLs.
- **Realtime progress**: the web app polls `GET /v1/videos/:id` while a render is in flight (mergedguard's polling pattern), with Server-Sent Events as an optional upgrade.

### Reuse from mergedguard
Copy the patterns rather than the code: Supabase Auth brokered by the API, `mg_session`-style cookie sessions, organizations and roles, `BillingService.charge()` with idempotency keys and refunds, Repository interface + Memory/Supabase implementations, and `node:test` + `fastify.inject` tests with fake providers.

---

## 3. Feature requirements (Phase 1)

### 3.1 Auth & organizations
- Email + password and "Continue with Google" (Google login also pairs naturally with YouTube).
- Organizations with roles: owner, admin, creator (generate), viewer.
- Onboarding wizard: create an organization → connect accounts (skippable) → first video.

### 3.2 Connect social accounts
| Platform | Login | Scopes requested in Phase 1 | Notes |
|---|---|---|---|
| **Facebook Page** | Facebook Login | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` | Store the **Page** access token (long-lived). Personal profiles and groups can't be posted to. |
| **Instagram** | Instagram API with Instagram Login | `instagram_business_basic`, `instagram_business_content_publish` | Business/Creator accounts only, and no Facebook Page is required. Personal accounts are not supported. |
| **YouTube** | Google OAuth | `youtube.upload`, `youtube.readonly` | Store the refresh token. |

- Tokens are encrypted at rest (AES-GCM with a key in `apps/api/.env`, or Supabase Vault) and never returned to the web app.
- A refresh job renews tokens before expiry. If an account's token is revoked, it shows as "Reconnect needed".
- Each connected account shows its avatar, handle, platform and status. Users can disconnect.
- An OAuth `state` cookie is checked on callback (same pattern as mergedguard's `mg_gh_flow`).

### 3.3 AI chat (the "director")
- A chat UI with a **style picker** above the input. Users can click presets or just type.
- **Presets** (each one maps to a prompt template + visual style guide + model choice):
  - 3D animated (Pixar-like look, original characters only)
  - Cartoon (bold outlines, bright flat colors)
  - 2D anime
  - Cinematic / movie-style (live-action look, film grading)
  - Watercolor / storybook (kids)
  - Comic / motion-comic
  - Realistic documentary
  - *Custom*: a free-text style description
- **Parameters** collected through chat or controls: genre (horror, motivational, kids, history, sci-fi, comedy, facts), target platform → aspect ratio (9:16 Reels/Shorts, 16:9 YouTube, 1:1), length (15s / 30s / 60s / 90s / up to 3 min), narration on/off, voice, language, music mood.
- The assistant asks clarifying questions only when something important is missing, then produces a **Creative Brief** (structured, validated by Zod) that the user confirms.
- Chat history is saved per project. The user can go back and re-brief.

### 3.4 Story generation
- Input: the confirmed Creative Brief.
- Output (structured output, `StorySchema`): title, logline, hook (first 3 seconds), characters (name, look, personality, a fixed **visual description** reused in every scene for consistency), full narration script, and estimated duration.
- The story is shown in an editor. The user can edit the text directly, ask the AI to rewrite it ("make it scarier", "shorter hook"), regenerate it, or approve it.
- Version history: every revision is kept, and users can restore an earlier one.
- Safety: refuse or soften stories involving real people in harmful situations, sexual content involving minors, or copyrighted characters ("in the style of a movie" is fine; "Spider-Man" is not). Run a moderation pass on both the prompt and the output.

### 3.5 Story → video
Pipeline (each step is a job, so a failure retries that step instead of the whole video):

1. **Scene planning** (LLM, `ScenePlanSchema`): split the script into 4–20 scenes. Each scene has its narration text, duration, shot description, camera move, characters present, and an image prompt plus a motion prompt that both embed the global style guide and the character descriptions.
2. **Character & style references**: generate one reference image per main character, plus one style frame. These are fed into every later image generation (as reference/consistency inputs) so the characters look the same from scene to scene.
3. **Keyframes**: one image per scene (text-to-image with the character references). The user can preview them and regenerate single scenes before spending on video (optional "storyboard review" step).
4. **Clips**: image-to-video for each scene (5–10 s clips). For lower-cost tiers, use a Ken Burns pan/zoom over the keyframe via FFmpeg instead (no video model cost).
5. **Voiceover**: TTS for the narration, one file per scene, with word timestamps used for captions.
6. **Music**: royalty-free library track by mood (Phase 1), or AI-generated music later.
7. **Assembly** (FFmpeg, or Remotion if templated overlays get complex): fit clip lengths to the voiceover, transitions, burned-in animated captions, music ducked under the voice, intro hook text, and an end card. Export H.264 MP4 at 1080×1920 or 1920×1080, plus a thumbnail.
8. **Delivery**: upload to Storage, mark the video `ready`, notify (in-app and email later).

Progress shown to the user: `queued → planning → references → keyframes → clips → voice → assembling → ready` (or `failed` with a "retry" button that refunds/recharges correctly).

Editing after render (Phase 1, minimal): regenerate a single scene, change the voice, swap the music, edit caption text, then re-assemble without regenerating the other scenes.

### 3.6 Library
- A grid of videos with status, style, duration and platform format.
- Preview player, download MP4, duplicate ("make another like this"), delete.
- Each video links back to its chat, brief and story version.

### 3.7 Credits & billing
- Every generation goes through `BillingService.charge(action)`, with idempotency keys and automatic refund on failures on our side (same rules as mergedguard).
- Suggested costing: story generation is cheap (count it inside the video charge or give it a small free allowance), and video credits scale with **seconds × tier**:
  - *Lite* (keyframes + pan/zoom): 1 credit per 10 s
  - *Standard* (image-to-video clips): 5 credits per 10 s
  - *Premium* (top video model, higher resolution): 10+ credits per 10 s
- Regenerating one scene costs only that scene.
- Track the real provider cost per job (`estimated_cost_usd`) in the ledger from day one, because video generation is the main cost of the business.

---

## 4. Generation providers (pluggable)

Each provider sits behind an interface (`ImageProvider`, `VideoProvider`, `TtsProvider`, `LlmProvider`), so models can be swapped as prices and quality change. Using an aggregator (e.g. fal.ai or Replicate) for image and video gives one API key and many models.

| Job | Default (to evaluate in a spike) | Alternatives |
|---|---|---|
| Chat, story, scene planning | Claude (`claude-sonnet-5-5`; `claude-opus-5-5` for premium stories) with structured outputs | Any LLM behind `LlmProvider` |
| Images / keyframes | A model that supports character reference images (via fal.ai) | Flux family, Ideogram, Google Imagen, OpenAI images |
| Image → video | Via fal.ai / Replicate: Kling, Runway, Luma, Google Veo, etc. | Direct vendor APIs once volume justifies it |
| Voiceover | ElevenLabs | OpenAI TTS, Google TTS, Azure |
| Music | Licensed royalty-free library | Suno/Udio-style APIs (check licensing for commercial use) |
| Assembly | FFmpeg (in the worker image) | Remotion |

**Spike before committing:** generate the same 30-second story in 3 styles with 2–3 video models, and compare character consistency, quality, render time and **cost per finished minute**. Pick the defaults based on those numbers.

---

## 5. Data model (Supabase, first migration)

```sql
organizations, memberships, invitations          -- as in mergedguard
social_accounts (
  id, organization_id, platform check in ('instagram','facebook','youtube'),
  external_id, handle, display_name, avatar_url,
  access_token_enc, refresh_token_enc, token_expires_at, scopes text[],
  status check in ('active','needs_reconnect','disconnected'), created_at
)
projects (id, organization_id, created_by, title, created_at)          -- one chat thread
chat_messages (id, project_id, role, content jsonb, created_at)
briefs (id, project_id, style_preset, custom_style, genre, aspect_ratio,
        target_seconds, language, voice_id, music_mood, narration bool, raw jsonb)
stories (id, project_id, brief_id, version int, title, logline, script,
         characters jsonb, status check in ('draft','approved'), created_at)
videos (id, project_id, story_id, tier, aspect_ratio, status, progress int,
        output_url, thumbnail_url, duration_ms, error, created_at)
scenes (id, video_id, idx, narration, duration_ms, image_prompt, motion_prompt,
        keyframe_url, clip_url, audio_url, status)
render_jobs (id, video_id, scene_id null, step, status, attempts, provider,
             provider_job_id, cost_usd, error, run_after, created_at)
subscriptions, usage_ledger                          -- as in mergedguard, with action types below
```

Turn on RLS for every table: members can read their organization's rows, and all writes go through the API's service role.

Chargeable actions: `story_generate`, `video_render`, `scene_regenerate`, `video_reassemble`.

---

## 6. Shared contracts (`packages/shared`)

```ts
export const StylePreset = z.enum([
  "animated_3d", "cartoon", "anime_2d", "cinematic", "storybook", "comic", "documentary", "custom",
]);

export const CreativeBriefSchema = z.object({
  stylePreset: StylePreset,
  customStyle: z.string().max(500).optional(),
  idea: z.string().min(3).max(2000),
  genre: z.string(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
  targetSeconds: z.number().int().min(15).max(180),
  language: z.string().default("en"),
  narration: z.boolean().default(true),
  voiceId: z.string().optional(),
  musicMood: z.string().optional(),
});

export const StorySchema = z.object({
  title: z.string(),
  logline: z.string(),
  hook: z.string(),
  characters: z.array(z.object({
    name: z.string(),
    role: z.string(),
    visualDescription: z.string(),   // reused verbatim in every image prompt
  })).max(5),
  script: z.string(),
  estimatedSeconds: z.number(),
});

export const ScenePlanSchema = z.object({
  styleGuide: z.string(),
  scenes: z.array(z.object({
    narration: z.string(),
    durationSeconds: z.number().min(2).max(10),
    shot: z.string(),
    camera: z.string(),
    characters: z.array(z.string()),
    imagePrompt: z.string(),
    motionPrompt: z.string(),
  })).min(2).max(20),
});
```

---

## 7. API surface (`/v1`, Phase 1)

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/register`, `/auth/login`, `/auth/logout` · GET `/auth/me` | Accounts (same as mergedguard) |
| GET, POST | `/orgs` … | Organizations, members, invitations |
| GET | `/social/:platform/connect`, `/social/:platform/callback` | OAuth redirects for instagram / facebook / youtube |
| GET, DELETE | `/social`, `/social/:id` | List / disconnect connected accounts |
| GET, POST | `/projects` | List / create a chat project |
| GET | `/projects/:id` | Project with its messages, briefs, stories and videos |
| POST | `/projects/:id/messages` | Send a chat message → assistant reply (streamed) |
| POST | `/projects/:id/brief` | Confirm the creative brief |
| POST | `/projects/:id/stories` | Generate a story (charged) |
| PATCH | `/stories/:id` | Edit the text / approve |
| POST | `/stories/:id/rewrite` | AI revision with an instruction |
| POST | `/stories/:id/videos` | Start a render `{ tier, aspectRatio }` (202, charged) |
| GET | `/videos`, `/videos/:id` | Library; detail with scenes and progress |
| POST | `/videos/:id/scenes/:sceneId/regenerate` | Re-render one scene (charged) |
| POST | `/videos/:id/reassemble` | Re-stitch after voice/music/caption edits |
| GET | `/videos/:id/download` | Signed URL |
| GET, PATCH | `/billing` · GET `/billing/quotes` | Credits, plan, cost of each action |
| POST | `/worker/callback` | Worker progress (bearer secret) |

---

## 8. Platform constraints to plan around (affects Phase 2, start now)

- **Meta App Review** (Facebook + Instagram permissions) and **business verification** are needed before anyone other than the app's admins/testers can connect. Expect weeks, and a screencast of the full flow is required. Submit as soon as the connect flow works.
- **Instagram**: Business/Creator accounts only. Publishing is a two-step process (create a container from a **public media URL**, then publish), with no native scheduling, so our own scheduler must run it. Containers expire after 24 hours. There's a cap of about 100 API posts per account per 24 hours.
- **Facebook Pages**: native scheduling via `published=false` + `scheduled_publish_time`. Reels go through `/{page-id}/video_reels`.
- **YouTube**: uploads through `videos.insert`. Scheduling uses `privacyStatus=private` + `publishAt`. Videos uploaded by **unverified API projects are locked to private** until the app passes Google's API audit, and the `youtube.upload` scope requires OAuth verification. Daily quota is 10,000 units by default, and uploads are expensive in quota, so request an increase early.
- **AI-content labeling**: YouTube requires a disclosure for realistic altered or synthetic content, and Meta applies "AI info" labels. Set the disclosure flags when publishing.
- **Copyright**: only original characters, licensed music, and no real-person likenesses without consent.

---

## 9. Web app screens (Phase 1)

1. **Login / signup / onboarding** (organization → connect accounts → first video)
2. **Studio** (`/studio/[projectId]`): chat on the left. On the right, a live panel that shows the brief → story editor → render progress → final player, depending on the stage.
3. **New video** (`/studio/new`): style preset gallery with sample thumbnails, plus a prompt box.
4. **Library** (`/library`): video grid, filters (style, status, format).
5. **Connections** (`/settings/connections`): IG / FB / YT cards with connect/reconnect/disconnect.
6. **Billing** (`/billing`): credits, usage, plan.
7. **Team** (`/settings/team`).

Design: dark creator aesthetic (reuse mergedguard's token setup in `globals.css` `@theme`), with a warmer accent (e.g. coral/violet) to separate the brands.

---

## 10. Non-functional requirements

- **Render time target**: a 60-second Standard video in under 10 minutes. Lite renders in under 3 minutes.
- **Reliability**: each step is idempotent and retried with backoff (3 attempts). A provider failure doesn't lose the scenes that already finished.
- **Cost guardrails**: a per-org concurrency limit (e.g. 2 renders at a time), a hard cap on seconds per video by plan, and a provider spend alert.
- **Security**: secrets only in `apps/api/.env` / worker env, encrypted OAuth tokens, signed storage URLs, RLS on all tables, rate limiting on generation endpoints, and moderation on prompts.
- **Observability**: structured logs per job, cost per video, a failure dashboard, and Sentry on web/api/worker.
- **Testing**: `node:test` + `fastify.inject` for the API, with fake providers (LLM, image, video, TTS) so the whole pipeline can be tested end to end with no spend.

---

## 11. Repository structure

```text
taleloop/
├── package.json                 # pnpm workspace; `pnpm dev` runs api + web (+ worker)
├── packages/shared/src/         # schemas.ts, types.ts, api.ts, billing.ts, styles.ts (presets)
├── apps/
│   ├── web/                     # Next.js 15 — UI only
│   │   └── src/app/{(auth),onboarding,studio,library,billing,settings}/
│   ├── api/                     # Fastify — all backend logic and secrets
│   │   ├── src/routes/{auth,orgs,social,projects,stories,videos,billing,worker}.ts
│   │   ├── src/services/{chat,storyPlanner,scenePlanner,render,social/{meta,youtube},billing,crypto}.ts
│   │   ├── src/store/{repository,memory,supabase}.ts
│   │   ├── supabase/migrations/
│   │   └── test/
│   └── worker/                  # Node 20 + FFmpeg, Dockerfile
│       └── src/{queue,steps/{references,keyframes,clips,voice,music,assemble},providers/}
└── requirements.md              # this file
```

---

## 12. Milestones (Phase 1)

| # | Milestone | Done when |
|---|---|---|
| 0 | **Model spike** | Same story rendered in 3 styles across 2–3 video models, with a cost/quality table and defaults chosen |
| 1 | **Skeleton** | Monorepo, auth, orgs, empty dashboard, CI, deploys to Vercel + Railway |
| 2 | **Connections** | IG / FB / YT OAuth connect + disconnect + token refresh; Meta and Google review submissions started |
| 3 | **Chat → brief → story** | Style presets, streaming chat, structured brief, story generation/edit/rewrite/approve, versions |
| 4 | **Render pipeline (Lite)** | Scene plan → keyframes → TTS → FFmpeg pan/zoom → captions → MP4 in the library |
| 5 | **Render pipeline (Standard/Premium)** | Image-to-video clips, character references, per-scene regenerate, reassemble |
| 6 | **Credits** | Charging, idempotency, refunds, quotes on buttons, usage page |
| 7 | **Polish & beta** | Moderation, error states, progress UX, 10 beta users producing videos |

### Later phases
- **Phase 2 — Publish & schedule:** a post composer (caption, hashtags, per-platform variants), a calendar, a scheduler worker, publish status, retries, and AI disclosure flags.
- **Phase 3 — Autopilot:** recurring series ("a new 60s horror story every day at 7pm to IG + YT Shorts"), approval queue or fully automatic mode, basic analytics pulled back from the platforms.
- **Phase 4:** long-form episodes, recurring characters across a series, voice cloning (with consent), lip-sync, multi-language dubbing.

---

## 13. Open questions

1. Who's the main target: faceless YouTube/TikTok creators, brands, or kids' content? This decides the default styles and the moderation strictness.
2. Is TikTok in scope? (Its Content Posting API needs a separate audit.)
3. Pricing per plan, and which tier free users get (probably Lite only, with a watermark).
4. Should the storyboard review step (approve keyframes before spending on video) be required or optional?
5. Which languages to support at launch?
