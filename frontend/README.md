# ARTPARK EIR frontend

React + Vite SPA for the ARTPARK Technology Innovator in Residence (EIR)
application portal. Talks only to the FastAPI backend at `api.artpark.info` —
no Supabase calls run in the browser.

## Local dev

```bash
cp .env.example .env.local        # fill in VITE_SUPABASE_* + VITE_API_BASE_URL=http://localhost:8000
npm install
npm run dev                       # http://localhost:5173
```

The backend must be running separately (see `../backend/README.md`). A dev
OTP can be fetched without SMTP via `python ../backend/scripts/dev_get_otp.py
<email>`.

## Tests

```bash
npm test                          # vitest run
npm run test:watch
npm run build                     # production build — dumps to dist/
```

## Deployment

Production is deployed to **Vercel** at **https://apply.artpark.info**.

| Setting           | Value |
|-------------------|-------|
| Git production branch | `main` |
| Project name      | `ap-os` |
| Root Directory    | `frontend` |
| Framework Preset  | Vite |
| Build Command     | `npm run build` |
| Output Directory  | `dist` |
| Install Command   | `npm install` |

### Environment variables (set in Vercel dashboard, NOT in git)

Configure under **Project Settings → Environment Variables**. Enable each
for *Production*, *Preview*, and *Development*:

| Name | Value |
|------|-------|
| `VITE_SUPABASE_URL` | prod Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | prod anon JWT (safe to expose; RLS gates all reads) |
| `VITE_API_BASE_URL` | `https://api.artpark.info` |

`VITE_SUPABASE_*` is currently unused in the bundle — the codebase has a
`src/lib/supabase.js` module staged for future realtime/storage work but no
caller imports it yet, so Vite tree-shakes it out. Keep the vars set so we
don't have to plumb them back in later.

The gitignored `frontend/.env.production` exists only to let `npm run build`
produce a realistic production bundle on your laptop — it's not read by
Vercel.

### vercel.json

Pinned in the repo (`frontend/vercel.json`) so SPA routing, security
headers, and asset caching survive project recreation. The three blocks:

- **Rewrites** — `/2026` serves `marketing.html`; everything else that
  isn't an asset and has no file extension falls through to `index.html`
  so react-router can pick it up.
- **Redirects** — `/marketing.html` → `/2026` (308 permanent).
- **Headers** — `X-Frame-Options: DENY`, `X-Content-Type-Options:
  nosniff`, `Referrer-Policy`, `Permissions-Policy`, and
  `Strict-Transport-Security` on every route; `Cache-Control:
  public, max-age=31536000, immutable` on `/assets/*` (safe because Vite
  fingerprints every asset filename).

### Custom domain

`apply.artpark.info` is a CNAME in GoDaddy pointing at
`cname.vercel-dns.com`. Vercel auto-issues the TLS cert on first verify —
no ACM involvement.

If you add staging later: add a preview CNAME (e.g. `staging.apply` →
`cname.vercel-dns.com`), set it as an alias domain in Vercel, point it at
a preview branch. Frontend env vars on that branch can point at a staging
API.

### Redeploying

Vercel auto-deploys on every push to `main`. For emergency rollback:

```bash
# Dashboard → Deployments → click previous good deploy → "Promote to Production"
#   (no CLI rollback needed — Vercel keeps every prior build around)
```

Or push a revert commit to `main`.

## Project structure

```
src/
  App.jsx                 # wizard shell (phase state, routing, keyboard shortcuts)
  router.jsx              # route table
  pages/                  # top-level route components
  screens.jsx             # section-level screens (welcome, section intro, done)
  auth_upload.jsx         # auth + CV upload + parsed-review screens
  inputs.jsx              # question-type input components
  questions.jsx           # the 23 questions (structure, validators, copy)
  hooks/                  # useAuth, useApplication, useResume, useToast
  lib/
    api.js                # fetch wrapper, handles 401 + refresh + ApiError
    session.js            # token storage + single-flight refresh
    auth.js               # lib-level OTP helpers
    fieldMap.js           # questionId ↔ backend column translation
  styles.css              # all styling (no CSS modules, no Tailwind)
```

See `../backend/docs/OPERATIONS.md` for production operations, incident
response, and the cross-origin flow (apply.artpark.info → api.artpark.info).
