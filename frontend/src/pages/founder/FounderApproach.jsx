// The Approach tab — 6-step onboarding wizard (Welcome / Mentors /
// Experiments / Workplan / Timeline / Review). Faithful port of
// TIR Onboarding.dc.html's showWelcome/showMentors/showExperiments/
// showWorkplan/showTimeline/showReview blocks + the Component class's
// go()/next()/back()/addEx()/addTask()/submit() handlers.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { founderApi } from "../../lib/founderApi.js";
import { useAuth } from "../../hooks/useAuth.jsx";
import { Loading, ErrorState } from "./ui.jsx";
import Stepper from "./components/Stepper.jsx";
import ExperimentCard from "./components/ExperimentCard.jsx";
import MentorCard from "./components/MentorCard.jsx";
import Gantt from "./components/Gantt.jsx";

const STEP_LABELS = ["Welcome", "Mentors", "Experiments", "Workplan", "Timeline", "Review"];
const TOTAL_STEPS = STEP_LABELS.length;
// Mirrors the mockup's submit(): setTimeout(..., 2600) before the plan
// flips from "pending" to "approved".
const REVIEW_ADVANCE_DELAY_MS = 2600;

export default function FounderApproach() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const firstName = (user?.full_name || "").trim().split(/\s+/)[0] || "Founder";

  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [experiments, setExperiments] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [mentors, setMentors] = useState(null);
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    Promise.all([
      founderApi.getExperiments(),
      founderApi.getTasks(),
      founderApi.getMentors(),
      founderApi.getReview(),
    ])
      .then(([ex, tk, mn, rv]) => {
        setExperiments(ex || []);
        setTasks(tk || []);
        setMentors(mn || []);
        setReview(rv || { status: "draft" });
      })
      .catch(setError);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const go = useCallback((i) => {
    const clamped = Math.max(0, Math.min(TOTAL_STEPS - 1, i));
    setStep(clamped);
    setFurthest((f) => Math.max(f, clamped));
  }, []);
  const next = () => go(step + 1);
  const back = () => go(step - 1);

  // ---- experiments (step 2 · Experiments, step 4 · Timeline) ----
  const updateExperiment = useCallback((id, field, value) => {
    setExperiments((prev) => (prev || []).map((e) => (e.id === id ? { ...e, [field]: value } : e)));
    founderApi.patchExperiment(id, { [field]: value }).catch((err) => setActionError(err));
  }, []);
  const removeExperiment = useCallback((id) => {
    setExperiments((prev) => (prev || []).filter((e) => e.id !== id));
    founderApi.delExperiment(id).catch((err) => setActionError(err));
  }, []);
  const addExperiment = useCallback(async (track) => {
    try {
      const row = await founderApi.addExperiment(track);
      setExperiments((prev) => [...(prev || []), row]);
    } catch (err) {
      setActionError(err);
    }
  }, []);

  // ---- tasks (step 3 · Workplan) ----
  const updateTask = useCallback((id, field, value) => {
    setTasks((prev) => (prev || []).map((t) => (t.id === id ? { ...t, [field]: value } : t)));
    founderApi.patchTask(id, { [field]: value }).catch((err) => setActionError(err));
  }, []);
  const removeTask = useCallback((id) => {
    setTasks((prev) => (prev || []).filter((t) => t.id !== id));
    founderApi.delTask(id).catch((err) => setActionError(err));
  }, []);
  const addTask = useCallback(async () => {
    try {
      const firstExpId = (experiments && experiments[0] && experiments[0].id) || null;
      const row = await founderApi.addTask({
        task: "", exp_id: firstExpId, owner: "", effort: 1, status: "todo",
      });
      setTasks((prev) => [...(prev || []), row]);
    } catch (err) {
      setActionError(err);
    }
  }, [experiments]);

  // ---- review (step 5) ----
  const submit = useCallback(async () => {
    try {
      const row = await founderApi.submitReview();
      setReview(row);
      timerRef.current = setTimeout(async () => {
        try {
          const approved = await founderApi.advanceReview();
          setReview(approved);
        } catch (err) {
          setActionError(err);
        }
      }, REVIEW_ADVANCE_DELAY_MS);
    } catch (err) {
      setActionError(err);
    }
  }, []);
  const goDashboard = () => navigate("/founder/dashboard");

  if (error) return <ErrorState error={error} />;
  const loaded = experiments && tasks && mentors && review;
  if (!loaded) return <Loading label="Loading your onboarding…" />;

  const technicalExperiments = experiments.filter((e) => e.track !== "commercial");
  const commercialExperiments = experiments.filter((e) => e.track === "commercial");
  const rankOf = (exp) => {
    if (exp.track === "commercial") {
      return "C" + (commercialExperiments.findIndex((e) => e.id === exp.id) + 1);
    }
    return "T" + (technicalExperiments.findIndex((e) => e.id === exp.id) + 1);
  };
  const expOptions = experiments.map((e) => ({ id: e.id, label: rankOf(e) }));
  const maxEnd = experiments.length
    ? Math.max(...experiments.map((e) => (e.start_week || 1) + (e.weeks || 1) - 1))
    : 1;

  const doneCount = Math.min(furthest + 1, TOTAL_STEPS);

  return (
    <div className="fj-onboarding">
      <Stepper
        steps={STEP_LABELS}
        current={step}
        furthest={furthest}
        onGo={go}
        eyebrow="Onboarding · Technology Innovator in Residence"
        progressLabel={`${doneCount} of ${TOTAL_STEPS} steps`}
      />

      {actionError && (
        <div className="fj-inline-error" role="alert">
          {actionError?.message || "Something went wrong saving that change."}
        </div>
      )}

      <div className="fj-wizard-body">
        {step === 0 && <WelcomeStep name={firstName} onNext={next} />}

        {step === 1 && <MentorsStep mentors={mentors} onBack={back} onNext={next} />}

        {step === 2 && (
          <ExperimentsStep
            technical={technicalExperiments}
            commercial={commercialExperiments}
            rankOf={rankOf}
            onChange={updateExperiment}
            onRemove={removeExperiment}
            onAdd={addExperiment}
            onBack={back}
            onNext={next}
          />
        )}

        {step === 3 && (
          <WorkplanStep
            tasks={tasks}
            expOptions={expOptions}
            onChange={updateTask}
            onRemove={removeTask}
            onAdd={addTask}
            onBack={back}
            onNext={next}
          />
        )}

        {step === 4 && (
          <TimelineStep
            experiments={experiments}
            onUpdate={updateExperiment}
            onBack={back}
            onNext={next}
          />
        )}

        {step === 5 && (
          <ReviewStep
            review={review}
            mentors={mentors}
            summaryExperiments={experiments.length}
            summaryTasks={tasks.length}
            summarySpan={`Wk 1–${maxEnd}`}
            onBack={back}
            onSubmit={submit}
            onGoDashboard={goDashboard}
          />
        )}
      </div>
    </div>
  );
}

