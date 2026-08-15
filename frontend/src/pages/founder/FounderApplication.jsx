import { useEffect, useState } from "react";
import FullApplication from "../../components/FullApplication.jsx";
import { api } from "../../lib/api.js";
import { Loading, ErrorState } from "./ui.jsx";

// The submitted-application endpoints are per-track and each router is gated
// by require_track(...), so the path has to match the founder's own track —
// and FullApplication picks its question schema from the same value.
const SUBMITTED_PATH = {
  tir: "/applications/me/submitted",
  sip: "/sip-applications/me/submitted",
};

export default function FounderApplication({ track = "tir" }) {
  const [app, setApp] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.get(SUBMITTED_PATH[track] || SUBMITTED_PATH.tir)
      .then((rows) => setApp(Array.isArray(rows) ? rows[0] : rows))
      .catch(setError);
  }, [track]);
  if (error) return <ErrorState error={error} />;
  if (!app) return <Loading label="Loading your application…" />;
  return (
    <div>
      <span className="eyebrow eyebrow-rule">Application · Current</span>
      <h1 className="big" style={{ fontFamily: "var(--font-display)" }}>Your current application.</h1>
      <FullApplication application={app} applicationId={app.id} track={track} />
    </div>
  );
}
