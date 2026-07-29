# IISc Jury Roster (Admin Portal, Jury Mode) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "IISc Jury Roster" section to the admin portal's Jury Decision mode — browse all 809 scraped IISc professors, open a per-professor detail drawer, see the jury-selected applications that match each professor's expertise (domain-wise), and send jury-invite emails; also hide the Applications + Rejected-Applications tabs in Jury mode.

**Architecture:** Entirely frontend. A new screen `AdminIiscRoster.jsx` reads a static `public/iisc_professors.json`, renders a design-system `os-table` + detail drawer + invite modal, computes recommendations client-side by matching each professor's `matched_domains` tokens against jury-selected apps' ARTPARK-domain tokens (via a `LABEL_TO_TOKEN` lib), and reuses the existing `adminPlatformApi.createJuryInvites`. `AdminTabBar` becomes decision-mode-aware.

**Tech stack:** React + Vite, existing `useAdminData` hooks, existing `adminPlatformApi.createJuryInvites`, `os-*` design-system classes + purple accent `#3213b7`. Tests: Vitest/RTL.

**Worktree/branch:** work in `/Users/apple/Desktop/Final_AP_os/.claude/worktrees/release-sip-launch-v1` on `release/sip-launch-v1`. Run FE tests: `cd frontend && npx vitest run <path>`.

**Spec:** `docs/superpowers/specs/2026-07-29-iisc-jury-roster-design.md`.

---

## File Structure

- Create `frontend/public/iisc_professors.json` — the 809-row roster (static asset, lazy-fetched).
- Create `frontend/src/lib/artparkDomains.js` — `LABEL_TO_TOKEN`, `TOKEN_TO_LABEL`, `DOMAIN_TOKENS` (pure, testable).
- Create `frontend/src/lib/__tests__/artparkDomains.test.js`.
- Modify `frontend/src/pages/admin/platform/AdminPortal.jsx` — `AdminTabBar` mode-aware + `AdminApp` render/reset for the new page.
- Create `frontend/src/pages/admin/platform/screens/AdminIiscRoster.jsx` — the screen (table + filters + drawer + invite modal + recommendation).
- Create `frontend/src/pages/admin/platform/screens/__tests__/AdminIiscRoster.test.jsx`.
- Create `frontend/src/pages/admin/platform/__tests__/AdminTabBar.test.jsx`.

---

## Task 1: Roster JSON asset

**Files:** Create `frontend/public/iisc_professors.json`.

- [ ] **Step 1: Copy the combined roster into the public dir**

Run:
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/release-sip-launch-v1
cp "/private/tmp/claude-501/-Users-apple-Desktop-Final-AP-os/9589e78a-7409-401b-949c-75a141de35cd/scratchpad/iisc_combined_all.json" frontend/public/iisc_professors.json
```

- [ ] **Step 2: Verify shape (809 rows + expected keys)**

Run:
```bash
python3 -c "import json;d=json.load(open('frontend/public/iisc_professors.json'));assert len(d)==809,len(d);k=set(d[0]);need={'name','title','department','division','profile_url','research_domain','subdomains','notable_work','artpark_match','matched_domains','reasoning','duplicate_joint_appointment'};assert need<=k, need-k;print('OK',len(d),'rows')"
```
Expected: `OK 809 rows`.

- [ ] **Step 3: Commit**

```bash
git add frontend/public/iisc_professors.json
git commit -m "feat(jury): add IISc professor roster static asset (809 rows)"
```

---

## Task 2: `artparkDomains.js` — label↔token map

**Files:** Create `frontend/src/lib/artparkDomains.js`, `frontend/src/lib/__tests__/artparkDomains.test.js`.

The labels below are the **real prod `industry_categories.label` values** (verified against prod); the pipeline row's `domain` field equals one of these.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/__tests__/artparkDomains.test.js`:

```js
import { describe, it, expect } from "vitest";
import { LABEL_TO_TOKEN, TOKEN_TO_LABEL, DOMAIN_TOKENS } from "../artparkDomains";

describe("artparkDomains", () => {
  it("maps the 13 real industry labels to tokens", () => {
    expect(LABEL_TO_TOKEN["Artificial Intelligence / Foundational Models"]).toBe("ai");
    expect(LABEL_TO_TOKEN["Healthcare / MedTech"]).toBe("health");
    expect(LABEL_TO_TOKEN["Communication (Wired & Wireless)"]).toBe("comms");
    expect(LABEL_TO_TOKEN["Climate Fintech / Urban Resilience"]).toBe("climate_fintech");
    expect(Object.keys(LABEL_TO_TOKEN)).toHaveLength(13);
  });
  it("TOKEN_TO_LABEL is the inverse", () => {
    expect(TOKEN_TO_LABEL.ai).toBe("Artificial Intelligence / Foundational Models");
    expect(TOKEN_TO_LABEL.comms).toBe("Communication (Wired & Wireless)");
    for (const [label, tok] of Object.entries(LABEL_TO_TOKEN))
      expect(TOKEN_TO_LABEL[tok]).toBe(label);
  });
  it("DOMAIN_TOKENS lists all 13 tokens", () => {
    expect(DOMAIN_TOKENS).toHaveLength(13);
    expect(DOMAIN_TOKENS).toContain("ev_mobility_services");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/lib/__tests__/artparkDomains.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the lib**

Create `frontend/src/lib/artparkDomains.js`:

```js
// ARTPARK's 13 industry domains — the real prod `industry_categories` labels
// (what the admin pipeline row's `domain` field contains) mapped to their
// tokens (what the IISc roster's `matched_domains` uses). Used to recommend
// jury-selected applications to professors by shared domain.

