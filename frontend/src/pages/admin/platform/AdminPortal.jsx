// Admin Platform Portal — ported shell from the prototype admin-2.jsx.
//
// Contains AdminTopbar, AdminCohortHeader, AdminTabBar, and AdminApp, copied
// verbatim from the prototype with minimal production adaptations:
//   - useAS2 alias resolved to React.useState
//   - window.OS_DATA accesses guarded with optional-chaining (?.)
//   - All screen components replaced with <ScreenStub> (real screens land in
//     Tasks 8-13)
//   - ReactDOM.createRoot(...) render call removed (router mounts AdminApp)
//   - Root element wrapped in <div className="adm-portal"> for CSS scoping
//
// The portal stylesheet (admin-portal.css) is scoped under .adm-portal so the
// prototype CSS does not leak into other surfaces.

import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../hooks/useAuth.jsx";
import "../../../styles/admin-portal.css";
import { ScreenStub } from "./screens/ScreenStub";
import { AdminDashboard } from "./screens/AdminDashboard";
import { AdminPipeline } from "./screens/AdminPipeline";
import { AdminDetail } from "./screens/AdminDetail";

function initialsFor(email) {
  const local = (email || '').split('@')[0] || '';
  return local.slice(0, 2).toUpperCase() || '??';
}

function AdminTopbar({ page, decisionMode, setPage }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const userEmail = user?.email || '';
  const userInitials = initialsFor(userEmail);

  const crumbMap = {
    dashboard:'DASHBOARD', pipeline:'APPLICATIONS', detail:'APPLICATION DETAIL',
    reviewers: decisionMode === 'jury' ? 'JURY PANEL' : 'REVIEWERS',
    roles:'USER ROLES',
    gate1: decisionMode === 'jury' ? 'FINAL GATE' : 'ADMIN REVIEW',
    psychometry:'PSYCHOMETRY',
    jury:'JURY MGMT', gate2:'GATE 2 FINAL', audit:'AUDIT LOG', analytics:'ANALYTICS',
  };
  const crumb = crumbMap[page] || 'DASHBOARD';
  const [menuOpen, setMenuOpen] = React.useState(false);

  React.useEffect(() => {
    if (!menuOpen) return;
    const handleClose = () => setMenuOpen(false);
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, [menuOpen]);

  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [, forceTick] = React.useReducer(x => x + 1, 0);
  const allStartups = (window.OS_DATA && window.OS_DATA.STARTUPS) || [];
  const isStatus = (s, set) => { const c = (s.chip || '').toUpperCase(); const d = (s.adminDecision || '').toUpperCase(); return set.includes(c) || set.includes(d); };
  const archivedApps = allStartups.filter(s => s.archived);
  const hiddenApps = allStartups.filter(s => s.hidden && !s.archived);
  const heldApps = allStartups.filter(s => !s.archived && isStatus(s, ['HOLD', 'WAITLISTED']));
  const rejectedApps = allStartups.filter(s => !s.archived && isStatus(s, ['REJECTED']));
  // Persist + re-render the modal AND the whole admin app (so the list/dashboard update live).
  const afterMutate = () => {
    if (window.persistOSData) window.persistOSData();
    forceTick();
    if (window.__osDataBump) window.__osDataBump();
  };
  const restoreFlag = (id, flag) => { const s = allStartups.find(x => x.id === id); if (s) { s[flag] = false; afterMutate(); } };
  const restoreStatus = (id) => { const s = allStartups.find(x => x.id === id); if (s) { s.chip = 'EVALUATED'; s.adminDecision = null; afterMutate(); } };

  return (
    <div className="lp-topbar">
      <button className="lp-home-btn" onClick={() => { setPage('dashboard'); }}>← HOME</button>
      <div className="lp-brand">
        <img className="lp-brand-combined" src="assets/artpark-iisc-combined.webp" alt="ARTPARK · AI & Robotics Technology Park @ IISc" />
      </div>
      <div className="lp-topbar-crumb">
        <div className="lp-topbar-pill">
          <span className="lp-live-dot" style={{background:'#3213b7'}}/>
          <span>ADMIN · {crumb}</span>
        </div>
      </div>
      <div className="lp-topbar-right">
        <button
          onClick={() => setSettingsOpen(true)}
          title="Settings"
          aria-label="Settings"
          style={{
            width: 38, height: 38, flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--line)', borderRadius: 2,
            background: 'var(--bg-paper)', color: 'var(--ink-soft)', cursor: 'pointer',
            transition: 'background 120ms, border-color 120ms, color 120ms'
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-soft)'; e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.borderColor = 'var(--line-strong)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-paper)'; e.currentTarget.style.color = 'var(--ink-soft)'; e.currentTarget.style.borderColor = 'var(--line)'; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
        <div
          className="lp-topbar-user"
          style={{
            position: 'relative',
            border: '1px solid var(--line)',
            borderRadius: '20px',
            padding: '4px 12px 4px 6px',
            background: 'var(--bg-soft)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            userSelect: 'none'
          }}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
        >
          <div className="os-avatar" style={{width:24,height:24,fontSize:10,flexShrink:0,background:'#3213b7',color:'#fff'}}>{userInitials}</div>
          <span style={{fontSize: 13, fontWeight: 500}}>{userEmail}</span>
          <span className="caret">▾</span>

          {menuOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                background: 'var(--bg-paper)',
                border: '1px solid var(--line-strong)',
                borderRadius: '2px',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                padding: '6px',
                zIndex: 9999,
                minWidth: '220px',
                display: 'flex',
                flexDirection: 'column',
                gap: 2
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{padding: '8px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)', textTransform: 'uppercase', borderBottom: '1px solid var(--line)', marginBottom: 4}}>
                Switch Panel
              </div>
              <div
                style={{
                  padding: '9px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--artblue)',
                  background: 'var(--bg-soft)',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--artblue)', flexShrink: 0 }} />
                <span>Admin Panel</span>
                <span style={{ color: 'var(--artblue)', marginLeft: 'auto', fontWeight: 700 }}>✓</span>
              </div>
              <a
                href="../Reviewer-Portal/reviewer-portal.html"
                style={{
                  padding: '8px 12px',
                  fontSize: 13,
                  color: 'var(--ink-soft)',
                  borderRadius: '2px',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer'
                }}
                className="dropdown-hover-item"
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-soft)';
                  e.currentTarget.style.color = 'var(--ink)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--ink-soft)';
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--line-strong)', flexShrink: 0 }} />
                <span>Reviewer Panel</span>
              </a>
            </div>
          )}
        </div>
        <button className="lp-signout" onClick={async () => { if (window.confirm('Sign out of the Admin portal?')) { await logout(); navigate('/apply/signin'); } }}>SIGN OUT ↗</button>
      </div>

      {settingsOpen && (
        <div className="os-modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="os-modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <div className="os-modal-head">
              <div>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>Settings</div>
                <div className="os-text-sm os-text-dim" style={{ marginTop: 2 }}>Restore archived or hidden applications</div>
              </div>
              <button className="os-btn ghost sm" onClick={() => setSettingsOpen(false)}>Close</button>
            </div>
            <div className="os-modal-body os-stack" style={{ gap: 24 }}>
              <div>
                <div className="os-card-title os-mb-sm">Archived applications ({archivedApps.length})</div>
                {archivedApps.length === 0 ? (
                  <div className="os-text-dim os-text-sm">No archived applications.</div>
                ) : (
                  <div className="os-stack gap-sm">
                    {archivedApps.map(s => (
                      <div key={s.id} className="os-row between" style={{ border: '1px solid var(--line)', borderRadius: 2, padding: '10px 14px' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.name}</div>
                          <div className="os-text-xs os-text-dim">{s.domain} · {s.id.toUpperCase()}</div>
                        </div>
                        <button className="os-btn sm secondary" onClick={() => restoreFlag(s.id, 'archived')}>Unarchive</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="os-card-title os-mb-sm">Hidden applications ({hiddenApps.length})</div>
                {hiddenApps.length === 0 ? (
                  <div className="os-text-dim os-text-sm">No hidden applications.</div>
                ) : (
                  <div className="os-stack gap-sm">
                    {hiddenApps.map(s => (
                      <div key={s.id} className="os-row between" style={{ border: '1px solid var(--line)', borderRadius: 2, padding: '10px 14px' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.name}</div>
                          <div className="os-text-xs os-text-dim">{s.domain} · {s.id.toUpperCase()}</div>
                        </div>
                        <button className="os-btn sm secondary" onClick={() => restoreFlag(s.id, 'hidden')}>Unhide</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="os-card-title os-mb-sm">On hold / waitlisted ({heldApps.length})</div>
                {heldApps.length === 0 ? (
                  <div className="os-text-dim os-text-sm">No applications on hold.</div>
                ) : (
                  <div className="os-stack gap-sm">
                    {heldApps.map(s => (
                      <div key={s.id} className="os-row between" style={{ border: '1px solid var(--line)', borderRadius: 2, padding: '10px 14px' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.name}</div>
                          <div className="os-text-xs os-text-dim">{s.domain} · {s.id.toUpperCase()}</div>
                        </div>
                        <button className="os-btn sm secondary" onClick={() => restoreStatus(s.id)}>Release hold</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="os-card-title os-mb-sm">Rejected ({rejectedApps.length})</div>
                {rejectedApps.length === 0 ? (
                  <div className="os-text-dim os-text-sm">No rejected applications.</div>
                ) : (
                  <div className="os-stack gap-sm">
                    {rejectedApps.map(s => (
                      <div key={s.id} className="os-row between" style={{ border: '1px solid var(--line)', borderRadius: 2, padding: '10px 14px' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.name}</div>
                          <div className="os-text-xs os-text-dim">{s.domain} · {s.id.toUpperCase()}</div>
                        </div>
                        <button className="os-btn sm secondary" onClick={() => restoreStatus(s.id)}>Restore</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminCohortHeader({ page, setPage, decisionMode, setDecisionMode }) {
  return (
    <div className="lp-page-header">
      <div className="lp-breadcrumb" style={{marginBottom:8}}>ARTPARK / OS · Admin Portal</div>
      <div className="lp-header-row">
        <div>
          <h1 className="lp-cohort-title">TIR + VIP cohort <span className="lp-year">2026</span></h1>
          <div className="lp-cohort-sub">
            Admin control panel · live state across all 7 layers · last updated 2m ago
          </div>
        </div>
        <div style={{marginTop:4,display:'flex',gap:12,alignItems:'center'}}>
          <div className="lp-toggle-control">
            <button
              className={`lp-toggle-btn ${decisionMode === 'reviewer' ? 'active' : ''}`}
              onClick={() => setDecisionMode('reviewer')}
            >
              Reviewer Decision
            </button>
            <button
              className={`lp-toggle-btn ${decisionMode === 'jury' ? 'active' : ''}`}
              onClick={() => setDecisionMode('jury')}
            >
              Jury Decision
            </button>
          </div>
          <button
            className={`os-btn ${page === 'roles' ? '' : 'ghost'}`}
            onClick={() => setPage(page === 'roles' ? 'dashboard' : 'roles')}
          >
            {page === 'roles' ? '← Back to Dashboard' : 'User Roles'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminTabBar({ page, setPage, decisionMode }) {
  const getAppCount = () => {
    if (!window.OS_DATA || !window.OS_DATA.STARTUPS) return 0;
    if (decisionMode === 'jury') {
      return window.OS_DATA.STARTUPS.filter(s => {
        const c = (s.chip || '').toUpperCase();
        return c === 'SHORTLISTED' || c === 'JURY REVIEW' || c === 'ACCEPTED' || c === 'REJECTED' || c === 'WAITLISTED';
      }).length;
    }
    return window.OS_DATA.STARTUPS.filter(s => !s.archived).length;
  };

  const tabs = [
    { id:'dashboard',    label:'Dashboard',    sub:'OVERVIEW · PIPELINE',       badge:null },
    {
      id:'reviewers',
      label: decisionMode === 'jury' ? 'Jury' : 'Reviewers',
      sub: decisionMode === 'jury' ? 'PANEL · ASSIGNMENTS' : 'ROSTER · PROGRESS',
      badge:null
    },
    { id:'pipeline',     label:'Applications', sub:'ALL SUBMISSIONS',            badge: String(getAppCount()) },
    {
      id:'gate1',
      label: decisionMode === 'jury' ? 'Final Gate' : 'Admin Review',
      sub: decisionMode === 'jury' ? 'CONSOLIDATED DECISIONS' : 'PENDING DECISIONS',
      badge: decisionMode === 'jury' ? null : '12'
    },
  ];

  return (
    <div className="lp-tabs">
      {tabs.map(t => (
        <div key={t.id} className={`lp-tab${page === t.id ? ' active' : ''}`} onClick={() => setPage(t.id)}>
          <div className="lp-tab-label">
            {t.label}
            {t.badge && <span className="lp-tab-badge">{t.badge}</span>}
          </div>
          <div className="lp-tab-sub">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

function AdminApp() {
  const [page, setPage] = React.useState('dashboard');
  const [selectedStartupId, setSelectedStartupId] = React.useState(null);
  const [selectedTrack, setSelectedTrack] = React.useState(null);
  const [backPage, setBackPage] = React.useState('pipeline');
  const [decisionMode, setDecisionMode] = React.useState('reviewer');

  // Global re-render hook: any component (e.g. the Settings panel) can call
  // window.__osDataBump() after mutating OS_DATA to refresh the whole admin tree live.
  const [, forceAppUpdate] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => { window.__osDataBump = forceAppUpdate; return () => { if (window.__osDataBump === forceAppUpdate) window.__osDataBump = null; }; }, []);

  const startups = window.OS_DATA?.STARTUPS || [];
  const currentIdx = startups.findIndex(s => s.id === selectedStartupId);

  // Auto-promote startups to 'JURY REVIEW' (Interview) if jury requested interview, unless already decided
  React.useEffect(() => {
    if (window.OS_DATA?.STARTUPS) {
      let changed = false;
      window.OS_DATA.STARTUPS.forEach(s => {
        if (s.jury) {
          const reco = (s.jury.reco || '').toLowerCase();
          if ((reco === 'interview' || reco === 'maybe' || reco === 'yes') &&
              (!s.chip || s.chip === 'SHORTLISTED' || s.chip === 'NEW' || s.chip === 'EVALUATED')) {
            s.chip = 'JURY REVIEW';
            changed = true;
          }
        }
      });
      if (changed && window.persistOSData) {
        window.persistOSData();
      }
    }
  }, []);

  const goDetail = (id, track, fromPage = 'pipeline') => {
    setSelectedStartupId(id);
    setSelectedTrack(track || null);
    setBackPage(fromPage);
    setPage('detail');
  };

  const onPrev = () => {
    if (currentIdx > 0) {
      setSelectedStartupId(startups[currentIdx - 1].id);
    }
  };

  const onNext = () => {
    if (currentIdx < startups.length - 1) {
      setSelectedStartupId(startups[currentIdx + 1].id);
    }
  };

  const isDetail = page === 'detail';

  return (
    <div className="adm-portal">
      <div className="os-shell">
        <AdminTopbar page={page} decisionMode={decisionMode} setPage={setPage} />
        <div className="lp-layout">
          {!isDetail && (
            <AdminCohortHeader
              page={page}
              setPage={setPage}
              decisionMode={decisionMode}
              setDecisionMode={setDecisionMode}
            />
          )}
          {!isDetail && page !== 'roles' && (
            <AdminTabBar
              page={page}
              setPage={setPage}
              decisionMode={decisionMode}
            />
          )}
          <div className="lp-tab-content">
            {page === 'dashboard'   && <AdminDashboard go={setPage} decisionMode={decisionMode} />}
            {page === 'pipeline'    && <AdminPipeline goDetail={goDetail} decisionMode={decisionMode} />}
            {page === 'detail'      && (
              <AdminDetail
                startupId={selectedStartupId}
                track={selectedTrack}
                onBack={() => setPage(backPage)}
                onPrev={currentIdx > 0 ? onPrev : null}
                onNext={currentIdx < startups.length - 1 ? onNext : null}
                decisionMode={decisionMode}
              />
            )}
            {page === 'reviewers'   && <ScreenStub name="Reviewers" />}
            {page === 'roles'       && <ScreenStub name="User Roles" />}
            {page === 'gate1'       && (decisionMode === 'jury' ? <ScreenStub name="Gate 2 Final" /> : <ScreenStub name="Admin Review" />)}
            {page === 'psychometry' && <ScreenStub name="Psychometry" />}
            {page === 'jury'        && <ScreenStub name="Jury Mgmt" />}
            {page === 'gate2'       && <ScreenStub name="Gate 2 Final" />}
            {page === 'audit'       && <ScreenStub name="Audit Log" />}
            {page === 'analytics'   && <ScreenStub name="Analytics" />}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminApp;
