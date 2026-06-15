// AdminGate1Review — A-4 Gate 1 Review (Task 18).
//
// The gate-1 decision surface. Acts on applications whose status is `evaluated`
// (reviewer-scored, awaiting an admin gate-1 decision). Fetched once via
//   adminPlatformApi.getPipeline({ status: "evaluated", include_hidden: false })
// and held in local state so the cutoff slider can recompute drafts without a
// re-fetch. Every variant reloads the evaluated list after applying.
//
// Three workflows share the same data + the same rationale gate:
//   • Decision Stack — one application at a time (prev/next). Four decision
//     buttons + a rationale textarea. Shortlist may submit without a rationale;
//     hold/reject/waitlist require a non-blank one. Single decide() per app.
//   • Triage Table — the whole cohort with per-row decision buttons and a
//     shared rationale field. "Apply all drafted decisions" collects the drafts
//     and calls bulkDecide(); the rationale gate runs client-side first so a
//     drafted hold/reject/waitlist with no rationale blocks the apply.
//   • Cutoff — a score-distribution histogram with an adjustable AI-score
//     threshold. Above → drafted "shortlisted", below → drafted "rejected"
//     (carrying a shared "below AI cutoff X.X" rationale). Per-app manual
//     override toggles an app out of its cutoff bucket. bulkDecide() applies.
//
// Per-id failures from bulkDecide (rationale_required / illegal_transition /
// not_found / error) are summarized inline. Every field access is guarded.

import { useCallback, useMemo, useState } from "react";

import { adminPlatformApi } from "../../../lib/adminPlatformApi.js";
import {
  useAsync,
  LoadingState,
  ErrorState,
  EmptyState,
  Chip,
  ScoreBar,
} from "./ui.jsx";

// ─── Decisions (wire value + rationale requirement) ─────────────────────────
// Mirrors AdminApplicationDetail / AdminPipeline: shortlist may submit without a
// rationale; hold/reject/waitlist require a non-blank one.
const DECISIONS = [
  { id: "shortlisted", label: "Shortlist", tone: "approve", needsRationale: false },
  { id: "on_hold", label: "Hold", tone: "waitlist", needsRationale: true },
  { id: "rejected", label: "Reject", tone: "reject", needsRationale: true },
  { id: "waitlisted", label: "Waitlist", tone: "waitlist", needsRationale: true },
];

const DECISION_TONE = {
  shortlisted: "green",
  on_hold: "amber",
  rejected: "red",
  waitlisted: "slate",
};

const BULK_RESULT_LABEL = {
  rationale_required: "rationale required",
  illegal_transition: "illegal transition",
  not_found: "not found",
  error: "error",
};

const VARIANTS = [
  { id: "stack", label: "Decision Stack" },
  { id: "table", label: "Triage Table" },
  { id: "cutoff", label: "Cutoff" },
];

function prettify(v) {
  if (!v) return "";
  return String(v)
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// ─── Pure helpers (exported for unit tests) ─────────────────────────────────

// True when a single decision is OK to submit. Shortlist may submit without a
// rationale; hold/reject/waitlist require a non-blank one; unknown ids fail.
export function canSubmitDecision(decisionId, rationale) {
  if (!decisionId) return false;
  const opt = DECISIONS.find((d) => d.id === decisionId);
  if (!opt) return false;
  if (!opt.needsRationale) return true;
  return (rationale || "").trim().length > 0;
}

// Does a wire decision id require a rationale?
export function decisionNeedsRationale(decisionId) {
  const opt = DECISIONS.find((d) => d.id === decisionId);
  return !!opt && opt.needsRationale;
}

// Build the bulkDecide items array from a {appId -> decisionId} draft map and
// the source rows, attaching a rationale per item. `rationaleFor(row, decision)`
// returns the rationale string for that row+decision (may be ""). Rows without
// a draft, or unknown rows, are skipped. Returns { items, missingRationale }
// where missingRationale lists the application ids whose drafted decision needs
// a rationale but has none — the caller blocks the apply when it's non-empty.
export function buildBulkItems(draftMap, rows, rationaleFor) {
  const byId = new Map((rows || []).map((r) => [r?.id, r]));
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
      track: row.track,
      application_id: row.id,
      decision,
      rationale: rationale.trim() || undefined,
    });
  }
  return { items, missingRationale };
}

