// One AIR lever rendered as a horizontal 1-9 scale, split into three
// per-segment states rather than a single continuous fill:
//   verified  -> solid, ARTPARK has confirmed the venture reached this level
//   claimed   -> ghost/hatched, the founder asserts it but no reviewer has
//                signed off yet (verification is a later phase — every
//                venture's `verified` is null today, which renders as an
//                all-ghost bar up to `claimed`. That is the normal state
//                of a draft round, not a broken one.)
//   empty     -> segment not reached by either claim or verification
//
// Presentational only, deliberately — Phase 6's dashboard scorecard reuses
// this component unchanged, so it must not import founderApi or otherwise
// know where its numbers come from. The caller owns fetching and passes
// plain `claimed`/`verified` levels down.
//
// `verified` can only ever be <= `claimed` in practice (a reviewer confirms
// or downgrades, never awards a level the founder didn't claim), but a bad
// read must not crash the bar — an out-of-order pair is clamped so the
// solid run never outruns the ghost run.
export default function AirBar({ name, claimed, verified, max = 9 }) {
  const claimedLevel = clamp(claimed, max);
  const verifiedLevel = clamp(Math.min(verified ?? 0, claimedLevel ?? 0), max);
  const hasVerified = verified != null;

  const segments = Array.from({ length: max }, (_, i) => {
    const n = i + 1;
    if (hasVerified && n <= verifiedLevel) return "verified";
    if (claimedLevel != null && n <= claimedLevel) return "claimed";
    return "empty";
  });

  return (
    <div className="fj-air-bar">
      <div className="fj-air-bar-head">
        <span className="fj-air-bar-name">{name}</span>
        <span className="fj-air-bar-value">
          {claimedLevel == null ? "—" : claimedLevel}
          {hasVerified && claimedLevel != null && verifiedLevel !== claimedLevel && (
            <span className="fj-air-bar-verified-val"> (verified {verifiedLevel})</span>
          )}
        </span>
      </div>
      <div className="fj-air-bar-track">
        {segments.map((state, i) => (
          <span
            key={i}
            data-air-seg={state}
            className={`fj-air-seg fj-air-seg-${state}`}
          />
        ))}
      </div>
    </div>
  );
}

// `n` can be null (unanswered), or a verifier value out of the 1..max
// range in theory — clamp defensively rather than let a segment count
// go negative or past `max`.
function clamp(n, max) {
  if (n == null) return null;
  return Math.max(0, Math.min(max, n));
}
