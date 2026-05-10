// ARTPARK SIP wizard — counterpart of App.jsx for the SIP track.
//
// Mirrors the TIR wizard's phase machine but:
//   - Reads /sip-applications/* and /sip-resume/* via useSipApplication +
//     useSipResume.
//   - Uses the SIP-specific question schema (questions_sip.jsx) and
//     QuestionInput switch (inputs_sip.jsx).
//   - Adds two SIP-specific early-exit gates:
//       sipIncorporated == "Not yet — we're still pre-incorporation"
//       sipTRL          == "TRL 3 or earlier — research stage"
//   - Applies a violet `track-sip` accent.
//
// The route prefix is /apply-sip/* (mirrors /apply/* for TIR).

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  ParsedReviewScreen,
  ParsingScreen,
  ReturningChoiceScreen,
  UploadScreen,
} from "./auth_upload.jsx";
import { SipQuestionInput, isAnsweredSip, whyBlockedSip } from "./inputs_sip.jsx";
import { ProfileScreen } from "./profile.jsx";
import {
  SECTIONS_SIP,
  flattenQuestionsSip,
  findInlineChildSip,
} from "./questions_sip.jsx";
import {
  CelebrationScreen,
  DoneScreen,
  ProgressBar,
  SectionIntroScreen,
  WelcomeScreen,
} from "./screens.jsx";
import { SupportButton } from "./support.jsx";
import { THEMES } from "./themes.jsx";

import { useSipApplication } from "./hooks/useSipApplication.jsx";
import { useAuth } from "./hooks/useAuth.jsx";
import { useSipResume } from "./hooks/useSipResume.js";
import { useToast } from "./hooks/useToast.jsx";
import {
  SECTION_ORDER_SIP,
  collapseFromRowSip,
} from "./lib/fieldMap-sip.js";

// SIP violet palette — overrides the TIR blue --accent + --accent-soft
// tokens that the shared theme tokens otherwise set. Applied to
// document.documentElement on mount so it beats App.jsx's inline TIR
// styles if the user navigates between the two wizards in one session.
const SIP_ACCENT_VARS = {
  "--accent": "#6B5CFF",
  "--accent-deep": "#4a3dd6",
  "--accent-soft": "#ece9ff",
};

const PHASES = {
  WELCOME: "welcome",
  RETURNING: "returning",
  UPLOAD: "upload",
  PARSING: "parsing",
  PARSE_REVIEW: "parse_review",
  REVIEW: "review",
  SECTION_INTRO: "section_intro",
  QUESTION: "question",
  CELEBRATE: "celebrate",
  DONE: "done",
  PROFILE: "profile",
  EARLY_EXIT: "early_exit",
};

const CELEBRATE_MESSAGES = [
  "Nice — basics are squared away.",
  "The hard part: you framed the problem.",
  "Solution + traction articulated. Keep going.",
  "Execution plan captured.",
  "Evidence uploaded. Home stretch.",
];

function pickSlug(pathname) {
  const m = pathname.replace(/\/+$/, "").match(/^\/apply-sip(?:\/([^/]*))?$/);
  return m ? m[1] || "" : null;
}

function humanizeField(col) {
  if (!col || typeof col !== "string") return "(unknown field)";
  const [section, ...rest] = col.split("_");
  const tail = rest.join(" ");
  const sectionLabel =
    {
      basic: "Basic info",
      problem: "Problem",
      solution: "Solution",
      execution: "Execution",
      sip: "SIP",
      evidence: "Evidence",
      declaration: "Declaration",
    }[section] || section;
  return tail ? `${sectionLabel}: ${tail}` : sectionLabel;
}

function urlForState(phase, sectionIdx) {
  if (phase === PHASES.PROFILE) return "/apply-sip/profile";
  if (phase === PHASES.REVIEW) return "/apply-sip/review";
  if (phase === PHASES.DONE) return "/apply-sip/submitted";
  // EARLY_EXIT gets its own slug so the auto-resolve effect below doesn't
  // see slug==="" and flip the phase back to RETURNING/UPLOAD before the
  // fit-check screen can render.
  if (phase === PHASES.EARLY_EXIT) return "/apply-sip/fit-check";
  if (
    phase === PHASES.WELCOME ||
    phase === PHASES.RETURNING ||
    phase === PHASES.UPLOAD ||
    phase === PHASES.PARSING ||
    phase === PHASES.PARSE_REVIEW
  ) {
    return "/apply-sip";
  }
  if (
    phase === PHASES.SECTION_INTRO ||
    phase === PHASES.QUESTION ||
    phase === PHASES.CELEBRATE
  ) {
    return (
      "/apply-sip/" +
      (SECTION_ORDER_SIP[sectionIdx] || SECTION_ORDER_SIP[0])
    );
  }
  return "/apply-sip";
}

