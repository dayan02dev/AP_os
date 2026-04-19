// Main app with phase machine: welcome → auth → upload → parsing → review → sections → done

import { useState as useS, useEffect as useE, useRef as useR } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { THEMES } from "./themes.jsx";
import { SECTIONS, flattenQuestions } from "./questions.jsx";
import { QuestionInput, isAnswered, whyBlocked } from "./inputs.jsx";
import {
  AuthScreen, ReturningChoiceScreen, UploadScreen, ParsingScreen, ParsedReviewScreen,
  simulateParse,
} from "./auth_upload.jsx";
import {
  ProgressBar, WelcomeScreen, SectionIntroScreen, CelebrationScreen, DoneScreen,
} from "./screens.jsx";
import { ProfileScreen } from "./profile.jsx";
import { TweaksPanel } from "./tweaks.jsx";
import { SupportButton } from "./support.jsx";
import {
  useSessionLock, TakeoverPrompt, KickedScreen, SessionLockBanner,
} from "./session_lock.jsx";

const PHASES = {
  WELCOME: "welcome",
  AUTH: "auth",
  RETURNING: "returning",
  UPLOAD: "upload",
  PARSING: "parsing",
  REVIEW: "review",
  SECTION_INTRO: "section_intro",
  QUESTION: "question",
  CELEBRATE: "celebrate",
  DONE: "done",
  PROFILE: "profile",
};

const SECTION_SLUGS = SECTIONS.map((s) => s.id);
const KNOWN_APPLY_PATHS = new Set([
  "", "signin", "verify", "profile", "review", "submitted", "support", ...SECTION_SLUGS,
]);
const PROTECTED_PATHS = new Set(["profile", "review", "submitted", ...SECTION_SLUGS]);

function pickPathFromLocation(pathname) {
  const m = pathname.replace(/\/+$/, "").match(/^\/apply(?:\/([^/]*))?$/);
  return m ? (m[1] || "") : null;
}