// ============ STEP 0 · WELCOME ============
function WelcomeStep({ name, onNext }) {
  return (
    <div className="fj-wizard">
      <span className="eyebrow eyebrow-rule">Technology Innovator in Residence</span>
      <h1 className="fj-h1 lg">Welcome to your residency, <span className="hl">{name}</span>.</h1>
      <p className="fj-help lg">
        Over the next six months you'll de-risk your venture along two parallel tracks — the
        technical feasibility of your hardest engineering, and the commercial desirability of
        what you're building. The goal at month 6 isn't a finished product or a fundable company.
        It's a venture where enough of the right risks have been retired to justify the next
        tranche of time and capital.
      </p>

      <div className="fj-welcome-cards">
        <div className="card card-purple fj-welcome-card">
          <span className="eyebrow" style={{ color: "#aafcf0" }}>How the program works</span>
          <h3 style={{ color: "#fff" }}>A mentor-led, funded residency at ARTPARK.</h3>
          <ul className="fj-arrow-list">
            <li><span className="fj-arrow">→</span><span>Six months at ARTPARK with a <strong>₹25L non-dilutive</strong> expense account — you keep 100% of your equity.</span></li>
            <li><span className="fj-arrow">→</span><span>A pod of <strong>deeply technical mentors</strong> who coach you weekly and hold sign-off at each stage gate.</span></li>
            <li><span className="fj-arrow">→</span><span>The program sets a fixed <strong>evidence bar</strong>. Mentors coach toward it — they don't negotiate it down.</span></li>
            <li><span className="fj-arrow">→</span><span>Bench, sensor and clinical-partner access you couldn't afford alone.</span></li>
          </ul>
        </div>

        <div className="card fj-welcome-card" style={{ borderColor: "var(--line-strong)" }}>
          <span className="eyebrow" style={{ color: "var(--artblue)" }}>Two parallel stacks</span>
          <h3>De-risk the science and the market — together.</h3>
          <div className="fj-stack-grid">
            <div className="fj-stack-col tech">
              <div className="fj-stack-title">Technical feasibility</div>
              <div className="fj-stack-desc">The subsystems and physics most likely to fail — ranked by cost to find out.</div>
            </div>
            <div className="fj-stack-col comm">
              <div className="fj-stack-title">Commercial desirability</div>
              <div className="fj-stack-desc">Which beachhead is real, and whether they'll actually pay.</div>
            </div>
          </div>
          <p className="fj-welcome-note">Progress on only one track produces either a science project or a pitch deck. By month 6 the two must point at each other.</p>
        </div>
      </div>

      <div style={{ marginTop: 40 }}>
        <span className="eyebrow">The principles you'll be held to</span>
        <div className="fj-principles">
          <div className="fj-principle">
            <span className="t">Risk-first, not build-first.</span>
            <span className="d">You work the assumption most likely to kill the company — not the one that's easiest or most fun to test.</span>
          </div>
          <div className="fj-principle">
            <span className="t">Cheap before expensive.</span>
            <span className="d">Literature, simulation, expert and customer calls exhaust themselves before any prototype gets built.</span>
          </div>
          <div className="fj-principle">
            <span className="t">Mentors judge; the program sets the bar.</span>
            <span className="d">Your pod owns the coaching and the sign-off. The evidence bar itself is fixed, not up for negotiation.</span>
          </div>
          <div className="fj-principle">
            <span className="t">Lock the criteria first.</span>
            <span className="d">Success and failure are set before a test starts — and never softened once it's running.</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 44 }}>
        <span className="eyebrow">How you'll move through the six months</span>
        <div className="fj-phases">
          <div className="fj-phase">
            <span className="ph">Phase 1 · Months 1–2</span>
            <span className="tt">Parallel Discovery</span>
            <span className="d">Rank your technical risks and 2–3 candidate beachheads. Run 15–20 customer conversations against a defined persona.</span>
            <span className="out"><strong>Output</strong> — two ranked, mentor-signed-off assumption stacks.</span>
            <div className="gate">→ Gate 1 · Month 2</div>
          </div>
          <div className="fj-phase">
            <span className="ph">Phase 2 · Months 2–4</span>
            <span className="tt">Cheap Risk Retirement</span>
            <span className="d">Work both stacks top-down with the cheapest possible tests. Success and failure criteria are locked before each test begins.</span>
            <span className="out"><strong>Output</strong> — a meaningful share of both stacks retired or invalidated, with evidence.</span>
            <div className="gate">→ Gate 2 · Month 4</div>
          </div>
          <div className="fj-phase">
            <span className="ph">Phase 3 · Months 4–6</span>
            <span className="tt">Prototyping &amp; Design Partners</span>
            <span className="d">Build only the subsystem that resolves your largest unknown. Convert warm conversations into written commitments.</span>
            <span className="out"><strong>Output</strong> — a demo of your hardest thing plus a design-partner LOI.</span>
            <div className="gate">→ Gate 3 · Month 6</div>
          </div>
        </div>
      </div>

      <div className="card card-black fj-stage-card">
        <span className="eyebrow" style={{ color: "#aafcf0" }}>The stage gates</span>
        <h3 style={{ color: "#fff" }}>Three gates. Four possible calls. One guardrail.</h3>
        <div className="fj-gate-chips">
          <span className="fj-gate-chip"><span className="dot green" /><strong>Advance</strong><span className="lbl-dim">on to the next phase</span></span>
          <span className="fj-gate-chip"><span className="dot amber" /><strong>Iterate</strong><span className="lbl-dim">stay in phase, close gaps</span></span>
          <span className="fj-gate-chip"><span className="dot" style={{ background: "var(--accent-violet)" }} /><strong>Pivot</strong><span className="lbl-dim">change thesis or beachhead</span></span>
          <span className="fj-gate-chip"><span className="dot coral" /><strong>Kill</strong><span className="lbl-dim">retire the venture</span></span>
        </div>
        <p>
          <strong style={{ color: "#fff" }}>Advance</strong> rests with your primary mentor.{" "}
          <strong style={{ color: "#fff" }}>Kill</strong> and <strong style={{ color: "#fff" }}>pivot</strong> need
          a second signal — a rotating second mentor or the monthly cohort panel — before they're
          final. It's the program's strongest guard against a venture being kept alive past the
          point it should.
        </p>
      </div>

      <div className="fj-actions lg">
        <a className="btn btn-primary" href="#" onClick={(e) => { e.preventDefault(); onNext(); }}>
          <span>Meet your mentor pod</span><span className="arrow">→</span>
        </a>
        <span className="hint">Step 1 of 6 · about 20 min to complete onboarding</span>
      </div>
    </div>
  );
}

