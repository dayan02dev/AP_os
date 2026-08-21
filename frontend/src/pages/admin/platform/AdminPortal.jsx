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
import { useAdminData } from "../../../hooks/useAdminData";
import { pipelineBadges } from "../../../lib/adminBadges";
import "../../../styles/admin-portal.css";
import { AdminDashboard } from "./screens/AdminDashboard";
import { AdminPipeline } from "./screens/AdminPipeline";
import { AdminDetail } from "./screens/AdminDetail";
import AdminGate1 from "./screens/AdminGate1";
import { AdminReviewers } from "./screens/AdminReviewers";
import { AdminGate2 } from "./screens/AdminGate2";
import { AdminSelectedApplications } from "./screens/AdminSelectedApplications";
import { AdminPsychometry } from "./screens/AdminPsychometry";
import { AdminAIStatus } from "./screens/AdminAIStatus";
import { AdminRoles } from "./screens/AdminRoles";
import PortalSwitcher from "../../../components/PortalSwitcher.jsx";
import ChangePasswordForm from "../../../components/ChangePasswordForm.jsx";

function initialsFor(email) {
  const local = (email || '').split('@')[0] || '';
  return local.slice(0, 2).toUpperCase() || '??';
}

function AdminTopbar({ page, setPage }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const userEmail = user?.email || '';
  const userInitials = initialsFor(userEmail);

  const crumbMap = {
    dashboard:'DASHBOARD', pipeline:'APPLICATIONS', detail:'APPLICATION DETAIL',
    reviewers:'REVIEWERS',
    roles:'USER ROLES',
    gate1:'ADMIN REVIEW',
    psychometry:'PSYCHOMETRY',
    rejected:'REJECTED',
    jury_selected:'ACCEPTED',
    gate2:'FINAL GATE', audit:'AUDIT LOG', analytics:'ANALYTICS',
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
      <div className="lp-brand">
        <img className="lp-brand-combined" src="/assets/artpark-iisc-logo.webp" alt="ARTPARK · AI & Robotics Technology Park @ IISc" />
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
            border: '1px solid var(--line)',
            borderRadius: '20px',
            padding: '4px 12px 4px 6px',
            background: 'var(--bg-soft)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            userSelect: 'none'
          }}
        >
          <div className="os-avatar" style={{width:24,height:24,fontSize:10,flexShrink:0,background:'#3213b7',color:'#fff'}}>{userInitials}</div>
          <span style={{fontSize: 13, fontWeight: 500}}>{userEmail}</span>
        </div>
        <PortalSwitcher current="admin" />
        <button className="lp-signout" onClick={async () => { if (window.confirm('Sign out of the Admin portal?')) { await logout(); navigate('/apply/signin'); } }}>SIGN OUT ↗</button>
      </div>

      {settingsOpen && (
        <div className="os-modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="os-modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <div className="os-modal-head">
              <div>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>Settings</div>
                <div className="os-text-sm os-text-dim" style={{ marginTop: 2 }}>Your password, and archived or hidden applications</div>
              </div>
              <button className="os-btn ghost sm" onClick={() => setSettingsOpen(false)}>Close</button>
            </div>
            <div className="os-modal-body os-stack" style={{ gap: 24 }}>
              <div>
                <div className="os-card-title os-mb-sm">Change password</div>
                <ChangePasswordForm compact />
              </div>
              <hr className="os-divider" />
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

function AdminCohortHeader({ page, setPage }) {
  return (
    <div className="lp-page-header">
      <div className="lp-breadcrumb" style={{marginBottom:8}}>ARTPARK / OS · Admin Portal</div>
      <div className="lp-header-row">
        <div>
          <h1 className="lp-cohort-title">TIR + VIP cohort <span className="lp-year">2026</span></h1>
        </div>
        <div style={{marginTop:4,display:'flex',gap:12,alignItems:'center'}}>
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

export function AdminTabBar({ page, setPage, appsBadge, rejectedBadge, reviewBadge,
  jurySelectedBadge }) {
  // Badges come from real /stats data (passed down from AdminApp). A null
  // badge renders as no badge at all — we never show a fabricated number.
  const tabs = [
    { id:'dashboard',     label:'Dashboard',    sub:'OVERVIEW · PIPELINE',      badge:null },
    { id:'reviewers',     label:'Reviewers',    sub:'ROSTER · PROGRESS',        badge:null },
    { id:'pipeline',      label:'Applications', sub:'ALL SUBMISSIONS',
      badge: appsBadge == null ? null : String(appsBadge) },
    { id:'rejected',      label:'Rejected',     sub:'TIR + VIP',
      badge: rejectedBadge == null ? null : String(rejectedBadge) },
    // One tab for both tracks — the work at this stage (attach the IC memo,
    // approve it) is identical either way, and each row carries a TRACK chip.
    { id:'jury_selected', label:'Accepted',     sub:'TIR + VIP',
      badge: jurySelectedBadge == null ? null : String(jurySelectedBadge) },
    { id:'gate1',         label:'Admin Review', sub:'PENDING DECISIONS',
      badge: reviewBadge == null ? null : String(reviewBadge) },
    // gate2 has its own id (it used to share `gate1`, switched by decision
    // mode). Without a distinct id the Final Gate is unreachable.
    { id:'gate2',         label:'Final Gate',   sub:'CONSOLIDATED DECISIONS',   badge:null },
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

  // Legacy page ids from when the jury stage had a tab per track, and from
  // when the Academic Jury Roster had a tab. Anything bookmarked at one of
  // those lands somewhere real instead of a blank pane.
  React.useEffect(() => {
    if (page === 'jury_tir' || page === 'jury_vip') setPage('jury_selected');
    if (page === 'iisc_roster') setPage('dashboard');
  }, [page]);

  // Global re-render hook: any component (e.g. the Settings panel) can call
  // window.__osDataBump() after mutating OS_DATA to refresh the whole admin tree live.
  const [, forceAppUpdate] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => { window.__osDataBump = forceAppUpdate; return () => { if (window.__osDataBump === forceAppUpdate) window.__osDataBump = null; }; }, []);

  // Real tab-badge counts from /stats. While loading (or if the field is
  // absent) we pass null so NO badge shows rather than a fabricated number.
  const { data: statsData, loading: statsLoading } = useAdminData('stats');
  const { appsBadge, rejectedBadge, juryBadge } =
    pipelineBadges(statsData, statsLoading);
  // "Admin Review" = apps evaluated by reviewers and awaiting an admin decision.
  const evaluatedEntry = (statsData?.statusCounts || []).find(s => s.id === 'evaluated');
  const reviewBadge = statsLoading ? null : (evaluatedEntry ? evaluatedEntry.n : null);

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
        <AdminTopbar page={page} setPage={setPage} />
        <div className="lp-layout">
          {!isDetail && (
            <AdminCohortHeader
              page={page}
              setPage={setPage}
            />
          )}
          {!isDetail && page !== 'roles' && (
            <AdminTabBar
              page={page}
              setPage={setPage}
              appsBadge={appsBadge}
              rejectedBadge={rejectedBadge}
              reviewBadge={reviewBadge}
              jurySelectedBadge={juryBadge}
            />
          )}
          <div className="lp-tab-content">
            {page === 'dashboard'   && <AdminDashboard go={setPage} />}
            {page === 'pipeline'    && <AdminPipeline goDetail={goDetail} baseFilter={{ exclude_status: 'rejected,jury_review' }} scopeKey="applications" />}
            {page === 'rejected'    && <AdminPipeline goDetail={goDetail} baseFilter={{ status: 'rejected' }} readOnly heading="Rejected applications" scopeKey="rejected" />}
            {/* Both tracks, one list. Each row carries a TRACK chip and the
                memo upload / approve actions. */}
            {page === 'jury_selected' && <AdminSelectedApplications goDetail={goDetail} />}
            {page === 'detail'      && (
              <AdminDetail
                startupId={selectedStartupId}
                track={selectedTrack}
                onBack={() => setPage(backPage)}
                onPrev={currentIdx > 0 ? onPrev : null}
                onNext={currentIdx < startups.length - 1 ? onNext : null}
              />
            )}
            {page === 'reviewers'   && <AdminReviewers />}
            {page === 'roles'       && <AdminRoles />}
            {page === 'gate1'       && <AdminGate1 goDetail={goDetail} />}
            {page === 'gate2'       && <AdminGate2 />}
            {page === 'psychometry' && <AdminPsychometry />}
            {page === 'aistatus'   && <AdminAIStatus />}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminApp;