function urlForPhase(phase, sectionIdx) {
  if (phase === PHASES.AUTH) return "/apply/signin";
  if (phase === PHASES.PROFILE) return "/apply/profile";
  if (phase === PHASES.REVIEW) return "/apply/review";
  if (phase === PHASES.DONE) return "/apply/submitted";
  if (phase === PHASES.SECTION_INTRO || phase === PHASES.QUESTION || phase === PHASES.CELEBRATE) {
    return "/apply/" + (SECTION_SLUGS[sectionIdx] || SECTION_SLUGS[0]);
  }
  return "/apply";
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const urlSyncRef = useR({ applying: false });

  const [config, setConfig] = useS(() => window.__eirDefaults);
  const [tweaksOpen, setTweaksOpen] = useS(false);

  const [phase, setPhase] = useS(() => localStorage.getItem("tir:phase") || PHASES.WELCOME);
  const [user, setUser] = useS(() => { try { return JSON.parse(localStorage.getItem("tir:user") || "null"); } catch { return null; } });
  const [uploaded, setUploaded] = useS(() => { try { return JSON.parse(localStorage.getItem("tir:uploaded") || "null"); } catch { return null; } });
  const [parsed, setParsed] = useS(() => { try { return JSON.parse(localStorage.getItem("tir:parsed") || "null"); } catch { return null; } });
  const [answers, setAnswers] = useS(() => { try { return JSON.parse(localStorage.getItem("tir:answers") || "{}"); } catch { return {}; } });
  const [stepIdx, setStepIdx] = useS(() => parseInt(localStorage.getItem("tir:stepIdx") || "0", 10));
  const [sectionIdx, setSectionIdx] = useS(() => parseInt(localStorage.getItem("tir:sectionIdx") || "0", 10));
  const [viewingSubmission, setViewingSubmission] = useS(null);

  // Persist
  useE(() => { localStorage.setItem("tir:phase", phase); }, [phase]);
  useE(() => { if (user) localStorage.setItem("tir:user", JSON.stringify(user)); }, [user]);
  useE(() => { if (uploaded) localStorage.setItem("tir:uploaded", JSON.stringify(uploaded)); }, [uploaded]);
  useE(() => { if (parsed) localStorage.setItem("tir:parsed", JSON.stringify(parsed)); }, [parsed]);
  useE(() => { localStorage.setItem("tir:answers", JSON.stringify(answers)); }, [answers]);
  useE(() => { localStorage.setItem("tir:stepIdx", String(stepIdx)); }, [stepIdx]);
  useE(() => { localStorage.setItem("tir:sectionIdx", String(sectionIdx)); }, [sectionIdx]);

  // Save submission record when reaching DONE
  useE(() => {
    if (phase !== PHASES.DONE || !user?.email) return;
    try {
      const key = `tir:submissions:${user.email}`;
      const existing = JSON.parse(localStorage.getItem(key) || "[]");
      const already = existing.some(s => s.answers && JSON.stringify(s.answers) === JSON.stringify(answers));
      if (already) return;
      const rec = {
        id: "TIR-" + Math.floor(Math.random() * 90000 + 10000),
        cycle: "TIR cohort 2026",
        projectTitle: answers?.problemStatement?.slice(0, 80) || "Your TIR.2026 application",
        ts: Date.now(),
        lastUpdate: Date.now(),
        currentMilestone: "submitted",
        outcome: null,
        feedback: null,
        answers,
      };
      existing.unshift(rec);
      localStorage.setItem(key, JSON.stringify(existing.slice(0, 10)));
    } catch {}
  }, [phase]);

  // Auto-seed demo data for test accounts — runs once per page load
  useE(() => {
    const SEED_EMAILS = ["ndedhia18@gmail.com", "test@artpark.in"];
    const SEED_FLAG = "tir:seededV3";
    if (localStorage.getItem(SEED_FLAG)) return;

    SEED_EMAILS.forEach((email) => {
      const key = `tir:submissions:${email}`;
      if (localStorage.getItem(key)) return;

      const firstName = email.split("@")[0].replace(/[0-9]/g, "").split(/[._-]/)[0];
      const displayName = firstName.charAt(0).toUpperCase() + firstName.slice(1);

      const submissions = [
        {
          id: "TIR-" + Math.floor(40000 + Math.random() * 9000),
          cycle: "TIR cohort 2026",
          projectTitle: "Solar micro cold-storage for smallholder farms",
          ts: Date.now() - 1000 * 60 * 60 * 24 * 12,
          lastUpdate: Date.now() - 1000 * 60 * 60 * 24 * 3,
          currentMilestone: "under_review",
          outcome: null,
          feedback: null,
          answers: {
            fullName: displayName + " Dedhia",
            email: email,
            phone: "+91 98765 43210",
            org: "Independent",
            degree: "Master's Degree",
            hasTeam: "No — going solo for now",
            problemDefined: "Yes — I can state it in one sentence",
            problemStatement: "Smallholder farmers across India lose 20-30% of post-harvest yield to poor cold-chain access, and existing solutions cost 10x what a marginal farm can absorb.",
            solutionSummary: "A decentralized, solar-powered micro cold-storage unit sized for a village cooperative (2-5 tonnes) that pays for itself in one harvest cycle through pooled economics.",
            stage: "Prototype in the field",
          },
        },
        {
          id: "TIR-" + Math.floor(30000 + Math.random() * 9000),
          cycle: "TIR cohort 2025",
          projectTitle: "Edge-AI diagnostic for rural primary-care clinics",
          ts: Date.now() - 1000 * 60 * 60 * 24 * 185,
          lastUpdate: Date.now() - 1000 * 60 * 60 * 24 * 120,
          currentMilestone: "decision",
          lastReached: "interview",
          outcome: "not_shortlisted",
          feedback: "Strong technical fundamentals and a promising hardware angle. The reviewing panel felt the market pull wasn't clearly demonstrated — we'd encourage you to talk to 10 more prospective users and re-apply with concrete pilot commitments. We remember your name; keep us posted.",
          answers: {
            fullName: displayName + " Dedhia",
            email: email,
            phone: "+91 98765 43210",
            org: "Independent",
            degree: "Master's Degree",
            problemStatement: "Rural primary-care clinics in Tier-3 towns lack on-site diagnostics — 40% of referrals end up being avoidable.",
            stage: "Prototype in the field",
          },
        },
        {
          id: "TIR-" + Math.floor(20000 + Math.random() * 9000),
          cycle: "TIR cohort 2024",
          projectTitle: "Crop-insurance underwriting via satellite imagery",
          ts: Date.now() - 1000 * 60 * 60 * 24 * 485,
          lastUpdate: Date.now() - 1000 * 60 * 60 * 24 * 460,
          currentMilestone: "submitted",
          lastReached: "submitted",
          outcome: "withdrawn",
          feedback: "Applicant withdrew during the review stage citing personal commitments. File kept open; application was otherwise progressing well — re-encouraged to reapply.",
          answers: {
            fullName: displayName + " Dedhia",
            email: email,
            phone: "+91 98765 43210",
            org: "IIT Bombay",
            degree: "Master's Degree",
            hasTeam: "Yes — I have co-founders",
            stage: "Idea stage",
          },
        },
      ];

      localStorage.setItem(key, JSON.stringify(submissions));

      try {
        const users = JSON.parse(localStorage.getItem("tir:users") || "{}");
        if (!users[email]) {
          users[email] = { email, created: Date.now() - 1000 * 60 * 60 * 24 * 500 };
          localStorage.setItem("tir:users", JSON.stringify(users));
        }
      } catch {}
    });

    localStorage.setItem(SEED_FLAG, "1");
  }, []);

  // Theme
  useE(() => {
    const theme = THEMES[config.theme] || THEMES.notebook;
    const root = document.documentElement;
    Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    const accents = { default: null, rust: "#c84a1a", olive: "#5a6b2a", ink: "#0a0a0a", plum: "#6a1a4a", forest: "#2a5a3a" };
    if (config.accent && config.accent !== "default" && accents[config.accent]) {
      root.style.setProperty("--accent", accents[config.accent]);
    }
    const bg = config.bg === "auto" ? theme.bg : config.bg;
    root.setAttribute("data-bg", bg || "none");
    root.setAttribute("data-theme", config.theme);
    root.setAttribute("data-typography", config.typography);
    root.setAttribute("data-tone", config.tone);
  }, [config]);

  // Tweaks message protocol
  useE(() => {
    const handler = (e) => {
      if (e.data?.type === "__activate_edit_mode") setTweaksOpen(true);
      if (e.data?.type === "__deactivate_edit_mode") setTweaksOpen(false);
    };
    window.addEventListener("message", handler);
    window.parent?.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", handler);
  }, []);

  // Protected-path redirect: unauthed users hitting /apply/profile, /apply/<section>,
  // /apply/review, /apply/submitted get bounced to signin with ?next= preserved.
  useE(() => {
    const slug = pickPathFromLocation(location.pathname);
    if (slug == null) return;
    if (PROTECTED_PATHS.has(slug) && !user) {
      const next = location.pathname + (location.search || "");
      navigate(`/apply/signin?next=${encodeURIComponent(next)}`, { replace: true });
    }
  }, [location.pathname, user]);

  // URL → phase sync (runs on mount and whenever the URL changes, e.g. browser back).
  useE(() => {
    const slug = pickPathFromLocation(location.pathname);
    if (slug == null) return;
    urlSyncRef.current.applying = true;
    if (slug === "signin") { if (phase !== PHASES.AUTH) setPhase(PHASES.AUTH); return; }
    if (slug === "verify") { /* Phase 3 stub — no phase mapping yet */ return; }
    if (slug === "profile") { if (user && phase !== PHASES.PROFILE) setPhase(PHASES.PROFILE); return; }
    if (slug === "review")  { if (user && phase !== PHASES.REVIEW)  setPhase(PHASES.REVIEW);  return; }
    if (slug === "submitted") { if (user && phase !== PHASES.DONE) setPhase(PHASES.DONE); return; }
    if (slug === "support") { /* support is a modal, no phase change */ return; }
    if (SECTION_SLUGS.includes(slug)) {
      if (!user) return; // protected effect already redirecting
      const idx = SECTION_SLUGS.indexOf(slug);
      if (idx !== sectionIdx) setSectionIdx(idx);
      if (phase !== PHASES.SECTION_INTRO && phase !== PHASES.QUESTION && phase !== PHASES.CELEBRATE) {
        setPhase(PHASES.SECTION_INTRO);
      }
    }
  }, [location.pathname]);

  // Phase → URL push. When internal state changes (Next/Prev, auth success, etc.),
  // reflect that in the URL so browser back/forward and deep-linking work.
  useE(() => {
    if (urlSyncRef.current.applying) { urlSyncRef.current.applying = false; return; }
    const target = urlForPhase(phase, sectionIdx);
    if (target && target !== location.pathname) {
      navigate(target, { replace: false });
    }
  }, [phase, sectionIdx]);

  // Compute active flat questions (with conditional logic)
  const flat = flattenQuestions(SECTIONS, answers);
  const currentFQ = phase === PHASES.QUESTION && stepIdx < flat.length ? flat[stepIdx] : null;

  const warmCopy = config.tone === "warm";
  const totalSections = SECTIONS.length;

  const startApp = () => setPhase(PHASES.AUTH);

  const onAuthed = (u) => {
    setUser(u);
    // Respect ?next= so protected-route redirects land back on the intended page.
    const nextParam = new URLSearchParams(location.search).get("next");
    if (nextParam && nextParam.startsWith("/apply")) {
      navigate(nextParam, { replace: true });
      return;
    }
    if (u.mode === "login") {
      setPhase(PHASES.RETURNING);
    } else {
      setPhase(PHASES.UPLOAD);
    }
  };

  const onResumeDraft = () => {
    if (parsed && Object.keys(answers || {}).length > 0) {
      setPhase(PHASES.QUESTION);
    } else if (uploaded) {
      setPhase(PHASES.REVIEW);
    } else {
      setPhase(PHASES.UPLOAD);
    }
  };

  const onViewPastSubmission = (sub) => {
    if (sub.answers) setAnswers(sub.answers);
    setViewingSubmission(sub);
    setPhase(PHASES.DONE);
  };

  const backFromPast = () => {
    setViewingSubmission(null);
    setPhase(PHASES.RETURNING);
  };

  const onStartNew = () => {
    ["tir:uploaded", "tir:parsed", "tir:answers", "tir:stepIdx", "tir:sectionIdx"].forEach(k => localStorage.removeItem(k));
    setUploaded(null); setParsed(null); setAnswers({});
    setSectionIdx(0); setStepIdx(0);
    setPhase(PHASES.UPLOAD);
  };

  const onUploaded = (u) => {
    setUploaded(u);
    setPhase(PHASES.PARSING);
  };

  const onParseDone = () => {
    const p = simulateParse(user?.email);
    setParsed(p);
    setPhase(PHASES.REVIEW);
  };

  const onReviewDone = (fields) => {
    const next = { ...answers };
    if (fields.fullName) next.fullName = fields.fullName;
    if (fields.email) next.email = fields.email;
    if (fields.phone) next.phone = fields.phone;
    if (fields.org) next.org = fields.org;
    if (fields.degree) {
      const d = fields.degree.toLowerCase();
      if (d.includes("phd") || d.includes("doctor")) next.degree = "PhD";
      else if (d.includes("master") || d.includes("msc") || d.includes("m.s")) next.degree = "Master's Degree";
      else if (d.includes("bachelor") || d.includes("b.tech") || d.includes("bsc")) next.degree = "Bachelor's Degree";
    }
    setAnswers(next);
    setSectionIdx(0);
    setStepIdx(0);
    setPhase(PHASES.SECTION_INTRO);
  };

  const goNextQuestion = () => {
    const cur = flat[stepIdx];
    const next = flat[stepIdx + 1];
    if (!next) {
      setPhase(PHASES.DONE);
      return;
    }
    if (next.sectionIdx !== cur.sectionIdx) {
      const msgs = [
        "Nice — basics are squared away.",
        "The hard part: you framed the problem.",
        "Solution articulated. Keep going.",
        "Execution plan captured.",
        "Evidence uploaded. Home stretch.",
      ];
      setPhase(PHASES.CELEBRATE);
      setSectionIdx(next.sectionIdx);
      setStepIdx(stepIdx + 1);
      window.__celebMsg = msgs[cur.sectionIdx] || "Section complete.";
      return;
    }
    setStepIdx(stepIdx + 1);
  };

  const goPrevQuestion = () => {
    if (stepIdx > 0) {
      const prev = flat[stepIdx - 1];
      setStepIdx(stepIdx - 1);
      setSectionIdx(prev.sectionIdx);
    }
  };

  const restart = () => {
    if (!confirm("Clear everything and start over?")) return;
    ["tir:phase", "tir:user", "tir:uploaded", "tir:parsed", "tir:answers", "tir:stepIdx", "tir:sectionIdx"].forEach(k => localStorage.removeItem(k));
    setUser(null); setUploaded(null); setParsed(null); setAnswers({});
    setSectionIdx(0); setStepIdx(0); setPhase(PHASES.WELCOME);
  };

  const logout = () => {
    ["tir:phase", "tir:user"].forEach(k => localStorage.removeItem(k));
    setUser(null);
    setPhase(PHASES.WELCOME);
  };

  const [prevPhase, setPrevPhase] = useS(null);
  const goProfileFrom = () => { setPrevPhase(phase); setPhase(PHASES.PROFILE); };
  const backFromProfile = () => { setPhase(prevPhase || PHASES.RETURNING); setPrevPhase(null); };
  const updateUser = (u) => setUser(u);

  const setAnswer = (id, value) => setAnswers({ ...answers, [id]: value });

  // ===== Single-editor session lock for team applications =====
  const teammateEmails = Array.isArray(answers.teammates)
    ? answers.teammates.filter(m => m && m.email).map(m => m.email)
    : [];
  const sharedAppEmails = user?.email ? [user.email, ...teammateEmails] : [];
  const lockActive = !!user && [PHASES.UPLOAD, PHASES.PARSING, PHASES.REVIEW, PHASES.SECTION_INTRO, PHASES.QUESTION, PHASES.CELEBRATE].includes(phase) && sharedAppEmails.length > 1;
  const lock = useSessionLock({
    sharedAppEmails,
    currentUser: { email: user?.email, name: (answers.fullName || user?.email || "").split("@")[0].split(" ")[0] },
    active: lockActive,
  });

  const handleSignOutFromKicked = () => {
    lock.releaseLock();
    logout();
  };
  const handleReclaim = () => {
    lock.takeLock();
  };

  // Keyboard
  useE(() => {
    const handler = (e) => {
      if (e.target.tagName === "TEXTAREA") return;
      if (e.target.tagName === "INPUT" && phase === PHASES.AUTH) return;
      if (e.key === "Enter" && !e.shiftKey) {
        if (phase === PHASES.WELCOME) { e.preventDefault(); startApp(); return; }
        if (phase === PHASES.CELEBRATE) {
          e.preventDefault();
          setPhase(PHASES.SECTION_INTRO);
          return;
        }
        if (phase === PHASES.SECTION_INTRO) {
          e.preventDefault();
          setPhase(PHASES.QUESTION);
          return;
        }
        if (phase === PHASES.QUESTION && currentFQ) {
          const v = answers[currentFQ.q.id];
          if (isAnswered(currentFQ.q, v)) {
            e.preventDefault();
            goNextQuestion();
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, currentFQ, answers, stepIdx]);

  // Progress calculation
  const totalQ = flat.length;
  const progress = phase === PHASES.QUESTION ? stepIdx / Math.max(1, totalQ) : 0;
  const estMin = Math.max(1, Math.round((totalQ - stepIdx) * 0.9));
  const currentSection = currentFQ?.section || SECTIONS[sectionIdx];

  const showProgress = [PHASES.QUESTION, PHASES.SECTION_INTRO].includes(phase);

  // Unknown /apply/<slug> → render the 404 screen inline (keeps App mounted
  // so state isn't lost when the user navigates back).
  const applySlug = pickPathFromLocation(location.pathname);
  const isUnknownApplyPath = applySlug != null && applySlug !== "" && !KNOWN_APPLY_PATHS.has(applySlug);
  if (isUnknownApplyPath) {
    return (
      <div className={`eir-root eir-theme-${config.theme}`}>
        <div className="eir-bg" />
        <div className="eir-frame">
          <main className="eir-main">
            <div className="eir-screen">
              <div className="eir-coord eir-mono">
                <span>ARTPARK / TIR.2026</span>
                <span>404 · not found</span>
              </div>
              <div className="eir-welcome-body">
                <h1 className="eir-welcome-title">Nothing here.</h1>
                <p className="eir-welcome-lede">
                  <code>{location.pathname}</code> doesn't point anywhere on the application portal.
                </p>
                <button className="eir-btn eir-btn-primary" onClick={() => navigate("/apply")}>
                  <span>Back to application</span>
                </button>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className={`eir-root eir-theme-${config.theme}`}>
      <div className="eir-bg" />
      <div className="eir-frame">
        <Header config={config} user={user} onRestart={restart} onTweaks={() => setTweaksOpen(!tweaksOpen)} onLogout={logout} onProfile={goProfileFrom} phase={phase} />

        {lockActive && lock.state === "active" && sharedAppEmails.length > 1 && (
          <SessionLockBanner
            currentUser={{ email: user?.email, name: (answers.fullName || user?.email || "").split("@")[0].split(" ")[0] }}
            sharedAppEmails={sharedAppEmails}
          />
        )}

        {showProgress && lock.state !== "kicked" && (
          <ProgressBar
            variant={config.progress}
            progress={progress}
            currentStep={stepIdx}
            totalSteps={totalQ}
            sectionLabel={currentSection?.label || ""}
            sectionIndex={sectionIdx}
            totalSections={totalSections}
            estMin={estMin}
          />
        )}

        <main className="eir-main">
          {lockActive && lock.state === "kicked" ? (
            <KickedScreen
              kickedBy={lock.activeSession}
              onSignOut={handleSignOutFromKicked}
              onReclaim={handleReclaim}
            />
          ) : (
            <>
              {phase === PHASES.WELCOME && <WelcomeScreen onStart={startApp} warmCopy={warmCopy} />}
              {phase === PHASES.AUTH && <AuthScreen onAuthed={onAuthed} warmCopy={warmCopy} />}
              {phase === PHASES.RETURNING && user && (
                <ReturningChoiceScreen
                  user={user}
                  hasDraft={!!parsed && Object.keys(answers || {}).length > 0}
                  draftProgress={flat.length ? stepIdx / flat.length : 0}
                  pastSubmissions={(() => { try { return JSON.parse(localStorage.getItem(`tir:submissions:${user.email}`) || "[]"); } catch { return []; } })()}
                  onResume={onResumeDraft}
                  onViewPast={onViewPastSubmission}
                  onStartNew={onStartNew}
                  warmCopy={warmCopy}
                />
              )}
              {phase === PHASES.UPLOAD && <UploadScreen onUploaded={onUploaded} warmCopy={warmCopy} />}
              {phase === PHASES.PARSING && <ParsingScreen onDone={onParseDone} uploaded={uploaded || {}} />}
              {phase === PHASES.REVIEW && parsed && <ParsedReviewScreen parsed={parsed} onContinue={onReviewDone} warmCopy={warmCopy} userEmail={user?.email} />}
              {phase === PHASES.SECTION_INTRO && <SectionIntroScreen section={SECTIONS[sectionIdx]} onContinue={() => setPhase(PHASES.QUESTION)} />}
              {phase === PHASES.CELEBRATE && <CelebrationScreen message={window.__celebMsg || "Section complete."} onContinue={() => setPhase(PHASES.SECTION_INTRO)} />}
              {phase === PHASES.QUESTION && currentFQ && (
                <QuestionView
                  fq={currentFQ} total={totalQ} stepIdx={stepIdx}
                  value={answers[currentFQ.q.id]}
                  onChange={(v) => setAnswer(currentFQ.q.id, v)}
                  onNext={goNextQuestion} onPrev={goPrevQuestion}
                  canPrev={stepIdx > 0} warmCopy={warmCopy} answers={answers}
                />
              )}
              {phase === PHASES.DONE && <DoneScreen answers={answers} onRestart={restart} submission={viewingSubmission} onBack={backFromPast} />}
              {phase === PHASES.PROFILE && user && <ProfileScreen user={user} onBack={backFromProfile} onUpdate={updateUser} onLogout={logout} />}
            </>
          )}
        </main>

        {lockActive && lock.state === "pending-takeover" && (
          <TakeoverPrompt
            activeSession={lock.activeSession}
            currentUser={{ email: user?.email }}
            onTakeOver={handleReclaim}
            onWait={() => { logout(); }}
          />
        )}

        <Footer phase={phase} stepIdx={stepIdx} totalQ={totalQ} onPrev={goPrevQuestion} canPrev={phase === PHASES.QUESTION && stepIdx > 0} />
      </div>

      <TweaksPanel open={tweaksOpen} onClose={() => setTweaksOpen(false)} config={config} setConfig={setConfig} user={user} />
      <SupportButton userEmail={user?.email} />
    </div>
  );
}

function Header({ config, user, onRestart, onTweaks, onLogout, onProfile, phase }) {
  const theme = THEMES[config.theme];
  const isAuthed = !!user;
  const onProfilePage = phase === "profile";
  return (
    <header className="eir-header">
      <div className="eir-header-left">
        <a href="/marketing.html" className="eir-home-link eir-mono" title="Back to home">
          <span className="eir-home-arrow">←</span>
          <span className="eir-home-label">home</span>
        </a>
        <span className="eir-header-sep" />
        <a href="/marketing.html" className="eir-brand" title="ARTPARK × IISc">
          <img
            src="/assets/iisc-logo-blue.png"
            alt="Indian Institute of Science"
            className="eir-brand-iisc"
          />
          <span className="eir-brand-divider" />
          <img
            src="/assets/artpark-logo.png"
            alt="ARTPARK"
            className="eir-brand-artpark"
          />
        </a>
      </div>
      <div className="eir-header-right">
        <div className="eir-mono eir-dim eir-theme-tag">{theme.tag}</div>
        {isAuthed && !onProfilePage && (
          <button className="eir-header-user eir-mono" onClick={onProfile} title="Profile settings">
            <span className="eir-header-user-avatar">{(user.email[0] || "?").toUpperCase()}</span>
            <span className="eir-header-user-email">{user.email}</span>
            <span className="eir-header-user-cog">⚙</span>
          </button>
        )}
        {isAuthed && (
          <button className="eir-chip-btn eir-mono eir-header-logout" onClick={onLogout} title="Sign out">
            sign out ↗
          </button>
        )}
        {!isAuthed && (
          <button className="eir-chip-btn eir-mono" onClick={onRestart}>reset ↺</button>
        )}
      </div>
    </header>
  );
}

function Footer({ phase, stepIdx, totalQ, onPrev, canPrev }) {
  return (
    <footer className="eir-footer">
      <div className="eir-footer-left eir-mono eir-dim">
        {phase === "question" && <>q.{(stepIdx + 1).toString().padStart(2, "0")} / {totalQ.toString().padStart(2, "0")}</>}
      </div>
      <div className="eir-footer-nav">
        <button className="eir-chip-btn eir-mono" onClick={onPrev} disabled={!canPrev}>← back</button>
        <span className="eir-mono eir-dim">press <kbd>⏎</kbd> to continue</span>
      </div>
    </footer>
  );
}

function QuestionView({ fq, total, stepIdx, value, onChange, onNext, onPrev, canPrev, warmCopy, answers }) {
  const { q, section, globalIdx } = fq;
  const answered = isAnswered(q, value);
  const blockReason = answered ? null : whyBlocked(q, value);
  const name = (answers.fullName || "").split(" ")[0];

  let prompt = q.prompt;
  if (warmCopy && name) {
    if (q.id === "phone") prompt = `Thanks, ${name}. A phone number we can reach you on?`;
    if (q.id === "problemDefined") prompt = `OK ${name} — is the problem you want to solve well-defined?`;
    if (q.id === "stage") prompt = `${name}, how far along are you?`;
  }

  return (
    <div className="eir-screen eir-question" key={globalIdx}>
      <div className="eir-coord eir-mono">
        <span>§ {section.index} · {section.label}</span>
        <span>q.{(stepIdx + 1).toString().padStart(2, "0")} of {total}</span>
      </div>

      <div className="eir-q-body">
        <div className="eir-q-index eir-mono">
          <span className="eir-q-index-num">{(stepIdx + 1).toString().padStart(2, "0")}</span>
          <span className="eir-q-index-arrow">→</span>
          {q.cvAutoFill && <span className="eir-pill eir-pill-auto">auto-filled from cv</span>}
          {q.optional && <span className="eir-q-optional">optional</span>}
          {q.required && !q.cvAutoFill && <span className="eir-q-required">required</span>}
        </div>

        <h2 className="eir-q-prompt">{prompt}</h2>
        {q.help && <p className="eir-q-help">{q.help}</p>}

        <div className="eir-q-input-wrap">
          <QuestionInput q={q} value={value} onChange={onChange} autoFocus />
        </div>

        <div className="eir-q-actions">
          <button className={`eir-btn ${answered ? "eir-btn-primary" : "eir-btn-disabled"}`} onClick={onNext} disabled={!answered}>
            <span>{stepIdx === total - 1 ? "Submit application" : "OK"}</span>
            <span className="eir-btn-key eir-mono">⏎</span>
          </button>
          {answered ? (
            <span className="eir-mono eir-dim">or press <kbd>Enter</kbd></span>
          ) : blockReason ? (
            <span className="eir-mono eir-block-reason">↳ {blockReason}</span>
          ) : (
            <span className="eir-mono eir-dim">or press <kbd>Enter</kbd></span>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
export { PHASES };
