# Frontend routing

The application portal lives under `/apply/*`. Every wizard screen is a real
URL so browser back/forward and deep-links work.

## Route table

| URL | Component | Protected | Renders |
|---|---|---|---|
| `/` | `Navigate` | — | redirects to `/apply` |
| `/apply` | `App` | no | welcome / returning-user choice, based on auth + draft state |
| `/apply/signin` | `App` (phase=AUTH) | no | register/login form |
| `/apply/verify` | `App` (stub) | no | 6-digit OTP entry — placeholder until Phase 3 |
| `/apply/profile` | `App` (phase=PROFILE) | ✓ | personal info, change password, sign-out |
| `/apply/basic` | `App` (section 02) | ✓ | team, contact details, degree, referral source |
| `/apply/problem` | `App` (section 03) | ✓ | problem definition and importance |
| `/apply/solution` | `App` (section 04) | ✓ | solution, core tech, moat, customers |
| `/apply/execution` | `App` (section 05) | ✓ | milestones, budget, failure modes |
| `/apply/evidence` | `App` (section 06) | ✓ | evidence files, prototype video, pitch deck |
| `/apply/declaration` | `App` (section 07) | ✓ | final confirmations |
| `/apply/review` | `App` (phase=REVIEW) | ✓ | edit parsed CV fields before starting sections |
| `/apply/submitted` | `App` (phase=DONE) | ✓ | post-submit receipt / past-submission read-only view |
| `/apply/support` | `App` | no | support ticket form (modal anywhere, dedicated URL here) |
| `/apply/*` (unknown) | inline 404 | no | "nothing here" screen with a back link |
| `*` (anywhere else) | `NotFoundPage` | no | same 404 outside `/apply` |

Section slugs are the `id` values from `frontend/src/questions.jsx` (kebab-case
where applicable): `basic`, `problem`, `solution`, `execution`, `evidence`,
`declaration`.

## Behaviour rules

1. **Protected routes**: if no session (`localStorage.tir:user` is null),
   redirect to `/apply/signin?next=<encoded intended URL>`. Handled inside
   `App.jsx` via the `PROTECTED_PATHS` set; `pages/ProtectedRoute.jsx` provides
   the same check for any future route that uses it at the router level.

2. **Post-auth redirect**: on successful sign-in, if the URL carries
   `?next=/apply/<something>`, navigate there. Otherwise, go to the returning-user
   chooser (login) or upload screen (register).

3. **URL ↔ phase sync** (both directions, inside `App.jsx`):
   - Landing on `/apply/profile` → sets phase to `PROFILE`.
   - Clicking Next in the wizard (crossing a section boundary) → pushes the
     next section slug onto the URL via `navigate()`.
   - Browser back → URL changes → sync effect pulls the matching phase back.

4. **Within-section navigation**: clicking OK on a question within the same
   section does NOT change the URL (the URL is at section granularity).
   Browser back from the middle of a section jumps to the previous section, not
   the previous question.

5. **404**: any `/apply/<slug>` where `<slug>` is not in the known set above
   renders a 404 screen inline. App stays mounted so state isn't lost.

6. **Landing on `/apply`**: `App` reads `localStorage` and decides whether to
   show welcome (fresh), returning-user chooser (authed with history), or
   resume (authed with draft). No redirect needed — the phase state drives the
   render.

## Base URL

Dev: `http://localhost:5173/apply/...`
Prod: `https://artpark.online/apply/...` (configured in Vercel; Phase 9).

Vite's dev server already rewrites unknown paths to `index.html`. Vercel needs
a `vercel.json` with a catch-all rewrite (added in Phase 9).
