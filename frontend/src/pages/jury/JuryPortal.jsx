// Jury Portal — shell. Mirrors reviewer/v2/ReviewerPortal.jsx (topbar / tabs /
// useAsync data-lift / PortalSwitcher / CSS import), reworked for the pick-3
// flow: the shell OWNS the selection state and renders a PickBar on every tab.
//
// `tab` prop selects the active surface:
//   "queue" → My Applications (/jury, /jury/queue)
//   "picks" → My Picks        (/jury/picks)
//   "eval"  → read-only detail (/jury/eval/:track/:appId)
//
// There is NO scoring anywhere in this portal — jurors pick applications to
// mentor, capped at exactly 3, and submit the set.

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";

import "../../styles/reviewer-portal.css";
import "./jury.css";

import { useAuth } from "../../hooks/useAuth.jsx";
import { useAsync } from "../../hooks/useAsync.js";
import { juryApi } from "../../lib/juryApi.js";
import { COHORT_LABEL, initialsOf } from "./ui.jsx";
import PortalSwitcher from "../../components/PortalSwitcher.jsx";

import JuryQueue from "./JuryQueue.jsx";
import JuryAppView from "./JuryAppView.jsx";
import JuryPicks from "./JuryPicks.jsx";

const keyOf = (id, track) => id + ":" + track;

// ── Topbar (green JURY MEMBER branding) ────────────────────────────────
function JuryTopbar({ tab }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const crumb =
    tab === "picks" ? "MY PICKS"
    : tab === "eval" ? "APPLICATION"
    : "MY APPLICATIONS";

  const initials = initialsOf(user?.full_name, user?.email);
  const email = user?.email || "juror@artpark.in";

  const signOut = async () => {
    await logout();
    navigate("/apply/signin");
  };

  return (
    <div className="lp-topbar">
      <button className="lp-home-btn" onClick={() => navigate("/jury")}>← HOME</button>

      <div className="lp-brand">
        <img
          src="/assets/artpark-iisc-logo.webp"
          alt="ARTPARK · AI & Robotics Technology Park at IISc"
          className="lp-brand-combined"
        />
      </div>

      <div className="lp-topbar-crumb">
        <div className="lp-topbar-pill">
          <span className="lp-live-dot" />
          <span>JURY MEMBER · {crumb}</span>
        </div>
      </div>

      <div className="lp-topbar-right">
        <div className="lp-topbar-user" style={{ cursor: "default" }}>
          <div
            className="os-avatar"
            style={{ width: 28, height: 28, fontSize: 11, flexShrink: 0, background: "#3213b7", color: "#fff" }}
          >
            {initials}
          </div>
          <span>{email}</span>
        </div>
        <PortalSwitcher current="jury" />
        <button className="lp-signout" onClick={signOut}>SIGN OUT ↗</button>
      </div>
    </div>
  );
}

// ── Cohort page header ─────────────────────────────────────────────────
function JuryCohortHeader() {
  return (
    <div className="lp-page-header">
      <div className="lp-breadcrumb" style={{ marginBottom: 8 }}>ARTPARK / OS · Jury Portal</div>
      <div className="lp-header-row">
        <div>
          <h1 className="lp-cohort-title">
            {COHORT_LABEL.replace(/ 2026$/, "")} <span className="lp-year">2026</span>
          </h1>
        </div>
      </div>
    </div>
  );
}

// ── Tab bar ────────────────────────────────────────────────────────────
function JuryTabBar({ tab, queueCount, pickCount }) {
  const navigate = useNavigate();
  return (
    <div className="lp-tabs">
      <div className={`lp-tab${tab === "queue" ? " active" : ""}`} onClick={() => navigate("/jury")}>
        <div className="lp-tab-label">
          My Applications
          {queueCount != null && <span className="lp-tab-badge">{queueCount}</span>}
        </div>
        <div className="lp-tab-sub">ASSIGNED STARTUPS</div>
      </div>
      <div className={`lp-tab${tab === "picks" ? " active" : ""}`} onClick={() => navigate("/jury/picks")}>
        <div className="lp-tab-label">
          My Picks
          <span className="lp-tab-badge">{pickCount} / 3</span>
        </div>
        <div className="lp-tab-sub">STARTUPS TO MENTOR</div>
      </div>
    </div>
  );
}