export const LABEL_TO_TOKEN = {
  "Artificial Intelligence / Foundational Models": "ai",
  "Robotics & Automation": "robotics",
  "Healthcare / MedTech": "health",
  "Defense & Aerospace": "defense",
  "EV Mobility & Services": "ev_mobility_services",
  "Advanced Manufacturing / Industry 5.0": "industry",
  "Semiconductor / Hardware": "semi",
  "Communication (Wired & Wireless)": "comms",
  "Climate Fintech / Urban Resilience": "climate_fintech",
  "EdTech": "edtech",
  "Developer Tools / DevOps": "dev_tools",
  "E-commerce & Artisanal Crafts": "e_commerce_crafts",
  "Other / Frontier": "other",
};

export const TOKEN_TO_LABEL = Object.fromEntries(
  Object.entries(LABEL_TO_TOKEN).map(([label, tok]) => [tok, label]),
);

export const DOMAIN_TOKENS = Object.values(LABEL_TO_TOKEN);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/lib/__tests__/artparkDomains.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/artparkDomains.js frontend/src/lib/__tests__/artparkDomains.test.js
git commit -m "feat(jury): ARTPARK domain label<->token map for roster recommendations"
```

---

## Task 3: `AdminTabBar` mode-aware + `AdminApp` wiring

**Files:** Modify `frontend/src/pages/admin/platform/AdminPortal.jsx`. Create `frontend/src/pages/admin/platform/__tests__/AdminTabBar.test.jsx`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/platform/__tests__/AdminTabBar.test.jsx`:

```jsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminTabBar } from "../AdminPortal";

const base = { page: "dashboard", setPage: vi.fn(), appsBadge: null,
  rejectedBadge: null, reviewBadge: null, juryBadge: null };

describe("AdminTabBar — jury vs reviewer tabs", () => {
  it("jury mode hides Applications + Rejected and shows IISc Jury Roster after Dashboard", () => {
    render(<AdminTabBar {...base} decisionMode="jury" />);
    expect(screen.getByText("IISc Jury Roster")).toBeTruthy();
    expect(screen.queryByText("Applications")).toBeNull();
    expect(screen.queryByText("Rejected Applications")).toBeNull();
    const labels = screen.getAllByText(
      /Dashboard|IISc Jury Roster|Jury|Jury Selected|Final Gate/).map(n => n.textContent);
    expect(labels[0]).toBe("Dashboard");
    expect(labels[1]).toBe("IISc Jury Roster");
  });
  it("reviewer mode keeps Applications + Rejected and has no IISc roster", () => {
    render(<AdminTabBar {...base} decisionMode="reviewer" />);
    expect(screen.getByText("Applications")).toBeTruthy();
    expect(screen.getByText("Rejected Applications")).toBeTruthy();
    expect(screen.queryByText("IISc Jury Roster")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminTabBar.test.jsx`
Expected: FAIL (no "IISc Jury Roster"; Applications present in jury mode).

- [ ] **Step 3: Make `AdminTabBar` mode-aware**

In `AdminPortal.jsx`, replace the `const tabs = [ ... ];` array in `AdminTabBar` (currently lines ~257-275) with a mutable build + jury adjustments:

```jsx
  let tabs = [
    { id:'dashboard',    label:'Dashboard',    sub:'OVERVIEW · PIPELINE',       badge:null },
    {
      id:'reviewers',
      label: decisionMode === 'jury' ? 'Jury' : 'Reviewers',
      sub: decisionMode === 'jury' ? 'PANEL · ASSIGNMENTS' : 'ROSTER · PROGRESS',
      badge:null
    },
    { id:'pipeline',     label:'Applications', sub:'ALL SUBMISSIONS',            badge: appsBadge == null ? null : String(appsBadge) },
    { id:'rejected',     label:'Rejected Applications', sub:'REJECTED BY ADMIN', badge: rejectedBadge == null ? null : String(rejectedBadge) },
    { id:'jury',         label:'Jury Selected', sub:'SELECTED FOR JURY',
      badge: juryBadge == null ? null : String(juryBadge) },
    {
      id:'gate1',
      label: decisionMode === 'jury' ? 'Final Gate' : 'Admin Review',
      sub: decisionMode === 'jury' ? 'CONSOLIDATED DECISIONS' : 'PENDING DECISIONS',
      badge: decisionMode === 'jury' ? null : (reviewBadge == null ? null : String(reviewBadge))
    },
  ];
  if (decisionMode === 'jury') {
    // Jury mode: drop the reviewer-pipeline tabs, add the candidate-pool roster
    // right after Dashboard.
    tabs = tabs.filter(t => t.id !== 'pipeline' && t.id !== 'rejected');
    const afterDash = tabs.findIndex(t => t.id === 'dashboard') + 1;
    tabs.splice(afterDash, 0,
      { id:'iisc_roster', label:'IISc Jury Roster', sub:'CANDIDATE POOL', badge:null });
  }
```

