const ROWS = [
  { col: "score_problem",    label: "Problem importance" },
  { col: "score_solution",   label: "Solution depth" },
  { col: "score_tech",       label: "Technical strength" },
  { col: "score_founders",   label: "Founder traits" },
  { col: "score_commitment", label: "Commitment" },
];

function Bar({ value, color }) {
  const pct = typeof value === "number" ? (value / 10) * 100 : 0;
  return (
    <div className="bar-track" style={{ flex: 1 }}>
      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export default function AIComparisonView({ myReview, aiScreening }) {
  const isStub = !!(aiScreening?.summary && /\bstub mode\b/i.test(aiScreening.summary));

  return (
    <div>
      <h3 style={{ fontSize: 18, margin: "0 0 16px" }}>Your scores vs AI:</h3>
      {ROWS.map((r) => (
        <div key={r.col} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 6 }}>{r.label}</div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 4 }}>
            <span style={{ width: 32, fontSize: 12, color: "var(--ink-soft)" }}>You</span>
            <Bar value={myReview?.[r.col]} color="var(--artblue)" />
            <span style={{ width: 24, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
              {myReview?.[r.col] ?? "—"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ width: 32, fontSize: 12, color: "var(--ink-soft)" }}>AI</span>
            <Bar value={aiScreening?.[r.col]} color="var(--ink-soft)" />
            <span style={{ width: 24, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
              {aiScreening?.[r.col] ?? "—"}
            </span>
          </div>
        </div>
      ))}

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Recommendation</div>
        <div style={{ fontSize: 14, color: "var(--ink)", fontWeight: 600 }}>
          {(myReview?.recommendation || "—").toUpperCase()}
        </div>
      </div>

      {aiScreening?.summary && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 4 }}>
            AI summary {isStub && <span style={{ marginLeft: 8, background: "var(--accent-amber)", color: "#fff", padding: "2px 6px", fontSize: 10, letterSpacing: "0.08em" }}>STUB</span>}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink)", fontStyle: "italic", lineHeight: 1.5 }}>
            {aiScreening.summary}
          </div>
        </div>
      )}
    </div>
  );
}
