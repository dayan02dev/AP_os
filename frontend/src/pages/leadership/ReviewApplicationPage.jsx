// ReviewApplicationPage — full-screen deep-review surface for a single app.
//
// Reachable from the leadership drawer's "Review application" button at:
//   /leadership/applications/:track/:id/review
//
// Loads the full detail via leadershipApi.getApplication(id) — the backend
// infers track from the id, so the URL's :track is canonical for routing
// purposes only (drives schema selection + the "TIR-…/SIP-…" identifier).
//
// State machine of side effects:
//   - On mount: kick off detail fetch, hydrate prev/next id list from
//     sessionStorage (or fetch and cache if absent), hydrate aside collapsed
//     state from localStorage.
//   - On id change (Prev / Next): refetch detail, update URL via navigate().
//   - On panel toggle: persist to localStorage so a reload keeps the choice.
//   - On Back: navigate(-1) to preserve scroll/state. Falls back to a hard
//     route if history is empty (direct URL).
//
// Capability gate: applied at the router layer (LeadershipReviewRoute). This
// component assumes the caller already has `view_app_detail`.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { leadershipApi } from "../../lib/leadershipApi.js";
import { labelFor } from "../../lib/statusMachine.js";
import { printWithTitle } from "../../lib/printDocument.js";
import { trackLabel } from "../../lib/trackLabel.js";
import { moveBadgeText } from "../../lib/trackMove";
import { schemaFor } from "./applicationSchemas.js";
import ReviewHeader from "./review/ReviewHeader.jsx";
import ReviewTabs from "./review/ReviewTabs.jsx";
import ApplicationTab from "./review/ApplicationTab.jsx";
import ReviewsTab from "./review/ReviewsTab.jsx";
import HistoryTab from "./review/HistoryTab.jsx";
import AIScreeningPanel from "./review/AIScreeningPanel.jsx";
import "../../styles/admin.css";
import "../../styles/leadership.css";
import "../../styles/review-application.css";

const ID_LIST_KEY = "review_app_id_list";
const PANEL_KEY = "review_panel_collapsed";

