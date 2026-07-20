import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth.jsx";
import { founderApi } from "../../lib/founderApi.js";
import { Loading, ErrorState } from "./ui.jsx";
import FounderApplication from "./FounderApplication.jsx";
import FounderMou from "./FounderMou.jsx";
import FounderApproach from "./FounderApproach.jsx";
import FounderOrganization from "./FounderOrganization.jsx";
import FounderExpense from "./FounderExpense.jsx";
import FounderDashboard from "./FounderDashboard.jsx";
import FounderLocked from "./FounderLocked.jsx";
import FounderStore from "./FounderStore.jsx";
import FounderFundraising from "./FounderFundraising.jsx";
import FounderPartners from "./FounderPartners.jsx";
import FounderAssets from "./FounderAssets.jsx";
import FounderSupport from "./FounderSupport.jsx";
import "../../styles/founder-portal.css";

// Founder nav — grafted onto the applicant `.eir-os-side` sidebar language so
// this reads as a native continuation of the /apply dashboard.
const NAV = [
  { group: "Application", items: [
    { sec: "application", num: "•", label: "Current", to: "/founder" },
  ]},
  { group: "Onboarding", items: [
    { sec: "mou", num: "01", label: "Sign MOU", to: "/founder/mou" },
  ]},
  { group: "Cohort management", locked: "cohort", items: [
    { sec: "approach", num: "01", label: "Approach", to: "/founder/approach" },
    { sec: "org", num: "02", label: "Organization", to: "/founder/org" },
    { sec: "expense", num: "03", label: "Expense management", to: "/founder/expense" },
  ]},
  { group: "Dashboard reporting", locked: "dashboard", items: [
    { sec: "dashboard", num: "•", label: "Process dashboard", to: "/founder/dashboard" },
  ]},
  { group: "Founders resources", items: [
    { sec: "store", num: "01", label: "Procurement store", to: "/founder/store" },
    { sec: "fundraising", num: "02", label: "Fundraising & connects", to: "/founder/fundraising" },
    { sec: "partners", num: "03", label: "Corporate partners", to: "/founder/partners" },
    { sec: "assets", num: "04", label: "Book ARTPARK assets", to: "/founder/assets" },
    { sec: "support", num: "05", label: "IT & Facilities support", to: "/founder/support" },
  ]},
];

// Same external cohort links the applicant dashboard shows, for continuity.
const COHORT_LINKS = [
  { href: "/programs.html", label: "Programs" },
  { href: "/marketing.html", label: "TIR overview" },
  { href: "/sip-marketing.html", label: "VIP overview" },
];

function FounderHeader({ user }) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const goHome = (e) => { e.preventDefault(); navigate("/apply"); };
  const signOut = async () => { await logout(); navigate("/apply/signin"); };
  return (
    <header className="eir-header">
      <div className="eir-header-left">
        <a href="/apply" onClick={goHome} className="eir-home-link eir-mono" title="Back to my application">
          <span className="eir-home-arrow">←</span>
          <span className="eir-home-label">home</span>
        </a>
        <span className="eir-header-sep" />
        <a href="/apply" onClick={goHome} className="eir-brand" title="ARTPARK × IISc">
          <img src="/assets/iisc-logo-blue.png" alt="Indian Institute of Science" className="eir-brand-iisc" />
          <img src="/assets/artpark-logo.png" alt="ARTPARK" className="eir-brand-artpark" />
        </a>
      </div>
      <div className="eir-header-right">
        <div className="eir-mono eir-dim eir-theme-tag">TIR.2026</div>
        {user && (
          <button className="eir-header-user eir-mono" onClick={() => navigate("/apply/profile")} title="Profile settings">
            <span className="eir-header-user-avatar">{(user.email?.[0] || "?").toUpperCase()}</span>
            <span className="eir-header-user-email">{user.email}</span>
            <span className="eir-header-user-cog">⚙</span>
          </button>
        )}
        <button className="eir-chip-btn eir-mono eir-header-logout" onClick={signOut} title="Sign out">
          sign out ↗
        </button>
      </div>
    </header>
  );
}

