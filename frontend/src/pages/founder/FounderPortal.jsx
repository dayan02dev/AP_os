import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import PortalSwitcher from "../../components/PortalSwitcher.jsx";
import { founderApi } from "../../lib/founderApi.js";
import { Loading, ErrorState } from "./ui.jsx";
import FounderApplication from "./FounderApplication.jsx";
import FounderMou from "./FounderMou.jsx";
import FounderApproach from "./FounderApproach.jsx";
import FounderOrganization from "./FounderOrganization.jsx";
import FounderExpense from "./FounderExpense.jsx";
import FounderDashboard from "./FounderDashboard.jsx";
import FounderLocked from "./FounderLocked.jsx";
import "../../styles/founder-portal.css";

const NAV = [
  { group: "Application", items: [
    { sec: "application", chip: "•", label: "Current", to: "/founder" },
  ]},
  { group: "Onboarding", tag: "New", items: [
    { sec: "mou", chip: "01", label: "Sign MOU", to: "/founder/mou" },
  ]},
  { group: "Cohort management", locked: "cohort", items: [
    { sec: "approach", chip: "01", label: "Approach", to: "/founder/approach" },
    { sec: "org", chip: "02", label: "Organization", to: "/founder/org" },
    { sec: "expense", chip: "03", label: "Expense management", to: "/founder/expense" },
  ]},
  { group: "Dashboard reporting", locked: "dashboard", items: [
    { sec: "dashboard", chip: "•", label: "Process dashboard", to: "/founder/dashboard" },
  ]},
];

export default function FounderPortal({ tab = "application" }) {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    founderApi.me().then(setMe).catch(setError);
  }, []);
  useEffect(refresh, [refresh]);

  if (error) {
    if (error.status === 403) {
      return (
        <div className="founder-portal" style={{ padding: 60 }}>
          <h1 style={{ fontFamily: "var(--font-display)" }}>Founder Portal</h1>
          <p style={{ color: "var(--ink-soft)" }}>
            This area unlocks once your TIR application is selected. <a href="/apply">Back to your application →</a>
          </p>
        </div>
      );
    }
    return <div className="founder-portal"><ErrorState error={error} /></div>;
  }
  if (!me) return <div className="founder-portal"><Loading label="Loading your portal…" /></div>;

  const locked = me.locked || { cohort: true, dashboard: true };
  const isLocked = (item, group) => group.locked && locked[group.locked];

  const renderTab = () => {
    // gate cohort/dashboard tabs until MOU signed
    if ((tab === "approach" || tab === "org" || tab === "expense") && locked.cohort)
      return <FounderLocked which="cohort" onGoMou={() => navigate("/founder/mou")} />;
    if (tab === "dashboard" && locked.dashboard)
      return <FounderLocked which="dashboard" onGoMou={() => navigate("/founder/mou")} />;
    switch (tab) {
      case "mou": return <FounderMou me={me} onSigned={refresh} />;
      case "approach": return <FounderApproach />;
      case "org": return <FounderOrganization />;
      case "expense": return <FounderExpense />;
      case "dashboard": return <FounderDashboard />;
      default: return <FounderApplication me={me} />;
    }
  };

  return (
    <div className="founder-portal">
      <div className="topbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 26px", borderBottom: "1px solid var(--line)" }}>
        <strong style={{ fontFamily: "var(--font-display)" }}>ARTPARK · TIR</strong>
        <PortalSwitcher current="founder" />
      </div>
      <div className="main-wrap">
        <aside className="side">
          <div className="who"><div className="ava">TIR</div><div><div className="nm">{me.project_name || "Your venture"}</div><div className="sub">TIR · Founder</div></div></div>
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="grp"><span className="eyebrow" style={g.tag ? { color: "var(--artblue)" } : undefined}>{g.group}</span>{g.tag && <span className="tag">{g.tag}</span>}</div>
              {g.items.map((it) => (
                <div
                  key={it.sec}
                  className={`nav-item${tab === it.sec ? " active" : ""}${isLocked(it, g) ? " locked" : ""}`}
                  onClick={() => navigate(it.to)}
                  style={isLocked(it, g) ? { opacity: 0.5 } : undefined}
                >
                  <span className="chip">{it.chip}</span><span className="t">{it.label}</span>
                  {isLocked(it, g) && <span className="badge">🔒</span>}
                </div>
              ))}
            </div>
          ))}
        </aside>
        <main className="main"><div className="wrap">{renderTab()}</div></main>
      </div>
    </div>
  );
}
