import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { reviewerApi } from "../../lib/reviewerApi.js";

const TRACKS = [
  { value: "all", label: "All" },
  { value: "tir", label: "TIR" },
  { value: "sip", label: "SIP" },
];

function fmtRelative(iso) {
  if (!iso) return "—";
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} wk ago`;
  return `${Math.floor(days / 30)} mo ago`;
}

function recLabel(r) {
  if (!r) return "—";
  return r.charAt(0).toUpperCase() + r.slice(1).toLowerCase();
}

export default function ReviewerCompletedPage() {
  const navigate = useNavigate();
  const [data, setData] = useState({ reviews: [], page: 1, total_pages: 1, total: 0 });
  const [track, setTrack] = useState("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page };
      if (track !== "all") params.track = track;
      const res = await reviewerApi.listCompletedReviews(params);
      setData(res);
    } catch (err) {
      setError(err?.message || "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [track, page]);

  useEffect(() => { load(); }, [load]);

  const openReview = useCallback(
    (r) => navigate(`/reviewer/${r.application_track}/${r.application_id}/score`),
    [navigate],
  );

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow eyebrow-rule">Reviews · Archive</span>
          <h1>Completed.</h1>
          <p className="page-sub">
            Your locked reviews. Read-only after the 60-minute edit window closes.
          </p>
        </div>
      </header>

      <div className="filter-bar">
        <div className="filter-chips">
          {TRACKS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`chip${track === t.value ? " active" : ""}`}
              onClick={() => { setPage(1); setTrack(t.value); }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      {!loading && data.reviews.length === 0 && (
        <div className="card card-soft" style={{ textAlign: "center", padding: "96px 32px" }}>
          <span className="eyebrow">No reviews yet</span>
          <h3 style={{ marginTop: 12 }}>Nothing here yet.</h3>
          <p style={{ color: "var(--ink-soft)", marginTop: 8 }}>
            Your locked reviews land here after the 60-minute edit window closes.
          </p>
        </div>
      )}

      {data.reviews.length > 0 && (
        <table className="tbl">
          <thead>
            <tr>
              <th>Application</th>
              <th>Track</th>
              <th className="num">My score</th>
              <th>My rec</th>
              <th>Submitted</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.reviews.map((r) => (
              <tr key={r.review_id} onClick={() => openReview(r)}>
                <td className="primary">
                  {r.app_identifier}
                  {r.problem_one_liner && (
                    <span className="sub">{r.problem_one_liner}</span>
                  )}
                </td>
                <td>{(r.application_track || "").toUpperCase()}</td>
                <td className="num">{r.score_overall_mine != null ? r.score_overall_mine.toFixed(1) : "—"}</td>
                <td>{recLabel(r.recommendation)}</td>
                <td title={r.submitted_at}>{fmtRelative(r.submitted_at)}</td>
                <td style={{ textAlign: "right", color: "var(--ink-soft)" }}>→</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data.total_pages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 24, color: "var(--ink-dim)" }}>
          <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Previous
          </button>
          <span>Page {data.page} of {data.total_pages}</span>
          <button className="btn btn-ghost" disabled={page >= data.total_pages} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
        </div>
      )}
    </>
  );
}
