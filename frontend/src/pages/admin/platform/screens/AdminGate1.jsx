// AdminGate1 — A-4 Gate 1 Review, 4 workflow variants.
//
// Faithful port of admin-2.jsx AdminGate1 + GateReviewStack / GateReviewCutoff /
// GateReviewBatchDecision / GateReviewHistory.  Prototype markup is preserved
// VERBATIM (classes, histogram, gate-kpi*, os-reco-btn, os-grid-evaluation, etc.).
//
// DATA SOURCE
//   useAdminData("pipeline", { status: "evaluated" }) → data.startups
//   Each row: { id, applicationId, track, name, founders, domain, stage,
//               ai: { overall }, rev: undefined, flags: [], chip,
//               flag, adminDecision, batch, sub }
//
// SCORE FIELD
//   Prototype reads s.rev.overall / s.rev[k].  Since list rows carry no
//   per-reviewer breakdown (rev is always undefined on the pipeline list),
//   every rev-access is guarded:
//     reviewer overall  → s.rev?.overall ?? s.ai?.overall ?? null
//     per-category k    → s.rev?.[k]     (shows '—' if absent)
//   For the Cutoff histogram (score-based partitioning), we use s.ai?.overall
//   exactly as the previous AdminGate1Review.jsx did.
//
// PERSISTENCE
//   All prototype mock-data calls are replaced with
//   adminPlatformApi.decide(track, id, body) / bulkDecide(body) + reload().
//   BUTTON_TO_DECISION maps the prototype button labels ('approve', 'waitlist',
//   'reject') to wire decision ids ('shortlisted', 'waitlisted', 'rejected').
//   The batch/history variants use the prototype's uppercase decision strings
//   ('APPROVED', 'HOLD', 'REJECTED') internally for UI state; they are
//   normalised to wire ids before the API call via UPPER_TO_WIRE below.

import { useState, useMemo, useCallback, useEffect } from "react";

import { useAdminData, loadDetail } from "../../../../hooks/useAdminData";
import { useStickyState } from "../../../../hooks/useStickyState.js";
import { adminPlatformApi }  from "../../../../lib/adminPlatformApi";
import { BUTTON_TO_DECISION } from "../../../../lib/adminDataAdapter";
import { moveButtonLabel } from "../../../../lib/trackMove";
import { PageHead, Chip, FlagDot } from "../shell/osAtoms";
import { ComparativeReviewModel } from "./ComparativeReviewModel";
import ApplicationSummaryCard from "./ApplicationSummaryCard";
import { LoadingState, ErrorState, EmptyState } from "../ui.jsx";

// ── Decision wiring ────────────────────────────────────────────────────────
// The prototype's batch/history variants store 'APPROVED' | 'HOLD' | 'REJECTED'
// as adminDecision.  Map those to wire ids for the API.
export const UPPER_TO_WIRE = {
  APPROVED: "jury_review", // = "advance to jury"; the decision that emails the applicant
  REJECTED: "rejected",
};

// Decision ids whose API call requires a non-blank rationale.
const WIRE_DECISIONS = [
  { id: "shortlisted", label: "Shortlist",  tone: "approve",  needsRationale: false },
  { id: "on_hold",     label: "Hold",       tone: "waitlist", needsRationale: true  },
  { id: "rejected",    label: "Reject",     tone: "reject",   needsRationale: true  },
  { id: "waitlisted",  label: "Waitlist",   tone: "waitlist", needsRationale: true  },
];

// ── Pure helpers (exported for unit tests) ───────────────────────────────────

/** True when a single decision may be submitted.  Shortlist needs no rationale;
 *  hold / reject / waitlist require a non-blank one; unknown ids fail. */
export function canSubmitDecision(decisionId, rationale) {
  if (!decisionId) return false;
  const opt = WIRE_DECISIONS.find(d => d.id === decisionId);
  if (!opt) return false;
  if (!opt.needsRationale) return true;
  return (rationale || "").trim().length > 0;
}

/** True when the given wire decision id requires a rationale. */
export function decisionNeedsRationale(decisionId) {
  const opt = WIRE_DECISIONS.find(d => d.id === decisionId);
  return !!opt && opt.needsRationale;
}

/** Build the bulkDecide items array from a {appId → decisionId} draft map and
 *  source rows, attaching a rationale via rationaleFor(row, decision).
 *  Returns { items, missingRationale } where missingRationale lists ids whose
 *  drafted decision needs a rationale but has none. */