// ============ STEP 1 · MENTORS ============
function MentorsStep({ mentors, onBack, onNext }) {
  return (
    <div className="fj-wizard">
      <span className="eyebrow eyebrow-rule">Your mentor pod</span>
      <h1 className="fj-h1">The people reviewing your <span className="hl">evidence</span>.</h1>
      <p className="fj-help">
        You're paired with three mentors for the full cycle. They meet you weekly, pressure-test
        your experiments, and — at the review gate — approve your plan before derisking begins.
        Read their focus so you bring the right questions.
      </p>

      <div className="fj-mentor-list">
        {mentors.map((m, i) => <MentorCard key={m.id || m.name} mentor={m} index={i} />)}
      </div>

      <div className="fj-actions">
        <a className="btn-ghost" href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>← Back</a>
        <a className="btn btn-primary" href="#" onClick={(e) => { e.preventDefault(); onNext(); }}>
          <span>Design your experiments</span><span className="arrow">→</span>
        </a>
      </div>
    </div>
  );
}

// ============ STEP 2 · EXPERIMENTS ============
function ExperimentsStep({ technical, commercial, rankOf, onChange, onRemove, onAdd, onBack, onNext }) {
  return (
    <div className="fj-wizard">
      <span className="eyebrow eyebrow-rule">Your two assumption stacks</span>
      <h1 className="fj-h1">What could <span className="hl">kill</span> this venture?</h1>
      <p className="fj-help">
        These are your two ranked stacks — the technical risks most likely to sink the build, and
        the commercial risks most likely to mean nobody wants it. Rank each by how likely it is to
        fail and how expensive it is to find out, then work top-down with the cheapest test that
        could settle it.
      </p>

      <div className="fj-good-exp-hint">
        <strong>A good experiment</strong> names one assumption on one track, states a falsifiable
        hypothesis, uses the cheapest test that could settle it — literature and calls before
        breadboards and pilots — and locks its pass and kill criteria before you run. Once a test
        is running, the criteria can't be softened.
      </div>

      <div className="fj-stack-section">
        <div className="fj-stack-head">
          <div>
            <span className="eyebrow" style={{ color: "var(--artblue)" }}>Technical feasibility · ranked</span>
            <div className="sub">The engineering most likely to fail — cheapest to find out, first.</div>
          </div>
          <span className="fj-stack-count">{technical.length} assumptions</span>
        </div>
        <div className="fj-exp-list">
          {technical.map((exp) => (
            <ExperimentCard
              key={exp.id}
              exp={exp}
              rank={rankOf(exp)}
              onChange={(field, value) => onChange(exp.id, field, value)}
              onRemove={() => onRemove(exp.id)}
            />
          ))}
        </div>
        <a href="#" className="fj-add-assumption tech" onClick={(e) => { e.preventDefault(); onAdd("technical"); }}>
          + Add a technical assumption
        </a>
      </div>

      <div className="fj-stack-section comm">
        <div className="fj-stack-head comm">
          <div>
            <span className="eyebrow" style={{ color: "var(--accent-violet)" }}>Commercial desirability · ranked</span>
            <div className="sub">Who the beachhead is, and whether they'll actually pay.</div>
          </div>
          <span className="fj-stack-count">{commercial.length} assumptions</span>
        </div>
        <div className="fj-exp-list">
          {commercial.map((exp) => (
            <ExperimentCard
              key={exp.id}
              exp={exp}
              rank={rankOf(exp)}
              onChange={(field, value) => onChange(exp.id, field, value)}
              onRemove={() => onRemove(exp.id)}
            />
          ))}
        </div>
        <a href="#" className="fj-add-assumption comm" onClick={(e) => { e.preventDefault(); onAdd("commercial"); }}>
          + Add a commercial assumption
        </a>
      </div>

      <div className="fj-actions">
        <a className="btn-ghost" href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>← Back</a>
        <a className="btn btn-primary" href="#" onClick={(e) => { e.preventDefault(); onNext(); }}>
          <span>Build your workplan</span><span className="arrow">→</span>
        </a>
      </div>
    </div>
  );
}

