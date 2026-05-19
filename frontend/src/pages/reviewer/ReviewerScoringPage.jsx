import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { reviewerApi } from "../../lib/reviewerApi.js";
import { schemaFor } from "./review/applicationSchemas.js";
import ReviewHeader from "./review/ReviewHeader.jsx";
import ApplicationTab from "./review/ApplicationTab.jsx";
import ReviewerScoringPanel from "./scoring/ReviewerScoringPanel.jsx";
import "../../styles/reviewer.css";

function composeAppId(track, id, submittedAt) {
  const prefix = (track || "").toUpperCase();
  let year = new Date().getFullYear();
  if (submittedAt) {
    try { year = new Date(submittedAt).getFullYear(); } catch { /* */ }
  }
  return `${prefix}-${year}-${(id || "").slice(0, 8) || "unknown"}`;
}

function pickState(myReview) {
  if (!myReview || !myReview.submitted_at) return "scoring";
  if (!myReview.locked_at) return "editable";
  const locked = new Date(myReview.locked_at).getTime();
  if (Date.now() < locked) return "editable";
  return "locked";
}

export default function ReviewerScoringPage() {
  const { track, id } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tooNarrow, setTooNarrow] = useState(
    typeof window !== "undefined" && window.innerWidth < 1024
  );

  useEffect(() => {
    const onResize = () => setTooNarrow(window.innerWidth < 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      reviewerApi.getMyReview(id),
      reviewerApi.getApplication(track, id),
    ])
      .then(([mineRes, appRes]) => {
        if (cancelled) return;
        setDetail({
          application: appRes.application,
          assignment: appRes.assignment,
          aiScreening: appRes.ai_screening,
          myReview: mineRes.review || appRes.my_review || null,
        });
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.details?.message || err?.message || "Failed to load.");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [track, id, reload]);

  const state = useMemo(() => pickState(detail?.myReview), [detail?.myReview]);
  const effectiveState = editing ? "scoring" : state;
  const schema = useMemo(() => schemaFor(track), [track]);
  const appIdent = useMemo(
    () => composeAppId(track, id, detail?.application?.submitted_at),
    [track, id, detail?.application?.submitted_at],
  );

  const onBack = useCallback(() => navigate("/reviewer/inbox"), [navigate]);

  const onEditClick = useCallback(() => setEditing(true), []);

  const onExpire = useCallback(() => setReload((n) => n + 1), []);

  const onSubmit = useCallback(async (form) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (editing && detail?.myReview) {
        await reviewerApi.patchReview(detail.myReview.id, { ...form, draft: false });
      } else {
        await reviewerApi.submitReview({
          application_id: id,
          application_track: track,
          assignment_id: detail.assignment.assignment_id,
          ...form,
          draft: false,
        });
      }
      setEditing(false);
      setReload((n) => n + 1);
    } catch (err) {
      if (err?.status === 423) {
        window.alert("Edit window closed. Your last submitted version is final.");
        setEditing(false);
        setReload((n) => n + 1);
      } else {
        window.alert(err?.message || "Submit failed.");
      }
    } finally {
      setSubmitting(false);
    }
  }, [id, track, detail, submitting, editing]);

  const onSaveDraft = useCallback(async (form) => {
    try {
      await reviewerApi.submitReview({
        application_id: id,
        application_track: track,
        assignment_id: detail.assignment.assignment_id,
        ...form,
        draft: true,
      });
      setReload((n) => n + 1);
    } catch (err) {
      window.alert(err?.message || "Save failed.");
    }
  }, [id, track, detail]);

  if (tooNarrow) {
    return (
      <div className="reviewer-scoring-page" style={{ padding: 24 }}>
        <div className="card card-soft" style={{ textAlign: "center", padding: 48 }}>
          <span className="eyebrow">Use a desktop</span>
          <h3 style={{ marginTop: 12 }}>Scoring requires a wider screen.</h3>
          <p style={{ color: "var(--ink-soft)", marginTop: 8 }}>
            This page needs at least 1024 pixels wide. Open this link on a laptop or desktop.
          </p>
          <button className="btn btn-ghost" style={{ marginTop: 24 }} onClick={onBack}>
            ← Back to inbox
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="reviewer-scoring-page review-page">
      <ReviewHeader
        appId={appIdent}
        status={detail?.application?.status || null}
        onBack={onBack}
        onPrev={() => {}}
        onNext={() => {}}
        hasPrev={false}
        hasNext={false}
      />
      <div className="review-body scoring-body" style={{ display: "flex" }}>
        <main className="review-main" style={{ flex: 1 }}>
          <div className="review-main-inner">
            {error && <div className="inline-error" role="alert">{error}</div>}
            {loading && !detail && <p>Loading application…</p>}
            {!error && detail && (
              <ApplicationTab schema={schema} application={detail.application} />
            )}
          </div>
        </main>
        {detail && (
          <ReviewerScoringPanel
            state={effectiveState}
            myReview={detail.myReview}
            aiScreening={detail.aiScreening}
            onSubmit={onSubmit}
            onSaveDraft={onSaveDraft}
            onEdit={onEditClick}
            onExpire={onExpire}
          />
        )}
      </div>
    </div>
  );
}
