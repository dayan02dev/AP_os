import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import FounderTlr from "../FounderTlr.jsx";
import { founderApi } from "../../../lib/founderApi.js";

// Six-lever catalog fixture, small ladders (max 4) mirroring LeverPanel's own
// test fixture shape so the wizard's plumbing — not the ladder arithmetic
// itself (that's LeverPanel's job) — is what's under test here. Option text
// is lever-scoped (`${lever}-${qid}-${opt}`) so radios never collide across
// the six panels rendered on one screen.
const LEVERS_META = [
  { key: "scientific_principles", name: "Scientific Principles & Models", family: "technology" },
  { key: "architecture", name: "Architecture & System Definition", family: "technology" },
  { key: "qualification", name: "Qualification & Final Design", family: "technology" },
  { key: "user_needs", name: "User Needs & Requirements", family: "commercial" },
  { key: "supply_chain", name: "Supply Chain & Manufacturing", family: "commercial" },
  { key: "reliability", name: "Reliability & Maintainability", family: "commercial" },
];

function questionsFor(lever) {
  return ["q1", "q2", "q3"].map((qid, idx) => ({
    id: qid,
    text: `${lever} ${qid} text`,
    focus: `${qid} focus`,
    options: [
      { id: "A", level: idx + 1, text: `${lever}-${qid}-A` },
      { id: "B", level: idx + 2, text: `${lever}-${qid}-B` },
    ],
  }));
}

function catalog() {
  const questions = {};
  const documents = {};
  for (const l of LEVERS_META) {
    questions[l.key] = questionsFor(l.key);
    documents[l.key] = { 1: `${l.name} — doc` };
  }
  return { levers: LEVERS_META, questions, criteria: {}, documents };
}

function leverRow(meta, over = {}) {
  return {
    lever: meta.key, name: meta.name, family: meta.family,
    q1_option: null, q2_option: null, q3_option: null,
    criteria_checked: [], claimed_level: null, verified_level: null,
    verifier_note: null, required_document: null, criteria: [], evidence: [],
    ...over,
  };
}

function makeBundle(over = {}) {
  const levers = (over.levers || LEVERS_META.map((m) => leverRow(m)));
  return {
    catalog: catalog(),
    round: { id: "r1", round_label: "FY26-27-Q2", status: "draft", submitted_at: null, verified_at: null },
    rollups: { claimed: { technology: null, commercial: null, overall: null }, verified: { technology: null, commercial: null, overall: null } },
    ...over,
    levers,
  };
}

// F3: without a real `required_document` (and, on at least one lever, an
// evidence row), EvidenceRow takes its empty-state branch for all six
// levers and renders zero file inputs — "no enabled file inputs" is then
// vacuously true whether or not disabling actually works. `scientific_principles`
// gets the one document `catalog()` defines (level 1, since claimed_level
// resolves down through the fallback the same way the real catalog's gaps
// do) plus a stored row at that level, so the read-only assertions below
// have a real input and a real Download button to bite on.
function allClaimed(level = 2, over = {}) {
  return LEVERS_META.map((m) => leverRow(m, {
    claimed_level: level,
    q1_option: "B",
    ...(m.key === "scientific_principles"
      ? {
          required_document: "Scientific Principles & Models — doc",
          evidence: [{
            id: "ev-sp-1", filename: "evidence.pdf", size_bytes: 1024,
            uploaded_at: "2026-08-01T00:00:00Z", air_level: 1,
          }],
        }
      : {}),
    ...over,
  }));
}

async function goto(label) {
  fireEvent.click(screen.getByText(label));
}