// ── PickBar (rendered on every tab) ─────────────────────────────────────
function PickBar({ picks, queue, setNote, submitPicks, submitting, submitMsg }) {
  const byKey = new Map(queue.map((q) => [keyOf(q.id, q.track), q]));
  return (
    <div className="jry-pickbar">
      <div className="jry-pickbar-inner">
        <div className="jry-pickbar-head">
          <span className="jry-pickbar-count">{`Your picks: ${picks.length} / 3`}</span>
          <span className="jry-pickbar-hint">Pick exactly 3 startups to mentor.</span>
        </div>
        <div className="jry-pickbar-notes">
          {picks.length === 0 && (
            <span className="jry-pickbar-empty">No picks yet — use the ☆ Pick button in the table.</span>
          )}
          {picks.map((p) => {
            const row = byKey.get(keyOf(p.application_id, p.application_track));
            return (
              <div className="jry-pickbar-note" key={keyOf(p.application_id, p.application_track)}>
                <span className="jry-pickbar-note-label">{row?.name || "Application"}</span>
                <textarea
                  placeholder="Optional note…"
                  value={p.note || ""}
                  onChange={(e) => setNote(p.application_id, p.application_track, e.target.value)}
                />
              </div>
            );
          })}
        </div>
        <div className="jry-pickbar-actions">
          <button
            className="jry-pickbar-submit"
            disabled={picks.length !== 3 || submitting}
            onClick={submitPicks}
          >
            {submitting ? "Submitting…" : "Submit picks"}
          </button>
          {submitMsg && <span className={"jry-pickbar-msg " + submitMsg.kind}>{submitMsg.text}</span>}
        </div>
      </div>
    </div>
  );
}

export default function JuryPortal({ tab = "queue" }) {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
  const initialDomain = location.state?.domain || "all";

  const openEval = (track, appId) => navigate(`/jury/eval/${track}/${appId}`);

  // Single queue fetch, lifted into the shell and shared by the table, the tab
  // badge, the pick bar (names), My Picks (cards), and the detail neighbours.
  const queueAsync = useAsync(() => juryApi.getQueue(), []);
  const queue = queueAsync.data || [];
  const queueCount = queueAsync.data ? queueAsync.data.length : null;

  // ── Selection state (the shell owns it) ──────────────────────────────
  const [picks, setPicks] = useState([]);
  const selAsync = useAsync(() => juryApi.getMySelections(), []);
  useEffect(() => {
    if (selAsync.data) {
      setPicks((selAsync.data.selections || []).map((s) => ({
        application_id: s.application_id,
        application_track: s.application_track,
        note: s.note || "",
      })));
    }
  }, [selAsync.data]);

  const togglePick = (row) =>
    setPicks((p) => {
      const me = { application_id: row.id, application_track: row.track, note: "" };
      const k = (x) => keyOf(x.application_id, x.application_track);
      return p.some((x) => k(x) === k(me))
        ? p.filter((x) => k(x) !== k(me))
        : p.length >= 3
          ? p
          : [...p, me];
    });

  const setNote = (application_id, application_track, note) =>
    setPicks((p) => p.map((x) =>
      x.application_id === application_id && x.application_track === application_track
        ? { ...x, note }
        : x));

  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState(null); // { kind: "ok"|"error", text }
  const [lastSubmittedAt, setLastSubmittedAt] = useState(null);

  const submitPicks = async () => {
    if (picks.length !== 3 || submitting) return;
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const res = await juryApi.putSelections(picks);
      if (res?.submitted_at) setLastSubmittedAt(res.submitted_at);
      await selAsync.reload();
      setSubmitMsg({ kind: "ok", text: "Picks submitted ✓" });
    } catch (err) {
      if (err?.status === 409 || err?.code === "app_already_decided") {
        setSubmitMsg({
          kind: "error",
          text: "One of your picks already has a final decision and can't be changed.",
        });
      } else {
        setSubmitMsg({ kind: "error", text: err?.message || "Couldn't submit your picks. Try again." });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const serverSubmittedAt = useMemo(() => {
    const rows = selAsync.data?.selections || [];
    const times = rows.map((r) => r.submitted_at).filter(Boolean).sort();
    return times.length ? times[times.length - 1] : null;
  }, [selAsync.data]);
  const submittedAt = lastSubmittedAt || serverSubmittedAt;

  return (
    <div className="rv-portal jry-portal os-shell">
      <JuryTopbar tab={tab} />
      <div className="lp-layout">
        {tab !== "eval" && <JuryCohortHeader />}
        {tab !== "eval" && <JuryTabBar tab={tab} queueCount={queueCount} pickCount={picks.length} />}

        {tab === "queue" && (
          <JuryQueue
            onOpen={openEval}
            initialDomain={initialDomain}
            queueAsync={queueAsync}
            picks={picks}
            togglePick={togglePick}
          />
        )}
        {tab === "picks" && (
          <JuryPicks
            picks={picks}
            queue={queue}
            setNote={setNote}
            submittedAt={submittedAt}
            onOpen={openEval}
          />
        )}
        {tab === "eval" && (
          <div className="lp-tab-content lp-tab-content--full">
            <JuryAppView
              track={params.track}
              appId={params.appId}
              onBack={() => navigate("/jury/queue")}
              onOpen={openEval}
              queue={queue}
              picks={picks}
              togglePick={togglePick}
              setNote={setNote}
            />
          </div>
        )}

        <PickBar
          picks={picks}
          queue={queue}
          setNote={setNote}
          submitPicks={submitPicks}
          submitting={submitting}
          submitMsg={submitMsg}
        />
      </div>
    </div>
  );
}
