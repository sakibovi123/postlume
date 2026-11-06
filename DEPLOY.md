# Deploying Postlume to Railway

Two services from this one repo:

```text
Internet ──https──▶ frontend (Next.js)  ──private network──▶ backend (Django + render worker)
                    public domain          /api, /media          volume /data: SQLite + videos
```

Only the **frontend** needs a public domain. It proxies `/api/*` and `/media/*` to the backend over
Railway's private network, so the browser always talks to one origin (cookies and CSRF just work).

The backend runs the web server **and** the render worker in one container (`backend/start.sh`), because both
need the same volume and Railway volumes can't be shared between services.

## 1. Create the project

1. Railway → **New Project** → **Deploy from GitHub repo** → pick `taleloop`.
2. Railway creates one service. Open it → **Settings**:
   - **Service name:** `backend` (the frontend expects this exact name, see step 3)
   - **Root Directory:** `/backend`
   - **Config file path:** `/backend/railway.json`
3. **+ Create** → **GitHub Repo** → `taleloop` again for the second service:
   - **Service name:** `frontend`
   - **Root Directory:** `/frontend`
   - **Config file path:** `/frontend/railway.json`

Both services build from their `Dockerfile`; nothing else to configure for the build.

## 2. Backend service

**Volume** (required, or data is wiped on every deploy): right-click the backend service →
**Attach volume** → mount path **`/data`**.

**Variables** (backend → Variables → Raw Editor):

```env
DJANGO_SECRET_KEY=<paste a long random string>
PUBLIC_APP_URL=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}

LLM_PROVIDER=fake
IMAGE_PROVIDER=fake
VIDEO_PROVIDER=fake
TTS_PROVIDER=fake
SIGNUP_ENABLED=true
```

`SIGNUP_ENABLED=true` is only there so you can create your own account (step 4). Generate the secret with `python3 -c "import secrets; print(secrets.token_urlsafe(50))"`.

That's enough to boot. Everything else in [`backend/.env.example`](backend/.env.example) is optional:

| To enable | Add |
|---|---|
| Real AI | `LLM_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, `IMAGE_PROVIDER=fal`, `VIDEO_PROVIDER=fal`, `TTS_PROVIDER=fal`, `FAL_KEY` |
| A separate token key | `TOKEN_ENCRYPTION_KEY` (`python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`). If unset, it's derived from `DJANGO_SECRET_KEY`. Set it before connecting accounts, because changing it later breaks stored tokens. |
| Social connect | `GOOGLE_CLIENT_ID/SECRET`, `META_APP_ID/SECRET`, `INSTAGRAM_APP_ID/SECRET` |
| Postgres instead of SQLite | Add a Railway Postgres database and set `DATABASE_URL=${{Postgres.DATABASE_URL}}`. Keep the `/data` volume, which still holds the videos. |

Don't generate a public domain for the backend. It isn't needed.

## 3. Frontend service

**Networking** → **Generate Domain** (this is your app URL).

No variables are needed if the backend service is named `backend`. The Dockerfile defaults to
`API_ORIGIN=http://backend.railway.internal:8000`, and the backend always listens on port 8000.
If you named it differently, set `API_ORIGIN=http://<backend-service-name>.railway.internal:8000`
on the frontend, then redeploy it. The value is read at build time.

## 4. Deploy and check

Deploy both services (backend first is nicer, but the order doesn't matter). Then:

- `https://<frontend-domain>/api/v1/health` → `{"ok": true}`
- Open `https://<frontend-domain>/signup`, create your account, and make a video. With the fake providers it renders in seconds.
- **Close sign-ups:** delete `SIGNUP_ENABLED` from the backend variables and redeploy. From then on, only people you invite from the Team page can create an account.

## OAuth redirect URIs (when you add social keys)

Register these in the Google Cloud / Meta developer consoles:

```text
https://<frontend-domain>/api/v1/social/youtube/callback
https://<frontend-domain>/api/v1/social/facebook/callback
https://<frontend-domain>/api/v1/social/instagram/callback
```

Token refresh: add a Railway cron service (same repo, root `/backend`) with start command
`python manage.py refresh_social_tokens` and schedule `0 3 * * *`. Its DB must be the same as the
backend's, so this only works with Postgres (`DATABASE_URL`), not the SQLite volume.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Backend crashes with `Set DJANGO_SECRET_KEY…` | Add `DJANGO_SECRET_KEY` to the backend variables. |
| Frontend pages load but API calls return 500 or "Failed to proxy" | The backend isn't named `backend`, or it isn't running. Set `API_ORIGIN` on the frontend and redeploy it. |
| `CSRF Failed: Origin checking failed` | `PUBLIC_APP_URL` on the backend must be the frontend's public URL. Redeploy the backend after changing it. |
| Users or videos disappear after a deploy | Attach the volume at `/data` on the backend. |
| `/signup` says sign-ups are closed | Set `SIGNUP_ENABLED=true` on the backend while you create an account, then remove it. Invited people don't need this. |
| Django admin | Not exposed through the frontend. Generate a backend domain temporarily and open `/admin/` there (`python manage.py createsuperuser` from the Railway shell). |
