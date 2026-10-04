// ReviewApplicationPage — full-screen deep-review surface for a single app.
//
// Reachable from the leadership drawer's "Review application" button at:
//   /leadership/applications/:track/:id/review
//
// Loads the full detail via leadershipApi.getApplication(id) — the backend
// infers track from the id. The URL's :track is the NATIVE track, but the
// detail's `native_track` wins once loaded (old links may carry the effective
// one): it picks the question schema. The identifier is the detail's
// display_id.
//
// State machine of side effects:
//   - On mount: kick off detail fetch, hydrate the prev/next id list the
//     dashboard stored (reviewNav.js — the user's filtered + sorted list),
//     hydrate aside collapsed state from localStorage.
//   - On id change (Prev / Next): refetch detail, update URL via navigate().
//   - On panel toggle: persist to localStorage so a reload keeps the choice.
//   - On Back: /leadership — the dashboard's sticky state restores the tab,
//     filters, sort and page the user left.
//
// Capability gate: applied at the router layer (LeadershipReviewRoute). This
// component assumes the caller already has `view_app_detail`.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { readVipMemo, writeVipMemo } from "../../lib/vipMemoCache.js";
import { leadershipApi } from "../../lib/leadershipApi.js";
import { printWithTitle } from "../../lib/printDocument.js";
import { trackLabel, relabelDisplayId } from "../../lib/trackLabel.js";
import { moveBadgeText } from "../../lib/trackMove";
import { schemaFor } from "./applicationSchemas.js";
import { statusLabel } from "./pipelineStages.js";
import { ID_LIST_EVENT, readReviewIdList } from "./reviewNav.js";
import ReviewHeader from "./review/ReviewHeader.jsx";
import ReviewTabs from "./review/ReviewTabs.jsx";
import ApplicationTab from "./review/ApplicationTab.jsx";
import ReviewsTab from "./review/ReviewsTab.jsx";
import HistoryTab from "./review/HistoryTab.jsx";
import AIScreeningPanel from "./review/AIScreeningPanel.jsx";
import VipMemoPreview from "../../components/VipMemoPreview.jsx";
import "../../styles/admin.css";
import "../../styles/leadership.css";
import "../../styles/review-application.css";
import "../../styles/vip-memo.css";

const PILOT_VIP_IDS = new Set([
  "0117bc80-98c1-4172-bccd-af61327ac580",
  "c8e45451-b9eb-4bed-8293-7a6782237168",
]);
const PANEL_KEY = "review_panel_collapsed";