// ============ STEP 3 · WORKPLAN ============
function WorkplanStep({ tasks, expOptions, onChange, onRemove, onAdd, onBack, onNext }) {
  return (
    <div className="fj-wizard" style={{ maxWidth: 960 }}>
      <span className="eyebrow eyebrow-rule">Workplan</span>
      <h1 className="fj-h1">Turn experiments into <span className="hl">derisking activities</span>.</h1>
      <p className="fj-help">
        Break each experiment into the concrete work it takes to run — the tasks, who owns them,
        and rough effort. This becomes the backbone of your timeline.
      </p>

      <div className="fj-table">
        <div className="fj-table-head">
          <div>Activity</div>
          <div>Experiment</div>
          <div>Owner</div>
          <div>Weeks</div>
          <div>Status</div>
          <div />
        </div>
        {tasks.map((t) => (
          <div className="fj-table-row" key={t.id}>
            <div>
              <input
                className="fj-table-name"
                defaultValue={t.task || ""}
                onBlur={(e) => onChange(t.id, "task", e.target.value)}
                placeholder="Describe the activity"
              />
            </div>
            <div>
              <select value={t.exp_id || ""} onChange={(e) => onChange(t.id, "exp_id", e.target.value || null)}>
                {expOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <input
                className="fj-table-text"
                defaultValue={t.owner || ""}
                onBlur={(e) => onChange(t.id, "owner", e.target.value)}
              />
            </div>
            <div>
              <input
                className="fj-table-text"
                type="number"
                min={1}
                max={12}
                defaultValue={t.effort}
                onBlur={(e) => onChange(t.id, "effort", Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 1)))}
              />
            </div>
            <div>
              <select value={t.status} onChange={(e) => onChange(t.id, "status", e.target.value)}>
                <option value="todo">To do</option>
                <option value="doing">In progress</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div className="fj-table-remove">
              <a href="#" onClick={(e) => { e.preventDefault(); onRemove(t.id); }}>×</a>
            </div>
          </div>
        ))}
      </div>

      <a href="#" className="fj-add-row" onClick={(e) => { e.preventDefault(); onAdd(); }}>+ Add an activity</a>

      <div className="fj-actions">
        <a className="btn-ghost" href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>← Back</a>
        <a className="btn btn-primary" href="#" onClick={(e) => { e.preventDefault(); onNext(); }}>
          <span>Set your timeline</span><span className="arrow">→</span>
        </a>
      </div>
    </div>
  );
}

