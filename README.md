# Smart Classroom Noise Monitor

IoT-based classroom noise monitoring dashboard with a **Node.js / Express** backend and static HTML client. Supabase credentials and privileged operations run server-side only.

## Project Structure

```
├── client/                 # Static frontend (HTML, CSS, JS)
│   ├── index.html          # Admin login
│   ├── app.html            # Admin dashboard
│   ├── teacher-*.html      # Teacher portal
│   ├── css/
│   └── js/
│       ├── constants.js    # Table names only — no secrets
│       ├── api.js          # Calls /api/* backend endpoints
│       ├── auth.js         # Admin session management
│       ├── data.js         # Data helpers & charts
│       └── ...
├── server/
│   ├── server.js           # Express entry point
│   ├── routes/             # REST route definitions
│   ├── controllers/        # Request handlers
│   ├── services/           # Supabase integration
│   ├── middleware/         # Auth, errors, rate limiting
│   ├── config/             # Environment & table config
│   ├── .env                # Secrets (not committed)
│   └── package.json
├── vercel.json             # Vercel deployment config
└── package.json            # Root scripts
```

## What Changed in the Migration

| Before (static) | After (server-side) |
|-----------------|---------------------|
| `js/config.js` with `SUPABASE_URL` + `SUPABASE_ANON_KEY` in browser | `client/js/constants.js` — no credentials |
| Direct Supabase REST/Auth calls from browser | All calls go through `/api/*` Express routes |
| `build.js` to inject secrets into frontend | `server/.env` + Vercel environment variables |
| Anon key visible in DevTools | Keys stored in server environment only |
| Service role used in cron script only | Service role used server-side for cleanup RPC |

The UI, CSS, routing, and user flows are unchanged.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/signup` | Register |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/auth/me` | Current user + profile |
| GET | `/api/profiles/:id` | Get profile |
| PUT | `/api/profiles/:id` | Create/update profile |
| GET | `/api/noise-events` | List noise events (filtered) |
| GET | `/api/classrooms` | List classrooms |
| GET | `/api/audit-logs` | Audit trail (admin) |
| POST | `/api/audit-logs` | Write audit entry |
| GET | `/api/settings` | System settings |
| PATCH | `/api/settings` | Update settings (admin) |
| GET | `/api/teachers/:id/classrooms` | Teacher's classrooms |
| GET | `/api/teachers/:id/schedules` | Teacher schedule |
| POST | `/api/teachers/schedules/check-conflict` | Schedule conflict check |
| POST | `/api/cleanup/expired-events` | Delete expired recordings |

Authenticated routes expect `Authorization: Bearer <access_token>` from Supabase Auth.

## Local Development

### Prerequisites

- Node.js 18+
- A Supabase project with the schema from `supabase_migration.sql`

### Setup

```bash
# 1. Install server dependencies
cd server
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your Supabase URL, anon key, and service role key

# 3. Start the server (serves API + client on one port)
cd ..
npm start
```

Open http://localhost:3000

### Development with auto-reload

```bash
npm run dev
```

## Deploy to Vercel

1. Push the project to GitHub.
2. Import the repo in [Vercel](https://vercel.com).
3. Set **Root Directory** to the project folder (`NoiseApp-Monitoring-updated-`).
4. Add environment variables in Vercel → Settings → Environment Variables:

   | Variable | Required |
   |----------|----------|
   | `SUPABASE_URL` | Yes |
   | `SUPABASE_ANON_KEY` | Yes |
   | `SUPABASE_SERVICE_ROLE_KEY` | Recommended |
   | `CORS_ORIGIN` | Optional (defaults to `*`) |
   | `CLEANUP_API_KEY` | Optional (for external cron) |

5. Deploy. Vercel routes **all traffic** through root `index.js` (not `api/index.js` — that breaks `/api/auth/*` paths).

**Important:** Do **not** put the Express entry inside an `api/` folder. Vercel treats each `api/*` path as a separate function, so `/api/auth/signup` returns 404 unless a matching file exists.

### Scheduled Cleanup on Vercel

Use Vercel Cron or an external service to POST:

```
POST https://your-app.vercel.app/api/cleanup/expired-events
x-cleanup-key: your-CLEANUP_API_KEY
```

Or call it as an authenticated admin.

## Security

- **Helmet** — security headers
- **CORS** — configurable allowed origins
- **Rate limiting** — 200 requests per 15 minutes per IP on `/api`
- **JWT forwarding** — user tokens passed to Supabase to preserve Row Level Security
- **Service role** — only used server-side for cleanup and profile bootstrap
- **No secrets in client** — browser code contains zero Supabase keys

## Legacy Static Files

The original root-level HTML/JS files remain for reference. The active application lives in `client/` and `server/`. You can remove the old root files once you've verified the migration.

## Troubleshooting

**Server won't start — missing env vars**
- Ensure `server/.env` exists with `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

**401 on API calls after login**
- Confirm Supabase Auth is enabled and the user exists.
- Check browser DevTools → Network for failed `/api/*` requests.

**Cleanup fails**
- Set `SUPABASE_SERVICE_ROLE_KEY` in `server/.env`.
- Ensure the `delete_expired_noise_events` RPC exists (see `supabase_migration.sql`).

**Vercel 404 on `/api/*`**
- Entry must be root `index.js`, **not** `api/index.js`.
- Redeploy and check Vercel → Deployment → Functions shows `index.js`.
- Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in Vercel environment variables.
- Test: `https://your-app.vercel.app/api/health` should return JSON.
