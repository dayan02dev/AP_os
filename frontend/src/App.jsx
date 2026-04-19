// ARTPARK EIR wizard shell — wired to the FastAPI backend via hooks.
//
// All data reads/writes go through useAuth + useApplication + useResume.
// This file owns:
//   - theme application (unchanged from Phase 0)
//   - phase state machine for the wizard (welcome → sections → done)
//   - URL ↔ section sync via react-router-dom
//   - keyboard shortcuts (Enter to advance)
//   - layout (header, progress bar, footer)
// All screen components live in /screens.jsx, /auth_upload.jsx, /profile.jsx —
// their markup is unchanged; we only wire them up differently.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  ParsedReviewScreen,
  ParsingScreen,
  UploadScreen,
} from "./auth_upload.jsx";
import { QuestionInput, isAnswered, whyBlocked } from "./inputs.jsx";
import { ProfileScreen } from "./profile.jsx";
import { SECTIONS, flattenQuestions } from "./questions.jsx";
import {
  CelebrationScreen,
  DoneScreen,
  ProgressBar,
  SectionIntroScreen,
  WelcomeScreen,
} from "./screens.jsx";
import { SupportButton } from "./support.jsx";
import { THEMES } from "./themes.jsx";
import { TweaksPanel } from "./tweaks.jsx";

import { useApplication } from "./hooks/useApplication.jsx";
import { useAuth } from "./hooks/useAuth.jsx";
import { useResume } from "./hooks/useResume.js";
import { useToast } from "./hooks/useToast.jsx";
import { SECTION_ORDER } from "./lib/fieldMap.js";

const PHASES = {
  WELCOME: "welcome",
  UPLOAD: "upload",
  PARSING: "parsing",
  // Post-upload confirmation of parsed CV fields. Distinct from REVIEW
  // (pre-submission summary) so that re-entering REVIEW later doesn't
  // bounce the user back to the CV-review screen when a resume is on file.
  PARSE_REVIEW: "parse_review",
  REVIEW: "review",
  SECTION_INTRO: "section_intro",
  QUESTION: "question",
  CELEBRATE: "celebrate",
  DONE: "done",
  PROFILE: "profile",
};

const CELEBRATE_MESSAGES = [
  "Nice — basics are squared away.",
  "The hard part: you framed the problem.",
  "Solution articulated. Keep going.",
  "Execution plan captured.",
  "Evidence uploaded. Home stretch.",
];

function pickSlug(pathname) {
  const m = pathname.replace(/\/+$/, "").match(/^\/apply(?:\/([^/]*))?$/);
  return m ? (m[1] || "") : null;
}

