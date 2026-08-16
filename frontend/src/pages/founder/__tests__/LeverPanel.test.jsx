import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import LeverPanel from "../components/LeverPanel.jsx";

// Two-question-maxed / third-unmaxed shape so the ladder message is
// exercised for real: q1 tops at level 2, q2 tops at level 3, q3 tops at
// level 4. Mirrors the brief's fixture verbatim.
const QUESTIONS = [
  { id: "q1", text: "Q1 text", focus: "F1", options: [
    { id: "A", level: 1, text: "q1 low" }, { id: "B", level: 2, text: "q1 top" }] },
  { id: "q2", text: "Q2 text", focus: "F2", options: [
    { id: "A", level: 2, text: "q2 low" }, { id: "B", level: 3, text: "q2 top" }] },
  { id: "q3", text: "Q3 text", focus: "F3", options: [
    { id: "A", level: 3, text: "q3 low" }, { id: "B", level: 4, text: "q3 top" }] },
];
const lever = (over = {}) => ({
  lever: "architecture", name: "Architecture & System Definition", family: "technology",
  q1_option: null, q2_option: null, q3_option: null, criteria_checked: [],
  claimed_level: null, verified_level: null, criteria: [], evidence: [], ...over,
});

describe("LeverPanel", () => {
  it("renders all three questions and every option's text", () => {
    render(<LeverPanel lever={lever()} questions={QUESTIONS} onAnswer={() => {}} onToggleCriterion={() => {}} />);
    expect(screen.getByText("Q1 text")).toBeInTheDocument();
    expect(screen.getByText("Q2 text")).toBeInTheDocument();
    expect(screen.getByText("Q3 text")).toBeInTheDocument();
    for (const q of QUESTIONS) {
      for (const opt of q.options) {
        expect(screen.getByText(opt.text)).toBeInTheDocument();
      }
    }
  });

  it("calls onAnswer with the exact (question id, option id) when an option is selected", () => {
    const onAnswer = vi.fn();
    render(<LeverPanel lever={lever()} questions={QUESTIONS} onAnswer={onAnswer} onToggleCriterion={() => {}} />);
    const q2TopRadio = screen.getByRole("radio", { name: "q2 top" });
    q2TopRadio.click();
    expect(onAnswer).toHaveBeenCalledWith("q2", "B");
  });

  it("ladder: q1 answered below top names Q1 as the cap", () => {
    render(<LeverPanel
      lever={lever({ q1_option: "A", claimed_level: 1 })}
      questions={QUESTIONS}
      onAnswer={() => {}}
      onToggleCriterion={() => {}}
    />);
    expect(screen.getByText(/Q1 is capping this/)).toBeInTheDocument();
    expect(screen.getByText(/Q2 only counts once Q1 is at its top option/)).toBeInTheDocument();
  });

  it("ladder: q1 at top but q2 below top names Q2 as the cap, not Q1", () => {
    render(<LeverPanel
      lever={lever({ q1_option: "B", q2_option: "A", claimed_level: 2 })}
      questions={QUESTIONS}
      onAnswer={() => {}}
      onToggleCriterion={() => {}}
    />);
    expect(screen.getByText(/Q2 is capping this/)).toBeInTheDocument();
    expect(screen.queryByText(/Q1 is capping this/)).not.toBeInTheDocument();
  });

  it("ladder, unanswered cap: tells the founder to answer Q2, and never says Q2 lifted the level", () => {
    render(<LeverPanel
      lever={lever({ q1_option: "B", q2_option: null, claimed_level: 2 })}
      questions={QUESTIONS}
      onAnswer={() => {}}
      onToggleCriterion={() => {}}
    />);
    expect(screen.getByText(/answer Q2 to go further/)).toBeInTheDocument();
    // Must not say Q2 is "capping" this — the capping phrasing is reserved
    // for an answered-but-below-top question, not an unanswered one.
    expect(screen.queryByText(/Q2 is capping this/)).not.toBeInTheDocument();
  });

  it("ladder, Q3 cap: uses the Q3-specific copy, with no reference to a fourth question", () => {
    render(<LeverPanel
      lever={lever({ q1_option: "B", q2_option: "B", q3_option: "A", claimed_level: 3 })}
      questions={QUESTIONS}
      onAnswer={() => {}}
      onToggleCriterion={() => {}}
    />);
    expect(screen.getByText(/a higher Q3 answer would lift this further/)).toBeInTheDocument();
    expect(screen.queryByText(/Q4/)).not.toBeInTheDocument();
  });

  it("fully evidenced: all three at top shows the fully-evidenced copy and no ladder text", () => {
    render(<LeverPanel
      lever={lever({ q1_option: "B", q2_option: "B", q3_option: "B", claimed_level: 4 })}
      questions={QUESTIONS}
      onAnswer={() => {}}
      onToggleCriterion={() => {}}
    />);
    expect(screen.getByText(/fully evidenced/)).toBeInTheDocument();
    expect(screen.queryByText(/only counts once/)).not.toBeInTheDocument();
  });

  it("not started: no answers shows 'Not started' and no ladder sentence", () => {
    render(<LeverPanel lever={lever()} questions={QUESTIONS} onAnswer={() => {}} onToggleCriterion={() => {}} />);
    expect(screen.getByText("Not started.")).toBeInTheDocument();
    expect(screen.queryByText(/capping/)).not.toBeInTheDocument();
    expect(screen.queryByText(/answer Q/)).not.toBeInTheDocument();
  });

  it("skipped q1: answers on q2/q3 still score null, but the copy explains why instead of claiming nothing was started", () => {
    render(
      <LeverPanel
        lever={lever({ q1_option: null, q2_option: "B", q3_option: "B", claimed_level: null })}
        questions={QUESTIONS}
        onAnswer={() => {}}
        onToggleCriterion={() => {}}
      />,
    );
    // The bare "Not started." of the nothing-answered case would read here
    // as the form having discarded two real answers.
    expect(screen.queryByText("Not started.")).not.toBeInTheDocument();
    expect(screen.getByText(/Q1 must be answered before the later questions count/))
      .toBeInTheDocument();
    // And it must not invent a level for a lever the ladder never lifted.
    expect(screen.queryByText(/AIR null/)).not.toBeInTheDocument();
  });

  it("renders criteria from lever.criteria, checks those in criteria_checked, and reports toggles", () => {
    const onToggleCriterion = vi.fn();
    const criteria = ["Has a functioning prototype", "Ran a literature scan"];
    render(<LeverPanel
      lever={lever({ criteria, criteria_checked: ["Ran a literature scan"] })}
      questions={QUESTIONS}
      onAnswer={() => {}}
      onToggleCriterion={onToggleCriterion}
    />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    const checked = screen.getByText("Ran a literature scan").closest("label").querySelector("input");
    const unchecked = screen.getByText("Has a functioning prototype").closest("label").querySelector("input");
    expect(checked.checked).toBe(true);
    expect(unchecked.checked).toBe(false);
    unchecked.click();
    expect(onToggleCriterion).toHaveBeenCalledWith("Has a functioning prototype");
  });

  it("disabled disables every radio and checkbox and hides the ladder hint", () => {
    render(<LeverPanel
      lever={lever({ q1_option: "A", claimed_level: 1, criteria: ["A criterion"] })}
      questions={QUESTIONS}
      disabled
      onAnswer={() => {}}
      onToggleCriterion={() => {}}
    />);
    const radios = screen.getAllByRole("radio");
    const checkboxes = screen.getAllByRole("checkbox");
    expect(radios.length).toBeGreaterThan(0);
    for (const r of radios) expect(r).toBeDisabled();
    for (const c of checkboxes) expect(c).toBeDisabled();
    expect(screen.queryByText(/is capping this/)).not.toBeInTheDocument();
    expect(screen.queryByText("Not started.")).not.toBeInTheDocument();
  });

  it("catalog-driven: a renamed question's text flows straight through to the screen", () => {
    const renamed = QUESTIONS.map((q) => (q.id === "q2" ? { ...q, text: "Totally reworded copy" } : q));
    render(<LeverPanel lever={lever()} questions={renamed} onAnswer={() => {}} onToggleCriterion={() => {}} />);
    expect(screen.getByText("Totally reworded copy")).toBeInTheDocument();
    expect(screen.queryByText("Q2 text")).not.toBeInTheDocument();
  });
});
