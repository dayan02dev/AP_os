# ARTPARK OS — Admin Portal (UI/UX prototype)

Self-contained, **static** front-end prototype of the Admin application-review dashboard
(Reviewer decision + Jury decision flows). UI/UX reference build for backend integration
handoff — intentionally separate from the Vite app in `frontend/`.

## Two ways to run

**A) Single file (easiest — for reviewers):**
Open **`ARTPARK-Admin-Portal.html`** directly in a browser (double-click). Everything —
CSS, all components, sample data, and the ARTPARK+IISc logo — is inlined. Needs an
internet connection (React + Babel + the Open Sans font load from CDN).

**B) Source build (for developers):**
Serve the folder over HTTP and open `admin-portal.html` (a `file://` open will not work
for this version because the browser blocks the babel `os/*.jsx` fetches):
```bash
python -m http.server 5500 --bind 127.0.0.1
# then open http://127.0.0.1:5500/admin-portal.html
```

## What it is
- React 18 + Babel from CDN (`@babel/standalone`) — **no build step, no npm install**.
- Components are plain `<script type="text/babel">` files under `os/`.
- Sample data in `os/data.js`; UI state persists to `localStorage` (`ARTPARK_OS_DATA`)
  via `window.persistOSData()`.

## Layout
```
admin-portal.html             entry (source build) — pins os/* via ?v= cache-busting
ARTPARK-Admin-Portal.html     self-contained single-file build (everything inlined)
os/shell.jsx                  shared shell atoms (topbar lockup, PageHead, ScoreBar, Chip…)
os/admin-1.jsx                Dashboard, Applications pipeline, Application detail
os/admin-2.jsx                Admin Review / Final Gate, Jury panel, User Roles, Settings, app shell
os/styles.css                 full theme (ARTBlue palette, Trebuchet MS + Open Sans)
os/data.js                    sample applications / reviewers / jury / decisions
assets/                       ARTPARK + IISc logo lockup and marks
```

## Features
- **Reviewer Decision** and **Jury Decision** modes (toggle in the cohort header).
- Dashboard (KPIs, pipeline funnel, applications-by-industry, status breakdown).
- Applications pipeline with filters, batch actions (Hold / Send to Next Level / Reject /
  Hide / Archive / Assign batch).
- Application detail with **Reviewer consensus**, **Jury panel** (per-field feedback +
  jury note + flags), **TIR Signal Profile**, and a Reviewer/Jury **Combined Score**.
- **Admin Review** (reviewer flow) and **Final Gate / interview scheduling** (jury flow).
- **User Access & Roles** management.
- **Settings** (topbar gear): restore Archived / Hidden / On-hold / Rejected applications
  — updates the UI live.

## Brand
ARTBlue `#3213b7`, ARTLight `#aafcf0`, ARTBlack `#242424`, ARTWhite `#efefef`.
Fonts: Trebuchet MS (display) + Open Sans (body). Sharp 2px radii; 999px pills.

## Notes for backend integration
- All actions are wired to local handlers and persist to `localStorage`; swap `os/data.js`
  + the `persist*` / `applyGateDecision` helpers for real API calls.
- AI Score / variance were deliberately removed from the UI per stakeholder direction —
  decisions are driven by human reviewer + jury consensus only.
