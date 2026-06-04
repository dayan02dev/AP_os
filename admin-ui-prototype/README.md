# ARTPARK OS — Admin Portal (UI/UX prototype)

Self-contained, **static** front-end prototype of the Admin application-review dashboard.
This is a **UI/UX reference build for handoff** — it is intentionally separate from the
Vite app in `frontend/` and from the existing user-management module in
`frontend/src/pages/admin/` (which is a different feature).

## What it is
- React 18 + Babel loaded from CDN (`@babel/standalone`) — **no build step, no npm install**.
- Components are plain `<script type="text/babel">` files under `os/`.
- Sample data lives in `os/data.js`; UI state persists to `localStorage`
  (`ARTPARK_OS_DATA`) via `window.persistOSData()`.

## Run it
Serve the folder over HTTP (opening `index.html` via `file://` will not work because
the browser blocks the babel-transformed module fetches):

```bash
cd admin-ui-prototype
python -m http.server 5500 --bind 127.0.0.1
# then open http://127.0.0.1:5500/index.html
```

## Layout
```
index.html        entry; pins script versions via ?v= cache-busting
os/shell.jsx      shared shell — header lockup, PageHead, nav
os/admin-1.jsx    Dashboard, Pipeline (collapsible filters), Application detail
os/admin-2.jsx    Admin Review (gate), comparative reviewer cards, decisions, roles
os/styles.css     full theme (ARTBlue palette, Trebuchet MS + Open Sans)
os/data.js        sample applications / reviewers / decisions
assets/           ARTPARK + IISc logo lockup and marks
```

## Brand
ARTBlue `#3213b7`, ARTLight `#aafcf0`, ARTBlack `#242424`, ARTWhite `#efefef`.
Fonts: Trebuchet MS (display) + Open Sans (body). Sharp 2px radii; 999px pills.

## Notes for backend integration
- All actions are wired to local handlers; swap `os/data.js` + the `persist*`/
  `applyGateDecision` helpers for real API calls.
- AI Score / variance were deliberately removed from the entire UI per stakeholder
  direction — decisions are driven by human reviewer consensus only.