function FounderSidebar({ tab, locked, navigate }) {
  const isLocked = (group) => group.locked && locked[group.locked];
  return (
    <aside className="eir-os-side">
      {NAV.map((g) => (
        <nav className="eir-os-side-group" key={g.group}>
          <div className="eir-mono eir-os-side-title">{g.group}</div>
          {g.items.map((it) => {
            const lock = isLocked(g);
            return (
              <button
                type="button"
                key={it.sec}
                className={`eir-os-nav ${tab === it.sec ? "is-on" : ""}`}
                onClick={() => navigate(it.to)}
                style={lock ? { opacity: 0.5 } : undefined}
                aria-disabled={lock || undefined}
              >
                <span className="eir-mono eir-os-nav-num">{it.num}</span>
                <span className="eir-os-nav-label">{it.label}</span>
                {lock && <span className="eir-mono eir-os-nav-badge">🔒</span>}
              </button>
            );
          })}
        </nav>
      ))}

      <nav className="eir-os-side-group">
        <div className="eir-mono eir-os-side-title">Cohort</div>
        {COHORT_LINKS.map((l) => (
          <a className="eir-os-nav eir-os-nav-link" href={l.href} target="_blank" rel="noopener noreferrer" key={l.href}>
            <span className="eir-mono eir-os-nav-num">↗</span>
            <span className="eir-os-nav-label">{l.label}</span>
          </a>
        ))}
      </nav>

      <div className="eir-os-side-foot">
        <div className="eir-mono eir-dim">↳ data encrypted at rest</div>
        <div className="eir-mono eir-dim">↳ progress autosaves</div>
      </div>
    </aside>
  );
}

function Shell({ user, children }) {
  return (
    <div className="eir-root eir-theme-notebook">
      <div className="eir-bg" />
      <div className="eir-frame">
        <FounderHeader user={user} />
        <main className="eir-main">{children}</main>
      </div>
    </div>
  );
}

export default function FounderPortal({ tab = "application" }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    founderApi.me().then(setMe).catch(setError);
  }, []);
  useEffect(refresh, [refresh]);

  if (error) {
    if (error.status === 403) {
      return (
        <Shell user={user}>
          <div className="eir-screen eir-os-shell">
            <div className="eir-os-body">
              <main className="eir-os-pane">
                <header className="eir-os-view-head">
                  <div className="eir-mono eir-dim eir-os-crumb">Founder Portal</div>
                  <h1 className="eir-os-view-title">Not yet unlocked</h1>
                  <p className="eir-os-view-sub">
                    This area unlocks once your TIR application is selected.{" "}
                    <a href="/apply">Back to your application →</a>
                  </p>
                </header>
              </main>
            </div>
          </div>
        </Shell>
      );
    }
    return <Shell user={user}><div className="founder-portal"><ErrorState error={error} /></div></Shell>;
  }
  if (!me) return <Shell user={user}><div className="founder-portal"><Loading label="Loading your portal…" /></div></Shell>;

  const locked = me.locked || { cohort: true, dashboard: true };

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
      case "store": return <FounderStore />;
      case "fundraising": return <FounderFundraising />;
      case "partners": return <FounderPartners />;
      case "assets": return <FounderAssets />;
      case "support": return <FounderSupport />;
      default: return <FounderApplication me={me} />;
    }
  };

  return (
    <Shell user={user}>
      <div className="eir-screen eir-os-shell">
        <div className="eir-os-body">
          <FounderSidebar tab={tab} locked={locked} navigate={navigate} />
          <main className="eir-os-pane">
            <div className="founder-portal founder-content">{renderTab()}</div>
          </main>
        </div>
      </div>
    </Shell>
  );
}