// ============ STEP 4 · TIMELINE ============
function TimelineStep({ experiments, onUpdate, onBack, onNext }) {
  return (
    <div className="fj-wizard" style={{ maxWidth: 1000 }}>
      <span className="eyebrow eyebrow-rule">Timeline</span>
      <h1 className="fj-h1">Sequence the <span className="hl">24-week</span> cycle.</h1>
      <p className="fj-help">
        Place each experiment on the calendar. Front-load the highest-risk work — the sooner you
        learn a killer assumption is wrong, the more of the residency you save. Fixed program
        milestones are marked.
      </p>

      <div className="fj-legend">
        <span className="fj-legend-item"><span className="fj-legend-swatch" style={{ background: "var(--accent-coral)" }} /> High risk</span>
        <span className="fj-legend-item"><span className="fj-legend-swatch" style={{ background: "var(--accent-amber)" }} /> Medium</span>
        <span className="fj-legend-item"><span className="fj-legend-swatch" style={{ background: "var(--accent-green)" }} /> Low</span>
        <span className="fj-legend-item"><span className="fj-legend-swatch milestone" style={{ background: "var(--artblue)" }} /> Program milestone</span>
      </div>

      <Gantt experiments={experiments} onUpdate={onUpdate} />

      <div className="fj-actions">
        <a className="btn-ghost" href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>← Back</a>
        <a className="btn btn-primary" href="#" onClick={(e) => { e.preventDefault(); onNext(); }}>
          <span>Submit for mentor review</span><span className="arrow">→</span>
        </a>
      </div>
    </div>
  );
}