function readIdList() {
  try {
    const raw = sessionStorage.getItem(ID_LIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((e) => e && e.id && e.track);
  } catch {
    return null;
  }
}

function writeIdList(list) {
  try {
    sessionStorage.setItem(ID_LIST_KEY, JSON.stringify(list));
  } catch {
    // sessionStorage full or unavailable — graceful no-op. Prev/Next falls
    // back to disabled at the page level.
  }
}

function readPanelCollapsed() {
  try {
    return localStorage.getItem(PANEL_KEY) === "true";
  } catch {
    return false;
  }
}
function writePanelCollapsed(v) {
  try {
    localStorage.setItem(PANEL_KEY, v ? "true" : "false");
  } catch {
    // ignore
  }
}

function composeAppIdentifier(track, id, submittedAt, createdAt) {
  const prefix = trackLabel(track);
  let year = new Date().getFullYear();
  const iso = submittedAt || createdAt;
  if (iso) {
    try { year = new Date(iso).getFullYear(); } catch { /* keep default */ }
  }
  const tail = (id || "").slice(0, 8) || "unknown";
  return `${prefix}-${year}-${tail}`;
}

export default function ReviewApplicationPage() {
  const { track, id } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [tab, setTab] = useState("application");
  const [pendingPrint, setPendingPrint] = useState(false);

  const [asideCollapsed, setAsideCollapsed] = useState(() => readPanelCollapsed());

  const [idList, setIdList] = useState(() => readIdList() || []);

  // ─── Detail fetch ─────────────────────────────────────────
  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    leadershipApi.getApplication(id)
      .then((d) => { if (!cancelled) { setDetail(d); setLoading(false); } })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.details?.message || err?.message || "Failed to load application.");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, reloadKey]);

  // ─── Id list cache for Prev / Next ────────────────────────
  useEffect(() => {
    if (idList.length > 0) return undefined;
    let cancelled = false;
    leadershipApi.listApplications({ limit: 200, offset: 0 })
      .then((page) => {
        if (cancelled) return;
        const list = (page?.applications || [])
          .map((a) => ({ track: a.track, id: a.id }))
          .filter((e) => e.id && e.track);
        if (list.length > 0) {
          setIdList(list);
          writeIdList(list);
        }
      })
      .catch(() => {
        // Best-effort. Prev/Next stays disabled if the list never lands.
      });
    return () => { cancelled = true; };
  }, [idList.length]);

  // ─── Reset tab to Application on app change ───────────────
  useEffect(() => {
    setTab("application");
  }, [id]);

  // ─── Persist panel collapsed state ────────────────────────
  useEffect(() => {
    writePanelCollapsed(asideCollapsed);
  }, [asideCollapsed]);

  // ─── Memo derivations ─────────────────────────────────────
  const schema = useMemo(() => schemaFor(track), [track]);
  const application = detail?.application || null;
  const aiScreening = detail?.ai_screening || null;
  const reviews = detail?.reviews || [];
  const assignments = detail?.reviewer_assignments || [];
  const history = detail?.status_history || [];

  const currentIndex = useMemo(() => {
    if (!idList || idList.length === 0) return -1;
    return idList.findIndex((e) => e.id === id);
  }, [idList, id]);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < idList.length - 1;

  const appIdentifier = useMemo(
    () => composeAppIdentifier(track, id, application?.submitted_at, application?.created_at),
    [track, id, application?.submitted_at, application?.created_at],
  );

  const companyName =
    aiScreening?.project_name ||
    application?.basic_org_name ||
    application?.basic_org ||
    application?.basic_full_name ||
    "";
  const scoreOverall = aiScreening?.score_overall;
  const hasScore =
    typeof scoreOverall === "number" && Number.isFinite(scoreOverall);

  const handleExportPdf = useCallback(() => {
    if (!detail) return;
    if (tab !== "application") setTab("application");
    setPendingPrint(true);
  }, [detail, tab]);

  // ─── PDF export: print once the Application tab is mounted ────────────
  useEffect(() => {
    if (!pendingPrint || tab !== "application" || !detail) return undefined;
    const raf = requestAnimationFrame(() => {
      const title = companyName ? `${appIdentifier} — ${companyName}` : appIdentifier;
      printWithTitle(title);
      setPendingPrint(false);
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingPrint, tab, detail, appIdentifier, companyName]);

  // ─── Handlers ─────────────────────────────────────────────
  // Back always lands at the leadership dashboard, NOT navigate(-1). Reason:
  // every Prev/Next step pushes to history, so navigate(-1) would walk back
  // through the review flow instead of jumping out of it. Browser scroll
  // restoration still kicks in on the destination route.
  const goBack = useCallback(() => {
    navigate("/leadership");
  }, [navigate]);

  const goPrev = useCallback(() => {
    if (!hasPrev) return;
    const prev = idList[currentIndex - 1];
    navigate(`/leadership/applications/${prev.track}/${prev.id}/review`);
  }, [hasPrev, idList, currentIndex, navigate]);

  const goNext = useCallback(() => {
    if (!hasNext) return;
    const next = idList[currentIndex + 1];
    navigate(`/leadership/applications/${next.track}/${next.id}/review`);
  }, [hasNext, idList, currentIndex, navigate]);

  const toggleAside = useCallback(() => {
    setAsideCollapsed((v) => !v);
  }, []);

  // ─── Keyboard navigation: ← / → ───────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft" && hasPrev) { goPrev(); }
      else if (e.key === "ArrowRight" && hasNext) { goNext(); }
      else if (e.key === "Escape") { goBack(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, goBack, hasPrev, hasNext]);

  return (
    <div className="review-page">
      <ReviewHeader
        appId={appIdentifier}
        status={application?.status || null}
        scoreOverall={aiScreening?.score_overall}
        onBack={goBack}
        onPrev={goPrev}
        onNext={goNext}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onToggleAside={toggleAside}
        asideCollapsed={asideCollapsed}
        onExport={handleExportPdf}
        canExport={!!detail}
      />
      {moveBadgeText(track, application?.moved_to_track) && (
        <span style={{ marginLeft: 12, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em',
          textTransform: 'uppercase', background: '#fff4d6', border: '1px solid #e6c34d',
          color: '#8a6d00', borderRadius: 999, padding: '3px 11px', display: 'inline-flex',
          alignItems: 'center', gap: 6, verticalAlign: 'middle' }}>
          {moveBadgeText(track, application?.moved_to_track)}
        </span>
      )}

      <div className="review-body" data-aside-collapsed={asideCollapsed ? "true" : "false"}>
        <main className="review-main">
          <div className="review-main-inner">
            {error && (
              <div className="inline-error" role="alert">{error}</div>
            )}
            {loading && !detail && !error && (
              <div className="inline-loading">Loading application…</div>
            )}

            {!error && detail && (
              <>
                <div className="review-print-title" aria-hidden="true">
                  <h1>{appIdentifier}</h1>
                  {companyName && <p className="rpt-company">{companyName}</p>}
                  <p className="rpt-meta">
                    {labelFor(application?.status)} · AI score{" "}
                    {hasScore ? scoreOverall.toFixed(1) : "—"} / 10
                  </p>
                </div>
                <ReviewTabs tab={tab} onChange={setTab} />
                {tab === "application" && (
                  <ApplicationTab
                    schema={schema}
                    application={application}
                    applicationId={id}
                    signedUrl={(appId, path) => leadershipApi.fileSignedUrl(appId, path)}
                  />
                )}
                {tab === "reviews" && (
                  <ReviewsTab reviews={reviews} assignments={assignments} />
                )}
                {tab === "history" && (
                  <HistoryTab history={history} />
                )}
              </>
            )}
          </div>
        </main>

        {!asideCollapsed && (
          <AIScreeningPanel
            aiScreening={aiScreening}
            assignments={assignments}
            onClose={toggleAside}
          />
        )}
      </div>
    </div>
  );
}