- [ ] **Step 4: Wire the new page + import in `AdminApp`**

Add the import near the other screen imports (after `import { AdminJury } ...`, line ~27):
```jsx
import { AdminIiscRoster } from "./screens/AdminIiscRoster";
```

In `AdminApp`, add a mode/page-reset effect right after the `decisionMode` state (~line 297):
```jsx
  // Keep `page` valid for the current decision mode: the IISc roster only
  // exists in jury mode; Applications/Rejected are hidden in jury mode.
  React.useEffect(() => {
    if (decisionMode === 'jury' && (page === 'pipeline' || page === 'rejected')) setPage('dashboard');
    if (decisionMode === 'reviewer' && page === 'iisc_roster') setPage('dashboard');
  }, [decisionMode]);   // eslint-disable-line react-hooks/exhaustive-deps
```

In the `lp-tab-content` render block, add (right after the `page === 'reviewers'` line, ~395):
```jsx
            {page === 'iisc_roster' && decisionMode === 'jury' && <AdminIiscRoster go={setPage} />}
```

> Task 4 creates `AdminIiscRoster`. If running strictly in order, Step 4's import will fail to resolve until Task 4 exists — so run Task 3's test (Step 5) which only renders `AdminTabBar` (no AdminApp import chain issue since the test imports `AdminTabBar` from the module; if the bare `AdminIiscRoster` import breaks module load, create an empty stub `export function AdminIiscRoster(){return null;}` now and flesh it out in Task 4). Simplest: do Task 4 first if the import blocks the test — but the tab logic + test here are self-contained. Prefer adding the stub file now.

- [ ] **Step 5: Run the tab test (create the stub if the import blocks module load)**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminTabBar.test.jsx`
Expected: PASS. If it errors on the missing `AdminIiscRoster` import, create `frontend/src/pages/admin/platform/screens/AdminIiscRoster.jsx` with `export function AdminIiscRoster(){return null;}` and re-run (Task 4 replaces it).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/platform/AdminPortal.jsx frontend/src/pages/admin/platform/__tests__/AdminTabBar.test.jsx frontend/src/pages/admin/platform/screens/AdminIiscRoster.jsx
git commit -m "feat(jury): jury-mode tabs hide Applications/Rejected, add IISc Jury Roster"
```

---

## Task 4: `AdminIiscRoster.jsx` — the screen

**Files:** Create/replace `frontend/src/pages/admin/platform/screens/AdminIiscRoster.jsx`. Create `frontend/src/pages/admin/platform/screens/__tests__/AdminIiscRoster.test.jsx`.

Design-system references: `PageHead` from `../shell/osAtoms`; `LoadingState`/`ErrorState` from `../ui.jsx`; `os-table`, `os-input`, `os-select`, `os-btn` (+ `secondary`/`ghost`/`sm`), `os-chip` (+ `purple`/`amber`), `os-drawer*`/`os-modal*` markup as in `AdminJury.jsx`/`ManageJurorsDrawer.jsx`. Match-chip tones: **Yes → `os-chip purple`, Partial → `os-chip amber`, No → `os-chip` (neutral)** — zero green.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/platform/screens/__tests__/AdminIiscRoster.test.jsx`:

```jsx
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
vi.mock("../../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: { createJuryInvites: vi.fn().mockResolvedValue({ results: [{ email: "x@y.com", status: "invited" }] }) },
}));

import { useAdminData } from "../../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../../lib/adminPlatformApi";
import { AdminIiscRoster } from "../AdminIiscRoster";

