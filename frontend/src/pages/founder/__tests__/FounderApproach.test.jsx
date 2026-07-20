import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FounderApproach from "../FounderApproach.jsx";
import { founderApi } from "../../../lib/founderApi.js";

vi.mock("../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "priya@x.com", full_name: "Priya Ramachandran" }, logout: () => Promise.resolve() }),
}));

const MENTORS = [
  { id: "ak", initials: "AK", name: "Dr. Anitha Krishnan", role: "Clinical Translation Lead · IISc CDS", tags: ["Clinical validation"], hours: "Tue", review_focus: "Clinical + ethics", brings: "Study design.", bio: "Ran three trials." },
  { id: "rm", initials: "RM", name: "Rahul Menon", role: "Venture Partner · ARTPARK", tags: ["Go-to-market"], hours: "Thu", review_focus: "Commercial", brings: "Derisking.", bio: "Backed deep-tech." },
  { id: "si", initials: "SI", name: "Prof. S. Iyer", role: "Hardware Systems · IISc EE", tags: ["Embedded"], hours: "Fri", review_focus: "Hardware + scale", brings: "BOM & reliability.", bio: "Two decades." },
];

const EXPERIMENTS = [
  { id: "e1", track: "technical", gate: 1, risk: "high", status: "running", test_type: "retro", start_week: 1, weeks: 6, assumption: "Acoustic features carry signal.", hypothesis: "Combined model beats baseline.", test: "Retrospective analysis.", pass_criteria: "AUROC up 0.05.", kill_criteria: "AUROC up < 0.02." },
  { id: "e2", track: "technical", gate: 3, risk: "medium", status: "not-started", test_type: "breadboard", start_week: 14, weeks: 6, assumption: "Bedside unit runs in power budget.", hypothesis: "Model under 150ms.", test: "Port to eval board.", pass_criteria: "Latency < 150ms.", kill_criteria: "Power > 3W." },
  { id: "e3", track: "commercial", gate: 1, risk: "high", status: "running", test_type: "customer", start_week: 1, weeks: 5, assumption: "Clinicians act on pre-culture alert.", hypothesis: "Most clinicians change management.", test: "15-20 structured conversations.", pass_criteria: "12 of 18.", kill_criteria: "< 6 of 18." },
];

const TASKS = [
  { id: "t1", task: "Sign data-sharing MoU", exp_id: "e1", owner: "Priya", effort: 2, status: "done" },
];

const DRAFT_REVIEW = { status: "draft", approved_by: null, approved_on: null, mentor_comment: null };

function mockLoad({ experiments = EXPERIMENTS, tasks = TASKS, mentors = MENTORS, review = DRAFT_REVIEW } = {}) {
  vi.spyOn(founderApi, "getExperiments").mockResolvedValue(experiments);
  vi.spyOn(founderApi, "getTasks").mockResolvedValue(tasks);
  vi.spyOn(founderApi, "getMentors").mockResolvedValue(mentors);
  vi.spyOn(founderApi, "getReview").mockResolvedValue(review);
}

describe("FounderApproach — 6-step wizard", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the stepper with all 6 steps", async () => {
    mockLoad();
    render(<MemoryRouter><FounderApproach /></MemoryRouter>);

    await screen.findByText("Technology Innovator in Residence");
    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("Mentors")).toBeInTheDocument();
    expect(screen.getByText("Experiments")).toBeInTheDocument();
    expect(screen.getByText("Workplan")).toBeInTheDocument();
    expect(screen.getByText("Timeline")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("1 of 6 steps")).toBeInTheDocument();
  });

  it("renders experiment cards from the mocked API, ranked per track", async () => {
    mockLoad();
    render(<MemoryRouter><FounderApproach /></MemoryRouter>);
    await screen.findByText("Technology Innovator in Residence");

    fireEvent.click(screen.getByText("Experiments"));

    await screen.findByText("Your two assumption stacks");
    expect(screen.getByText("2 assumptions")).toBeInTheDocument(); // technical
    expect(screen.getByText("1 assumptions")).toBeInTheDocument(); // commercial
    expect(screen.getByText("T1")).toBeInTheDocument();
    expect(screen.getByText("T2")).toBeInTheDocument();
    expect(screen.getByText("C1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Acoustic features carry signal.")).toBeInTheDocument();
  });

  it("add-experiment calls the API and appends the new card", async () => {
    mockLoad();
    const newRow = { id: "e9", track: "technical", gate: 1, risk: "medium", status: "not-started", test_type: "literature", start_week: 1, weeks: 4, assumption: "", hypothesis: "", test: "", pass_criteria: "", kill_criteria: "" };
    vi.spyOn(founderApi, "addExperiment").mockResolvedValue(newRow);

    render(<MemoryRouter><FounderApproach /></MemoryRouter>);
    await screen.findByText("Technology Innovator in Residence");
    fireEvent.click(screen.getByText("Experiments"));
    await screen.findByText("2 assumptions");

    fireEvent.click(screen.getByText("+ Add a technical assumption"));

    await waitFor(() => expect(founderApi.addExperiment).toHaveBeenCalledWith("technical"));
    await waitFor(() => expect(screen.getByText("3 assumptions")).toBeInTheDocument());
    expect(screen.getByText("T3")).toBeInTheDocument();
  });

  it("review: submit -> pending -> approved (after the mentor-review delay)", async () => {
    mockLoad();
    vi.spyOn(founderApi, "submitReview").mockResolvedValue({ status: "pending", approved_by: null, approved_on: null, mentor_comment: null });
    vi.spyOn(founderApi, "advanceReview").mockResolvedValue({
      status: "approved", approved_by: "Dr. Anitha Krishnan", approved_on: "14 Jul 2026",
      mentor_comment: "Strong prioritisation.",
    });

    render(<MemoryRouter><FounderApproach /></MemoryRouter>);
    await screen.findByText("Technology Innovator in Residence");

    fireEvent.click(screen.getByText("Review"));
    await screen.findByText("Mentor review");
    expect(screen.getByText("Submit for review")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Submit for review"));
    await waitFor(() => expect(founderApi.submitReview).toHaveBeenCalled());
    await screen.findByText("Awaiting mentor review");

    await waitFor(
      () => expect(founderApi.advanceReview).toHaveBeenCalled(),
      { timeout: 4000 },
    );
    await waitFor(
      () => expect(screen.getByText("Plan approved")).toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(screen.getByText(/Approved by Dr. Anitha Krishnan/)).toBeInTheDocument();
    expect(screen.getByText("Go to your dashboard")).toBeInTheDocument();
  }, 10000);
});
