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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  ParsedReviewScreen,
  ParsingScreen,
  ReturningChoiceScreen,
  TemplateScreen,
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
import { api } from "./lib/api.js";
import { SECTION_ORDER, collapseFromRow } from "./lib/fieldMap.js";

const PHASES = {
  WELCOME: "welcome",
  // Authed user re-entering /apply with a draft or past submissions — shows
  // the "Good to see you" chooser (Start new / Continue / Past applications).
  RETURNING: "returning",
  UPLOAD: "upload",
  PARSING: "parsing",
  // Post-upload confirmation of parsed CV fields. Distinct from REVIEW
  // (pre-submission summary) so that re-entering REVIEW later doesn't
  // bounce the user back to the CV-review screen when a resume is on file.
  PARSE_REVIEW: "parse_review",
  // Optional offline-template (.docx) download + upload step that lives
  // between section 01 (Basic Details) and section 02 (Problem). Inserted
  // as its own phase so applicants who type in Word/Docs can pre-fill
  // Q9–Q19 before they hit the long-text questions.
  TEMPLATE_UPLOAD: "template_upload",
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
  "Evidence. Show, don't just tell.",
  "Evidence uploaded. Home stretch.",
];

function pickSlug(pathname) {
  const m = pathname.replace(/\/+$/, "").match(/^\/apply(?:\/([^/]*))?$/);
  return m ? (m[1] || "") : null;
}

// Turn a backend column name ("solution_ten_x") into something a human
// wants to read in a toast ("Solution: ten x"). Best-effort — good enough
// for surfacing which field broke submission without cross-referencing
// the questions.jsx title for every field.
function humanizeField(col) {
  if (!col || typeof col !== "string") return "(unknown field)";
  const [section, ...rest] = col.split("_");
  const tail = rest.join(" ");
  const sectionLabel =
    { basic: "Basic info", problem: "Problem", solution: "Solution",
      execution: "Execution", evidence: "Evidence", declaration: "Declaration" }[section] ||
    section;
  return tail ? `${sectionLabel}: ${tail}` : sectionLabel;
}

