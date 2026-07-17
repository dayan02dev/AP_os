export default function FounderLocked({ which, onGoMou }) {
  const what = which === "dashboard" ? "the process dashboard" : "cohort management";
  return (
    <div className="panel" style={{ padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 30 }}>🔒</div>
      <h2 style={{ fontFamily: "var(--font-display)", marginTop: 10 }}>Sign your MOU to unlock {what}</h2>
      <p style={{ color: "var(--ink-soft)", marginTop: 8 }}>
        Once your Memorandum of Understanding is signed, this section opens up.
      </p>
      <div className="row-actions" style={{ justifyContent: "center", marginTop: 16 }}>
        <button className="btn btn-primary" onClick={onGoMou}>Go to Sign MOU →</button>
      </div>
    </div>
  );
}