// The PDF export prints the live DOM; the VIP memo is not part of the
// application, so keep it out of any print (Export PDF or the browser's own).
const PRINT_HIDE_MEMO = "@media print { .review-page .vip-memo-actions { display: none !important; } }";

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
  const [vipMemo, setVipMemo] = useState(null);
  const [vipMemoBusy, setVipMemoBusy] = useState(false);

  const [idList, setIdList] = useState(() => readReviewIdList() || []);

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

  // ─── Prev / Next list ─────────────────────────────────────
  // Only the list the dashboard stored (the user's filters + sort). It may be
  // swapped for the complete list after mount; with no list (direct URL)
  // Prev/Next stay disabled.
  useEffect(() => {
    const onList = () => setIdList(readReviewIdList() || []);
    window.addEventListener(ID_LIST_EVENT, onList);
    return () => window.removeEventListener(ID_LIST_EVENT, onList);
  }, []);

  // ─── Reset tab to Application on app change ───────────────
  useEffect(() => {
    setTab("application");
  }, [id]);

  // ─── Persist panel collapsed state ────────────────────────
  useEffect(() => {
    writePanelCollapsed(asideCollapsed);
  }, [asideCollapsed]);

  // ─── Memo derivations ─────────────────────────────────────
  // Native track drives the schema + move badge; the effective one is what the
  // VIP memo endpoint checks.
  const nativeTrack = detail?.native_track || track;
  const effectiveTrack = detail?.track || track;
  const schema = useMemo(() => schemaFor(nativeTrack), [nativeTrack]);
  const application = detail?.application || null;
  const aiScreening = detail?.ai_screening || null;
  const reviews = detail?.reviews || [];
  const assignments = detail?.reviewer_assignments || [];
  const history = detail?.status_history || [];
  // Reviewer names the detail already carries, for History actors the
  // backend didn't name.
  const actorNames = useMemo(() => {
    const out = {};
    for (const r of [...assignments, ...reviews]) {
      const name = r?.reviewer_name || r?.reviewer_full_name || r?.reviewer_email;
      if (r?.reviewer_user_id && name) out[r.reviewer_user_id] = name;
    }
    return out;
  }, [assignments, reviews]);

  const currentIndex = useMemo(() => {
    if (!idList || idList.length === 0) return -1;
    return idList.findIndex((e) => e.id === id);
  }, [idList, id]);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < idList.length - 1;

  const appIdentifier = useMemo(
    () => (detail?.display_id
      ? relabelDisplayId(detail.display_id)
      : composeAppIdentifier(effectiveTrack, id, application?.submitted_at, application?.created_at)),
    [detail?.display_id, effectiveTrack, id, application?.submitted_at, application?.created_at],
  );
  // Same label as the dashboard row when we came from it (gate + IC-memo
  // aware); otherwise the raw status through the shared map.
  const listLabel = currentIndex >= 0 ? idList[currentIndex]?.label : null;
  const stageLabelText = listLabel || (application?.status ? statusLabel(application.status) : null);

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

  const generateVipMemo = useCallback(async () => {
    if (effectiveTrack !== "sip" || !id) return;
    setVipMemoBusy(true);
    try {
      const response = await leadershipApi.generateVipMemo(id);
      setVipMemo(response.memo || null);
      writeVipMemo(id, response.memo);
    } catch (err) {
      setError(err?.message || "Could not generate VIP memo.");
    } finally {
      setVipMemoBusy(false);
    }
  }, [effectiveTrack, id]);

  const downloadVipMemo = useCallback(async (format) => {
    const blob = await leadershipApi.downloadVipMemo(id, format);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vip-memo-${id}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  }, [id]);

  useEffect(() => {
    if (!detail || effectiveTrack !== "sip" || !PILOT_VIP_IDS.has(id)) return;
    const cached = readVipMemo(id);
    if (cached) {
      setVipMemo(cached);
      return;
    }
    generateVipMemo();
  }, [detail, effectiveTrack, id, generateVipMemo]);

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
        statusLabel={stageLabelText}
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
      {moveBadgeText(nativeTrack, detail?.moved_to_track) && (
        <span style={{ marginLeft: 12, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em',
          textTransform: 'uppercase', background: '#fff4d6', border: '1px solid #e6c34d',
          color: '#8a6d00', borderRadius: 999, padding: '3px 11px', display: 'inline-flex',
          alignItems: 'center', gap: 6, verticalAlign: 'middle' }}>
          {moveBadgeText(nativeTrack, detail?.moved_to_track)}
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
                    {stageLabelText || "—"} · AI score{" "}
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
                {/* VIP memo: Application tab only, never in print. */}
                {effectiveTrack === "sip" && tab === "application" && !pendingPrint && (
                  <div className="vip-memo-actions">
                    <style>{PRINT_HIDE_MEMO}</style>
                    {vipMemoBusy && <p className="vip-memo-status">Preparing the investment memo — this can take a moment.</p>}
                    <VipMemoPreview memo={vipMemo} onDownload={downloadVipMemo} generating={vipMemoBusy} />
                  </div>
                )}
                {tab === "reviews" && (
                  <ReviewsTab reviews={reviews} assignments={assignments} />
                )}
                {tab === "history" && (
                  <HistoryTab history={history} actorNames={actorNames} />
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