// Split rows into above/below an AI-score cutoff. Rows in `overrides` (a Set of
// application ids) are pulled out into `overridden` and excluded from both
// buckets so a manual decision wins. Missing scores count as below cutoff.
export function partitionByCutoff(rows, cutoff, overrides) {
  const ov = overrides || new Set();
  const above = [];
  const below = [];
  const overridden = [];
  for (const r of rows || []) {
    if (ov.has(r?.id)) {
      overridden.push(r);
      continue;
    }
    const score = typeof r?.ai_score_overall === "number" ? r.ai_score_overall : -1;
    if (score >= cutoff) above.push(r);
    else below.push(r);
  }
  return { above, below, overridden };
}

// Summarize a bulkDecide response into { ok, failures: [{id, status}] }.
// A result is a success when status === "decided".
export function summarizeBulkResults(resp) {
  const results = resp?.results ?? [];
  const failures = results
    .filter((x) => x?.status && x.status !== "decided")
    .map((x) => ({ id: x.application_id, status: x.status }));
  return { ok: results.length - failures.length, failures };
}

function failuresText(failures) {
  return failures
    .map((f) => `${f.id} (${BULK_RESULT_LABEL[f.status] || f.status})`)
    .join(", ");
}

// ─── Shared note banner ─────────────────────────────────────────────────────
function Note({ note, onDismiss }) {
  if (!note) return null;
  return (
    <div className={"g1-note " + (note.kind === "error" ? "is-error" : "is-ok")}>
      <span>{note.text}</span>
      <button className="g1-note-x" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

// ─── Variant A · Decision Stack ─────────────────────────────────────────────
function DecisionStack({ rows, busy, setBusy, onApplied }) {
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState(null); // wire decision id for current app
  const [rationale, setRationale] = useState("");
  const [note, setNote] = useState(null);

  const total = rows.length;
  const safeIdx = Math.min(idx, Math.max(0, total - 1));
  const s = rows[safeIdx];

  const goto = (next) => {
    const clamped = Math.max(0, Math.min(total - 1, next));
    setIdx(clamped);
    setSelected(null);
    setRationale("");
    setNote(null);
  };

  const decide = async (decisionId) => {
    if (busy || !s) return;
    setSelected(decisionId);
    if (!canSubmitDecision(decisionId, rationale)) {
      const opt = DECISIONS.find((d) => d.id === decisionId);
      setNote({
        kind: "error",
        text: `${opt ? opt.label : "That decision"} needs a rationale.`,
      });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await adminPlatformApi.decide(s.track, s.id, {
        decision: decisionId,
        rationale: rationale.trim() || undefined,
      });
      if (safeIdx < total - 1) {
        goto(safeIdx + 1);
      } else {
        // Last app decided — reload the evaluated list (this app drops out).
        await onApplied({ kind: "ok", text: "Decision saved." });
        setIdx(0);
        setSelected(null);
        setRationale("");
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

  if (!s) return <EmptyState label="No evaluated applications awaiting a decision." />;

  const rationaleEmpty = !rationale.trim();
  const reviewerScore =
    typeof s?.reviewer_score_overall === "number"
      ? s.reviewer_score_overall
      : typeof s?.reviewer_score === "number"
        ? s.reviewer_score
        : null;

  return (
    <div>
      <div className="g1-stack-head">
        <div className="os-row gap-sm">
          <span className="os-chip blue">DECISION STACK</span>
          <span className="os-text-soft">Decide one application at a time.</span>
        </div>
        <span className="os-mono os-text-sm">
          {safeIdx + 1} of {total}
        </span>
      </div>

      <Note note={note} onDismiss={() => setNote(null)} />

      <div className="os-grid-2" style={{ alignItems: "start" }}>
        <div className="os-card">
          <div className="os-card-head">
            <div className="os-row gap-sm" style={{ flexWrap: "wrap" }}>
              <span className="os-mono os-text-xs os-text-dim">
                {s?.applicationId ?? "—"}
              </span>
              <span style={{ fontSize: 20, fontFamily: "var(--font-serif)" }}>
                {s?.name ?? "—"}
              </span>
              <span className="os-chip">
                {s?.track === "sip" ? "SIP" : s?.track === "tir" ? "TIR" : s?.track ?? "—"}
              </span>
            </div>
            <div className="os-row gap-sm">
              <button
                className="os-btn sm ghost"
                disabled={safeIdx === 0}
                onClick={() => goto(safeIdx - 1)}
              >
                ← Prev
              </button>
              <button
                className="os-btn sm ghost"
                disabled={safeIdx >= total - 1}
                onClick={() => goto(safeIdx + 1)}
              >
                Next →
              </button>
            </div>
          </div>

          <div className="g1-meta-row">
            <span className="os-text-soft os-text-sm">Founder</span>
            <span>{s?.founder ?? "—"}</span>
          </div>

          <div style={{ marginTop: 14 }}>
            <div className="os-text-xs os-text-dim os-uppercase" style={{ marginBottom: 6 }}>
              AI score
            </div>
            {typeof s?.ai_score_overall === "number" ? (
              <ScoreBar label="" value={s.ai_score_overall} />
            ) : (
              <span className="os-text-soft">—</span>
            )}
          </div>

          {reviewerScore != null && (
            <div style={{ marginTop: 14 }}>
              <div className="os-text-xs os-text-dim os-uppercase" style={{ marginBottom: 6 }}>
                Reviewer score
              </div>
              <ScoreBar label="" value={reviewerScore} kind="rev" />
            </div>
          )}
        </div>

        <div className="os-stack gap-sm">
          <div className="os-card">
            <div className="os-card-title os-mb-sm">Decision</div>
            <div className="os-reco-group">
              {DECISIONS.map((d) => (
                <button
                  key={d.id}
                  className={
                    "os-reco-btn " + d.tone + (selected === d.id ? " active" : "")
                  }
                  disabled={busy}
                  onClick={() => decide(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <textarea
              className="os-input os-w-100 os-mt"
              rows="3"
              placeholder="Decision rationale (required for hold / reject / waitlist)…"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
            {selected && decisionNeedsRationale(selected) && rationaleEmpty && (
              <div className="g1-field-hint">
                {DECISIONS.find((d) => d.id === selected)?.label} needs a rationale.
              </div>
            )}
          </div>

          <div className="os-card">
            <div className="os-card-title os-mb-sm">Queue</div>
            <div className="os-row gap-sm" style={{ flexWrap: "wrap" }}>
              {rows.map((it, i) => (
                <button
                  key={it?.id ?? i}
                  className={"g1-queue-dot" + (i === safeIdx ? " is-current" : "")}
                  onClick={() => goto(i)}
                  title={it?.name || it?.applicationId}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Variant B · Triage Table ───────────────────────────────────────────────
function TriageTable({ rows, busy, setBusy, onApplied }) {
  const [drafts, setDrafts] = useState({}); // appId -> wire decision id
  const [rationale, setRationale] = useState(""); // shared rationale
  const [note, setNote] = useState(null);

  const setDraft = (id, decisionId) => {
    setDrafts((prev) => {
      const next = { ...prev };
      if (next[id] === decisionId) delete next[id]; // toggle off
      else next[id] = decisionId;
      return next;
    });
  };

  const draftedCount = Object.keys(drafts).filter((k) => drafts[k]).length;
  // Any drafted hold/reject/waitlist that would need the shared rationale.
  const needsRationale = Object.values(drafts).some(
    (d) => d && decisionNeedsRationale(d),
  );

  const applyAll = async () => {
    if (busy || draftedCount === 0) return;
    const { items, missingRationale } = buildBulkItems(
      drafts,
      rows,
      () => rationale,
    );
    if (missingRationale.length > 0) {
      setNote({
        kind: "error",
        text: `A rationale is required for hold / reject / waitlist (${missingRationale.length} drafted).`,
      });
      return;
    }
    if (items.length === 0) {
      setNote({ kind: "error", text: "No decisions to apply yet." });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const resp = await adminPlatformApi.bulkDecide({ items });
      const { ok, failures } = summarizeBulkResults(resp);
      if (failures.length === 0) {
        setDrafts({});
        setRationale("");
        await onApplied({ kind: "ok", text: `Applied ${ok} decision(s).` });
      } else {
        await onApplied({
          kind: "error",
          text: `${ok} applied, ${failures.length} failed — ${failuresText(failures)}`,
        });
      }
    } catch (e) {
      setNote({ kind: "error", text: `Apply failed: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  };

  if (rows.length === 0)
    return <EmptyState label="No evaluated applications awaiting a decision." />;

  return (
    <div>
      <div className="g1-stack-head">
        <div className="os-row gap-sm">
          <span className="os-chip blue">TRIAGE TABLE</span>
          <span className="os-text-soft">
            Draft a decision per row, then apply them all at once.
          </span>
        </div>
        <span className="os-mono os-text-sm">{draftedCount} drafted</span>
      </div>

      <Note note={note} onDismiss={() => setNote(null)} />

      <div className="g1-shared-rationale">
        <label className="os-text-xs os-text-dim os-uppercase">
          Shared rationale
          {needsRationale ? " (required — a hold/reject/waitlist is drafted)" : " (optional)"}
        </label>
        <textarea
          className="os-input os-w-100"
          rows="2"
          placeholder="Applied to every drafted decision in this batch…"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
        />
      </div>

      <div className="g1-table-wrap">
        <table className="os-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Founder</th>
              <th style={{ minWidth: 140 }}>AI Score</th>
              <th style={{ width: 320 }}>Drafted decision</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const draft = drafts[s?.id];
              return (
                <tr key={s?.id}>
                  <td className="os-mono os-text-xs">{s?.applicationId ?? "—"}</td>
                  <td className="startup">
                    {s?.name ?? "—"}
                    <small>
                      {s?.track === "sip" ? "SIP" : s?.track === "tir" ? "TIR" : s?.track ?? ""}
                    </small>
                  </td>
                  <td>{s?.founder ?? "—"}</td>
                  <td>
                    {typeof s?.ai_score_overall === "number" ? (
                      <ScoreBar label="" value={s.ai_score_overall} />
                    ) : (
                      <span className="os-text-soft">—</span>
                    )}
                  </td>
                  <td>
                    <div className="os-reco-group" style={{ margin: 0, flexWrap: "wrap" }}>
                      {DECISIONS.map((d) => (
                        <button
                          key={d.id}
                          className={
                            "os-reco-btn " + d.tone + (draft === d.id ? " active" : "")
                          }
                          style={{ padding: "4px 10px", fontSize: 11 }}
                          disabled={busy}
                          onClick={() => setDraft(s?.id, d.id)}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="g1-apply-bar">
        <button
          className="os-btn"
          disabled={busy || draftedCount === 0}
          onClick={applyAll}
        >
          Apply all drafted decisions ({draftedCount})
        </button>
      </div>
    </div>
  );
}

// ─── Variant C · Cutoff ──────────────────────────────────────────────────────
function CutoffView({ rows, busy, setBusy, onApplied }) {
  const [cutoff, setCutoff] = useState(7.0);
  const [overrides, setOverrides] = useState(() => new Set()); // appIds pulled out of cutoff buckets
  const [note, setNote] = useState(null);

  const sorted = useMemo(
    () =>
      rows
        .slice()
        .sort(
          (a, b) =>
            (typeof b?.ai_score_overall === "number" ? b.ai_score_overall : -1) -
            (typeof a?.ai_score_overall === "number" ? a.ai_score_overall : -1),
        ),
    [rows],
  );

  const { above, below, overridden } = useMemo(
    () => partitionByCutoff(sorted, cutoff, overrides),
    [sorted, cutoff, overrides],
  );

  const cutoffRationale = `Below AI cutoff ${cutoff.toFixed(1)}`;

  const toggleOverride = (id) => {
    setOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const nudge = (delta) => {
    setCutoff((c) => Math.max(0, Math.min(10, Math.round((c + delta) * 10) / 10)));
  };

  const applyCutoff = async () => {
    if (busy) return;
    // Above → shortlisted (no rationale needed); below → rejected with the
    // shared cutoff rationale. Overridden apps are intentionally excluded.
    const draftMap = {};
    above.forEach((s) => {
      if (s?.id != null) draftMap[s.id] = "shortlisted";
    });
    below.forEach((s) => {
      if (s?.id != null) draftMap[s.id] = "rejected";
    });
    const { items, missingRationale } = buildBulkItems(draftMap, sorted, (_row, decision) =>
      decision === "rejected" ? cutoffRationale : "",
    );
    if (missingRationale.length > 0) {
      // Should not happen — every reject carries the shared cutoff rationale.
      setNote({ kind: "error", text: "A rationale is required for the rejected apps." });
      return;
    }
    if (items.length === 0) {
      setNote({ kind: "error", text: "Nothing to apply at this cutoff." });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const resp = await adminPlatformApi.bulkDecide({ items });
      const { ok, failures } = summarizeBulkResults(resp);
      if (failures.length === 0) {
        setOverrides(new Set());
        await onApplied({
          kind: "ok",
          text: `Applied ${ok} decision(s) at cutoff ${cutoff.toFixed(1)}.`,
        });
      } else {
        await onApplied({
          kind: "error",
          text: `${ok} applied, ${failures.length} failed — ${failuresText(failures)}`,
        });
      }
    } catch (e) {
      setNote({ kind: "error", text: `Apply failed: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  };

  if (rows.length === 0)
    return <EmptyState label="No evaluated applications awaiting a decision." />;

  const maxScore = 10;

  return (
    <div>
      <div className="g1-stack-head">
        <div className="os-row gap-sm">
          <span className="os-chip blue">CUTOFF</span>
          <span className="os-text-soft">
            Set an AI-score threshold. Override individuals as needed.
          </span>
        </div>
        <button
          className="os-btn"
          disabled={busy}
          onClick={applyCutoff}
        >
          Apply cutoff: shortlist {above.length}, reject {below.length}
        </button>
      </div>

      <Note note={note} onDismiss={() => setNote(null)} />

      <div className="os-card os-mb-lg">
        <div className="os-card-head">
          <div className="os-card-title">
            Score distribution · cutoff at {cutoff.toFixed(1)}
          </div>
          <div className="os-row gap-sm" style={{ alignItems: "center" }}>
            <button className="os-btn sm ghost" disabled={busy} onClick={() => nudge(-0.5)}>
              −0.5
            </button>
            <input
              type="range"
              min="0"
              max="10"
              step="0.1"
              value={cutoff}
              onChange={(e) => setCutoff(Number(e.target.value))}
              aria-label="AI score cutoff"
              style={{ width: 160 }}
            />
            <button className="os-btn sm ghost" disabled={busy} onClick={() => nudge(0.5)}>
              +0.5
            </button>
          </div>
        </div>
        <div className="g1-histogram">
          <div className="g1-bars">
            {sorted.map((s) => {
              const score =
                typeof s?.ai_score_overall === "number" ? s.ai_score_overall : 0;
              const isOverride = overrides.has(s?.id);
              const passes = !isOverride && score >= cutoff;
              return (
                <div key={s?.id} className="g1-bar-col" title={`${s?.name}: ${score.toFixed(1)}`}>
                  <div
                    className={
                      "g1-bar" + (isOverride ? " is-override" : passes ? " is-above" : " is-below")
                    }
                    style={{ height: (score / maxScore) * 100 + "%" }}
                  >
                    <span className="g1-bar-val">{score.toFixed(1)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div
            className="g1-cutoff-line"
            style={{ bottom: (cutoff / maxScore) * 100 + "%" }}
          >
            <span className="g1-cutoff-tag">CUTOFF · {cutoff.toFixed(1)}</span>
          </div>
        </div>
      </div>

      <div className="os-grid-2">
        <div className="os-card">
          <div className="os-card-head">
            <div className="os-card-title">Above cutoff · {above.length}</div>
            <span className="os-chip green">→ SHORTLIST</span>
          </div>
          <div className="os-stack gap-sm">
            {above.length === 0 ? (
              <span className="os-text-soft os-text-sm">None at this cutoff.</span>
            ) : (
              above.map((s) => (
                <div key={s?.id} className="g1-cutoff-row">
                  <span>
                    {s?.name}{" "}
                    <span className="os-text-xs os-text-dim">· {s?.founder ?? "—"}</span>
                  </span>
                  <span className="os-row gap-sm">
                    <span className="os-mono os-text-sm">
                      {typeof s?.ai_score_overall === "number"
                        ? s.ai_score_overall.toFixed(1)
                        : "—"}
                    </span>
                    <button
                      className="os-btn sm ghost"
                      disabled={busy}
                      onClick={() => toggleOverride(s?.id)}
                    >
                      override
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="os-card">
          <div className="os-card-head">
            <div className="os-card-title">Below cutoff · {below.length}</div>
            <span className="os-chip red">→ REJECT</span>
          </div>
          <div className="os-stack gap-sm">
            {below.length === 0 ? (
              <span className="os-text-soft os-text-sm">None at this cutoff.</span>
            ) : (
              below.map((s) => (
                <div key={s?.id} className="g1-cutoff-row">
                  <span className="os-text-soft">
                    {s?.name}{" "}
                    <span className="os-text-xs os-text-dim">· {s?.founder ?? "—"}</span>
                  </span>
                  <span className="os-row gap-sm">
                    <span className="os-mono os-text-sm">
                      {typeof s?.ai_score_overall === "number"
                        ? s.ai_score_overall.toFixed(1)
                        : "—"}
                    </span>
                    <button
                      className="os-btn sm ghost"
                      disabled={busy}
                      onClick={() => toggleOverride(s?.id)}
                    >
                      override
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {overridden.length > 0 && (
        <div className="os-card os-mt">
          <div className="os-card-head">
            <div className="os-card-title">Overridden · {overridden.length}</div>
            <span className="os-chip slate">EXCLUDED FROM APPLY</span>
          </div>
          <div className="os-stack gap-sm">
            {overridden.map((s) => (
              <div key={s?.id} className="g1-cutoff-row">
                <span className="os-text-soft">
                  {s?.name}{" "}
                  <span className="os-text-xs os-text-dim">
                    · {typeof s?.ai_score_overall === "number"
                      ? s.ai_score_overall.toFixed(1)
                      : "—"}
                  </span>
                </span>
                <button
                  className="os-btn sm ghost"
                  disabled={busy}
                  onClick={() => toggleOverride(s?.id)}
                >
                  restore to cutoff
                </button>
              </div>
            ))}
          </div>
          <div className="os-text-xs os-text-dim" style={{ marginTop: 8 }}>
            Overridden apps are left untouched by the cutoff apply — decide them in the
            Decision Stack or Triage Table.
          </div>
        </div>
      )}

      <div className="os-text-xs os-text-dim" style={{ marginTop: 12 }}>
        Below-cutoff rejects carry the rationale: “{cutoffRationale}”.
      </div>
    </div>
  );
}

// ─── Shell ───────────────────────────────────────────────────────────────────
export default function AdminGate1Review() {
  const [variant, setVariant] = useState("stack");
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useAsync(
    () =>
      adminPlatformApi.getPipeline({ status: "evaluated", include_hidden: false }),
    [],
  );

  const rows = useMemo(() => data?.applications ?? [], [data]);
  const total = data?.total ?? rows.length;

  // Apply-complete hook for every variant: surface the result note, reload the
  // evaluated list. The note is held here so it survives the reload remount of
  // the inner variant component (the variant's own note state would reset).
  const [topNote, setTopNote] = useState(null);
  const onApplied = useCallback(
    async (note) => {
      setTopNote(note || null);
      await reload();
    },
    [reload],
  );

  const variantProps = { rows, busy, setBusy, onApplied };

  return (
    <div className="dash-scroll">
      <style>{GATE1_CSS}</style>

      <div className="g1-head">
        <div>
          <div className="dash-section-tag">A-4 · GATE 1 REVIEW</div>
          <div className="dash-card-title">Decide on evaluated applications</div>
          <div className="os-text-soft os-text-sm" style={{ marginTop: 2 }}>
            {loading
              ? "Loading…"
              : `${rows.length} of ${total} evaluated · reviewer-scored, awaiting a gate-1 decision`}
          </div>
        </div>
      </div>

      <div className="g1-variant-bar" role="tablist" aria-label="Gate-1 workflow">
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={variant === v.id}
            className={"g1-variant-tab" + (variant === v.id ? " active" : "")}
            onClick={() => {
              setVariant(v.id);
              setTopNote(null);
            }}
          >
            {v.label}
          </button>
        ))}
      </div>

      <Note note={topNote} onDismiss={() => setTopNote(null)} />

      {loading ? (
        <LoadingState label="Loading evaluated applications…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <EmptyState label="No evaluated applications awaiting a gate-1 decision." />
      ) : variant === "stack" ? (
        <DecisionStack key={"stack-" + rows.length} {...variantProps} />
      ) : variant === "table" ? (
        <TriageTable key={"table-" + rows.length} {...variantProps} />
      ) : (
        <CutoffView key={"cutoff-" + rows.length} {...variantProps} />
      )}
    </div>
  );
}

// Scoped styles. Everything reuses admin-portal.css atoms; only the gate-1
// specific layout (variant bar, histogram, queue dots, note) is defined here.
const GATE1_CSS = `
.adm-portal .g1-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:16px; }
.adm-portal .g1-variant-bar { display:inline-flex; gap:4px; background:var(--bg-soft); border:1px solid var(--line); border-radius:6px; padding:3px; margin-bottom:16px; }
.adm-portal .g1-variant-tab {
  height:30px; padding:0 16px; border:none; background:transparent; border-radius:4px;
  font-family:var(--font-sans); font-size:12.5px; font-weight:600; color:var(--ink-soft); cursor:pointer;
}
.adm-portal .g1-variant-tab:hover { color:var(--ink); }
.adm-portal .g1-variant-tab.active { background:#fff; color:var(--ink); box-shadow:0 1px 2px rgba(0,0,0,0.08); }
.adm-portal .g1-stack-head { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:16px; }
.adm-portal .g1-meta-row { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:12px; padding-top:12px; border-top:1px solid var(--line); font-size:13px; }
.adm-portal .g1-field-hint { margin-top:8px; font-size:12px; color:#b3262b; }
.adm-portal .g1-queue-dot {
  width:28px; height:28px; border-radius:6px; display:grid; place-items:center;
  background:var(--bg-soft); color:var(--ink-dim); border:1px solid var(--line);
  font-family:var(--font-sans); font-size:12px; font-weight:600; cursor:pointer;
}
.adm-portal .g1-queue-dot:hover { border-color:var(--line-strong); color:var(--ink); }
.adm-portal .g1-queue-dot.is-current { outline:2px solid var(--accent); outline-offset:1px; }
.adm-portal .g1-shared-rationale { display:flex; flex-direction:column; gap:6px; margin-bottom:16px; }
.adm-portal .g1-table-wrap { border:1px solid var(--line); border-radius:4px; overflow:auto; }
.adm-portal .g1-apply-bar { display:flex; justify-content:flex-end; margin-top:16px; }
.adm-portal .g1-histogram { position:relative; height:200px; padding:18px 8px 0; }
.adm-portal .g1-bars { display:flex; align-items:flex-end; gap:6px; height:100%; }
.adm-portal .g1-bar-col { flex:1; display:flex; align-items:flex-end; justify-content:center; height:100%; }
.adm-portal .g1-bar { width:100%; position:relative; min-height:2px; border-radius:2px 2px 0 0; }
.adm-portal .g1-bar.is-above { background:var(--ok, #2F6F62); }
.adm-portal .g1-bar.is-below { background:var(--ink-dim); }
.adm-portal .g1-bar.is-override { background:var(--accent); opacity:0.55; }
.adm-portal .g1-bar-val { position:absolute; top:-16px; left:50%; transform:translateX(-50%); font-family:var(--font-mono); font-size:10px; color:var(--ink-soft); }
.adm-portal .g1-cutoff-line { position:absolute; left:8px; right:8px; border-top:2px dashed var(--accent); pointer-events:none; }
.adm-portal .g1-cutoff-tag { position:absolute; right:0; top:-22px; background:var(--accent); color:#fff; font-family:var(--font-mono); font-size:11px; padding:2px 8px; border-radius:2px; }
.adm-portal .g1-cutoff-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px dashed var(--line); font-size:13px; }
.adm-portal .g1-note { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 14px; border-radius:4px; font-size:13px; font-family:var(--font-sans); margin-bottom:16px; }
.adm-portal .g1-note.is-ok { background:#e9f6ef; border:1px solid #b7ddc8; color:#1d6b45; }
.adm-portal .g1-note.is-error { background:#fdecec; border:1px solid #f3c2c4; color:#b3262b; }
.adm-portal .g1-note-x { background:none; border:none; cursor:pointer; font-size:18px; line-height:1; color:inherit; padding:0 4px; }
`;