export function buildBulkItems(draftMap, rows, rationaleFor) {
  const byId = new Map((rows || []).map(r => [r?.id, r]));
  const items = [];
  const missingRationale = [];
  for (const [id, decision] of Object.entries(draftMap || {})) {
    if (!decision) continue;
    const row = byId.get(id) ?? byId.get(Number(id));
    if (!row) continue;
    const rationale = (rationaleFor ? rationaleFor(row, decision) : "") || "";
    if (decisionNeedsRationale(decision) && !rationale.trim()) {
      missingRationale.push(id);
      continue;
    }
    items.push({
      track:          row.track,
      application_id: row.id,
      decision,
      rationale:      rationale.trim() || undefined,
    });
  }
  return { items, missingRationale };
}

/** Split rows into above/below a cutoff value (uses ai_score_overall field).
 *  Rows in the overrides Set are pulled into a separate `overridden` bucket. */
export function partitionByCutoff(rows, cutoff, overrides) {
  const ov = overrides || new Set();
  const above = [], below = [], overridden = [];
  for (const r of rows || []) {
    if (ov.has(r?.id)) { overridden.push(r); continue; }
    const score = typeof r?.ai_score_overall === "number" ? r.ai_score_overall : -1;
    if (score >= cutoff) above.push(r);
    else below.push(r);
  }
  return { above, below, overridden };
}

/** Summarize a bulkDecide API response into { ok, failures: [{id, status}] }. */
export function summarizeBulkResults(resp) {
  const results  = resp?.results ?? [];
  const failures = results.filter(x => x?.status && x.status !== "decided").map(x => ({ id: x.application_id, status: x.status }));
  return { ok: results.length - failures.length, failures };
}

// The API requires a rationale for hold/reject/waitlist.
const WIRE_NEEDS_RATIONALE = new Set(["on_hold", "rejected", "waitlisted"]);

// ── Small helpers ──────────────────────────────────────────────────────────
function revScore(s) {
  // Reviewer overall if available (detail-loaded rows), else AI overall.
  const v = s?.rev?.overall ?? s?.ai?.overall ?? null;
  return typeof v === "number" ? v : null;
}

function revCat(s, k) {
  return typeof s?.rev?.[k] === "number" ? s.rev[k] : null;
}

function fmtScore(n) {
  return n != null ? n.toFixed(1) : "—";
}

function decisionTone(dec) {
  if (dec === "APPROVED")   return "green";
  if (dec === "HOLD")       return "amber";
  if (dec === "REJECTED")   return "red";
  if (dec === "WAITLISTED") return "slate";
  return "";
}

function recoTone(reco) {
  const r = (reco || "").toLowerCase();
  if (r === "yes" || r === "approve") return "green";
  if (r === "maybe" || r === "waitlist") return "amber";
  return "red";
}

