// FunnelStrip — visual pipeline from profiles → decided. Driven by the
// `funnel` block on GET /leadership/stats, which always returns these five
// keys: { profiles, submitted, in_review, advanced, decided }.
//
// Steps are intentionally rendered in order even when some are zero — that's
// how the staffing reality reads (e.g. early in the cycle, "decided" is 0).

const STEPS = [
  { key: "profiles",  label: "Profiles",   sub: "signed up" },
  { key: "submitted", label: "Submitted",  sub: "complete" },
  { key: "in_review", label: "In review",  sub: "AI + human" },
  { key: "advanced",  label: "Advanced",   sub: "shortlist + interview" },
  { key: "decided",   label: "Decided",    sub: "offered + onboarded" },
];

export default function FunnelStrip({ funnel }) {
  const values = STEPS.map((s) => ({ ...s, n: funnel?.[s.key] ?? 0 }));
  const max = Math.max(1, ...values.map((s) => s.n));
  return (
    <div className="lp-funnel">
      {values.map((s, i) => {
        const w = (s.n / max) * 100;
        const isLast = i === values.length - 1;
        return (
          <div className="lp-funnel-step" key={s.key}>
            <div className="lp-funnel-bar-wrap">
              <div className="lp-funnel-bar" style={{ width: `${w}%` }} />
              <span className="eir-mono lp-funnel-bar-n">{s.n}</span>
            </div>
            <div className="lp-funnel-meta">
              <div className="eir-mono lp-funnel-label">{s.label}</div>
              <div className="eir-mono eir-dim lp-funnel-sub">{s.sub}</div>
            </div>
            {!isLast && (
              <span className="lp-funnel-arrow" aria-hidden="true">
                ↓
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