export default function AppSip() {
  const location = useLocation();
  const navigate = useNavigate();
  const urlSyncRef = useRef({ applying: false });

  const { user, logout, loading: authLoading } = useAuth();
  const {
    application,
    answers,
    loading,
    saving,
    locked,
    save,
    flushNow,
    submit,
    refetch,
    completion,
    submittedApps,
    startNew,
  } = useSipApplication();
  const resume = useSipResume();
  const { push: pushToast } = useToast();

  const [phase, setPhase] = useState(PHASES.WELCOME);
  const [sectionIdx, setSectionIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [celebMsg, setCelebMsg] = useState("");
  const [prevPhase, setPrevPhase] = useState(null);
  const [viewingApp, setViewingApp] = useState(null);

  // Apply the SIP violet accent at the document level so it wins against
  // any --accent App.jsx set earlier in the session. Also apply the
  // base "minimal" theme so the wizard chrome (line/ink/bg) renders even
  // when the user lands on /apply-sip without going through /apply first.
  useEffect(() => {
    const root = document.documentElement;
    const baseTheme = THEMES.minimal;
    const baseEntries = Object.entries(baseTheme.vars);
    const sipEntries = Object.entries(SIP_ACCENT_VARS);
    baseEntries.forEach(([k, v]) => root.style.setProperty(k, v));
    sipEntries.forEach(([k, v]) => root.style.setProperty(k, v));
    root.setAttribute("data-bg", baseTheme.bg || "none");
    root.setAttribute("data-theme", baseTheme.key);
    return () => {
      sipEntries.forEach(([k]) => root.style.removeProperty(k));
    };
  }, []);

  const flat = useMemo(
    () => flattenQuestionsSip(SECTIONS_SIP, answers),
    [answers],
  );
  const totalQ = flat.length;
  const currentFQ =
    phase === PHASES.QUESTION && stepIdx < flat.length ? flat[stepIdx] : null;

  // ─── URL → phase/section sync ────────────────────────────
  useEffect(() => {
    const slug = pickSlug(location.pathname);
    if (slug === null) return;
    urlSyncRef.current.applying = true;

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
    if (slug === "fit-check") {
      setPhase(PHASES.EARLY_EXIT);
      return;
    }
    if (SECTION_ORDER_SIP.includes(slug)) {
      const idx = SECTION_ORDER_SIP.indexOf(slug);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    const slug = pickSlug(location.pathname);
    if (slug !== "") return;
    if (authLoading) return;
    if (!user) {
      setPhase(PHASES.WELCOME);
      return;
    }
    if (!application) return;
    if (locked) {
      setPhase(PHASES.RETURNING);
      return;
    }
    const hasAny = answers && Object.keys(answers).length > 0;
    setPhase(hasAny ? PHASES.RETURNING : PHASES.UPLOAD);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, application, locked]);

  useEffect(() => {
    if (!locked) return;
    const slug = pickSlug(location.pathname);
    if (slug && SECTION_ORDER_SIP.includes(slug)) {
      navigate("/apply-sip/submitted", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  useEffect(() => {
    if (phase !== PHASES.PARSING) return;
    const status = resume.resume?.parse_status;
    if (status === "completed" || status === "failed") {
      setPhase(PHASES.PARSE_REVIEW);
    }
  }, [phase, resume.resume?.parse_status]);

  // ─── Phase/section → URL push ────────────────────────────
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

  // ─── Navigation handlers ─────────────────────────────────
  const startWizard = () => {
    if (!user) {
      navigate("/apply/signin?next=%2Fapply-sip", { replace: false });
      return;
    }
    if (!resume.resume) {
      setPhase(PHASES.UPLOAD);
      return;
    }
    setSectionIdx(0);
    setStepIdx(0);
    setPhase(PHASES.SECTION_INTRO);
  };

  const onStartNew = async () => {
    if (locked) {
      try {
        await startNew();
      } catch {
        /* error captured in hook */
      }
    }
    setSectionIdx(0);
    setStepIdx(0);
    setPhase(PHASES.UPLOAD);
  };

  const onResumeDraft = () => {
    setSectionIdx(0);
    setStepIdx(0);
    setPhase(PHASES.SECTION_INTRO);
  };

  const onViewPast = (entry) => {
    const match =
      entry && Array.isArray(submittedApps)
        ? submittedApps.find((r) => r.id === entry.id)
        : null;
    setViewingApp(match || null);
    setPhase(PHASES.DONE);
  };

  const skipUpload = () => {
    setSectionIdx(0);
    setStepIdx(0);
    setPhase(PHASES.SECTION_INTRO);
  };

  const goNextQuestion = () => {
    flushNow();
    const cur = flat[stepIdx];
    if (!cur) return;

    // Early exit gates — SIP only.
    if (
      cur.q.id === "sipIncorporated" &&
      answers.sipIncorporated === "Not yet — we're still pre-incorporation"
    ) {
      setPhase(PHASES.EARLY_EXIT);
      return;
    }
    if (
      cur.q.id === "sipTRL" &&
      answers.sipTRL === "TRL 3 or earlier — research stage"
    ) {
      setPhase(PHASES.EARLY_EXIT);
      return;
    }

    const next = flat[stepIdx + 1];
    if (!next) {
      navigate("/apply-sip/review");
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
    flushNow();
    if (stepIdx > 0) {
      const prev = flat[stepIdx - 1];
      setStepIdx(stepIdx - 1);
      setSectionIdx(prev.sectionIdx);
    }
  };

  const goBackUniversal = () => {
    flushNow();
    if (phase === PHASES.QUESTION) {
      if (stepIdx === 0) {
        setPhase(PHASES.SECTION_INTRO);
        return;
      }
      const prev = flat[stepIdx - 1];
      if (prev.sectionIdx !== sectionIdx) {
        setPhase(PHASES.QUESTION);
      }
      setStepIdx(stepIdx - 1);
      setSectionIdx(prev.sectionIdx);
      return;
    }
    if (phase === PHASES.SECTION_INTRO) {
      if (sectionIdx === 0) {
        setPhase(resume.resume ? PHASES.PARSE_REVIEW : PHASES.UPLOAD);
        return;
      }
      const prevSectionLastFQ = [...flat]
        .reverse()
        .find((fq) => fq.sectionIdx === sectionIdx - 1);
      if (prevSectionLastFQ) {
        setPhase(PHASES.QUESTION);
        setStepIdx(prevSectionLastFQ.globalIdx);
        setSectionIdx(prevSectionLastFQ.sectionIdx);
      }
      return;
    }
    if (phase === PHASES.CELEBRATE) {
      setPhase(PHASES.QUESTION);
      return;
    }
    if (phase === PHASES.REVIEW) {
      if (totalQ > 0) {
        const last = flat[totalQ - 1];
        setPhase(PHASES.QUESTION);
        setStepIdx(totalQ - 1);
        setSectionIdx(last.sectionIdx);
      }
      return;
    }
    if (phase === PHASES.PARSE_REVIEW || phase === PHASES.PARSING) {
      setPhase(PHASES.UPLOAD);
    }
  };

  const canGoBackUniversal =
    [
      PHASES.QUESTION,
      PHASES.SECTION_INTRO,
      PHASES.CELEBRATE,
      PHASES.REVIEW,
      PHASES.PARSE_REVIEW,
      PHASES.PARSING,
    ].includes(phase) &&
    !(
      phase === PHASES.SECTION_INTRO &&
      sectionIdx === 0 &&
      !resume.resume
    );

  const goProfileFrom = () => {
    setPrevPhase(phase);
    setPhase(PHASES.PROFILE);
  };
  const backFromProfile = () => {
    setPhase(prevPhase || PHASES.SECTION_INTRO);
    setPrevPhase(null);
  };

  const handleAnswerChange = (qid, value) => save({ [qid]: value });

  const onUploadedReal = async (uploaded) => {
    const file =
      uploaded?.cv?.file instanceof File
        ? uploaded.cv.file
        : uploaded?.cv instanceof File
          ? uploaded.cv
          : null;
    if (!file) {
      pushToast({
        kind: "error",
        message: "Couldn't read the selected CV file. Try choosing it again.",
      });
      return;
    }
    setPhase(PHASES.PARSING);
    try {
      await resume.upload(file);
    } catch (err) {
      pushToast({
        kind: "error",
        message: err?.message || "Upload failed. Try again.",
      });
      setPhase(PHASES.UPLOAD);
    }
  };

  const onReviewParsed = async (editedFields) => {
    try {
      await resume.applyToApplication();
      if (editedFields && typeof editedFields === "object") {
        const patch = {};
        for (const [k, v] of Object.entries(editedFields)) {
          if (typeof v === "string" && v.trim()) patch[k] = v.trim();
        }
        if (Object.keys(patch).length > 0) save(patch);
      }
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
      if (result?.application_id) navigate("/apply-sip/submitted");
    } catch (err) {
      if (err?.status === 422) {
        const missing = err?.details?.missing_fields || [];
        const invalid = err?.details?.invalid_fields || [];
        const problems = [
          ...missing.map((f) => `${humanizeField(f)} — not filled in`),
          ...invalid.map((x) => `${humanizeField(x.field)} — ${x.reason}`),
        ];
        const shown = problems.slice(0, 3).join("; ");
        const extra = problems.length > 3 ? ` (+${problems.length - 3} more)` : "";
        pushToast({
          kind: "error",
          message: problems.length
            ? `Can't submit yet: ${shown}${extra}`
            : "Some fields need attention before submitting.",
        });
      } else {
        pushToast({
          kind: "error",
          message: err?.message || "Submission failed.",
        });
      }
    }
  };

  // Keyboard shortcut: Enter advances.
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
          if (isAnsweredSip(currentFQ.q, v)) {
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

  const totalSections = SECTIONS_SIP.length;
  const currentSection = currentFQ?.section || SECTIONS_SIP[sectionIdx];
  const progress =
    phase === PHASES.QUESTION ? stepIdx / Math.max(1, totalQ) : 0;
  const estMin = Math.max(1, Math.round((totalQ - stepIdx) * 0.9));
  const warmCopy = true;

  return (
    <div className="eir-root track-sip">
      <div className="eir-bg" />
      <div className="eir-frame">
        <Header
          user={user}
          onLogout={logout}
          onProfile={goProfileFrom}
          phase={phase}
          onHome={() => {
            flushNow();
            setSectionIdx(0);
            setStepIdx(0);
            setPhase(PHASES.RETURNING);
          }}
        />

        {phase === PHASES.SECTION_INTRO && (
          <ProgressBar
            variant="section"
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
          {user && loading && !application && <LoadingScreen />}

          {phase === PHASES.WELCOME && (
            <WelcomeScreen onStart={startWizard} warmCopy={warmCopy} track="sip" />
          )}
          {phase === PHASES.RETURNING && user && (
            <ReturningChoiceScreen
              user={user}
              applicantName={application?.basic_full_name || user?.full_name}
              hasDraft={
                !locked &&
                !!application &&
                Object.keys(answers || {}).length > 0
              }
              draftProgress={
                application && completion
                  ? (completion.completion_pct ?? 0) / 100
                  : 0
              }
              pastSubmissions={(() => {
                const past = (submittedApps || []).map((r) => ({
                  id: r.id,
                  ts: r.submitted_at
                    ? new Date(r.submitted_at).getTime()
                    : Date.now(),
                  cycle: r.cycle || "SIP.2026",
                  projectTitle: r.solution_describe?.slice(0, 80) || "",
                  currentMilestone: r.current_milestone || "submitted",
                  feedback: r.reviewer_feedback || null,
                  answers: collapseFromRowSip(r),
                }));
                if (
                  locked &&
                  application?.submitted_at &&
                  !past.some((p) => p.id === application.id)
                ) {
                  past.unshift({
                    id: application.id,
                    ts: new Date(application.submitted_at).getTime(),
                    cycle: application.cycle || "SIP.2026",
                    projectTitle:
                      application.solution_describe?.slice(0, 80) || "",
                    currentMilestone:
                      application.current_milestone || "submitted",
                    feedback: application.reviewer_feedback || null,
                    answers,
                  });
                }
                return past;
              })()}
              onResume={onResumeDraft}
              onViewPast={onViewPast}
              onStartNew={onStartNew}
              warmCopy={warmCopy}
              track="sip"
            />
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
          {phase === PHASES.PARSE_REVIEW && (
            resume.resume?.parsed_data ? (
              <ParsedReviewScreen
                parsed={buildParsedReviewPayload(
                  resume.resume.parsed_data,
                  user,
                )}
                onContinue={onReviewParsed}
                warmCopy={warmCopy}
                userEmail={user?.email}
              />
            ) : resume.resume?.parse_status === "failed" ? (
              <ParseFailedScreen
                error={resume.resume.parse_error || resume.error?.message}
                onContinue={skipUpload}
                onRetry={() => setPhase(PHASES.UPLOAD)}
              />
            ) : (
              <ParseStillRunningScreen onSkip={skipUpload} />
            )
          )}
          {phase === PHASES.SECTION_INTRO && currentSection && (
            <SectionIntroScreen
              section={currentSection}
              onContinue={() => setPhase(PHASES.QUESTION)}
              onBack={canGoBackUniversal ? goBackUniversal : null}
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
              onAnswerById={handleAnswerChange}
              onNext={goNextQuestion}
              onPrev={goPrevQuestion}
              canPrev={stepIdx > 0}
              warmCopy={warmCopy}
              answers={answers}
              locked={locked}
              saving={saving}
            />
          )}
          {phase === PHASES.EARLY_EXIT && (
            <SipEarlyExitScreen
              answers={answers}
              onChangeAnswer={() => {
                if (
                  answers.sipIncorporated ===
                  "Not yet — we're still pre-incorporation"
                ) {
                  save({ sipIncorporated: null });
                } else if (
                  answers.sipTRL === "TRL 3 or earlier — research stage"
                ) {
                  save({ sipTRL: null });
                }
                setPhase(PHASES.QUESTION);
              }}
              onProceedSip={() => {
                // User wants to keep going on SIP despite the fit warning.
                // Move past the gating question to the next one in the flow.
                const next = flat[stepIdx + 1];
                if (next) {
                  setStepIdx(stepIdx + 1);
                  setSectionIdx(next.sectionIdx);
                }
                setPhase(PHASES.QUESTION);
              }}
            />
          )}
          {phase === PHASES.REVIEW && (
            <ReviewSubmitPanel
              answers={answers}
              completion={completion}
              onSubmit={handleSubmit}
              locked={locked}
              saving={saving}
              onBack={canGoBackUniversal ? goBackUniversal : null}
            />
          )}
          {phase === PHASES.DONE &&
            (() => {
              // Pick the row to render the receipt for, in priority order:
              //   1. A past submission the user explicitly clicked on
              //   2. The most-recent submitted row (submittedApps is desc by
              //      submitted_at on the backend) — this is the freshly-
              //      submitted application after handleSubmit() returns.
              //   3. Fallback to current `application` only if no submission
              //      exists yet (edge case, shouldn't normally render here).
              // Reading from `application` directly broke download/receipt:
              // after submit, the backend creates a new empty draft and
              // GET /sip-applications/me returns it, so `answers` becomes
              // empty and the download showed "(not provided)" everywhere.
              const lastSubmitted =
                Array.isArray(submittedApps) && submittedApps.length > 0
                  ? submittedApps[0]
                  : null;
              const target = viewingApp || lastSubmitted || application;
              if (!target) return null;
              const targetAnswers =
                viewingApp || lastSubmitted
                  ? collapseFromRowSip(viewingApp || lastSubmitted)
                  : answers;
              return (
                <DoneScreen
                  answers={targetAnswers}
                  onRestart={() => navigate("/apply-sip")}
                  submission={{
                    id: target.id,
                    ts: target.submitted_at
                      ? new Date(target.submitted_at).getTime()
                      : Date.now(),
                    currentMilestone: target.current_milestone || "submitted",
                    answers: targetAnswers,
                  }}
                  onBack={() => {
                    setViewingApp(null);
                    navigate("/apply-sip");
                  }}
                  onDownload={() => downloadSipResponses(targetAnswers, target)}
                  questionPrompts={QUESTION_PROMPTS_SIP}
                />
              );
            })()}
          {phase === PHASES.PROFILE && user && (
            <ProfileScreen
              user={user}
              onBack={backFromProfile}
              onUpdate={() => {}}
              onLogout={logout}
            />
          )}
        </main>

        <Footer saving={saving} locked={locked} />
      </div>

      <SupportButton userEmail={user?.email} track="SIP" />
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function buildParsedReviewPayload(parsed, user) {
  const fullName = parsed.full_name || "";
  const email = parsed.email || user?.email || "";
  const phone = parsed.phone || "";
  const latestExperience =
    Array.isArray(parsed.work_experience) && parsed.work_experience.length > 0
      ? parsed.work_experience[0]
      : null;
  const org = latestExperience?.company || parsed.location || "";

  const classifyDegree = (rawStr) => {
    const s = (rawStr || "").toLowerCase();
    if (!s) return null;
    if (
      s.includes("phd") ||
      s.includes("ph.d") ||
      s.includes("doctor") ||
      s.includes("d.phil")
    )
      return "PhD";
    if (
      s.includes("master") ||
      s.includes("msc") ||
      s.includes("m.s") ||
      s.includes("m.tech") ||
      s.includes("mtech") ||
      s.includes("mba")
    )
      return "Master's Degree";
    if (
      s.includes("bachelor") ||
      s.includes("b.tech") ||
      s.includes("btech") ||
      s.includes("bsc") ||
      s.includes("b.sc") ||
      s.includes("b.e.")
    )
      return "Bachelor's Degree";
    return "Self-taught / Other";
  };
  const DEGREE_RANK = {
    PhD: 3,
    "Master's Degree": 2,
    "Bachelor's Degree": 1,
    "Self-taught / Other": 0,
  };
  const eduList = Array.isArray(parsed.education) ? parsed.education : [];
  let degree = "";
  let degreeRaw = "";
  for (const e of eduList) {
    const combined = `${e?.degree || ""} ${e?.field || ""}`;
    const cls = classifyDegree(combined);
    if (cls && (!degree || DEGREE_RANK[cls] > DEGREE_RANK[degree])) {
      degree = cls;
      degreeRaw = combined.trim();
    }
  }

  const confidence = (value, highCertainty) => {
    if (!value) return "low";
    return highCertainty ? "high" : "low";
  };

  return {
    fullName,
    email,
    phone,
    org,
    degree,
    _meta: {
      fullName: { label: "full name", confidence: confidence(fullName, !!parsed.full_name) },
      email: { label: "email", confidence: confidence(email, !!parsed.email) },
      phone: { label: "phone number", confidence: confidence(phone, !!parsed.phone) },
      org: {
        label: "current organization",
        confidence: confidence(org, !!latestExperience?.company),
      },
      degree: {
        label: "highest degree",
        confidence: confidence(degree, degreeRaw.length > 0),
      },
    },
    _order: ["fullName", "email", "phone", "org", "degree"],
  };
}

function LoadingScreen() {
  return (
    <div className="eir-screen">
      <div className="eir-welcome-body">
        <p className="eir-mono eir-dim">loading your application…</p>
      </div>
    </div>
  );
}

function ParseStillRunningScreen({ onSkip }) {
  return (
    <div className="eir-screen">
      <div className="eir-coord eir-mono">
        <span>01 · Professional Profile</span>
        <span>parsing · in progress</span>
      </div>
      <div className="eir-welcome-body">
        <h1 className="eir-welcome-title">Still reading your CV…</h1>
        <p className="eir-welcome-lede">
          Usually 10–30 seconds. You can wait or skip ahead — parsed data flows
          in automatically once it's ready.
        </p>
        <div className="eir-q-actions">
          <button className="eir-btn eir-btn-ghost" onClick={onSkip}>
            <span>Skip — I'll fill it in manually</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ParseFailedScreen({ error, onContinue, onRetry }) {
  return (
    <div className="eir-screen">
      <div className="eir-coord eir-mono">
        <span>01 · Professional Profile</span>
        <span>parsing · couldn't read CV</span>
      </div>
      <div className="eir-welcome-body">
        <h1 className="eir-welcome-title">We couldn't read that CV.</h1>
        <p className="eir-welcome-lede">
          Upload a different file, or continue and fill in manually.
        </p>
        {error && (
          <div className="eir-mono eir-block-reason" style={{ marginTop: "0.5rem" }}>
            ↳ {String(error).slice(0, 200)}
          </div>
        )}
        <div className="eir-q-actions">
          <button className="eir-btn eir-btn-ghost" onClick={onRetry}>
            <span>Upload a different file</span>
          </button>
          <button className="eir-btn eir-btn-primary" onClick={onContinue}>
            <span>Continue — fill in manually</span>
            <span className="eir-btn-key eir-mono">⏎</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function SipEarlyExitScreen({ answers, onChangeAnswer, onProceedSip }) {
  const isPreIncorp =
    answers.sipIncorporated === "Not yet — we're still pre-incorporation";
  return (
    <div className="eir-screen">
      <div className="eir-coord eir-mono">
        <span>sip.2026 / fit check</span>
      </div>
      <div className="eir-welcome-body">
        <h1 className="eir-welcome-title" style={{ maxWidth: "20ch" }}>
          {isPreIncorp
            ? "TIR might be the better fit for you right now."
            : "SIP is calibrated for ventures past the prototype mark."}
        </h1>
        <p className="eir-welcome-lede">
          {isPreIncorp ? (
            <>
              The Startup Incubation Programme is for incorporated Pvt Ltd
              companies translating lab-proven research into a product.{" "}
              <em>Translational Innovation Residency (TIR)</em> is designed
              for founders at your stage — pre-incorporation, working from
              research toward a defensible technology angle.
            </>
          ) : (
            <>
              SIP is built around ventures with a working prototype (TRL 4 and
              beyond) and at least early customer signal. If you're earlier
              than that, the <em>Translational Innovation Residency (TIR)</em>{" "}
              programme is where to look.
            </>
          )}
        </p>
        <p className="eir-welcome-lede">
          Questions? Email{" "}
          <a href="mailto:sip@artpark.in" style={{ color: "var(--accent)" }}>
            sip@artpark.in
          </a>
          .
        </p>
        <div className="eir-q-actions eir-fit-actions">
          <a
            className="eir-btn eir-btn-primary eir-fit-switch"
            href="/apply"
            style={{ textDecoration: "none" }}
          >
            <span>switch to TIR application →</span>
          </a>
          <button
            type="button"
            className="eir-btn eir-btn-fit-proceed"
            onClick={onProceedSip}
          >
            <span className="eir-fit-proceed-main">
              proceed with SIP application
            </span>
            <span className="eir-fit-proceed-sub eir-mono">
              · register within 30 days
            </span>
          </button>
          <button className="eir-btn eir-btn-ghost" onClick={onChangeAnswer}>
            <span>← change my answer</span>
          </button>
        </div>
        <p className="eir-fit-disclaimer eir-mono eir-dim">
          by proceeding, you commit to incorporating a private limited company
          within 30 days of acceptance. proof of incorporation will be
          required before disbursement.
        </p>
      </div>
    </div>
  );
}

function Header({ user, onLogout, onProfile, phase, onHome }) {
  const navigate = useNavigate();
  const onProfilePage = phase === "profile";
  const homeHref = user ? "/apply-sip" : "/";
  const homeLabel = user ? "my application" : "home";
  const onHomeClick = (e) => {
    if (!user) return;
    e.preventDefault();
    if (onHome) onHome();
    else navigate("/apply-sip");
  };
  return (
    <header className="eir-header">
      <div className="eir-header-left">
        <a
          href={homeHref}
          onClick={onHomeClick}
          className="eir-home-link eir-mono"
          title={user ? "Back to my application" : "Back to home"}
        >
          <span className="eir-home-arrow">←</span>
          <span className="eir-home-label">{homeLabel}</span>
        </a>
        <span className="eir-header-sep" />
        <a
          href={homeHref}
          onClick={onHomeClick}
          className="eir-brand"
          title="ARTPARK × IISc"
        >
          <img
            src="/assets/iisc-logo-blue.png"
            alt="Indian Institute of Science"
            className="eir-brand-iisc"
          />
          <img
            src="/assets/artpark-logo.png"
            alt="ARTPARK"
            className="eir-brand-artpark"
          />
        </a>
      </div>
      <div className="eir-header-right">
        <div className="eir-mono eir-dim eir-theme-tag">SIP.2026</div>
        {user && !onProfilePage && (
          <button
            className="eir-header-user eir-mono"
            onClick={onProfile}
            title="Profile settings"
          >
            <span className="eir-header-user-avatar">
              {(user.email?.[0] || "?").toUpperCase()}
            </span>
            <span className="eir-header-user-email">{user.email}</span>
            <span className="eir-header-user-cog">⚙</span>
          </button>
        )}
        {user && (
          <button
            className="eir-chip-btn eir-mono eir-header-logout"
            onClick={onLogout}
            title="Sign out"
          >
            sign out ↗
          </button>
        )}
      </div>
    </header>
  );
}

function Footer({ saving, locked }) {
  if (!saving && !locked) return null;
  if (saving === "idle" && !locked) return null;
  return (
    <footer className="eir-footer eir-footer-slim">
      <div className="eir-footer-left eir-mono eir-dim">
        {saving === "saving" && <span className="eir-save-state">saving…</span>}
        {saving === "saved" && (
          <span className="eir-save-state is-ok">saved ✓</span>
        )}
        {saving === "error" && (
          <span className="eir-save-state is-err">save failed</span>
        )}
        {locked && (
          <span className="eir-save-state is-lock">locked · submitted</span>
        )}
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
  onAnswerById,
  onNext,
  onPrev,
  canPrev,
  warmCopy,
  answers,
  locked,
}) {
  const { q, section, globalIdx } = fq;
  const answered = isAnsweredSip(q, value);
  const blockReason = answered ? null : whyBlockedSip(q, value);
  const inlineChild = findInlineChildSip(q.id);

  let prompt = typeof q.prompt === "function" ? q.prompt(answers) : q.prompt;

  return (
    <div className="eir-screen eir-question" key={globalIdx}>
      <div className="eir-coord eir-mono">
        <span>
          {section.index} · {section.label}
        </span>
        <span>
          q.{(stepIdx + 1).toString().padStart(2, "0")} of {total}
        </span>
      </div>

      <div className="eir-q-body">
        <div className="eir-q-index eir-mono">
          <span className="eir-q-index-num">
            {(stepIdx + 1).toString().padStart(2, "0")}
          </span>
          <span className="eir-q-index-arrow">→</span>
          {q.cvAutoFill && (
            <span className="eir-pill eir-pill-auto">auto-filled from cv</span>
          )}
          {q.optional && <span className="eir-q-optional">optional</span>}
          {q.required && !q.cvAutoFill && (
            <span className="eir-q-required">required</span>
          )}
        </div>

        <h2 className="eir-q-prompt">{prompt}</h2>
        {q.helpItems && q.helpItems.length > 0 && (
          <div className="eir-q-help eir-q-help-list">
            {q.helpIntro && (
              <p className="eir-q-help-intro">
                <strong>{q.helpIntro}</strong>
              </p>
            )}
            <ul>
              {q.helpItems.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {q.help && <p className="eir-q-help">{q.help}</p>}

        <div className="eir-q-input-wrap">
          <SipQuestionInput
            q={q}
            value={value}
            onChange={onChange}
            autoFocus
          />
        </div>

        {inlineChild && (
          <div className="eir-q-inline-attach">
            <div className="eir-q-inline-attach-divider eir-mono">
              {inlineChild.attachLabel || "attachments · optional"}
            </div>
            <SipQuestionInput
              q={inlineChild}
              value={answers[inlineChild.id]}
              onChange={(v) => onAnswerById(inlineChild.id, v)}
            />
          </div>
        )}

        <div className="eir-q-actions">
          {canPrev && (
            <button
              type="button"
              className="eir-btn eir-btn-ghost"
              onClick={onPrev}
            >
              <span>← Back</span>
            </button>
          )}
          <button
            className={`eir-btn ${answered && !locked ? "eir-btn-primary" : "eir-btn-disabled"}`}
            onClick={onNext}
            disabled={!answered || locked}
          >
            <span>{stepIdx === total - 1 ? "Review + submit" : "OK"}</span>
            <span className="eir-btn-key eir-mono">⏎</span>
          </button>
          {locked ? (
            <span className="eir-mono eir-block-reason">
              ↳ application already submitted
            </span>
          ) : answered ? (
            <span className="eir-mono eir-dim">
              or press <kbd>Enter</kbd>
            </span>
          ) : blockReason ? (
            <span className="eir-mono eir-block-reason">↳ {blockReason}</span>
          ) : (
            <span className="eir-mono eir-dim">
              or press <kbd>Enter</kbd>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const QUESTION_PROMPTS_SIP = SECTIONS_SIP.reduce((acc, s) => {
  for (const q of s.questions) {
    if (typeof q.prompt === "string") acc[q.id] = q.prompt;
  }
  return acc;
}, {});

function ReviewSubmitPanel({
  answers,
  completion,
  onSubmit,
  locked,
  saving,
  onBack,
}) {
  const entries = Object.entries(answers)
    .filter(([_, v]) => v !== undefined && v !== null && v !== "")
    .slice(0, 30);
  const incomplete = completion.completion_pct < 100;
  const canSubmit = !locked && saving !== "saving";

  const renderValue = (v) => {
    if (typeof v === "string") return v;
    if (Array.isArray(v))
      return v
        .map((e) =>
          e && typeof e === "object" && e.name
            ? `${e.name}${e.share !== undefined ? ` (${e.share}%)` : ""}`
            : e?.name || JSON.stringify(e),
        )
        .join(", ");
    if (v && typeof v === "object" && v.name) return v.name;
    if (v && typeof v === "object") {
      const labels = { truthful: "Truthful", refChecks: "Reference checks", terms: "Terms accepted", newsletter: "Newsletter" };
      return Object.entries(v)
        .filter(([, val]) => val)
        .map(([key]) => labels[key] || key)
        .join(", ") || "None selected";
    }
    return String(v);
  };

  return (
    <div className="eir-screen eir-done">
      <div className="eir-coord eir-mono">
        <span>ARTPARK / SIP.2026</span>
        <span>review · submit when ready</span>
      </div>
      <div className="eir-done-body">
        <h2 className="eir-done-title">Ready to submit?</h2>
        <p className="eir-done-lede">
          Take one last look — once submitted, you can't edit.
          {incomplete && (
            <>
              {" "}
              You've filled <strong>{completion.completion_pct}%</strong> so
              far. You can still submit — empty fields will be marked "not
              provided" for the reviewer.
            </>
          )}
        </p>

        {completion.missing_required_fields.length > 0 && (
          <div className="eir-done-feedback">
            <div className="eir-mono eir-dim eir-done-feedback-label">
              ↳ still empty (you can still submit)
            </div>
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
          <div className="eir-mono eir-dim eir-done-answers-label">
            ↳ what you've entered
          </div>
          <dl className="eir-done-answers-list">
            {entries.map(([k, v]) => (
              <div key={k} className="eir-done-answer-row">
                <dt className="eir-review-label">
                  {QUESTION_PROMPTS_SIP[k] || k}
                </dt>
                <dd>{renderValue(v)}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="eir-q-actions">
          {onBack && (
            <button
              type="button"
              className="eir-btn eir-btn-ghost"
              onClick={onBack}
            >
              <span>← Back</span>
            </button>
          )}
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

// ─── SIP responses → downloadable text export ───────────────────────
//
// Walks SECTIONS_SIP in display order, prints each visible question's
// prompt + the user's answer (or "(not provided)"). File-upload kinds
// are flattened to a list of original filenames. Renders as plain text
// so it opens in any text editor / email client and prints cleanly.

function formatSipAnswerValue(q, value) {
  if (value === undefined || value === null || value === "") {
    return "(not provided)";
  }
  if (q.kind === "captable" && Array.isArray(value)) {
    return value
      .map(
        (e, i) =>
          `  ${(i + 1).toString().padStart(2, "0")}. ${e?.name || "(unnamed)"} — ${e?.type || ""} · ${e?.share || 0}%`,
      )
      .join("\n");
  }
  if (q.kind === "declarations" && value && typeof value === "object") {
    return q.items
      .map((it) => `  ${value[it.key] ? "[x]" : "[ ]"} ${it.label}`)
      .join("\n");
  }
  if (q.kind === "sipPitchDeck" || q.kind === "sipCapTableFile") {
    if (value && typeof value === "object" && value.name) {
      const kb = value.size ? ` (${Math.round(value.size / 1024)} KB)` : "";
      return `${value.name}${kb}`;
    }
    return "(not provided)";
  }
  if (
    q.kind === "sipPatents" ||
    q.kind === "sipTractionFiles" ||
    q.kind === "milestoneFiles"
  ) {
    if (Array.isArray(value) && value.length > 0) {
      return value
        .map((f) => {
          const kb = f?.size ? ` (${Math.round(f.size / 1024)} KB)` : "";
          return `  • ${f?.name || "(file)"}${kb}`;
        })
        .join("\n");
    }
    return "(no files attached)";
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function buildSipResponsesText(answers, application) {
  const lines = [];
  const submittedDate = application?.submitted_at
    ? new Date(application.submitted_at).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  lines.push("ARTPARK · Startup Incubation Programme 2026");
  lines.push("Application Responses");
  lines.push("");
  lines.push(`Application ID : ${application?.id || "(draft)"}`);
  lines.push(`Submitted on   : ${submittedDate}`);
  if (answers.fullName || answers.basic_full_name) {
    lines.push(`Applicant      : ${answers.fullName || answers.basic_full_name}`);
  }
  if (answers.email || answers.basic_email) {
    lines.push(`Email          : ${answers.email || answers.basic_email}`);
  }
  lines.push("");
  lines.push("=".repeat(72));

  for (const section of SECTIONS_SIP) {
    lines.push("");
    lines.push(`Section ${section.index} · ${section.label}`);
    lines.push("-".repeat(72));
    for (const q of section.questions) {
      if (q.conditional && !q.conditional(answers || {})) continue;
      const promptText =
        typeof q.prompt === "function" ? q.prompt(answers) : q.prompt;
      const answerText = formatSipAnswerValue(q, answers[q.id]);
      lines.push("");
      lines.push(`Q. ${promptText}`);
      lines.push(
        answerText.includes("\n") ? answerText : `A. ${answerText}`,
      );
    }
    lines.push("");
  }

  lines.push("=".repeat(72));
  lines.push("Generated by apply.artpark.info — keep this file for your records.");
  return lines.join("\n");
}

function downloadSipResponses(answers, application) {
  const text = buildSipResponsesText(answers, application);
  const stamp = new Date().toISOString().slice(0, 10);
  const idTail = (application?.id || "draft").toString().slice(0, 8);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `artpark-sip-${stamp}-${idTail}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so Safari/Firefox can finish the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