// ── Inline note banner ─────────────────────────────────────────────────────
function Note({ note, onDismiss }) {
  if (!note) return null;
  const cls = note.kind === "error" ? "is-error" : "is-ok";
  return (
    <div className={"g1-note " + cls}>
      <span>{note.text}</span>
      <button className="g1-note-x" onClick={onDismiss} aria-label="Dismiss">×</button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// VARIANT A · Status Stack (prototype: GateReviewStack)
// ══════════════════════════════════════════════════════════════════════════
function GateReviewStack({ items, reload, goDetail }) {
  // Sticky, not plain state: opening an application unmounts this screen
  // entirely, and a decision remounts it via the `key` below — both used to
  // snap the reviewer back to 1/N. sessionStorage means the position survives
  // navigation and a reload, but a fresh tab starts clean.
  const [idx, setIdx]           = useStickyState("admin.gate1.stack", "idx", 0);
  const [decisions, setDecisions] = useState(() => {
    const init = {};
    items.forEach(it => {
      const ad = (it.adminDecision || "").toUpperCase();
      if (ad === "APPROVED")   init[it.id] = "approve";
      else if (ad === "WAITLISTED" || ad === "HOLD") init[it.id] = "waitlist";
      else if (ad === "REJECTED") init[it.id] = "reject";
    });
    return init;
  });
  const [notes, setNotes]       = useState({});
  const [busy, setBusy]         = useState(false);
  const [moveBusy, setMoveBusy] = useState(false);
  const [note, setNote]         = useState(null);

  const total   = items.length;
  const safeIdx = Math.min(idx, Math.max(0, total - 1));
  const s       = items[safeIdx];

  // `safeIdx` clamps at render time; this writes the clamped value back so a
  // stale index from a longer list does not persist into the next session.
  useEffect(() => {
    if (idx !== safeIdx) setIdx(safeIdx);
  }, [idx, safeIdx]);   // eslint-disable-line react-hooks/exhaustive-deps

  const [detailCache, setDetailCache] = useState({});
  useEffect(() => {
    if (!s || !s.id || detailCache[s.id]) return;
    let alive = true;
    loadDetail(s.track, s.id)
      .then(d => { if (alive) setDetailCache(prev => ({ ...prev, [s.id]: d ?? false })); })
      .catch(e => { console.error("AdminGate1: loadDetail failed", e); });
    return () => { alive = false; };
  }, [s?.id, s?.track]); // eslint-disable-line react-hooks/exhaustive-deps
  const sH = (s && detailCache[s.id]) ? { ...s, ...detailCache[s.id] } : s;

  const goto = (next) => {
    setIdx(Math.max(0, Math.min(total - 1, next)));
    setNote(null);
  };

  const decide = async (btn) => {
    if (busy || !s) return;
    const wireId  = BUTTON_TO_DECISION[btn]; // 'shortlisted' | 'on_hold' | 'rejected' | 'waitlisted'
    const rationale = (notes[s.id] || "").trim();
    if (WIRE_NEEDS_RATIONALE.has(wireId) && !rationale) {
      setNote({ kind: "error", text: `${btn.charAt(0).toUpperCase() + btn.slice(1)} requires a rationale.` });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await adminPlatformApi.decide(s.track, s.id, {
        decision: wireId,
        rationale: rationale || undefined,
      });
      setDecisions(prev => ({ ...prev, [s.id]: btn }));
      if (safeIdx < total - 1) {
        setTimeout(() => goto(safeIdx + 1), 200);
      } else {
        setNote({ kind: "ok", text: "All decisions saved." });
        await reload();
        setIdx(0);
      }
    } catch (e) {
      const code = e?.details?.error || e?.code;
      if (code === "rationale_required") {
        setNote({ kind: "error", text: "A rationale is required for that decision." });
      } else {
        setNote({ kind: "error", text: `Decision failed: ${e?.message || e}` });
      }
    } finally {
      setBusy(false);
    }
  };

  // Track-move (TIR<->VIP). The flag lives on the NATIVE application row; the
  // row's `track` is the effective/display track under the overlay.
  const onMove = async () => {
    if (busy || moveBusy || !s) return;
    const nat = s.nativeTrack || s.track;
    if (!s.movedToTrack) {
      const other = nat === "tir" ? "VIP" : "TIR";
      if (!window.confirm(`Move this application to ${other} and email the applicant?`)) return;
    }
    setMoveBusy(true);
    setNote(null);
    try {
      await adminPlatformApi.moveTrack(nat, s.id);
      setNote({ kind: "ok", text: "Application track updated." });
      await reload();
    } catch (e) {
      setNote({ kind: "error", text: `Move failed: ${e?.message || e}` });
    } finally {
      setMoveBusy(false);
    }
  };

  const decided = Object.keys(decisions).length;
  const counts  = { approve: 0, waitlist: 0, reject: 0 };
  Object.values(decisions).forEach(d => { if (counts[d] !== undefined) counts[d]++; });

  if (!s) return <EmptyState label="No evaluated applications awaiting a decision." />;

  const scoreVal = revScore(sH);
  const seq = items.map(i => ({ id: i.id, track: i.track }));

  return (
    <div>
      <Note note={note} onDismiss={() => setNote(null)} />
      <div className="os-row between os-mb">
        <div className="os-row gap-sm">
          <span className="os-chip blue">VARIANT A · STATUS</span>
          <span className="os-text-soft">Decide one application at a time.</span>
        </div>
        <span className="os-mono os-text-sm">{decided} / {items.length} decided</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(220px, 280px))", gap: 14, marginBottom: 24 }}>
        <div className="os-card soft gate-kpi">
          <span className="gate-kpi-kicker">Applications</span>
          <span className="gate-kpi-num">{items.length}</span>
          <span className="gate-kpi-sub">Reviewer-evaluated this gate</span>
        </div>
        <div className="os-card soft gate-kpi">
          <span className="gate-kpi-kicker">Live Decisions</span>
          <div style={{ display: "flex", gap: 26, marginTop: 8 }}>
            {[["Approve", counts.approve, "#2F6F62"], ["Reject", counts.reject, "#FF5A5F"]].map(([label, n, c]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5 }}>
                <span style={{ fontFamily: "var(--font-serif)", fontSize: 30, fontWeight: 400, lineHeight: 1, color: "var(--ink)" }}>{n}</span>
                <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-dim)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: c, flexShrink: 0 }} />{label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="os-grid-evaluation">
        <div className="os-card">
          <div className="os-card-head">
            <div className="os-row gap-sm">
              <span className="os-mono os-text-xs os-text-dim">{safeIdx + 1}/{items.length}</span>
              <FlagDot tone={s.flag} />
              <span style={{ fontSize: 22, fontFamily: "var(--font-serif)" }}>{s.name}</span>
              <span className="os-chip">{s.domain}</span>
              <span className="os-chip">{s.stage}</span>
            </div>
            <div className="os-row gap-sm">
              <button className="os-btn sm ghost" disabled={busy || safeIdx === 0} onClick={() => goto(safeIdx - 1)}>← Prev</button>
              <button className="os-btn sm ghost" disabled={busy || safeIdx >= total - 1} onClick={() => goto(safeIdx + 1)}>Next →</button>
            </div>
          </div>

          <div style={{ padding: "0 0 20px 0" }}>
            <ApplicationSummaryCard
              startup={sH}
              onViewFullApplication={() => goDetail && goDetail(s.id, s.track, "gate1", seq)}
            />
            <div style={{ marginTop: 16 }}>
              <ComparativeReviewModel startup={sH} />
            </div>
          </div>
        </div>

        <div className="os-stack">
          <div className="os-card" style={{ background: "var(--artlight)", border: "1px solid transparent" }}>
            <div className="os-row between" style={{ alignItems: "center" }}>
              <div>
                <span className="os-text-xs os-uppercase" style={{ fontWeight: 600, letterSpacing: "0.12em", color: "var(--artblue)" }}>
                  {sH.rev ? "Reviewer Overall" : "AI Score"}
                </span>
                <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>
                  {sH.rev ? "Weighted reviewer consensus" : "AI screening score (reviewer score unavailable on list)"}
                </div>
              </div>
              <span className="os-num-big" style={{ fontSize: 34, fontFamily: "var(--font-serif)", fontWeight: 400, letterSpacing: "-0.01em", color: "var(--artblue)" }}>
                {scoreVal != null ? scoreVal.toFixed(2) : "—"}
              </span>
            </div>
          </div>

          <div className="os-card">
            <div className="os-card-title os-mb-sm">Decision</div>
            <div className="os-reco-group">
              <button className={"os-reco-btn approve " + (decisions[s.id] === "approve" ? "active" : "")} disabled={busy} onClick={() => decide("approve")}>Approve</button>
              <button className={"os-reco-btn reject " + (decisions[s.id] === "reject" ? "active" : "")} disabled={busy} onClick={() => decide("reject")}>Reject</button>
            </div>
            <textarea
              className="os-input os-w-100 os-mt"
              rows="3"
              placeholder="Decision rationale (required for reject)…"
              value={notes[s.id] || ""}
              onChange={e => setNotes(prev => ({ ...prev, [s.id]: e.target.value }))}
            />
            <button
              type="button"
              className="os-btn sm"
              disabled={busy || moveBusy}
              onClick={onMove}
              style={{ marginTop: 12, width: "100%" }}>
              {moveBusy ? "Moving…" : moveButtonLabel(s.nativeTrack || s.track, s.movedToTrack)}
            </button>
          </div>

          <div className="os-card">
            <div className="os-card-title os-mb-sm">Progress</div>
            <div className="os-row gap-sm" style={{ flexWrap: "wrap" }}>
              {items.map((it, i) => {
                const dec = decisions[it.id];
                const t = dec === "approve"   ? { bg: "#eef5f1", fg: "#2F6F62", bd: "#bcd7cd" }
                        : dec === "reject"    ? { bg: "#fff0f0", fg: "#d23b40", bd: "#f8c2c4" }
                        : dec === "waitlist"  ? { bg: "#fff8e6", fg: "#9a6206", bd: "#f6d98a" }
                        : { bg: "var(--bg-soft)", fg: "var(--ink-dim)", bd: "var(--line)" };
                return (
                  <div key={i} onClick={() => goto(i)}
                    style={{ width: 26, height: 26, borderRadius: 6, display: "grid", placeItems: "center",
                             background: t.bg, color: t.fg, border: "1px solid " + t.bd,
                             fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, cursor: "pointer",
                             outline: i === safeIdx ? "2px solid var(--accent)" : "none", outlineOffset: 1 }}>
                    {i + 1}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// VARIANT C · Batch decision room (prototype: GateReviewBatchDecision)
// ══════════════════════════════════════════════════════════════════════════
function GateReviewBatchDecision({ items, reload, goDetail }) {
  const [selectedBatch, setSelectedBatch]     = useStickyState("admin.gate1", "batch", "All");
  const [draftDecisions, setDraftDecisions]   = useState({}); // id → 'APPROVED' | 'HOLD' | 'REJECTED'
  const [busy, setBusy]                       = useState(false);
  const [note, setNote]                       = useState(null);

  const allBatches = useMemo(
    () => Array.from(new Set(items.map(s => s.batch || "Unassigned"))).sort(),
    [items]
  );

  const filtered = useMemo(
    () => selectedBatch === "All" ? items : items.filter(s => (s.batch || "Unassigned") === selectedBatch),
    [items, selectedBatch]
  );

  const handleDraftSelect = (id, dec) => {
    setDraftDecisions(prev => ({ ...prev, [id]: prev[id] === dec ? null : dec }));
  };

  const countPushed = filtered.filter(s => draftDecisions[s.id]).length;

  const handlePushDecisions = async () => {
    if (busy) return;
    const selected = filtered.filter(s => draftDecisions[s.id]);
    if (selected.length === 0) return;

    const bulkItems = selected.map(s => {
      const wireId   = UPPER_TO_WIRE[draftDecisions[s.id]] || "on_hold";
      return {
        track:          s.track,
        application_id: s.id,
        decision:       wireId,
        // Rationale required for hold/reject; batch variant carries a generic note
        ...(WIRE_NEEDS_RATIONALE.has(wireId) ? { rationale: `Batch decision — ${draftDecisions[s.id]}` } : {}),
      };
    });

    setBusy(true);
    setNote(null);
    try {
      const resp = await adminPlatformApi.bulkDecide({ items: bulkItems });
      const results  = resp?.results ?? [];
      const ok       = results.filter(x => x?.status === "decided").length;
      const failures = results.filter(x => x?.status && x.status !== "decided");
      const remaining = { ...draftDecisions };
      selected.forEach(s => { delete remaining[s.id]; });
      setDraftDecisions(remaining);
      if (failures.length === 0) {
        setNote({ kind: "ok", text: `Successfully pushed decisions for ${ok} application(s).` });
      } else {
        const fText = failures.map(f => `${f.application_id} (${f.status})`).join(", ");
        setNote({ kind: "error", text: `${ok} applied, ${failures.length} failed — ${fText}` });
      }
      await reload();
    } catch (e) {
      setNote({ kind: "error", text: `Push failed: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  };

  const seq = filtered.map(i => ({ id: i.id, track: i.track }));

  return (
    <div>
      <Note note={note} onDismiss={() => setNote(null)} />
      <div className="lp-section-head" style={{ marginBottom: 20 }}>
        <div>
          <span className="lp-section-eyebrow">BATCH DECISIONS</span>
          <h2 className="lp-section-title">Batch decision room</h2>
          <div className="lp-section-sub">Filter pending evaluations by batch, assign decisions in draft mode, and apply them in bulk.</div>
        </div>
      </div>

      <div className="os-row between os-mb-lg" style={{ background: "var(--bg-soft)", padding: "12px 16px", borderRadius: 2, border: "1px solid var(--line)", marginBottom: 24, gap: 16 }}>
        <div className="os-row gap-xs" style={{ flexWrap: "wrap" }}>
          <span className="os-text-sm os-mono os-text-dim" style={{ marginRight: 8, fontSize: 11, fontWeight: "bold" }}>FILTER BATCH:</span>
          <button className={"os-btn sm " + (selectedBatch === "All" ? "primary" : "secondary")} onClick={() => setSelectedBatch("All")}>
            All Batches ({items.length})
          </button>
          {allBatches.map(b => {
            const count = items.filter(s => (s.batch || "Unassigned") === b).length;
            return (
              <button key={b} className={"os-btn sm " + (selectedBatch === b ? "primary" : "secondary")} onClick={() => setSelectedBatch(b)}>
                {b} ({count})
              </button>
            );
          })}
        </div>

        <button
          className="os-btn"
          disabled={busy || countPushed === 0}
          onClick={handlePushDecisions}
          style={{ background: countPushed > 0 ? "var(--accent)" : "var(--bg-soft)", color: countPushed > 0 ? "white" : "var(--ink-dim)", fontWeight: 600, cursor: countPushed > 0 ? "pointer" : "not-allowed" }}
        >
          Push Decisions ({countPushed})
        </button>
      </div>

      <table className="os-table">
        <thead>
          <tr>
            <th>Startup</th>
            <th>Batch</th>
            <th>Score</th>
            <th>Flags</th>
            <th style={{ width: 280, textAlign: "center" }}>Draft Decision</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan="5" style={{ textAlign: "center", padding: "32px", color: "var(--ink-dim)", fontFamily: "var(--font-serif)", fontSize: 16 }}>
                No pending evaluations found in this batch.
              </td>
            </tr>
          ) : (
            filtered.map((s) => {
              const draft = draftDecisions[s.id];
              const score = revScore(s);
              return (
                <tr
                  key={s.id}
                  onClick={(e) => {
                    if (e.target.closest("button") || e.target.closest("a")) return;
                    if (goDetail) goDetail(s.id, s.track, "gate1", seq);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    <b style={{ fontSize: 14 }}>{s.name}</b>
                    <div style={{ color: "var(--ink-dim)", fontSize: 11, marginTop: 2 }}>{s.domain}</div>
                  </td>
                  <td className="os-mono os-text-sm">{s.batch || "Unassigned"}</td>
                  <td className="num"><b>{score != null ? score.toFixed(1) : "—"}</b></td>
                  <td>
                    {s.flags && s.flags.length > 0 ? (
                      <span className="os-chip red" style={{ fontSize: 11, padding: "2px 6px" }}>⚐ {s.flags.length} flag{s.flags.length > 1 ? "s" : ""}</span>
                    ) : (
                      <span className="os-text-soft" style={{ fontSize: 11 }}>—</span>
                    )}
                  </td>
                  <td>
                    <div className="os-reco-group" style={{ margin: 0, justifyContent: "center", display: "flex", gap: 4 }}>
                      <button className={"os-reco-btn approve " + (draft === "APPROVED" ? "active" : "")} disabled={busy} onClick={() => handleDraftSelect(s.id, "APPROVED")} style={{ padding: "4px 10px", fontSize: 11, flex: 1 }}>Approve</button>
                      <button className={"os-reco-btn reject " + (draft === "REJECTED" ? "active" : "")} disabled={busy} onClick={() => handleDraftSelect(s.id, "REJECTED")} style={{ padding: "4px 10px", fontSize: 11, flex: 1 }}>Reject</button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// VARIANT D · History (prototype: GateReviewHistory)
// Shows apps with adminDecision already set (all statuses except evaluated).
// Uses a separate useAdminData("pipeline") with no status filter so we see
// decided apps too; filtered locally to those with adminDecision.
// ══════════════════════════════════════════════════════════════════════════
function GateReviewHistory({ allStartups, reload, goDetail }) {
  const [editingId, setEditingId]   = useState(null);
  const [busy, setBusy]             = useState(false);
  const [note, setNote]             = useState(null);
  const [sortCol, setSortCol]       = useStickyState("admin.gate1.history", "sortCol", null);
  const [sortAsc, setSortAsc]       = useStickyState("admin.gate1.history", "sortAsc", true);

  // Apps with a non-null adminDecision
  const startups = useMemo(
    () => (allStartups || []).filter(s => s.adminDecision),
    [allStartups]
  );

  const handleSort = (col) => {
    setSortCol(prev => { if (prev === col) { setSortAsc(a => !a); return col; } setSortAsc(true); return col; });
  };

  const renderHeader = (label, colKey) => {
    const isSorted = sortCol === colKey;
    return (
      <th onClick={() => handleSort(colKey)} style={{ cursor: "pointer", userSelect: "none" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {label}{isSorted ? (sortAsc ? " ▲" : " ▼") : ""}
        </span>
      </th>
    );
  };

  const sortedStartups = useMemo(() => {
    if (!sortCol) return startups;
    return [...startups].sort((a, b) => {
      let valA, valB;
      if (sortCol === "name")          { valA = a.name || ""; valB = b.name || ""; }
      else if (sortCol === "sub")      { valA = a.sub || ""; valB = b.sub || ""; }
      else if (sortCol === "batch")    { valA = a.batch || "Unassigned"; valB = b.batch || "Unassigned"; }
      else if (sortCol === "score")    { valA = revScore(a) ?? -1; valB = revScore(b) ?? -1; }
      else if (sortCol === "flags")    { valA = a.flags ? a.flags.length : 0; valB = b.flags ? b.flags.length : 0; }
      else if (sortCol === "adminDecision") { valA = a.adminDecision || ""; valB = b.adminDecision || ""; }
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [startups, sortCol, sortAsc]);

  // Stats
  const total        = startups.length;
  const approvedCount = startups.filter(s => s.adminDecision === "APPROVED").length;
  const selectionRate = total > 0 ? ((approvedCount / total) * 100).toFixed(0) : 0;
  const avgFlags      = total > 0 ? (startups.reduce((sum, s) => sum + (s.flags?.length || 0), 0) / total).toFixed(1) : "0.0";

  const handleSaveDecision = async (id, newUpperDec) => {
    const s = startups.find(x => x.id === id);
    if (!s || busy) return;
    const wireId   = UPPER_TO_WIRE[newUpperDec] || "on_hold";
    const rationale = WIRE_NEEDS_RATIONALE.has(wireId) ? `Admin override: ${newUpperDec}` : undefined;
    setBusy(true);
    setNote(null);
    try {
      await adminPlatformApi.decide(s.track, s.id, { decision: wireId, rationale });
      setEditingId(null);
      await reload();
    } catch (e) {
      setNote({ kind: "error", text: `Save failed: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  };

  const seq = sortedStartups.map(i => ({ id: i.id, track: i.track }));

  return (
    <div>
      <Note note={note} onDismiss={() => setNote(null)} />
      <div className="lp-section-head" style={{ marginBottom: 20 }}>
        <div>
          <span className="lp-section-eyebrow">HISTORY</span>
          <h2 className="lp-section-title">Admin decision history</h2>
          <div className="lp-section-sub">All applications decided on at Admin Review, key metrics, and alignment with human reviews. Click on a row to view the full application review page.</div>
        </div>
      </div>

      <div className="lp-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
        <div className="dash-stat-tile" style={{ background: "var(--bg-soft)", border: "1px solid var(--line)", padding: "16px 20px", borderRadius: 2 }}>
          <div className="dash-stat-label" style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--ink-dim)", letterSpacing: "0.08em", textTransform: "uppercase" }}>TOTAL DECISIONS</div>
          <div className="dash-stat-num" style={{ fontSize: 28, fontWeight: 700, margin: "8px 0 4px 0", color: "var(--ink)" }}>{total}</div>
          <div className="dash-stat-sub" style={{ fontSize: 11, color: "var(--ink-soft)" }}>across cohorts</div>
        </div>
        <div className="dash-stat-tile" style={{ background: "var(--bg-soft)", border: "1px solid var(--line)", padding: "16px 20px", borderRadius: 2 }}>
          <div className="dash-stat-label" style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--ink-dim)", letterSpacing: "0.08em", textTransform: "uppercase" }}>SELECTION RATE</div>
          <div className="dash-stat-num" style={{ fontSize: 28, fontWeight: 700, margin: "8px 0 4px 0", color: "var(--accent)" }}>{selectionRate}%</div>
          <div className="dash-stat-sub" style={{ fontSize: 11, color: "var(--ink-soft)" }}>approved applications</div>
        </div>
        <div className="dash-stat-tile" style={{ background: "var(--bg-soft)", border: "1px solid var(--line)", padding: "16px 20px", borderRadius: 2 }}>
          <div className="dash-stat-label" style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--ink-dim)", letterSpacing: "0.08em", textTransform: "uppercase" }}>AVG FLAGS RAISED</div>
          <div className="dash-stat-num" style={{ fontSize: 28, fontWeight: 700, margin: "8px 0 4px 0", color: "#d23b40" }}>{avgFlags}</div>
          <div className="dash-stat-sub" style={{ fontSize: 11, color: "var(--ink-soft)" }}>flags per startup</div>
        </div>
      </div>

      <table className="os-table">
        <thead>
          <tr>
            {renderHeader("Startup", "name")}
            {renderHeader("Date", "sub")}
            {renderHeader("Batch", "batch")}
            {renderHeader("Score", "score")}
            {renderHeader("Flags", "flags")}
            {renderHeader("Admin Decision", "adminDecision")}
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {sortedStartups.length === 0 ? (
            <tr>
              <td colSpan="7" style={{ textAlign: "center", padding: "32px", color: "var(--ink-dim)", fontFamily: "var(--font-serif)", fontSize: 16 }}>
                No decisions recorded in history yet.
              </td>
            </tr>
          ) : (
            sortedStartups.map((s) => {
              const isEditing = editingId === s.id;
              const score     = revScore(s);
              const handleRowClick = (e) => {
                if (e.target.closest("button") || e.target.closest("a") || isEditing) return;
                if (goDetail) goDetail(s.id, s.track, "gate1", seq);
              };
              return (
                <tr key={s.id} onClick={handleRowClick} style={{ cursor: isEditing ? "default" : "pointer" }}>
                  <td>
                    <b style={{ fontSize: 14 }}>{s.name}</b>
                    <div style={{ color: "var(--ink-dim)", fontSize: 11, marginTop: 2 }}>{s.domain}</div>
                  </td>
                  <td className="os-mono os-text-sm">{s.sub || "—"}</td>
                  <td className="os-mono os-text-sm">{s.batch || "Unassigned"}</td>
                  <td className="num"><b>{score != null ? score.toFixed(1) : "—"}</b></td>
                  <td>
                    {s.flags && s.flags.length > 0 ? (
                      <span className="os-chip red" style={{ fontSize: 11, padding: "2px 6px" }}>⚐ {s.flags.length} flag{s.flags.length > 1 ? "s" : ""}</span>
                    ) : (
                      <span className="os-text-soft" style={{ fontSize: 11 }}>—</span>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <div className="os-row gap-xs" style={{ flexWrap: "nowrap" }}>
                        <button className="os-btn sm green"  disabled={busy} onClick={() => handleSaveDecision(s.id, "APPROVED")}   style={{ padding: "3px 8px", fontSize: 11 }}>Approve</button>
                        <button className="os-btn sm amber"  disabled={busy} onClick={() => handleSaveDecision(s.id, "HOLD")}       style={{ padding: "3px 8px", fontSize: 11 }}>Hold</button>
                        <button className="os-btn sm red"    disabled={busy} onClick={() => handleSaveDecision(s.id, "REJECTED")}   style={{ padding: "3px 8px", fontSize: 11 }}>Reject</button>
                      </div>
                    ) : (
                      <Chip tone={decisionTone(s.adminDecision)}>{(s.adminDecision || "").toUpperCase()}</Chip>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <button className="os-btn sm secondary" disabled={busy} onClick={() => setEditingId(null)}>Cancel</button>
                    ) : (
                      <button className="os-btn sm ghost" onClick={() => setEditingId(s.id)}>✎ Edit</button>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TAB CONTROLLER (prototype: AdminGate1)
// ══════════════════════════════════════════════════════════════════════════
export default function AdminGate1({ goDetail }) {
  const [variant, setVariant] = useState("stack");

  // Evaluated applications (awaiting gate-1 decision) — Variants A, B, C
  const { data: evalData, loading: evalLoading, error: evalError, reload: reloadEval } =
    useAdminData("pipeline", { status: "evaluated" });

  // All pipeline apps (for History tab which shows already-decided apps)
  const { data: allData, loading: allLoading, error: allError, reload: reloadAll } =
    useAdminData("pipeline", {});

  const evalRows = evalData?.startups ?? [];
  const allRows  = allData?.startups  ?? [];

  const reload = useCallback(async () => {
    await Promise.all([reloadEval(), reloadAll()]);
  }, [reloadEval, reloadAll]);

  const loading = variant === "history" ? allLoading  : evalLoading;
  const error   = variant === "history" ? allError    : evalError;
  const count   = variant === "history"
    ? (allRows.filter(s => s.adminDecision).length)
    : evalRows.length;

  return (
    <div className="dash-scroll">
      <style>{GATE1_CSS}</style>
      <PageHead
        eyebrow="A-4 · ADMIN REVIEW"
        title={`Decide on <em>${count} application${count !== 1 ? "s" : ""}</em>`}
        sub={loading ? "Loading…" : "Each one is reviewer-evaluated. Choose a workflow that matches your decision style."}
      />

      <div className="os-row gap-sm os-mb-lg">
        <div className={"os-tab " + (variant === "stack"   ? "active" : "")} onClick={() => setVariant("stack")}>A · Status</div>
        <div className={"os-tab " + (variant === "batch"   ? "active" : "")} onClick={() => setVariant("batch")}>B · Batch decision</div>
        <div className={"os-tab " + (variant === "history" ? "active" : "")} onClick={() => setVariant("history")}>C · My history</div>
      </div>

      {loading ? (
        <LoadingState label="Loading applications…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : variant === "stack" ? (
        <GateReviewStack   key={"stack-"   + evalRows.length} items={evalRows} reload={reload} goDetail={goDetail} />
      ) : variant === "batch" ? (
        <GateReviewBatchDecision key={"batch-" + evalRows.length} items={evalRows} reload={reload} goDetail={goDetail} />
      ) : (
        <GateReviewHistory key={"hist-" + allRows.length} allStartups={allRows} reload={reload} goDetail={goDetail} />
      )}
    </div>
  );
}

// Scoped styles — gate-1 specific layout + atoms not in admin-portal.css
const GATE1_CSS = `
.adm-portal .g1-note { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 14px; border-radius:4px; font-size:13px; font-family:var(--font-sans); margin-bottom:16px; }
.adm-portal .g1-note.is-ok    { background:#e9f6ef; border:1px solid #b7ddc8; color:#1d6b45; }
.adm-portal .g1-note.is-error { background:#fdecec; border:1px solid #f3c2c4; color:#b3262b; }
.adm-portal .g1-note-x { background:none; border:none; cursor:pointer; font-size:18px; line-height:1; color:inherit; padding:0 4px; }
`;
