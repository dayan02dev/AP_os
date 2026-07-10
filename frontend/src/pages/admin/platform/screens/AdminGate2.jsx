// AdminGate2 — A-7 · FINAL GATE (real screen, jury v2 pick-matrix).
//
// Reads the pipeline via useAdminData("pipeline", {}); filters to apps where:
//   - status chip is JURY REVIEW and picks_ready=true  (ready for decision)
//   - OR gate2_decision is already set  (history tab)
//
// v2 model: jurors PICK startups to mentor (no scoring). The decision card
// shows a PICK MATRIX — which assigned jurors picked this startup + their
// notes — instead of a jury average.
//
// Decision outcomes (gate_stage:"gate2"):
//   offered | waitlisted | on_hold | rejected
//   rationale required for non-"offered" decisions.
//
// Mirrors AdminGate1.jsx's tab-based UX with two variants:
//   A · Status   — decide one app at a time (mirroring GateReviewStack)
//   B · History  — apps with gate2_decision already set

import { useState, useMemo } from "react";
import { useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { PageHead, Chip, FlagDot } from "../shell/osAtoms";
import { LoadingState, ErrorState, EmptyState } from "../ui.jsx";

// ── Decision config ─────────────────────────────────────────────────────────
const GATE2_DECISIONS = [
  { id: "offered",    label: "Offer",    tone: "approve",  needsRationale: false },
  { id: "waitlisted", label: "Waitlist", tone: "waitlist", needsRationale: true  },
  { id: "on_hold",    label: "Hold",     tone: "waitlist", needsRationale: true  },
  { id: "rejected",   label: "Reject",   tone: "reject",   needsRationale: true  },
];
const NEEDS_RATIONALE = new Set(["waitlisted", "on_hold", "rejected"]);

const DECISION_CHIP = {
  offered:    "green",
  waitlisted: "amber",
  on_hold:    "amber",
  rejected:   "red",
};

// ── Inline note ─────────────────────────────────────────────────────────────
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

// ══════════════════════════════════════════════════════════════════════════════
// VARIANT A · Status Stack — decide one app at a time
// ══════════════════════════════════════════════════════════════════════════════
function Gate2Stack({ items, reload }) {
  const [idx, setIdx] = useState(0);
  const [decisions, setDecisions] = useState(() => {
    const init = {};
    items.forEach(it => { if (it.gate2_decision) init[it.id] = it.gate2_decision; });
    return init;
  });
  const [rationales, setRationales] = useState({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const total   = items.length;
  const safeIdx = Math.min(idx, Math.max(0, total - 1));
  const s       = items[safeIdx];

  const goto = (next) => {
    setIdx(Math.max(0, Math.min(total - 1, next)));
    setNote(null);
  };

  const decide = async (decisionId) => {
    if (busy || !s) return;
    const rationale = (rationales[s.id] || "").trim();
    if (NEEDS_RATIONALE.has(decisionId) && !rationale) {
      setNote({ kind: "error", text: `${decisionId.charAt(0).toUpperCase() + decisionId.slice(1)} requires a rationale.` });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await adminPlatformApi.decideGate2(s.track, s.id, {
        decision: decisionId,
        rationale: rationale || undefined,
      });
      setDecisions(prev => ({ ...prev, [s.id]: decisionId }));
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

  const decided = Object.keys(decisions).length;
  const counts  = { offered: 0, waitlisted: 0, on_hold: 0, rejected: 0 };
  Object.values(decisions).forEach(d => { if (d in counts) counts[d]++; });

  if (!s) return <EmptyState label="No applications ready for a Final Gate decision." />;

  const pickedBy = s.picked_by || [];

  return (
    <div>
      <Note note={note} onDismiss={() => setNote(null)} />
      <div className="os-row between os-mb">
        <div className="os-row gap-sm">
          <span className="os-chip blue">VARIANT A · STATUS</span>
          <span className="os-text-soft">Decide final cohort outcomes one at a time.</span>
        </div>
        <span className="os-mono os-text-sm">{decided} / {total} decided</span>
      </div>

      {/* KPI tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(220px, 280px))", gap: 14, marginBottom: 24 }}>
        <div className="os-card soft gate-kpi">
          <span className="gate-kpi-kicker">Applications Ready</span>
          <span className="gate-kpi-num">{total}</span>
          <span className="gate-kpi-sub">Jurors have picked — ready for final gate</span>
        </div>
        <div className="os-card soft gate-kpi">
          <span className="gate-kpi-kicker">Cohort Decisions</span>
          <div style={{ display: "flex", gap: 20, marginTop: 8, flexWrap: "wrap" }}>
            {[["Offered", counts.offered, "#2F6F62"], ["Waitlisted", counts.waitlisted, "#FFB703"], ["Hold", counts.on_hold, "#e07b00"], ["Rejected", counts.rejected, "#FF5A5F"]].map(([label, n, c]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5 }}>
                <span style={{ fontFamily: "var(--font-serif)", fontSize: 26, fontWeight: 400, lineHeight: 1, color: "var(--ink)" }}>{n}</span>
                <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-dim)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: c, flexShrink: 0 }} />{label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="os-grid-evaluation">
        {/* Left — app card */}
        <div className="os-card">
          <div className="os-card-head">
            <div className="os-row gap-sm">
              <span className="os-mono os-text-xs os-text-dim">{safeIdx + 1}/{total}</span>
              <FlagDot tone={s.flag} />
              <span style={{ fontSize: 22, fontFamily: "var(--font-serif)" }}>{s.name}</span>
              <span className="os-chip">{s.domain}</span>
              {s.stage && s.stage !== "—" && <span className="os-chip">{s.stage}</span>}
            </div>
            <div className="os-row gap-sm">
              <button className="os-btn sm ghost" disabled={busy || safeIdx === 0} onClick={() => goto(safeIdx - 1)}>← Prev</button>
              <button className="os-btn sm ghost" disabled={busy || safeIdx >= total - 1} onClick={() => goto(safeIdx + 1)}>Next →</button>
            </div>
          </div>

          <div style={{ padding: "12px 0 20px 0", display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Pick matrix — which assigned jurors picked this startup to mentor */}
            <div className="os-card" style={{ background: "var(--artlight)", border: "1px solid transparent" }}>
              <div className="os-row between" style={{ alignItems: "center", marginBottom: 10 }}>
                <span className="os-text-xs os-uppercase" style={{ fontWeight: 600, letterSpacing: "0.12em", color: "var(--artblue)" }}>Pick matrix</span>
              </div>
              {pickedBy.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {pickedBy.map((p, i) => (
                    <div key={p.juror_user_id || i} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>★ {p.name}</span>
                      {p.note && <span style={{ fontSize: 12, fontStyle: "italic", color: "var(--ink-soft)" }}>{p.note}</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="os-text-soft" style={{ fontSize: 13 }}>No jurors have picked this startup yet.</div>
              )}
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 12 }}>
                {pickedBy.length} of {s.jury_assigned ?? 0} assigned jurors picked this startup
              </div>
            </div>

            {/* AI score context */}
            {s.ai?.overall != null && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "var(--bg-soft)", borderRadius: 4, border: "1px solid var(--line)" }}>
                <span className="os-text-xs os-uppercase" style={{ fontWeight: 600, letterSpacing: "0.1em", color: "var(--ink-soft)" }}>AI Screening Score</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>{Number(s.ai.overall).toFixed(1)}</span>
              </div>
            )}

            {/* Existing gate2_decision indicator */}
            {s.gate2_decision && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "var(--bg-soft)", border: "1px solid var(--line)", borderRadius: 4 }}>
                <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>Existing Gate-2 decision:</span>
                <span className={"os-chip " + (DECISION_CHIP[s.gate2_decision] || "")} style={{ fontSize: 11, fontWeight: 700 }}>
                  {s.gate2_decision.toUpperCase()}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Right — decision panel */}
        <div className="os-stack">
          <div className="os-card">
            <div className="os-card-title os-mb-sm">Gate-2 Decision</div>
            <div className="os-reco-group">
              {GATE2_DECISIONS.map(opt => {
                const isActive = decisions[s.id] === opt.id;
                return (
                  <button
                    key={opt.id}
                    className={"os-reco-btn " + opt.tone + (isActive ? " active" : "")}
                    disabled={busy}
                    onClick={() => decide(opt.id)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <textarea
              className="os-input os-w-100 os-mt"
              rows="3"
              placeholder="Decision rationale (required for waitlist / hold / reject)…"
              value={rationales[s.id] || ""}
              onChange={e => setRationales(prev => ({ ...prev, [s.id]: e.target.value }))}
            />
          </div>

          {/* Progress dots */}
          <div className="os-card">
            <div className="os-card-title os-mb-sm">Progress</div>
            <div className="os-row gap-sm" style={{ flexWrap: "wrap" }}>
              {items.map((it, i) => {
                const dec = decisions[it.id];
                const t = dec === "offered"    ? { bg: "#eef5f1", fg: "#2F6F62", bd: "#bcd7cd" }
                        : dec === "rejected"   ? { bg: "#fff0f0", fg: "#d23b40", bd: "#f8c2c4" }
                        : dec === "waitlisted" || dec === "on_hold" ? { bg: "#fff8e6", fg: "#9a6206", bd: "#f6d98a" }
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

// ══════════════════════════════════════════════════════════════════════════════
// VARIANT B · History — apps with gate2_decision already recorded
// ══════════════════════════════════════════════════════════════════════════════
function Gate2History({ allRows, reload }) {
  const decided = useMemo(
    () => allRows.filter(s => s.gate2_decision),
    [allRows]
  );

  const [editingId, setEditingId] = useState(null);
  const [editDecision, setEditDecision] = useState("");
  const [editRationale, setEditRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const handleSave = async (s) => {
    const rationale = editRationale.trim();
    if (NEEDS_RATIONALE.has(editDecision) && !rationale) {
      setNote({ kind: "error", text: "A rationale is required for that decision." });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await adminPlatformApi.decideGate2(s.track, s.id, {
        decision: editDecision,
        rationale: rationale || undefined,
      });
      setEditingId(null);
      await reload();
    } catch (e) {
      setNote({ kind: "error", text: `Save failed: ${e?.message || e}` });
    } finally {
      setBusy(false); }
  };

  const total         = decided.length;
  const offeredCount  = decided.filter(s => s.gate2_decision === "offered").length;
  const selectionRate = total > 0 ? ((offeredCount / total) * 100).toFixed(0) : 0;

  return (
    <div>
      <Note note={note} onDismiss={() => setNote(null)} />

      <div className="lp-section-head" style={{ marginBottom: 20 }}>
        <div>
          <span className="lp-section-eyebrow">HISTORY</span>
          <h2 className="lp-section-title">Gate-2 decision history</h2>
          <div className="lp-section-sub">All applications finalized at the final cohort gate.</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
        {[
          ["TOTAL DECISIONS", total, "across cohort", "var(--ink)"],
          ["OFFER RATE", selectionRate + "%", "applications offered", "var(--accent)"],
          ["WAITLISTED", decided.filter(s => s.gate2_decision === "waitlisted").length, "on waitlist", "#9a6206"],
        ].map(([label, val, sub, color]) => (
          <div key={label} style={{ background: "var(--bg-soft)", border: "1px solid var(--line)", padding: "16px 20px", borderRadius: 2 }}>
            <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--ink-dim)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, margin: "8px 0 4px 0", color }}>{val}</div>
            <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{sub}</div>
          </div>
        ))}
      </div>

      {decided.length === 0 ? (
        <EmptyState label="No Gate-2 decisions recorded yet." />
      ) : (
        <table className="os-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Industry</th>
              <th>Picked by</th>
              <th>Gate-2 Decision</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {decided.map(s => {
              const isEditing = editingId === s.id;
              const pickers = (s.picked_by || []).map(p => p.name).filter(Boolean);
              return (
                <tr key={s.id}>
                  <td>
                    <div className="startup">
                      {s.name}
                      <small>{s.founders?.[0] || "—"}</small>
                    </div>
                  </td>
                  <td className="os-text-soft">{s.domain}</td>
                  <td>
                    {pickers.length
                      ? <span className="os-text-sm">{pickers.join(", ")}</span>
                      : <span className="os-text-soft">—</span>}
                  </td>
                  <td>
                    {isEditing ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <select
                          className="os-select"
                          value={editDecision}
                          onChange={e => setEditDecision(e.target.value)}
                          style={{ fontSize: 13 }}
                        >
                          {GATE2_DECISIONS.map(opt => (
                            <option key={opt.id} value={opt.id}>{opt.label}</option>
                          ))}
                        </select>
                        <textarea
                          className="os-input"
                          rows="2"
                          style={{ fontSize: 12, width: "100%" }}
                          placeholder="Rationale (required for waitlist / hold / reject)…"
                          value={editRationale}
                          onChange={e => setEditRationale(e.target.value)}
                        />
                      </div>
                    ) : (
                      <Chip tone={DECISION_CHIP[s.gate2_decision] || ""}>
                        {(s.gate2_decision || "").toUpperCase()}
                      </Chip>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <div className="os-row gap-xs">
                        <button className="os-btn sm secondary" disabled={busy} onClick={() => setEditingId(null)}>Cancel</button>
                        <button
                          className="os-btn sm"
                          style={{ background: "var(--accent)", color: "#fff" }}
                          disabled={busy}
                          onClick={() => handleSave(s)}
                        >
                          {busy ? "Saving…" : "Save"}
                        </button>
                      </div>
                    ) : (
                      <button
                        className="os-btn sm ghost"
                        onClick={() => {
                          setEditingId(s.id);
                          setEditDecision(s.gate2_decision || "offered");
                          setEditRationale("");
                          setNote(null);
                        }}
                      >
                        ✎ Edit
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Main tab controller
// ══════════════════════════════════════════════════════════════════════════════
export function AdminGate2() {
  const [variant, setVariant] = useState("stack");

  const { data, loading, error, reload } = useAdminData("pipeline", {});
  const allRows = data?.startups ?? [];

  // Stack: JURY REVIEW apps whose jurors have finished picking (picks_ready).
  const readyRows = useMemo(
    () => allRows.filter(s => {
      const chip = (s.chip || "").toUpperCase();
      return chip === "JURY REVIEW" && s.picks_ready;
    }),
    [allRows]
  );

  const count = variant === "history"
    ? allRows.filter(s => s.gate2_decision).length
    : readyRows.length;

  return (
    <div className="dash-scroll">
      <style>{GATE2_CSS}</style>
      <PageHead
        eyebrow="A-7 · FINAL GATE"
        title={`Final <em>${count} application${count !== 1 ? "s" : ""}</em>`}
        sub={loading ? "Loading…" : "Applications the jury has picked, ready for cohort onboarding decisions."}
      />

      <div className="os-row gap-sm os-mb-lg">
        <div className={"os-tab " + (variant === "stack"   ? "active" : "")} onClick={() => setVariant("stack")}>A · Status</div>
        <div className={"os-tab " + (variant === "history" ? "active" : "")} onClick={() => setVariant("history")}>B · History</div>
      </div>

      {loading ? (
        <LoadingState label="Loading applications…" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : variant === "stack" ? (
        <Gate2Stack key={"stack-" + readyRows.length} items={readyRows} reload={reload} />
      ) : (
        <Gate2History key={"hist-" + allRows.length} allRows={allRows} reload={reload} />
      )}
    </div>
  );
}

export default AdminGate2;

// Scoped styles
const GATE2_CSS = `
.adm-portal .g1-note { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 14px; border-radius:4px; font-size:13px; font-family:var(--font-sans); margin-bottom:16px; }
.adm-portal .g1-note.is-ok    { background:#e9f6ef; border:1px solid #b7ddc8; color:#1d6b45; }
.adm-portal .g1-note.is-error { background:#fdecec; border:1px solid #f3c2c4; color:#b3262b; }
.adm-portal .g1-note-x { background:none; border:none; cursor:pointer; font-size:18px; line-height:1; color:inherit; padding:0 4px; }
`;