function urlForState(phase, sectionIdx) {
  if (phase === PHASES.PROFILE) return "/apply/profile";
  if (phase === PHASES.REVIEW) return "/apply/review";
  if (phase === PHASES.DONE) return "/apply/submitted";
  // UPLOAD / PARSING / PARSE_REVIEW all live on /apply so the URL doesn't
  // jitter during the CV flow. The user sees these as one continuous step.
  if (
    phase === PHASES.UPLOAD ||
    phase === PHASES.PARSING ||
    phase === PHASES.PARSE_REVIEW
  ) {
    return "/apply";
  }
  if (phase === PHASES.SECTION_INTRO || phase === PHASES.QUESTION || phase === PHASES.CELEBRATE) {
    return "/apply/" + (SECTION_ORDER[sectionIdx] || SECTION_ORDER[0]);
  }
  return "/apply";
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const urlSyncRef = useRef({ applying: false });

  const { user, logout } = useAuth();
  const { application, answers, loading, saving, locked, save, submit, refetch, completion } =
    useApplication();
  const resume = useResume();
  const { push: pushToast } = useToast();

  const [config, setConfig] = useState(() => window.__eirDefaults);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [phase, setPhase] = useState(PHASES.WELCOME);
  const [sectionIdx, setSectionIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [celebMsg, setCelebMsg] = useState("");
  const [prevPhase, setPrevPhase] = useState(null);

  // ─── Theme application ───────────────────────────────────────
  useEffect(() => {
    const theme = THEMES[config.theme] || THEMES.notebook;
    const root = document.documentElement;
    Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    const accents = {
      default: null,
      rust: "#c84a1a",
      olive: "#5a6b2a",
      ink: "#0a0a0a",
      plum: "#6a1a4a",
      forest: "#2a5a3a",
    };
    if (config.accent && config.accent !== "default" && accents[config.accent]) {
      root.style.setProperty("--accent", accents[config.accent]);
    }
    const bg = config.bg === "auto" ? theme.bg : config.bg;
    root.setAttribute("data-bg", bg || "none");
    root.setAttribute("data-theme", config.theme);
    root.setAttribute("data-typography", config.typography);
    root.setAttribute("data-tone", config.tone);
  }, [config]);

  // Tweaks message protocol (designer overlay).
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === "__activate_edit_mode") setTweaksOpen(true);
      if (e.data?.type === "__deactivate_edit_mode") setTweaksOpen(false);
    };
    window.addEventListener("message", handler);
    window.parent?.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", handler);
  }, []);

  // ─── Flat question list + current slot ───────────────────────
  const flat = useMemo(() => flattenQuestions(SECTIONS, answers), [answers]);
  const totalQ = flat.length;
  const currentFQ = phase === PHASES.QUESTION && stepIdx < flat.length ? flat[stepIdx] : null;

  // ─── URL → phase/section sync ────────────────────────────────
  //
  // Fires ONLY when the URL pathname changes. The `application` and `locked`
  // state transitions have their own effects below, so an inbound save
  // response doesn't trip this effect and reset stepIdx back to zero
  // (which was the Phase-7-post-launch bug that bounced users from the
  // name question to the hasTeam question after every auto-save).
  useEffect(() => {
    const slug = pickSlug(location.pathname);
    if (slug === null) return;
    urlSyncRef.current.applying = true;

    // Slug "" is handled by the dedicated /apply effect below — it needs to
    // wait for the application to load before deciding the initial phase.
    if (slug === "") return;

    if (slug === "profile") {
      setPhase(PHASES.PROFILE);
      return;
    }
    if (slug === "review") {
      setPhase(PHASES.REVIEW);
      return;
    }
    if (slug === "submitted") {
      setPhase(PHASES.DONE);
      return;
    }
    if (SECTION_ORDER.includes(slug)) {
      const idx = SECTION_ORDER.indexOf(slug);
      // Only reset stepIdx when we've actually changed section. This is the
      // fix: prior to the split, every save() → setRow() → application-dep
      // effect → setStepIdx(firstQInSection) and the user lost their place.
      if (idx !== sectionIdx) {
        setSectionIdx(idx);
        const firstQInSection = flat.findIndex((fq) => fq.sectionIdx === idx);
        if (firstQInSection >= 0) setStepIdx(firstQInSection);
      }
      if (phase !== PHASES.QUESTION && phase !== PHASES.CELEBRATE) {
        setPhase(PHASES.SECTION_INTRO);
      }
      return;
    }
    // Unknown slug — handled by router-level 404.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // /apply (empty slug) needs to wait for the application to load before it
  // can decide between WELCOME (first-timer, no answers yet) and
  // SECTION_INTRO (returning user with saved answers).
  useEffect(() => {
    if (!application) return;
    const slug = pickSlug(location.pathname);
    if (slug !== "") return;
    if (locked) {
      setPhase(PHASES.DONE);
      return;
    }
    const hasAny = answers && Object.keys(answers).length > 0;
    setPhase(hasAny ? PHASES.SECTION_INTRO : PHASES.WELCOME);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [application, locked]);

  // When the application flips to non-draft status mid-session (another
  // device submitted, or the user did so via another tab), bounce any
  // section URL to /apply/submitted.
  useEffect(() => {
    if (!locked) return;
    const slug = pickSlug(location.pathname);
    if (slug && SECTION_ORDER.includes(slug)) {
      navigate("/apply/submitted", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  // ─── Phase/section → URL push ────────────────────────────────
  useEffect(() => {
    if (urlSyncRef.current.applying) {
      urlSyncRef.current.applying = false;
      return;
    }
    const target = urlForState(phase, sectionIdx);
    if (target && target !== location.pathname) {
      navigate(target, { replace: false });
    }
  }, [phase, sectionIdx, navigate, location.pathname]);

  // ─── Navigation handlers ─────────────────────────────────────
  const startWizard = () => {
    // Resume upload comes before the first section so parsed fields can
    // pre-fill contact info. If the user already uploaded a CV we skip
    // straight to the sections; they can always re-upload from /apply/profile.
    if (!resume.resume) {
      setPhase(PHASES.UPLOAD);
      return;
    }
    setSectionIdx(0);
    setStepIdx(0);
    setPhase(PHASES.SECTION_INTRO);
  };

  const skipUpload = () => {
    setSectionIdx(0);
    setStepIdx(0);
    setPhase(PHASES.SECTION_INTRO);
  };

  const goNextQuestion = () => {
    const cur = flat[stepIdx];
    const next = flat[stepIdx + 1];
    if (!cur) return;
    if (!next) {
      // Reached the end of the flat list — proceed to review.
      navigate("/apply/review");
      return;
    }
    if (next.sectionIdx !== cur.sectionIdx) {
      setCelebMsg(CELEBRATE_MESSAGES[cur.sectionIdx] || "Section complete.");
      setPhase(PHASES.CELEBRATE);
      setSectionIdx(next.sectionIdx);
      setStepIdx(stepIdx + 1);
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

  const goProfileFrom = () => {
    setPrevPhase(phase);
    setPhase(PHASES.PROFILE);
  };
  const backFromProfile = () => {
    setPhase(prevPhase || PHASES.SECTION_INTRO);
    setPrevPhase(null);
  };

  const handleAnswerChange = (qid, value) => {
    save({ [qid]: value });
  };

  // Wizard upload/parse/review — thin wiring to the real hook.
  const onUploadedReal = async (uploaded) => {
    if (!uploaded?.cv) {
      setPhase(PHASES.PARSING);
      return;
    }
    try {
      await resume.upload(uploaded.cv);
      setPhase(PHASES.PARSING);
    } catch (err) {
      pushToast({
        kind: "error",
        message: err?.message || "Upload failed. Try again.",
      });
    }
  };

  const onReviewParsed = async () => {
    try {
      await resume.applyToApplication();
      await refetch();
      pushToast({ kind: "info", message: "Profile filled from your CV." });
    } catch (err) {
      pushToast({
        kind: "error",
        message: err?.message || "Couldn't apply parsed data.",
      });
    }
    setPhase(PHASES.SECTION_INTRO);
    setSectionIdx(0);
    setStepIdx(0);
  };

  const handleSubmit = async () => {
    try {
      const result = await submit();
      pushToast({ kind: "info", message: "Submitted. Good luck!" });
      if (result?.application_id) {
        navigate("/apply/submitted");
      }
    } catch (err) {
      if (err?.status === 422) {
        pushToast({
          kind: "error",
          message: "Some fields need attention before submitting. See the review screen.",
        });
      } else {
        pushToast({
          kind: "error",
          message: err?.message || "Submission failed.",
        });
      }
    }
  };

  // Keyboard shortcuts (Enter advances) — unchanged from pre-Phase-7.
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "TEXTAREA") return;
      if (e.key === "Enter" && !e.shiftKey) {
        if (phase === PHASES.WELCOME) {
          e.preventDefault();
          startWizard();
          return;
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentFQ, answers, stepIdx]);

  // ─── Progress figures ────────────────────────────────────────
  const totalSections = SECTIONS.length;
  const currentSection = currentFQ?.section || SECTIONS[sectionIdx];
  const progress = phase === PHASES.QUESTION ? stepIdx / Math.max(1, totalQ) : 0;
  const estMin = Math.max(1, Math.round((totalQ - stepIdx) * 0.9));
  const warmCopy = config.tone === "warm";
  const showProgress = [PHASES.QUESTION, PHASES.SECTION_INTRO].includes(phase);

  return (
    <div className={`eir-root eir-theme-${config.theme}`}>
      <div className="eir-bg" />
      <div className="eir-frame">
        <Header
          config={config}
          user={user}
          onLogout={logout}
          onProfile={goProfileFrom}
          phase={phase}
        />

        {showProgress && (
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
          {loading && !application && <LoadingScreen />}

          {phase === PHASES.WELCOME && application && (
            <WelcomeScreen onStart={startWizard} warmCopy={warmCopy} />
          )}
          {phase === PHASES.UPLOAD && (
            <div>
              <UploadScreen onUploaded={onUploadedReal} warmCopy={warmCopy} />
              <div className="eir-upload-skip">
                <button
                  type="button"
                  className="eir-link-btn eir-mono"
                  onClick={skipUpload}
                >
                  skip for now — I'll fill it in manually ↗
                </button>
              </div>
            </div>
          )}
          {phase === PHASES.PARSING && (
            <ParsingScreen
              onDone={() => setPhase(PHASES.PARSE_REVIEW)}
              uploaded={{ cv: resume.resume?.original_filename || "your CV" }}
            />
          )}
          {phase === PHASES.PARSE_REVIEW && resume.resume?.parsed_data && (
            <ParsedReviewScreen
              parsed={{
                fullName: resume.resume.parsed_data.full_name || "",
                email: resume.resume.parsed_data.email || user?.email || "",
                phone: resume.resume.parsed_data.phone || "",
                org: resume.resume.parsed_data.location || "",
                degree: "",
                _meta: {},
                _order: ["fullName", "email", "phone", "org", "degree"],
              }}
              onContinue={onReviewParsed}
              warmCopy={warmCopy}
              userEmail={user?.email}
            />
          )}
          {phase === PHASES.SECTION_INTRO && currentSection && (
            <SectionIntroScreen
              section={currentSection}
              onContinue={() => setPhase(PHASES.QUESTION)}
            />
          )}
          {phase === PHASES.CELEBRATE && (
            <CelebrationScreen
              message={celebMsg || "Section complete."}
              onContinue={() => setPhase(PHASES.SECTION_INTRO)}
            />
          )}
          {phase === PHASES.QUESTION && currentFQ && (
            <QuestionView
              fq={currentFQ}
              total={totalQ}
              stepIdx={stepIdx}
              value={answers[currentFQ.q.id]}
              onChange={(v) => handleAnswerChange(currentFQ.q.id, v)}
              onNext={goNextQuestion}
              onPrev={goPrevQuestion}
              canPrev={stepIdx > 0}
              warmCopy={warmCopy}
              answers={answers}
              locked={locked}
              saving={saving}
            />
          )}
          {phase === PHASES.REVIEW && (
            <ReviewSubmitPanel
              answers={answers}
              completion={completion}
              onSubmit={handleSubmit}
              locked={locked}
              saving={saving}
            />
          )}
          {phase === PHASES.DONE && application && (
            <DoneScreen
              answers={answers}
              onRestart={() => navigate("/apply")}
              submission={{
                id: application.id,
                ts: application.submitted_at
                  ? new Date(application.submitted_at).getTime()
                  : Date.now(),
                currentMilestone: "submitted",
                answers,
              }}
              onBack={() => navigate("/apply")}
            />
          )}
          {phase === PHASES.PROFILE && user && (
            <ProfileScreen
              user={user}
              onBack={backFromProfile}
              onUpdate={() => {}}
              onLogout={logout}
            />
          )}
        </main>

        <Footer
          phase={phase}
          stepIdx={stepIdx}
          totalQ={totalQ}
          onPrev={goPrevQuestion}
          canPrev={phase === PHASES.QUESTION && stepIdx > 0}
          saving={saving}
          locked={locked}
        />
      </div>

      <TweaksPanel
        open={tweaksOpen}
        onClose={() => setTweaksOpen(false)}
        config={config}
        setConfig={setConfig}
        user={user}
      />
      <SupportButton userEmail={user?.email} />
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="eir-screen">
      <div className="eir-welcome-body">
        <p className="eir-mono eir-dim">loading your application…</p>
      </div>
    </div>
  );
}

function Header({ config, user, onLogout, onProfile, phase }) {
  const theme = THEMES[config.theme] || THEMES.minimal;
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
          <img src="/assets/iisc-logo-blue.png" alt="Indian Institute of Science" className="eir-brand-iisc" />
          <span className="eir-brand-divider" />
          <img src="/assets/artpark-logo.png" alt="ARTPARK" className="eir-brand-artpark" />
        </a>
      </div>
      <div className="eir-header-right">
        <div className="eir-mono eir-dim eir-theme-tag">{theme.tag}</div>
        {user && !onProfilePage && (
          <button className="eir-header-user eir-mono" onClick={onProfile} title="Profile settings">
            <span className="eir-header-user-avatar">{(user.email?.[0] || "?").toUpperCase()}</span>
            <span className="eir-header-user-email">{user.email}</span>
            <span className="eir-header-user-cog">⚙</span>
          </button>
        )}
        {user && (
          <button className="eir-chip-btn eir-mono eir-header-logout" onClick={onLogout} title="Sign out">
            sign out ↗
          </button>
        )}
      </div>
    </header>
  );
}

function Footer({ phase, stepIdx, totalQ, onPrev, canPrev, saving, locked }) {
  return (
    <footer className="eir-footer">
      <div className="eir-footer-left eir-mono eir-dim">
        {phase === "question" && (
          <>
            q.{(stepIdx + 1).toString().padStart(2, "0")} / {totalQ.toString().padStart(2, "0")}
          </>
        )}
        {saving === "saving" && <span className="eir-save-state"> · saving…</span>}
        {saving === "saved" && <span className="eir-save-state is-ok"> · saved ✓</span>}
        {saving === "error" && <span className="eir-save-state is-err"> · save failed</span>}
        {locked && <span className="eir-save-state is-lock"> · locked (submitted)</span>}
      </div>
      <div className="eir-footer-nav">
        <button className="eir-chip-btn eir-mono" onClick={onPrev} disabled={!canPrev}>
          ← back
        </button>
        <span className="eir-mono eir-dim">
          press <kbd>⏎</kbd> to continue
        </span>
      </div>
    </footer>
  );
}

function QuestionView({
  fq,
  total,
  stepIdx,
  value,
  onChange,
  onNext,
  onPrev: _onPrev,
  canPrev: _canPrev,
  warmCopy,
  answers,
  locked,
}) {
  const { q, section, globalIdx } = fq;
  const answered = isAnswered(q, value);
  const blockReason = answered ? null : whyBlocked(q, value);
  const name = (answers.fullName || "").split(" ")[0];

  let prompt = q.prompt;
  if (warmCopy && name) {
    if (q.id === "phone") prompt = `Thanks, ${name}. A phone number we can reach you on?`;
    if (q.id === "problemDefined")
      prompt = `OK ${name} — is the problem you want to solve well-defined?`;
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
          <button
            className={`eir-btn ${answered && !locked ? "eir-btn-primary" : "eir-btn-disabled"}`}
            onClick={onNext}
            disabled={!answered || locked}
          >
            <span>{stepIdx === total - 1 ? "Review + submit" : "OK"}</span>
            <span className="eir-btn-key eir-mono">⏎</span>
          </button>
          {locked ? (
            <span className="eir-mono eir-block-reason">↳ application already submitted</span>
          ) : answered ? (
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

function ReviewSubmitPanel({ answers, completion, onSubmit, locked, saving }) {
  const entries = Object.entries(answers)
    .filter(([_, v]) => v !== undefined && v !== null && v !== "")
    .slice(0, 30);
  const canSubmit = !locked && completion.completion_pct >= 100 && saving !== "saving";

  return (
    <div className="eir-screen eir-done">
      <div className="eir-coord eir-mono">
        <span>ARTPARK / TIR.2026</span>
        <span>review · submit when ready</span>
      </div>
      <div className="eir-done-body">
        <h2 className="eir-done-title">Review your application.</h2>
        <p className="eir-done-lede">
          You've completed <strong>{completion.completion_pct}%</strong>. Review your answers below,
          then submit when you're ready.
        </p>

        {completion.missing_required_fields.length > 0 && (
          <div className="eir-done-feedback">
            <div className="eir-mono eir-dim eir-done-feedback-label">↳ still to fill</div>
            <ul>
              {completion.missing_required_fields.map((f) => (
                <li key={f}>
                  <code>{f}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="eir-done-answers">
          <div className="eir-mono eir-dim eir-done-answers-label">↳ what you've entered</div>
          <dl className="eir-done-answers-list">
            {entries.map(([k, v]) => (
              <div key={k} className="eir-done-answer-row">
                <dt className="eir-mono">{k}</dt>
                <dd>{typeof v === "string" ? v : JSON.stringify(v)}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="eir-q-actions">
          <button
            className={`eir-btn ${canSubmit ? "eir-btn-primary" : "eir-btn-disabled"}`}
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            <span>Submit application</span>
            <span className="eir-btn-key eir-mono">⏎</span>
          </button>
        </div>
      </div>
    </div>
  );
}
