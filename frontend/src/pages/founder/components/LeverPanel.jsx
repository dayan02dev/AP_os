// One AIR lever: its three ladder questions, the criteria checklist for the
// claimed level, and a level chip that explains the ladder rather than
// hiding it.
//
// `air_scoring.lever_level` (backend/app/services/air_scoring.py) walks
// q1 -> q2 -> q3 and only lets a question lift the level while every
// question before it sits at its own top option. So a founder can pick the
// best possible Q3 answer and watch the level not move at all, which reads
// as a broken form unless the panel names exactly which question is
// blocking. `lever.claimed_level` is authoritative and never recomputed
// here — this component only *finds* the capping question by walking the
// same three questions and comparing each answer's level against the max
// level in that question's own option list. That mirrors lever_level's
// stopping condition without reimplementing its arithmetic, so the two can
// never drift against each other.
//
// Nothing about the framework (lever names, question text, option text,
// criteria) is hardcoded — everything rendered here comes from `questions`
// (bundle.catalog.questions[lever]) and `lever` (one element of
// bundle.levers), both server-owned.
const Q_LABELS = { q1: "Q1", q2: "Q2", q3: "Q3" };

function questionTopLevel(question) {
  return Math.max(...question.options.map((o) => o.level));
}

// Walks q1 -> q2 -> q3 and returns the first question that is either
// unanswered or answered below its own top option, plus its 0-based index
// and whether it was unanswered vs. answered-but-not-top. Returns null when
// all three are answered at their own top — nothing is capping the level.
function findCappingQuestion(questions, lever) {
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const selectedId = lever[`${q.id}_option`];
    if (!selectedId) {
      return { question: q, index: i, unanswered: true };
    }
    const selected = q.options.find((o) => o.id === selectedId);
    const top = questionTopLevel(q);
    if (!selected || selected.level < top) {
      return { question: q, index: i, unanswered: false };
    }
  }
  return null;
}

// The single sentence the level chip shows, per the state table in the
// Task 3 brief. Deliberately distinguishes the question that *lifted* the
// level (never named here — that isn't what a founder needs to act on)
// from the question that is *capping* it.
function ladderCopy(lever, questions) {
  const cap = findCappingQuestion(questions, lever);
  const n = lever.claimed_level;

  if (!cap) return `AIR ${n} — fully evidenced.`;

  const label = Q_LABELS[cap.question.id] || cap.question.id;

  if (cap.unanswered) {
    // The capping question hasn't been touched at all. If it's the very
    // first question, nothing has been established yet — "Not started",
    // not "AIR null so far". Any later question being the unanswered cap
    // means everything before it is already at its top, so `n` is a real
    // number worth reporting.
    if (cap.index === 0) return "Not started.";
    return `AIR ${n} so far — answer ${label} to go further.`;
  }

  // Answered, but below its own top option.
  if (cap.index === questions.length - 1) {
    return `AIR ${n} — a higher ${label} answer would lift this further.`;
  }
  const nextLabel = Q_LABELS[questions[cap.index + 1]?.id] || `Q${cap.index + 2}`;
  return `AIR ${n} — ${label} is capping this. ${nextLabel} only counts once ${label} is at its top option.`;
}

export default function LeverPanel({ lever, questions, disabled, onAnswer, onToggleCriterion }) {
  const criteria = lever.criteria || [];
  const criteriaChecked = lever.criteria_checked || [];

  return (
    <div className="fj-lever-panel">
      {!disabled && (
        <div className="fj-lever-chip">{ladderCopy(lever, questions)}</div>
      )}

      {questions.map((q) => {
        const selected = lever[`${q.id}_option`];
        return (
          <fieldset className="fj-lever-question" key={q.id} disabled={disabled}>
            <legend className="fj-lever-q-text">{q.text}</legend>
            {q.focus && <div className="fj-lever-q-focus">{q.focus}</div>}
            <div className="fj-lever-options">
              {q.options.map((opt) => (
                <label className="fj-lever-option" key={opt.id}>
                  <input
                    type="radio"
                    name={`${lever.lever}-${q.id}`}
                    value={opt.id}
                    checked={selected === opt.id}
                    disabled={disabled}
                    onChange={() => onAnswer(q.id, opt.id)}
                  />
                  <span className="fj-lever-option-text">{opt.text}</span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}

      {criteria.length > 0 && (
        <fieldset className="fj-lever-criteria" disabled={disabled}>
          <legend className="fj-lever-criteria-head">Measurement criteria</legend>
          {criteria.map((c) => (
            <label className="fj-lever-criterion" key={c}>
              <input
                type="checkbox"
                checked={criteriaChecked.includes(c)}
                disabled={disabled}
                onChange={() => onToggleCriterion(c)}
              />
              <span>{c}</span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