const ROSTER = [
  { name: "Dr. AI One", title: "Professor", department: "CSA", division: "Electrical Sciences",
    profile_url: "https://x/1", research_domain: "ML", subdomains: "deep learning",
    notable_work: "big paper", artpark_match: "Yes", matched_domains: "ai; robotics",
    reasoning: "does AI", duplicate_joint_appointment: "" },
  { name: "Dr. Health Two", title: "Assoc Prof", department: "BSSE", division: "Interdisciplinary & Physical Sciences",
    profile_url: "https://x/2", research_domain: "Bio", subdomains: "genomics",
    notable_work: "health paper", artpark_match: "Partial", matched_domains: "health",
    reasoning: "does health", duplicate_joint_appointment: "" },
  { name: "Dr. Joint Dup", title: "Professor", department: "RBCCPS", division: "Electrical Sciences",
    profile_url: "https://x/3", research_domain: "Robotics", subdomains: "control",
    notable_work: "robot paper", artpark_match: "Yes", matched_domains: "robotics",
    reasoning: "joint", duplicate_joint_appointment: "Yes" },
];

// Two jury-selected apps: one AI, one Health (real prod industry labels).
const STARTUPS = [
  { id: "a1", track: "tir", name: "AI Startup", chip: "JURY REVIEW",
    domain: "Artificial Intelligence / Foundational Models", ai: { overall: 8.5 }, founders: ["F1"] },
  { id: "a2", track: "sip", name: "Health Startup", chip: "JURY REVIEW",
    domain: "Healthcare / MedTech", ai: { overall: 7.9 }, founders: ["F2"] },
  { id: "a3", track: "tir", name: "Not Jury", chip: "SHORTLISTED",
    domain: "Healthcare / MedTech", ai: { overall: 6 }, founders: [] },
];

function mockData({ jurors = [], pendingInvites = [] } = {}) {
  useAdminData.mockImplementation((kind) => {
    if (kind === "pipeline") return { data: { startups: STARTUPS }, loading: false, error: null, reload: vi.fn() };
    if (kind === "jurors")   return { data: { jurors, pendingInvites }, loading: false, error: null, reload: vi.fn() };
    return { data: null, loading: false, error: null, reload: vi.fn() };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockData();
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(ROSTER) }));
});
afterEach(() => { delete global.fetch; });

async function renderRoster() {
  render(<AdminIiscRoster />);
  await screen.findByText("Dr. AI One");
}