// ============ STEP 5 · MENTOR REVIEW ============
function ReviewStep({ review, mentors, summaryExperiments, summaryTasks, summarySpan, onBack, onSubmit, onGoDashboard }) {
  const isDraft = review.status === "draft";
  const isPending = review.status === "pending";
  const isApproved = review.status === "approved";
  const AVATAR_COLORS = ["var(--artblue)", "var(--accent-violet)", "var(--artblack)"];

  return (
    <div className="fj-wizard" style={{ maxWidth: 860 }}>
      <span className="eyebrow eyebrow-rule">Mentor review</span>
      <h1 className="fj-h1">Get your plan <span className="hl">approved</span>.</h1>
      <p className="fj-help">
        Your mentor pod reviews both assumption stacks and your timeline before derisking begins.
        This is your first stage gate — the pod can advance, iterate, pivot, or kill the plan.
        Advance is your primary mentor's call; a kill or pivot needs a second signal. Once you're
        cleared to advance, your dashboard unlocks and the residency clock starts.
      </p>

      <div className="card fj-review-card">
        <div className="fj-review-summary">
          <div><div className="num">{summaryExperiments}</div><div className="lbl">Experiments</div></div>
          <div><div className="num">{summaryTasks}</div><div className="lbl">Activities</div></div>
          <div><div className="num">{summarySpan}</div><div className="lbl">Planned span</div></div>
        </div>
        <div className="fj-reviewers">
          <div className="fj-reviewers-head">Reviewers</div>
          <div className="fj-reviewers-list">
            {mentors.map((m, i) => (
              <div className="fj-reviewer" key={m.id || m.name}>
                <div className="fj-reviewer-avatar" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>{m.initials}</div>
                <div>
                  <div className="nm">{m.name}</div>
                  <div className="fc">{m.review_focus}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {isDraft && (
        <div className="fj-actions">
          <a className="btn-ghost" href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>← Back</a>
          <a className="btn btn-primary" href="#" onClick={(e) => { e.preventDefault(); onSubmit(); }}>
            <span>Submit for review</span><span className="arrow">→</span>
          </a>
          <span className="hint">Your pod is notified by email.</span>
        </div>
      )}

      {isPending && (
        <div className="fj-review-pending">
          <span className="dot amber" />
          <div>
            <div className="tt">Awaiting mentor review</div>
            <div className="ss">Sent to Dr. Anitha Krishnan and pod · typically reviewed within 2 working days.</div>
          </div>
        </div>
      )}

      {isApproved && (
        <>
          <div className="fj-review-approved">
            <div className="top">
              <span className="dot green" />
              <div>
                <div className="tt">Plan approved</div>
                <div className="ss">Approved by {review.approved_by} · {review.approved_on}</div>
              </div>
            </div>
            <div className="fj-review-quote">"{review.mentor_comment}"</div>
          </div>
          <div className="fj-actions">
            <a className="btn btn-primary" href="#" onClick={(e) => { e.preventDefault(); onGoDashboard(); }}>
              <span>Go to your dashboard</span><span className="arrow">→</span>
            </a>
          </div>
        </>
      )}
    </div>
  );
}
