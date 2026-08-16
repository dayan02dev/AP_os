// The VIP analogue of TIR's cycle-timeline Gantt, sitting in the same
// bottom-card position (Task 7). Open Question 2 (no founder-facing
// endpoint returns any AIR round but the current quarter's) means there is
// exactly one data point reachable today, for every venture, regardless of
// how many quarters they have actually completed. This renders that one
// point honestly — a single labelled marker plus a PERMANENT note
// explaining why there is only one. The note is not an error state and not
// a loading state: it must read as a static fact about this surface, never
// as something a founder should retry, so it is never gated on `round`'s
// status or on whether the point actually has a number.
//
// Consumes the same `round`/`rollups` slice AirScorecardPanel.jsx takes —
// not a new fetch. Presentational only.
export default function AirTrajectoryPanel({ round, rollups }) {
  const overall = rollups?.claimed?.overall;

  return (
    <div className="card fj-dash-card">
      <div className="fj-dash-card-title">AIR Trajectory</div>
      <div className="vipd-trajectory">
        <div className="vipd-trajectory-point">
          <span className="vipd-trajectory-round">{round.round_label}</span>
          <span className="vipd-trajectory-value">{overall ?? "—"}</span>
        </div>
        {/* Always rendered — see the header comment. Never conditioned on
            `round.status` or on `overall` having a real value: this note
            is about the surface's own reach, not about this round's
            progress. */}
        <p className="vipd-trajectory-note">
          Earlier rounds aren't available here yet — this panel will plot AIR over time once
          round history is reachable from your portal.
        </p>
      </div>
    </div>
  );
}