describe("AdminIiscRoster", () => {
  it("renders all professors from the fetched roster", async () => {
    await renderRoster();
    expect(screen.getByText("Dr. AI One")).toBeTruthy();
    expect(screen.getByText("Dr. Health Two")).toBeTruthy();
    expect(screen.getByText("Dr. Joint Dup")).toBeTruthy();
  });

  it("recommends jury-selected apps by matched domain (AI prof → 1, Health prof → 1)", async () => {
    await renderRoster();
    // Dr. AI One (ai; robotics) matches the AI startup → recommended count 1
    const aiRow = screen.getByText("Dr. AI One").closest("tr");
    expect(aiRow.textContent).toMatch(/\b1\b/);
    // Dr. Health Two (health) matches the Health startup → 1
    const healthRow = screen.getByText("Dr. Health Two").closest("tr");
    expect(healthRow.textContent).toMatch(/\b1\b/);
  });

  it("domain filter narrows to matching professors", async () => {
    await renderRoster();
    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "health" } });
    expect(screen.queryByText("Dr. AI One")).toBeNull();
    expect(screen.getByText("Dr. Health Two")).toBeTruthy();
  });

  it("'Unique only' hides joint-appointment rows", async () => {
    await renderRoster();
    expect(screen.getByText("Dr. Joint Dup")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Unique only/i));
    expect(screen.queryByText("Dr. Joint Dup")).toBeNull();
  });

  it("Invite opens a name-prefilled modal and sends via createJuryInvites", async () => {
    await renderRoster();
    fireEvent.click(screen.getAllByText("Invite")[0]);
    expect(screen.getByDisplayValue("Dr. AI One")).toBeTruthy();      // name prefilled
    fireEvent.change(screen.getByLabelText("Invite email"), { target: { value: "aione@iisc.ac.in" } });
    fireEvent.click(screen.getByText("Send invite"));
    await waitFor(() => expect(adminPlatformApi.createJuryInvites).toHaveBeenCalledWith(
      [{ name: "Dr. AI One", email: "aione@iisc.ac.in" }]));
  });

  it("marks a professor already in the jury roster as Invited (disabled button)", async () => {
    mockData({ jurors: [{ id: "j1", name: "Dr. AI One" }] });
    await renderRoster();
    const aiRow = screen.getByText("Dr. AI One").closest("tr");
    expect(aiRow.textContent).toMatch(/Invited/);
    // its Invite button is disabled
    const btn = Array.from(aiRow.querySelectorAll("button")).find(b => /Invite|Invited/.test(b.textContent));
    expect(btn.disabled).toBe(true);
  });

  it("opens a detail drawer with fields, profile link, and recommended apps", async () => {
    await renderRoster();
    fireEvent.click(screen.getByText("Dr. AI One"));
    expect(screen.getByText(/does AI/)).toBeTruthy();                 // reasoning in drawer
    const link = screen.getByText(/View profile/i).closest("a");
    expect(link.getAttribute("href")).toBe("https://x/1");
    expect(screen.getByText("AI Startup")).toBeTruthy();             // recommended app listed
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/AdminIiscRoster.test.jsx`
Expected: FAIL (stub renders null).

- [ ] **Step 3: Implement the screen**

Replace `frontend/src/pages/admin/platform/screens/AdminIiscRoster.jsx` with:

```jsx
// AdminIiscRoster — A-7 · IISC JURY ROSTER (jury-mode candidate pool).
//
// Reads the static /iisc_professors.json (809 scraped IISc professors),
// renders a design-system table with filters + a detail drawer, recommends
// jury-selected (jury_review) applications to each professor by shared ARTPARK
// domain, and sends jury invites via the existing createJuryInvites flow.
import React, { useEffect, useMemo, useState } from "react";
import { useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { LABEL_TO_TOKEN, TOKEN_TO_LABEL, DOMAIN_TOKENS } from "../../../../lib/artparkDomains";
import { PageHead } from "../shell/osAtoms";
import { LoadingState, ErrorState } from "../ui.jsx";

const DRAWER_STYLES = `
  @keyframes osDrawerFadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes osDrawerSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
`;
const MATCH_TONE = { Yes: "purple", Partial: "amber", No: "" };
const norm = (s) => (s || "").toLowerCase().replace(/\./g, "").replace(/-/g, " ").replace(/\s+/g, " ").trim();
const tokensOf = (md) => (md || "").split(";").map(t => t.trim()).filter(t => t && t !== "—");

export function AdminIiscRoster({ go } = {}) {
  const [profs, setProfs] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setProfs(null); setLoadErr(null);
    fetch("/iisc_professors.json")
      .then(r => { if (!r.ok) throw new Error("Failed to load roster"); return r.json(); })
      .then(d => { if (alive) setProfs(Array.isArray(d) ? d : []); })
      .catch(e => { if (alive) setLoadErr(e); });
    return () => { alive = false; };
  }, [reloadKey]);

  const pipeline = useAdminData("pipeline");
  const jurorsData = useAdminData("jurors");

  // Jury-selected apps grouped by ARTPARK domain token.
  const appsByToken = useMemo(() => {
    const m = new Map();
    for (const s of (pipeline.data?.startups ?? [])) {
      if ((s.chip || "").toUpperCase() !== "JURY REVIEW") continue;
      const tok = LABEL_TO_TOKEN[s.domain];
      if (!tok) continue;
      if (!m.has(tok)) m.set(tok, []);
      m.get(tok).push(s);
    }
    return m;
  }, [pipeline.data]);

  const recommendFor = (md) => {
    const seen = new Set(); const out = [];
    for (const t of tokensOf(md)) for (const a of (appsByToken.get(t) || [])) {
      const k = `${a.track}:${a.id}`;
      if (!seen.has(k)) { seen.add(k); out.push(a); }
    }
    return out;
  };

  const invitedNames = useMemo(() => {
    const s = new Set();
    for (const j of (jurorsData.data?.jurors ?? [])) if (j.name) s.add(norm(j.name));
    for (const p of (jurorsData.data?.pendingInvites ?? [])) if (p.name) s.add(norm(p.name));
    return s;
  }, [jurorsData.data]);

  // Filters + sort.
  const [search, setSearch] = useState("");
  const [division, setDivision] = useState("");
  const [department, setDepartment] = useState("");
  const [match, setMatch] = useState("");
  const [domain, setDomain] = useState("");
  const [uniqueOnly, setUniqueOnly] = useState(false);
  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [detail, setDetail] = useState(null);
  const [invite, setInvite] = useState(null);

  const divisions = useMemo(() => Array.from(new Set((profs || []).map(p => p.division).filter(Boolean))).sort(), [profs]);
  const departments = useMemo(() => Array.from(new Set((profs || []).map(p => p.department).filter(Boolean))).sort(), [profs]);

  const rows = useMemo(() => {
    const q = norm(search);
    let list = (profs || [])
      .map(p => ({ ...p, recommended: recommendFor(p.matched_domains) }))
      .filter(p => {
        if (uniqueOnly && p.duplicate_joint_appointment === "Yes") return false;
        if (division && p.division !== division) return false;
        if (department && p.department !== department) return false;
        if (match && p.artpark_match !== match) return false;
        if (domain && !tokensOf(p.matched_domains).includes(domain)) return false;
        if (q && !norm(`${p.name} ${p.research_domain} ${p.subdomains} ${p.notable_work}`).includes(q)) return false;
        return true;
      });
    if (sortCol) {
      const dir = sortAsc ? 1 : -1;
      const rank = { Yes: 0, Partial: 1, No: 2 };
      list = [...list].sort((a, b) => {
        if (sortCol === "match") return (rank[a.artpark_match] - rank[b.artpark_match]) * dir;
        if (sortCol === "reco") return (a.recommended.length - b.recommended.length) * dir;
        return String(a[sortCol] || "").localeCompare(String(b[sortCol] || "")) * dir;
      });
    }
    return list;
  }, [profs, search, division, department, match, domain, uniqueOnly, sortCol, sortAsc, appsByToken]);

  const onSort = (col) => { if (sortCol === col) setSortAsc(a => !a); else { setSortCol(col); setSortAsc(true); } };
  const hdr = (label, col, isNum = false) => (
    <th className={isNum ? "num" : ""} onClick={() => onSort(col)} style={{ cursor: "pointer", userSelect: "none" }}>
      {label}{sortCol === col ? (sortAsc ? " ▲" : " ▼") : ""}
    </th>
  );
  const isInvited = (p) => invitedNames.has(norm(p.name));

  if (loadErr) return <div className="dash-scroll"><ErrorState error={loadErr} onRetry={() => setReloadKey(k => k + 1)} /></div>;
  if (profs === null) return <div className="dash-scroll"><LoadingState label="Loading IISc roster…" /></div>;

  return (
    <div className="dash-scroll">
      <style dangerouslySetInnerHTML={{ __html: DRAWER_STYLES }} />
      {go && (
        <button className="os-btn ghost sm" style={{ marginBottom: 12 }} onClick={() => go("dashboard")}>← Dashboard</button>
      )}
      <PageHead
        eyebrow="A-7 · IISC JURY ROSTER"
        title="IISc jury <em>roster</em>"
        sub="All IISc professors we scraped, scored against ARTPARK's domains. Open a professor for detail, see the jury-selected applications that match their expertise, and send an invite."
      />

      {/* Filter bar */}
      <div className="os-row gap-sm" style={{ flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <input className="os-input" aria-label="Search" placeholder="Search name, research, work…"
          style={{ minWidth: 220, fontSize: 13 }} value={search} onChange={e => setSearch(e.target.value)} />
        <select className="os-select" aria-label="Division" style={{ fontSize: 13 }} value={division} onChange={e => setDivision(e.target.value)}>
          <option value="">All divisions</option>
          {divisions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="os-select" aria-label="Department" style={{ fontSize: 13 }} value={department} onChange={e => setDepartment(e.target.value)}>
          <option value="">All departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="os-select" aria-label="Match" style={{ fontSize: 13 }} value={match} onChange={e => setMatch(e.target.value)}>
          <option value="">All matches</option><option>Yes</option><option>Partial</option><option>No</option>
        </select>
        <select className="os-select" aria-label="Domain" style={{ fontSize: 13 }} value={domain} onChange={e => setDomain(e.target.value)}>
          <option value="">All ARTPARK domains</option>
          {DOMAIN_TOKENS.map(t => <option key={t} value={t}>{TOKEN_TO_LABEL[t]}</option>)}
        </select>
        <label className="os-text-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={uniqueOnly} onChange={e => setUniqueOnly(e.target.checked)} aria-label="Unique only" />
          Unique only
        </label>
        <span className="os-mono os-text-sm os-text-dim" style={{ marginLeft: "auto" }}>{rows.length} of {profs.length}</span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="os-table">
          <thead><tr>
            {hdr("Professor", "name")}
            {hdr("Department", "department")}
            {hdr("ARTPARK match", "match")}
            <th>Matched domains</th>
            {hdr("Recommended apps", "reco", true)}
            <th></th>
          </tr></thead>
          <tbody>
            {rows.map((p, i) => {
              const invited = isInvited(p);
              return (
                <tr key={(p.name || "") + i}>
                  <td>
                    <a className="nm" onClick={() => setDetail(p)} style={{ cursor: "pointer" }}>{p.name || "—"}</a>
                    {p.duplicate_joint_appointment === "Yes" && <span className="os-chip" style={{ marginLeft: 6, fontSize: 9, padding: "1px 5px" }}>joint</span>}
                    <div className="os-text-soft" style={{ fontSize: 11.5 }}>{p.title || "—"}</div>
                  </td>
                  <td><span className="os-chip" style={{ fontSize: 11, padding: "2px 6px" }}>{p.department}</span>
                    <div className="os-text-soft" style={{ fontSize: 10, marginTop: 3 }}>{p.division}</div></td>
                  <td><span className={"os-chip " + (MATCH_TONE[p.artpark_match] || "")} style={{ fontWeight: 700 }}>{p.artpark_match}</span></td>
                  <td><div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 200 }}>
                    {tokensOf(p.matched_domains).length
                      ? tokensOf(p.matched_domains).map(t => <span key={t} className="dtag" style={{ fontFamily: "var(--mono)", fontSize: 10.5, padding: "2px 6px", border: "1px solid var(--line)", borderRadius: 5 }}>{t}</span>)
                      : <span className="os-text-soft">—</span>}
                  </div></td>
                  <td className="num">
                    <a className="nm" style={{ cursor: "pointer", fontWeight: 700 }} onClick={() => setDetail(p)}>{p.recommended.length}</a>
                  </td>
                  <td>
                    <button className="os-btn sm secondary" disabled={invited} onClick={() => setInvite(p)}>
                      {invited ? "Invited" : "Invite"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detail && <ProfDrawer prof={detail} onClose={() => setDetail(null)}
        onInvite={() => { setInvite(detail); }} invited={isInvited(detail)} />}
      {invite && <InviteModal prof={invite} onClose={() => setInvite(null)}
        onDone={() => { setInvite(null); jurorsData.reload(); }} />}
    </div>
  );
}

// ── Detail drawer ─────────────────────────────────────────────────────────────
function ProfDrawer({ prof, onClose, onInvite, invited }) {
  const recs = prof.recommended || [];
  return (
    <div className="os-drawer-backdrop" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(36,36,36,0.4)", backdropFilter: "blur(4px)", zIndex: 1000, display: "flex", justifyContent: "flex-end", animation: "osDrawerFadeIn 0.2s ease-out" }}>
      <div className="os-drawer" onClick={e => e.stopPropagation()}
        style={{ width: 720, maxWidth: "92vw", height: "100%", background: "var(--bg-paper)", borderLeft: "1px solid var(--line-strong)", boxShadow: "-10px 0 40px rgba(36,36,36,0.15)", display: "flex", flexDirection: "column", animation: "osDrawerSlideIn 0.3s cubic-bezier(0.16,1,0.3,1)" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>{prof.name}</div>
            <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 4 }}>{prof.title} · {prof.department} · {prof.division}</div>
          </div>
          <button className="os-btn sm ghost" onClick={onClose} style={{ padding: "2px 8px", fontSize: 18 }}>&times;</button>
        </div>
        <div style={{ padding: 24, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}>
          <Field label="Research domain">{prof.research_domain || "—"}</Field>
          <Field label="Subdomains">{prof.subdomains || "—"}</Field>
          <Field label="Notable work">{prof.notable_work || "—"}</Field>
          <Field label="ARTPARK match">
            <span className={"os-chip " + (MATCH_TONE[prof.artpark_match] || "")} style={{ fontWeight: 700 }}>{prof.artpark_match}</span>
            {" "}<span className="os-text-soft">{tokensOf(prof.matched_domains).join(", ") || "—"}</span>
            <div className="os-text-soft" style={{ fontSize: 12.5, marginTop: 6, fontStyle: "italic" }}>{prof.reasoning}</div>
          </Field>
          {prof.profile_url && (
            <a className="os-btn ghost sm" href={prof.profile_url} target="_blank" rel="noopener" style={{ alignSelf: "flex-start" }}>View profile ↗</a>
          )}
          <div>
            <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 8 }}>
              Recommended jury-selected applications ({recs.length})
            </div>
            {recs.length === 0
              ? <div className="os-text-soft" style={{ fontSize: 13 }}>No jury-selected applications match this professor's domains.</div>
              : <table className="os-table"><thead><tr><th>Project</th><th>Industry</th><th className="num">AI</th></tr></thead>
                  <tbody>{recs.map(a => (
                    <tr key={a.track + a.id}><td><div className="startup">{a.name}<small>{a.founders?.[0] || "—"}</small></div></td>
                      <td className="os-text-soft">{a.domain}</td>
                      <td className="num">{a.ai?.overall != null ? Number(a.ai.overall).toFixed(1) : "—"}</td></tr>
                  ))}</tbody></table>}
          </div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: 12, background: "var(--bg-soft)" }}>
          <button className="os-btn secondary" disabled={invited} onClick={onInvite}>{invited ? "Invited" : "Invite"}</button>
          <button className="os-btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
function Field({ label, children }) {
  return (<div><div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 13.5, color: "var(--ink)" }}>{children}</div></div>);
}

// ── Invite modal (single prof, name prefilled) ────────────────────────────────
function InviteModal({ prof, onClose, onDone }) {
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);
  const send = async () => {
    const e = email.trim();
    if (!e) { setErr("Enter an email."); return; }
    setSaving(true); setErr(null);
    try {
      const res = await adminPlatformApi.createJuryInvites([{ name: prof.name, email: e }]);
      setResult(res?.results?.[0] || { status: "invited" });
    } catch (ex) { setErr(ex?.message || "Invite failed."); setSaving(false); }
  };
  return (
    <div className="os-modal-backdrop" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(36,36,36,0.5)", backdropFilter: "blur(4px)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="os-modal" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 460, width: "92vw", background: "var(--bg-paper)", border: "1px solid var(--line-strong)", borderRadius: 4, boxShadow: "0 20px 60px rgba(36,36,36,0.18)" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Invite jury member</div>
          <button className="os-btn sm ghost" onClick={onClose} style={{ padding: "2px 8px", fontSize: 18 }}>&times;</button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          {result ? (
            <>
              <div className="os-text-sm">Invite to <b>{prof.name}</b>: <span className={"os-chip " + (result.status === "invited" ? "purple" : result.status === "already_invited" ? "amber" : "")}>{result.status.replace(/_/g, " ")}</span></div>
              <button className="os-btn" style={{ background: "#3213b7", color: "#fff" }} onClick={onDone}>Done</button>
            </>
          ) : (
            <>
              <div>
                <label className="os-text-xs os-text-dim os-uppercase" style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Name</label>
                <input className="os-input os-w-100" aria-label="Invite name" value={prof.name} readOnly />
              </div>
              <div>
                <label className="os-text-xs os-text-dim os-uppercase" style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>Email</label>
                <input className="os-input os-w-100" type="email" aria-label="Invite email" placeholder="name@iisc.ac.in" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              {err && <div style={{ color: "var(--bad)", fontSize: 13, fontWeight: 600 }}>{err}</div>}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
                <button className="os-btn secondary" onClick={onClose} disabled={saving}>Cancel</button>
                <button className="os-btn" style={{ background: "#3213b7", color: "#fff" }} onClick={send} disabled={saving}>{saving ? "Sending…" : "Send invite"}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminIiscRoster;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/AdminIiscRoster.test.jsx`
Expected: PASS (all 7 cases). If `PageHead`'s `title`/`sub` props differ from AdminJury's usage, mirror AdminJury.jsx's `PageHead` call exactly.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/AdminIiscRoster.jsx frontend/src/pages/admin/platform/screens/__tests__/AdminIiscRoster.test.jsx
git commit -m "feat(jury): IISc Jury Roster screen — table, detail drawer, domain recommendations, invite"
```

---

## Task 5: Verify + ship

**Files:** none (build + deploy).

- [ ] **Step 1: Run the new + neighbouring FE tests**

Run:
```bash
cd frontend && npx vitest run src/lib/__tests__/artparkDomains.test.js \
  src/pages/admin/platform/__tests__/AdminTabBar.test.jsx \
  src/pages/admin/platform/screens/__tests__/AdminIiscRoster.test.jsx \
  src/pages/admin/platform/__tests__/AdminJury.test.jsx
```
Expected: all PASS.

- [ ] **Step 2: Full jury/admin sweep + build**

Run:
```bash
cd frontend && npx vitest run src/pages/admin/platform && npm run build
```
Expected: build succeeds; only the ~2 documented pre-existing `AdminPipeline` "Batch A" failures remain (confirm any failure is in a file this plan did NOT touch).

- [ ] **Step 3: Push branch + verify origin tip**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/release-sip-launch-v1
git push origin release/sip-launch-v1
git rev-parse HEAD && git ls-remote origin release/sip-launch-v1
```
Expected: local HEAD == origin tip.

- [ ] **Step 4: Deploy**

This feature is **frontend-only** — no backend change, so **no SAM deploy is required** (the invite endpoint is already live in prod). Ship = **user promotes `release/sip-launch-v1` on Vercel**. Only if a backend change was introduced during the build (it should not have been) run `bash infra/sam/deploy-prod.sh` from the worktree after verifying `TIR_/SIP_SUBMISSIONS_CLOSED=true` in `backend/.env.prod`.

- [ ] **Step 5: Hand off**

Tell the user: code is on `release/sip-launch-v1`; **frontend Vercel promote is theirs**. After promote, verify in Jury Decision mode: (a) tab bar shows `Dashboard · IISc Jury Roster · Jury · Jury Selected · Final Gate` (no Applications/Rejected); (b) the roster lists all 809 with filters + "unique only"; (c) opening a professor shows detail + profile link + recommended jury-selected apps; (d) Invite sends the jury email; (e) reviewer mode is unchanged.

---

## Notes / gotchas for the implementer

- **Never** add a `Co-Authored-By` / AI trailer to commits (user's global rule).
- The pipeline row's `domain` is the industry **label** (`adminDataAdapter.js:73` → `row.industry`); that's why matching goes label→token. The 13 labels in `artparkDomains.js` are the real prod values (verified).
- Match-chip tones: **Yes→purple, Partial→amber, No→neutral** — no green anywhere (consistent with the jury recolor).
- `useAdminData("pipeline")` returns `{data:{startups}}`; `useAdminData("jurors")` returns `{data:{jurors, pendingInvites}}` — both already used by `AdminJury.jsx`.
- Already-invited matching is by **normalized name only** (the roster has no emails); it's best-effort — the authoritative invite state is the existing Jury tab.
- Show all **809** rows by default; "Unique only" hides `duplicate_joint_appointment === "Yes"`.
- If `PageHead` / `LoadingState` / `ErrorState` import paths differ, copy them verbatim from `AdminJury.jsx` (same directory depth).