function urlForState(phase, sectionIdx) {
  if (phase === PHASES.PROFILE) return "/apply/profile";
  if (phase === PHASES.REVIEW) return "/apply/review";
  if (phase === PHASES.DONE) return "/apply/submitted";
  // WELCOME / RETURNING / UPLOAD / PARSING / PARSE_REVIEW all live on /apply
  // so the URL doesn't jitter during the landing + CV flow. The user sees
  // these as one continuous lead-in to the sectioned wizard.
  if (
    phase === PHASES.WELCOME ||
    phase === PHASES.RETURNING ||
    phase === PHASES.UPLOAD ||
    phase === PHASES.PARSING ||
    phase === PHASES.PARSE_REVIEW
  ) {
    return "/apply";
  }
  if (phase === PHASES.SECTION_INTRO || phase === PHASES.QUESTION || phase === PHASES.CELEBRATE) {
    return "/apply/" + (SECTION_ORDER[sectionIdx] || SECTION_ORDER[0]);
  }
  if (phase === PHASES.TEMPLATE_UPLOAD) {
    return "/apply/template";
  }
  return "/apply";
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const urlSyncRef = useRef({ applying: false });

  const { user, logout: rawLogout, loading: authLoading } = useAuth();
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
  } = useApplication();

  // Sign-out has to flush the debounced autosave first. Without this, a
  // user who pastes an answer and immediately clicks "sign out" loses
  // the paste — the 800ms debounce timer never fires (auth flips, the
  // bearer token is cleared, and the queued PATCH dies in flight).
  // Incident 2026-05-22: at least one applicant repeatedly reported a
  // long answer "disappearing" because of this exact race.
  const logout = useCallback(async () => {
    try {
      await flushNow();
    } catch {
      // Don't block sign-out on a save failure — the toast/footer
      // already surfaced the error, and forcing the user to stay
      // signed-in to retry would be worse UX than losing the last edit.
    }
    return rawLogout();
  }, [flushNow, rawLogout]);
  const resume = useResume();
  const { push: pushToast } = useToast();

  const [config, setConfig] = useState(() => window.__eirDefaults);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [phase, setPhase] = useState(PHASES.WELCOME);
  const [sectionIdx, setSectionIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [celebMsg, setCelebMsg] = useState("");
  const [prevPhase, setPrevPhase] = useState(null);
  // Multi-app: which submitted application to display in DoneScreen.
  // Null means "show the current/just-submitted application" (default
  // post-submit). Set by clicking a card on the Past tab.
  const [viewingApp, setViewingApp] = useState(null);

  // Cross-track: now that applicants can submit BOTH tracks, the Past
  // applications tab shows submissions from BOTH TIR and SIP. The TIR
  // hook only returns its own track; we fetch SIP submissions here and
  // merge in the pastSubmissions builder below.
  const [crossTrackSubmitted, setCrossTrackSubmitted] = useState([]);
  useEffect(() => {
    if (!user) {
      setCrossTrackSubmitted([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const sipPast = await api.get("/sip-applications/me/submitted");
        if (!cancelled) {
          setCrossTrackSubmitted(Array.isArray(sipPast) ? sipPast : []);
        }
      } catch {
        // SIP fetch failure is non-fatal — just show TIR-only past list.
        if (!cancelled) setCrossTrackSubmitted([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

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

  // /apply (empty slug) decides what the first screen is:
  //
  //   unauthed                       → WELCOME (public landing, Begin → signin)
  //   authed, submitted              → RETURNING chooser (Past tab pre-selected
  //                                    via ReturningChoiceScreen's defaultTab
  //                                    logic; user clicks the past card to see
  //                                    the receipt at /apply/submitted)
  //   authed, has draft answers      → RETURNING chooser
  //   authed, no draft yet           → UPLOAD (CV upload is the first step)
  //
  // Previously locked users were trapped on PHASES.DONE — they had no way
  // back to a dashboard view of their submission. Routing them to RETURNING
  // gives them the central "Start new / Continue / Past applications" view
  // they expect when they come back after submitting.
  //
  // We can't decide until both auth rehydrate AND application fetch have
  // resolved. `authLoading` covers the first; waiting for `application` to
  // be non-null (or for the user to be null) covers the second.
  useEffect(() => {
    const slug = pickSlug(location.pathname);
    if (slug !== "") return;
    if (authLoading) return;

    // Unauthed visitors land on the welcome screen.
    if (!user) {
      setPhase(PHASES.WELCOME);
      return;
    }
    // Authed but application hasn't finished loading yet.
    if (!application) return;

    if (locked) {
      setPhase(PHASES.RETURNING);
      return;
    }
    const hasAny = answers && Object.keys(answers).length > 0;
    // `?direct=1` is set by the unified TIR/SIP track chooser when a
    // user crosses tracks (e.g. clicks the TIR card while on /apply-sip).
    // The chooser already captured the founder's track intent, so the
    // per-track RETURNING screen here is redundant — drop them straight
    // into the wizard instead.
    const params = new URLSearchParams(location.search);
    if (params.get("direct") === "1") {
      setSectionIdx(0);
      setStepIdx(0);
      setPhase(hasAny ? PHASES.SECTION_INTRO : PHASES.UPLOAD);
      return;
    }
    setPhase(hasAny ? PHASES.RETURNING : PHASES.UPLOAD);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, application, locked]);

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

  // While we're on the PARSING screen, advance to PARSE_REVIEW the moment
  // the backend's parse_status reaches a terminal state. The ParsingScreen
  // itself no longer self-advances — that was bug #1 in the "stale CV
  // data" report (animation finished in 4s; backend parse takes longer;
  // PARSE_REVIEW rendered with the *previous* session's resume.parsed_data
  // before the new upload returned).
  useEffect(() => {
    if (phase !== PHASES.PARSING) return;
    const status = resume.resume?.parse_status;
    if (status === "completed" || status === "failed") {
      setPhase(PHASES.PARSE_REVIEW);
    }
  }, [phase, resume.resume?.parse_status]);

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
  //
  // Clicking "Begin application" on the welcome screen can mean three things
  // depending on state:
  //   unauthed              → go to signin (preserves ?next=/apply)
  //   authed, CV uploaded   → straight to first section
  //   authed, no CV         → CV upload flow
  //
  // ReturningChoiceScreen has its own "Begin new" / "Resume" / "View past"
  // buttons, handled below in onStartNew / onResumeDraft / onViewPast.
  const startWizard = () => {
    if (!user) {
      navigate("/apply/signin?next=%2Fapply", { replace: false });
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

  // ReturningChoiceScreen handlers. The screen shows three tabs; each tab's
  // primary action hits one of these.
  const onStartNew = async () => {
    // Multi-app: if the current `application` is a submitted row (locked),
    // ask the backend for a fresh draft. The partial-unique index means
    // GET /me will auto-create one when no draft exists, so a single
    // refetch is enough. For an already-empty draft (locked=false) we
    // skip the round-trip and just walk the user through upload again.
    if (locked) {
      try {
        await startNew();
      } catch {
        /* error already captured in hook state; let the UI surface it */
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
    // Multi-app: each card carries an `id` matching a row in submittedApps.
    // Look up the full DB row so DoneScreen can render that specific
    // submission's data, not the current draft. If no match (e.g. just-
    // submitted flow with no entry passed), fall back to the live row.
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
    flushNow();
    if (stepIdx > 0) {
      const prev = flat[stepIdx - 1];
      setStepIdx(stepIdx - 1);
      setSectionIdx(prev.sectionIdx);
    }
  };

  // Back-navigation that works from any phase of the wizard, not just
  // question pages. Maps each phase to its sensible "previous" target so
  // users never hit a dead back-button.
  const goBackUniversal = () => {
    flushNow();
    if (phase === PHASES.QUESTION) {
      // First question of the whole wizard → drop back to that section's intro.
      if (stepIdx === 0) {
        setPhase(PHASES.SECTION_INTRO);
        return;
      }
      const prev = flat[stepIdx - 1];
      // Crossing a section boundary — show the CELEBRATE screen for the
      // section we're leaving (same as forward flow, mirrored).
      if (prev.sectionIdx !== sectionIdx) {
        setPhase(PHASES.QUESTION);
      }
      setStepIdx(stepIdx - 1);
      setSectionIdx(prev.sectionIdx);
      return;
    }
    if (phase === PHASES.SECTION_INTRO) {
      // Section 1 intro → back to the CV parse-review (if resume on file)
      //   otherwise to the upload screen. Section 2 intro → back to the
      //   offline-template page (which sits between sections 01 and 02).
      //   Section N intro (N>2) → back to the last question of N-1.
      if (sectionIdx === 0) {
        setPhase(resume.resume ? PHASES.PARSE_REVIEW : PHASES.UPLOAD);
        return;
      }
      if (sectionIdx === 1) {
        setPhase(PHASES.TEMPLATE_UPLOAD);
        return;
      }
      const prevSectionLastFQ = [...flat].reverse().find((fq) => fq.sectionIdx === sectionIdx - 1);
      if (prevSectionLastFQ) {
        setPhase(PHASES.QUESTION);
        setStepIdx(prevSectionLastFQ.globalIdx);
        setSectionIdx(prevSectionLastFQ.sectionIdx);
      }
      return;
    }
    if (phase === PHASES.TEMPLATE_UPLOAD) {
      // Mirror the TemplateScreen's own back button: drop into the last
      // question of section 0 so the user can re-edit basic info.
      const lastBasicIdx = flat.findIndex(
        (f, i, arr) =>
          f.sectionIdx === 0 && (i === arr.length - 1 || arr[i + 1].sectionIdx !== 0),
      );
      if (lastBasicIdx >= 0) {
        setSectionIdx(0);
        setStepIdx(lastBasicIdx);
        setPhase(PHASES.QUESTION);
      }
      return;
    }
    if (phase === PHASES.CELEBRATE) {
      // Mid-wizard celebration → back to the last question of the just-finished section.
      setPhase(PHASES.QUESTION);
      return;
    }
    if (phase === PHASES.REVIEW) {
      // From review → last question.
      if (totalQ > 0) {
        const last = flat[totalQ - 1];
        setPhase(PHASES.QUESTION);
        setStepIdx(totalQ - 1);
        setSectionIdx(last.sectionIdx);
      }
      return;
    }
    if (phase === PHASES.PARSE_REVIEW) {
      setPhase(PHASES.UPLOAD);
      return;
    }
    if (phase === PHASES.PARSING) {
      setPhase(PHASES.UPLOAD);
      return;
    }
  };

  // Back button is available on any wizard phase that has a sensible
  // predecessor. Welcome / Returning / Upload / Done / Profile all have
  // their own nav (or are the starting point), so no back button there.
  const canGoBackUniversal = [
    PHASES.QUESTION,
    PHASES.SECTION_INTRO,
    PHASES.CELEBRATE,
    PHASES.REVIEW,
    PHASES.PARSE_REVIEW,
    PHASES.PARSING,
  ].includes(phase) && !(phase === PHASES.SECTION_INTRO && sectionIdx === 0 && !resume.resume);

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
    // UploadScreen passes { cv: { name, size, file }, linkedin, github }.
    // Legacy shape was { cv: File } directly; handle both.
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
      // Once the backend parse completes, resume.parsed ends up populated via
      // the poll loop; the PARSING screen's onDone callback then advances to
      // PARSE_REVIEW. If parsing fails, resume.error is set and we still move
      // along — PARSE_REVIEW's render branch shows null parsed_data gracefully.
    } catch (err) {
      pushToast({
        kind: "error",
        message: err?.message || "Upload failed. Try again.",
      });
      // Back out of parsing since nothing is actually parsing.
      setPhase(PHASES.UPLOAD);
    }
  };

  const onReviewParsed = async (editedFields) => {
    try {
      // Step 1: backend copies parsed_data → applications row for any
      // currently-NULL columns. Catches the case where the user didn't
      // touch a field but the parser DID extract a value.
      await resume.applyToApplication();
      // Step 2: persist the user's actual edits from the review screen.
      // applyToApplication only fills NULL columns, so without this step
      // any change the user made on the review screen would be silently
      // dropped. Filter to non-empty so we don't overwrite the parsed
      // values with blanks.
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
    // Pre-flight: resume_file_id is required at submit time (migration 019).
    // Block here with a clear message so applicants don't see a cryptic 422
    // from the backend; the wizard's completion meter alone doesn't reflect
    // this requirement.
    if (!application?.resume_file_id) {
      pushToast({
        kind: "error",
        message:
          "Please upload your CV/resume before submitting. The upload step is in section 01 — Basic Details.",
        ttlMs: 12000,
      });
      return;
    }
    try {
      const result = await submit();
      pushToast({ kind: "info", message: "Submitted. Good luck!" });
      if (result?.application_id) {
        navigate("/apply/submitted");
      }
    } catch (err) {
      if (err?.status === 409 && err?.code === "cross_track_submission_blocked") {
        pushToast({
          kind: "error",
          message:
            err?.message ||
            "You've already submitted a SIP application. Each applicant can submit to only one track.",
          ttlMs: 12000,
        });
      } else if (err?.status === 422) {
        // Backend shape: { error: {...}, missing_fields: [...], invalid_fields: [{field, reason}] }
        // api.js already merges these into err.details. Surface the actual
        // field names so the user knows *what* to fix — a vague "some fields
        // need attention" makes people think the button is broken.
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
          onHome={() => {
            // 'MY APPLICATION' button — should always land the user on
            // the welcome/returning page (the tabbed 'Good to see you'
            // screen), not just nav to /apply (which leaves the phase
            // state untouched, so e.g. clicking from UPLOAD does
            // nothing visible).
            flushNow();
            setSectionIdx(0);
            setStepIdx(0);
            setPhase(PHASES.RETURNING);
          }}
        />

        {/* Section progress only on the section-intro hand-off — gives the
            applicant a sense of where they are in the 6-section arc without
            cluttering every question screen (which has its own §/Q.NN line). */}
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
          {/* Loading only blocks when we're authed and waiting for data.
              Unauthed visitors should see WELCOME immediately. */}
          {user && loading && !application && <LoadingScreen />}

          {phase === PHASES.WELCOME && (
            <WelcomeScreen onStart={startWizard} warmCopy={warmCopy} />
          )}
          {phase === PHASES.RETURNING && user && (
            <ReturningChoiceScreen
              user={user}
              applicantName={application?.basic_full_name}
              hasDraft={!locked && !!application && Object.keys(answers || {}).length > 0}
              draftProgress={
                application && completion
                  ? (completion.completion_pct ?? 0) / 100
                  : 0
              }
              pastSubmissions={
                // Multi-app: build the Past tab list from submittedApps
                // (every non-draft row the user owns), newest-first. Each
                // entry maps to ReturningChoiceScreen's expected shape:
                // {id, ts, cycle, projectTitle, currentMilestone, answers}.
                // The current `application` is only included if it's a
                // just-submitted row that hasn't yet been pulled into the
                // submittedApps cache (post-submit refresh races).
                (() => {
                  const past = (submittedApps || []).map((r) => ({
                    id: r.id,
                    ts: r.submitted_at
                      ? new Date(r.submitted_at).getTime()
                      : Date.now(),
                    cycle: r.cycle || "TIR.2026",
                    projectTitle: r.solution_describe?.slice(0, 80) || "",
                    currentMilestone: r.current_milestone || "submitted",
                    feedback: r.reviewer_feedback || null,
                    answers: collapseFromRow(r),
                  }));
                  // Append cross-track SIP submissions (both-track allowed
                  // post 2026-05-26). Sort newest-first across both.
                  (crossTrackSubmitted || []).forEach((r) => {
                    past.push({
                      id: r.id,
                      ts: r.submitted_at
                        ? new Date(r.submitted_at).getTime()
                        : Date.now(),
                      cycle: r.cycle || "SIP.2026",
                      projectTitle: r.solution_describe?.slice(0, 80) || "",
                      currentMilestone: r.current_milestone || "submitted",
                      feedback: r.reviewer_feedback || null,
                      // SIP rows can't be opened from the TIR DoneScreen
                      // (different field shape); leave answers empty so the
                      // card renders as info-only with a clear cycle badge.
                      answers: {},
                    });
                  });
                  past.sort((a, b) => b.ts - a.ts);
                  if (
                    locked &&
                    application?.submitted_at &&
                    !past.some((p) => p.id === application.id)
                  ) {
                    past.unshift({
                      id: application.id,
                      ts: new Date(application.submitted_at).getTime(),
                      cycle: application.cycle || "TIR.2026",
                      projectTitle:
                        application.solution_describe?.slice(0, 80) || "",
                      currentMilestone:
                        application.current_milestone || "submitted",
                      feedback: application.reviewer_feedback || null,
                      answers,
                    });
                  }
                  return past;
                })()
              }
              onResume={onResumeDraft}
              onViewPast={onViewPast}
              onStartNew={onStartNew}
              warmCopy={warmCopy}
              track="tir"
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
            // Priority order matters here: a successful parse takes precedence
            // over any transient "still loading" / error signal so the user
            // never sees a spurious failure screen flash before the results
            // render. ParseFailedScreen is *only* shown when the backend has
            // actually stamped parse_status=failed OR we caught a direct
            // upload-time error — NOT when parsed_data simply hasn't arrived
            // yet (that's "still running").
            resume.resume?.parsed_data ? (
              <ParsedReviewScreen
                parsed={buildParsedReviewPayload(resume.resume.parsed_data, user)}
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
              // Default while we wait for the poll to resolve — covers
              // parsing/processing/pending/unknown states. Never misleading.
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
              onContinue={() => {
                // Slot the offline-template step in between section 01
                // (basic details) and section 02 (problem). Every other
                // section transition goes straight to the next intro.
                if (sectionIdx === 1) {
                  setPhase(PHASES.TEMPLATE_UPLOAD);
                } else {
                  setPhase(PHASES.SECTION_INTRO);
                }
              }}
            />
          )}
          {phase === PHASES.TEMPLATE_UPLOAD && (
            <TemplateScreen
              onContinue={() => setPhase(PHASES.SECTION_INTRO)}
              onBack={() => {
                // Backtrack to the last basic-section question.
                const lastBasicIdx = flat.findIndex(
                  (f, i, arr) =>
                    f.sectionIdx === 0 &&
                    (i === arr.length - 1 || arr[i + 1].sectionIdx !== 0),
                );
                if (lastBasicIdx >= 0) {
                  setSectionIdx(0);
                  setStepIdx(lastBasicIdx);
                  setPhase(PHASES.QUESTION);
                } else {
                  setPhase(PHASES.SECTION_INTRO);
                }
              }}
              onTemplateApplied={async () => {
                await refetch();
                pushToast({ kind: "info", message: "Pre-filled from your template." });
              }}
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
              onBack={canGoBackUniversal ? goBackUniversal : null}
            />
          )}
          {phase === PHASES.DONE && (() => {
            const lastSubmitted =
              Array.isArray(submittedApps) && submittedApps.length > 0
                ? submittedApps[0]
                : null;
            // Only fall back to the live row if it's actually been submitted
            // — otherwise a draft user landing on /apply/submitted (refresh,
            // stale link) sees their draft rendered as a past submission.
            const safeApp =
              application && application.status === "submitted" ? application : null;
            const target = viewingApp || lastSubmitted || safeApp;
            if (!target) return null;
            const targetAnswers =
              viewingApp || lastSubmitted
                ? collapseFromRow(viewingApp || lastSubmitted)
                : answers;
            return (
              <DoneScreen
                answers={targetAnswers}
                onRestart={() => navigate("/apply")}
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
                  navigate("/apply");
                }}
                questionPrompts={QUESTION_PROMPTS}
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

// Shape the backend's ParsedResumeSchema → the ParsedReviewScreen's expected
// props ({fullName, email, phone, org, degree, _meta, _order}). Every field
// referenced in _order MUST have a _meta entry with a `confidence` string
// or the component dereferences `undefined.confidence` and crashes.
function buildParsedReviewPayload(parsed, user) {
  const fullName = parsed.full_name || "";
  const email = parsed.email || user?.email || "";
  const phone = parsed.phone || "";
  // LLM returns `location` as a freeform string (e.g. "Bangalore, India") AND
  // separately provides structured `work_experience` / `ventures`. For the
  // "current organization" field, prefer the most recent employer; fall back
  // to `location`.
  const latestExperience =
    Array.isArray(parsed.work_experience) && parsed.work_experience.length > 0
      ? parsed.work_experience[0]
      : null;
  const org = latestExperience?.company || parsed.location || "";

  // Map the education list to one of our four degree options. Previous
  // logic only looked at education[0], which gave wrong answers when the
  // resume listed entries oldest-first (Bachelor's before Master's). Now
  // we scan every entry and return the highest rank found.
  const classifyDegree = (rawStr) => {
    const s = (rawStr || "").toLowerCase();
    if (!s) return null;
    if (s.includes("phd") || s.includes("ph.d") || s.includes("doctor") || s.includes("d.phil")) return "PhD";
    if (
      s.includes("master") || s.includes("msc") || s.includes("m.s") ||
      s.includes("m.tech") || s.includes("mtech") || s.includes("mba") ||
      s.includes("m.e.") || s.includes("m.a.") || s.includes("post-graduate") || s.includes("postgraduate")
    ) return "Master's Degree";
    if (
      s.includes("bachelor") || s.includes("b.tech") || s.includes("btech") ||
      s.includes("bsc") || s.includes("b.sc") || s.includes("b.e.") ||
      s.includes("b.a.") || s.includes("b.com") || s.includes("undergrad")
    ) return "Bachelor's Degree";
    return "Self-taught / Other";
  };
  const DEGREE_RANK = { "PhD": 3, "Master's Degree": 2, "Bachelor's Degree": 1, "Self-taught / Other": 0 };
  const eduList = Array.isArray(parsed.education) ? parsed.education : [];
  // Classify every education entry (degree + field combined so e.g. a row
  // with degree="Master of Science" and field="Computer Science" is still
  // recognised, and a row with degree="B.Tech" followed by "M.Tech in AI"
  // correctly picks M.Tech).
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
          OpenRouter is working through it — usually 10–30 seconds. You can
          wait here or skip ahead and fill the basics in manually; parsed
          data will flow in automatically once it's ready.
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
          Something went sideways in the parse step. You can upload a
          different file or continue and fill the form in manually.
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

function Header({ config, user, onLogout, onProfile, phase, onHome }) {
  const theme = THEMES[config.theme] || THEMES.minimal;
  const onProfilePage = phase === "profile";
  const navigate = useNavigate();
  // Authed users get an in-app link to their dashboard; anon users go to
  // the ARTPARK programs landing (which fans out to TIR or SIP). The brand
  // mark mirrors that — clicking it shouldn't dump a logged-in applicant
  // out to the public site.
  const homeHref = user ? "/apply" : "/";
  const homeLabel = user ? "my application" : "home";
  const onHomeClick = (e) => {
    if (!user) return; // anon: let the browser follow the / → programs.html rewrite
    e.preventDefault();
    // Ask App.jsx to reset the phase machine to the welcome/returning
    // tabs screen. Without this, navigating to /apply when we're
    // already on /apply has no visible effect — the phase state
    // persists, so the upload screen / wizard step stays mounted.
    if (onHome) onHome();
    else navigate("/apply");
  };
  return (
    <header className="eir-header">
      <div className="eir-header-left">
        <a href={homeHref} onClick={onHomeClick} className="eir-home-link eir-mono" title={user ? "Back to my application" : "Back to home"}>
          <span className="eir-home-arrow">←</span>
          <span className="eir-home-label">{homeLabel}</span>
        </a>
        <span className="eir-header-sep" />
        <a href={homeHref} onClick={onHomeClick} className="eir-brand" title="ARTPARK × IISc">
          <img src="/assets/iisc-logo-blue.png" alt="Indian Institute of Science" className="eir-brand-iisc" />
          <img src="/assets/artpark-logo.png" alt="ARTPARK" className="eir-brand-artpark" />
        </a>
      </div>
      <div className="eir-header-right">
        <div className="eir-mono eir-dim eir-theme-tag">TIR.2026</div>
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

// Footer was a full row with `q.NN/NN`, save state, a back button, and
// "press ⏎ to continue". The back button + Enter hint duplicated affordances
// already on the question screen and felt like UI clutter. This shrinks the
// footer to just the save/lock indicator (an unobtrusive bottom-left line),
// which is genuinely useful and doesn't compete with the question.
function Footer({ saving, locked }) {
  if (!saving && !locked) return null;
  if (saving === "idle" && !locked) return null;
  return (
    <footer className="eir-footer eir-footer-slim">
      <div className="eir-footer-left eir-mono eir-dim">
        {saving === "saving" && <span className="eir-save-state">saving…</span>}
        {saving === "saved" && <span className="eir-save-state is-ok">saved ✓</span>}
        {saving === "error" && <span className="eir-save-state is-err">save failed</span>}
        {locked && <span className="eir-save-state is-lock">locked · submitted</span>}
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
  onPrev,
  canPrev,
  warmCopy,
  answers,
  locked,
}) {
  const { q, section, globalIdx } = fq;
  const answered = isAnswered(q, value);
  const blockReason = answered ? null : whyBlocked(q, value);
  const name = (answers.fullName || "").split(" ")[0];

  // Some prompts are functions (a) => "OK ${first} — ..." so they can
  // greet the applicant by name. Resolve them here, otherwise React
  // renders the function reference and the prompt disappears.
  let prompt = typeof q.prompt === "function" ? q.prompt(answers) : q.prompt;
  if (warmCopy && name) {
    if (q.id === "phone") prompt = `Thanks, ${name}. A phone number we can reach you on?`;
    if (q.id === "stage") prompt = `${name}, how far along are you?`;
    // problemDefined intentionally not overridden — the spec wording
    // ("Do you think the problem you want to solve is well-defined?")
    // already reads like a friendly question; rewriting it to "OK <name>
    // — is the problem ..." dropped the "Do you think" framing.
  }

  return (
    <div className="eir-screen eir-question" key={globalIdx}>
      <div className="eir-coord eir-mono">
        <span>{section.index} · {section.label}</span>
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
        {q.helpItems && q.helpItems.length > 0 && (
          <div className="eir-q-help eir-q-help-list">
            {q.helpIntro && <p className="eir-q-help-intro"><strong>{q.helpIntro}</strong></p>}
            <ul>
              {q.helpItems.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {q.help && <p className="eir-q-help">{q.help}</p>}

        <div className="eir-q-input-wrap">
          <QuestionInput q={q} value={value} onChange={onChange} autoFocus />
        </div>

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

// Flat lookup: question-id → its prompt string. Built once from SECTIONS so
// the review panel can show "Do you have a co-founder or team?" instead of
// the bare answer key "hasTeam" (which renders as "hasteam" under mono).
const QUESTION_PROMPTS = SECTIONS.reduce((acc, s) => {
  for (const q of s.questions) {
    if (typeof q.prompt === "string") {
      acc[q.id] = q.prompt;
    } else if (typeof q.prompt === "function") {
      // Dynamic prompts — call with empty answers to get a generic label
      try { acc[q.id] = q.prompt({}); } catch { acc[q.id] = q.id; }
    }
  }
  return acc;
}, {});

function ReviewSubmitPanel({ answers, completion, onSubmit, locked, saving, onBack }) {
  const renderValue = (v) => {
    if (typeof v === "string") return v;
    if (Array.isArray(v))
      return v
        .map((e) =>
          e && typeof e === "object" && e.name
            ? `${e.name}${e.share !== undefined ? ` (${e.share}%)` : ""}`
            : e?.name || e?.original_name || String(e),
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
  const entries = Object.entries(answers)
    .filter(([_, v]) => {
      if (v === undefined || v === null || v === "") return false;
      if (Array.isArray(v) && v.length === 0) return false;
      return true;
    })
    .slice(0, 30);
  // Submission is allowed at any completion %; the missing-fields list
  // and the percentage hint are purely informational. Only block while
  // a save is in flight (so we don't race against the debounced PATCH)
  // or once the row is already submitted.
  const incomplete = completion.completion_pct < 100;
  const canSubmit = !locked && saving !== "saving";

  return (
    <div className="eir-screen eir-done">
      <div className="eir-coord eir-mono">
        <span>ARTPARK / TIR.2026</span>
        <span>review · submit when ready</span>
      </div>
      <div className="eir-done-body">
        <h2 className="eir-done-title">Ready to submit?</h2>
        <p className="eir-done-lede">
          Take one last look — once submitted, you can't edit.
          {incomplete && (
            <> You've filled <strong>{completion.completion_pct}%</strong> so far. You can still submit — empty fields will be marked "not provided" for the reviewer.</>
          )}
        </p>

        {completion.missing_required_fields.length > 0 && (
          <div className="eir-done-feedback">
            <div className="eir-mono eir-dim eir-done-feedback-label">↳ still empty (you can still submit)</div>
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
                <dt className="eir-review-label">{QUESTION_PROMPTS[k] || k}</dt>
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