describe("FounderTlr — the five-step AIR wizard", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the stepper with all five labels and the round label in the eyebrow", async () => {
    vi.spyOn(founderApi, "getAir").mockResolvedValue(makeBundle());
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");

    for (const label of ["Overview", "Technology", "Commercial", "Evidence", "Scorecard"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/AIR evaluation · FY26-27-Q2/)).toBeInTheDocument();
  });

  it("catalog-driven overview: the six lever names come from the bundle, not hardcoded", async () => {
    const b = makeBundle({ levers: LEVERS_META.map((m) => leverRow(m, m.key === "user_needs" ? { name: "Totally Reworded Lever" } : {})) });
    vi.spyOn(founderApi, "getAir").mockResolvedValue(b);
    render(<FounderTlr />);
    await screen.findByText("Totally Reworded Lever");
    expect(screen.queryByText("User Needs & Requirements")).not.toBeInTheDocument();
  });

  it("step 02 shows exactly the three technology levers", async () => {
    vi.spyOn(founderApi, "getAir").mockResolvedValue(makeBundle());
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Technology");

    await screen.findByText("Scientific Principles & Models");
    expect(screen.getByText("Architecture & System Definition")).toBeInTheDocument();
    expect(screen.getByText("Qualification & Final Design")).toBeInTheDocument();
    expect(screen.queryByText("User Needs & Requirements")).not.toBeInTheDocument();
    expect(screen.queryByText("Supply Chain & Manufacturing")).not.toBeInTheDocument();
    expect(screen.queryByText("Reliability & Maintainability")).not.toBeInTheDocument();
  });

  it("step 03 shows exactly the three commercial levers", async () => {
    vi.spyOn(founderApi, "getAir").mockResolvedValue(makeBundle());
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Commercial");

    await screen.findByText("User Needs & Requirements");
    expect(screen.getByText("Supply Chain & Manufacturing")).toBeInTheDocument();
    expect(screen.getByText("Reliability & Maintainability")).toBeInTheDocument();
    expect(screen.queryByText("Scientific Principles & Models")).not.toBeInTheDocument();
    expect(screen.queryByText("Architecture & System Definition")).not.toBeInTheDocument();
    expect(screen.queryByText("Qualification & Final Design")).not.toBeInTheDocument();
  });

  it("step 04 renders an EvidenceRow for all six levers", async () => {
    vi.spyOn(founderApi, "getAir").mockResolvedValue(makeBundle());
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Evidence");

    await screen.findByText("Scientific Principles & Models");
    for (const m of LEVERS_META) {
      expect(screen.getByText(m.name)).toBeInTheDocument();
    }
    expect(document.querySelectorAll(".fj-evidence-row")).toHaveLength(6);
  });

  it("answering a question calls putAirLever with the lever key and all four payload fields", async () => {
    const b = makeBundle();
    vi.spyOn(founderApi, "getAir").mockResolvedValue(b);
    const putAirLever = vi.spyOn(founderApi, "putAirLever").mockResolvedValue(makeBundle());
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Technology");
    await screen.findByText("Architecture & System Definition");

    fireEvent.click(screen.getByRole("radio", { name: "architecture-q1-B" }));

    await waitFor(() => expect(putAirLever).toHaveBeenCalledWith("architecture", {
      q1_option: "B", q2_option: null, q3_option: null, criteria_checked: [],
    }));
  });

  it("toggling a criterion also sends the whole lever payload, not a partial patch", async () => {
    const b = makeBundle({
      levers: LEVERS_META.map((m) => leverRow(m, m.key === "architecture"
        ? { q1_option: "B", q2_option: "B", q3_option: "B", claimed_level: 4, criteria: ["Has a working prototype"] }
        : {})),
    });
    vi.spyOn(founderApi, "getAir").mockResolvedValue(b);
    const putAirLever = vi.spyOn(founderApi, "putAirLever").mockResolvedValue(b);
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Technology");
    await screen.findByText("Has a working prototype");

    fireEvent.click(screen.getByRole("checkbox", { name: "Has a working prototype" }));

    await waitFor(() => expect(putAirLever).toHaveBeenCalledWith("architecture", {
      q1_option: "B", q2_option: "B", q3_option: "B", criteria_checked: ["Has a working prototype"],
    }));
  });

  it("replaces state with the response bundle: a server-changed claimed_level shows without a refetch", async () => {
    const getAir = vi.spyOn(founderApi, "getAir").mockResolvedValue(makeBundle());
    vi.spyOn(founderApi, "putAirLever").mockResolvedValue(makeBundle({
      levers: LEVERS_META.map((m) => leverRow(m, m.key === "architecture" ? { q1_option: "B", claimed_level: 2 } : {})),
    }));
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Technology");
    await screen.findByText("Architecture & System Definition");

    fireEvent.click(screen.getByRole("radio", { name: "architecture-q1-B" }));

    await screen.findByText("AIR 2");
    expect(getAir).toHaveBeenCalledTimes(1);
  });

  it("step 05 renders six AirBars and the three rollups", async () => {
    const b = makeBundle({
      levers: allClaimed(3),
      rollups: { claimed: { technology: 2, commercial: 3, overall: 2 }, verified: { technology: null, commercial: null, overall: null } },
    });
    vi.spyOn(founderApi, "getAir").mockResolvedValue(b);
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Scorecard");

    await screen.findByText("Scientific Principles & Models");
    expect(document.querySelectorAll(".fj-air-bar")).toHaveLength(6);

    const techTile = screen.getByText("Technology AIR").closest(".tile");
    const commTile = screen.getByText("Commercial AIR").closest(".tile");
    const overallTile = screen.getByText("Overall AIR").closest(".tile");
    expect(techTile.textContent).toContain("2");
    expect(commTile.textContent).toContain("3");
    expect(overallTile.textContent).toContain("2");
  });

  it("submit is disabled with an incomplete bundle, and names the outstanding lever", async () => {
    const levers = LEVERS_META.map((m) => leverRow(m, m.key === "reliability" ? {} : { claimed_level: 3, q1_option: "B" }));
    vi.spyOn(founderApi, "getAir").mockResolvedValue(makeBundle({ levers }));
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Scorecard");
    await screen.findByText("Scientific Principles & Models");

    const submitBtn = screen.getByRole("button", { name: /submit assessment/i });
    expect(submitBtn).toBeDisabled();
    const outstanding = document.querySelector(".fj-air-outstanding");
    expect(outstanding.textContent).toContain("Reliability & Maintainability");
  });

  it("submit is enabled once all six levers have a claimed level, and clicking calls submitAir", async () => {
    const b = makeBundle({
      levers: allClaimed(2),
      rollups: { claimed: { technology: 2, commercial: 2, overall: 2 }, verified: { technology: null, commercial: null, overall: null } },
    });
    vi.spyOn(founderApi, "getAir").mockResolvedValue(b);
    const submitAir = vi.spyOn(founderApi, "submitAir").mockResolvedValue({
      ...b, round: { ...b.round, status: "submitted", submitted_at: "2026-08-16T00:00:00Z" },
    });
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Scorecard");
    await screen.findByText("Scientific Principles & Models");

    const submitBtn = screen.getByRole("button", { name: /submit assessment/i });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => expect(submitAir).toHaveBeenCalled());
    await screen.findByText("Submitted");
  });

  it("a submitted bundle renders every input disabled and offers no submit control", async () => {
    const b = makeBundle({
      levers: allClaimed(2),
      round: { id: "r1", round_label: "FY26-27-Q2", status: "submitted", submitted_at: "2026-08-01T00:00:00Z", verified_at: null },
    });
    vi.spyOn(founderApi, "getAir").mockResolvedValue(b);
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");

    await goto("Technology");
    await screen.findByText("Scientific Principles & Models");
    for (const r of screen.getAllByRole("radio")) expect(r).toBeDisabled();
    for (const c of screen.queryAllByRole("checkbox")) expect(c).toBeDisabled();

    await goto("Evidence");
    await screen.findByText("Scientific Principles & Models");
    expect(document.querySelectorAll('input[type="file"]:not(:disabled)')).toHaveLength(0);
    // A founder must always be able to retrieve their own documents, even
    // once the round is read-only — only upload/replace/delete lock.
    expect(screen.getByRole("button", { name: /download/i })).not.toBeDisabled();

    await goto("Scorecard");
    await screen.findByText("Submitted");
    expect(screen.queryByRole("button", { name: /submit assessment/i })).not.toBeInTheDocument();
  });

  it("wires EvidenceRow's onUpload straight through to uploadAirEvidence(lever, level, file), never substituting its own level", async () => {
    const b = makeBundle({
      levers: LEVERS_META.map((m) => leverRow(m, m.key === "architecture"
        ? { claimed_level: 2, required_document: "Arch doc" }
        : {})),
    });
    b.catalog.documents.architecture = { 1: "Arch backfill doc", 2: "Arch doc" };
    vi.spyOn(founderApi, "getAir").mockResolvedValue(b);
    const upload = vi.spyOn(founderApi, "uploadAirEvidence").mockResolvedValue(b);
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Evidence");
    await screen.findByText("Scientific Principles & Models");

    // Upload against the BACKFILL level (1), not the claimed one (2) — this
    // is exactly the case the brief warns about: a backfill upload targets
    // a level below the claimed one, and the level must travel through
    // unmodified rather than being replaced with claimed_level.
    const archRow = screen.getByText("Architecture & System Definition").closest(".fj-evidence-row");
    fireEvent.click(archRow.querySelector(".fj-evidence-backfill-toggle"));
    const input = screen.getByLabelText("Upload AIR 1 evidence");
    const file = new File(["x"], "evidence.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(upload).toHaveBeenCalledWith("architecture", 1, file));
    expect(upload).not.toHaveBeenCalledWith("architecture", 2, file);
  });

  it("wires EvidenceRow's onDownload through the signed-url fetch and opens it, the way FounderMou does", async () => {
    const row = { id: "ev-1", filename: "doc.pdf", size_bytes: 1024, uploaded_at: "2026-08-01T00:00:00Z", air_level: 1 };
    const b = makeBundle({
      levers: LEVERS_META.map((m) => leverRow(m, m.key === "architecture"
        ? { claimed_level: 1, required_document: "Arch doc", evidence: [row] }
        : {})),
    });
    vi.spyOn(founderApi, "getAir").mockResolvedValue(b);
    const signedUrl = vi.spyOn(founderApi, "airEvidenceSignedUrl").mockResolvedValue({ url: "https://signed.example/doc.pdf" });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => {});
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Evidence");
    await screen.findByText("Scientific Principles & Models");

    fireEvent.click(screen.getByRole("button", { name: /download/i }));

    await waitFor(() => expect(signedUrl).toHaveBeenCalledWith("ev-1"));
    expect(openSpy).toHaveBeenCalledWith("https://signed.example/doc.pdf", "_blank", "noopener");
  });

  it("a failing putAirLever surfaces the error banner without discarding the founder's other answers", async () => {
    vi.spyOn(founderApi, "getAir").mockResolvedValue(makeBundle());
    vi.spyOn(founderApi, "putAirLever").mockRejectedValue(new Error("network down"));
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Technology");
    await screen.findByText("Scientific Principles & Models");

    fireEvent.click(screen.getByRole("radio", { name: "scientific_principles-q1-B" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("network down"));
    // The optimistic selection stays put — a failed save must not roll back
    // what the founder just picked.
    expect(screen.getByRole("radio", { name: "scientific_principles-q1-B" })).toBeChecked();
  });
});
