import { useEffect, useState } from "react";
import FullApplication from "../../components/FullApplication.jsx";
import { api } from "../../lib/api.js";
import { Loading, ErrorState } from "./ui.jsx";

export default function FounderApplication() {
  const [app, setApp] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.get("/applications/me/submitted").then((rows) => setApp(Array.isArray(rows) ? rows[0] : rows)).catch(setError);
  }, []);
  if (error) return <ErrorState error={error} />;
  if (!app) return <Loading label="Loading your application…" />;
  return (
    <div>
      <span className="eyebrow eyebrow-rule">Application · Current</span>
      <h1 className="big" style={{ fontFamily: "var(--font-display)" }}>Your current application.</h1>
      <FullApplication application={app} applicationId={app.id} track="tir" />
    </div>
  );
}
