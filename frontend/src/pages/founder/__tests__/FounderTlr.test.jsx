import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import FounderTlr from "../FounderTlr.jsx";
import { founderApi } from "../../../lib/founderApi.js";
import { ApiError } from "../../../lib/api.js";

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

  // F4: AIR fires a PUT per radio click, so two quick clicks in normal use
  // are the ordinary rhythm, not an edge case. If the responses land out of
  // order, a naive `.then(setBundle)` lets the STALE response overwrite the
  // newer answer, leaving the founder's second pick visibly un-checked even
  // though the DB holds it correctly.
  it("F4: out-of-order PUT responses don't let the stale one clobber the later-issued answer", async () => {
    vi.spyOn(founderApi, "getAir").mockResolvedValue(makeBundle());
    let resolveFirst, resolveSecond;
    const first = new Promise((res) => { resolveFirst = res; });
    const second = new Promise((res) => { resolveSecond = res; });
    vi.spyOn(founderApi, "putAirLever")
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second);
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Technology");
    await screen.findByText("Architecture & System Definition");

    fireEvent.click(screen.getByRole("radio", { name: "architecture-q1-A" }));
    fireEvent.click(screen.getByRole("radio", { name: "architecture-q1-B" }));

    // The SECOND (later-issued) request's response lands first...
    resolveSecond(makeBundle({
      levers: LEVERS_META.map((m) => leverRow(m, m.key === "architecture" ? { q1_option: "B" } : {})),
    }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "architecture-q1-B" })).toBeChecked());

    // ...then the FIRST (now-stale) request's response arrives after. It
    // must not overwrite the newer answer.
    resolveFirst(makeBundle({
      levers: LEVERS_META.map((m) => leverRow(m, m.key === "architecture" ? { q1_option: "A" } : {})),
    }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "architecture-q1-B" })).toBeChecked());
    expect(screen.getByRole("radio", { name: "architecture-q1-A" })).not.toBeChecked();
  });

  // F4 also covers evidence uploads — "all of which return bundles" per the
  // fix brief — not just lever PUTs.
  it("F4: out-of-order evidence-upload responses don't let the stale one clobber the later-issued one", async () => {
    const b = makeBundle({
      levers: LEVERS_META.map((m) => leverRow(m, m.key === "architecture"
        ? { claimed_level: 1, required_document: "Arch doc" }
        : {})),
    });
    b.catalog.documents.architecture = { 1: "Arch doc" };
    vi.spyOn(founderApi, "getAir").mockResolvedValue(b);
    let resolveFirst, resolveSecond;
    const first = new Promise((res) => { resolveFirst = res; });
    const second = new Promise((res) => { resolveSecond = res; });
    vi.spyOn(founderApi, "uploadAirEvidence")
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second);
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Evidence");
    await screen.findByText("Scientific Principles & Models");

    const archRow = screen.getByText("Architecture & System Definition").closest(".fj-evidence-row");
    const input = archRow.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [new File(["a"], "a.pdf", { type: "application/pdf" })] } });
    fireEvent.change(input, { target: { files: [new File(["b"], "b.pdf", { type: "application/pdf" })] } });

    const withEvidence = (filename, id) => {
      const bb = makeBundle({
        levers: LEVERS_META.map((m) => leverRow(m, m.key === "architecture"
          ? {
              claimed_level: 1, required_document: "Arch doc",
              evidence: [{ id, filename, size_bytes: 1, uploaded_at: null, air_level: 1 }],
            }
          : {})),
      });
      bb.catalog.documents.architecture = { 1: "Arch doc" };
      return bb;
    };

    // The SECOND (later-issued) upload's response lands first...
    resolveSecond(withEvidence("b.pdf", "ev-b"));
    await waitFor(() => expect(screen.getByText("b.pdf")).toBeInTheDocument());

    // ...then the FIRST (now-stale) response arrives after. It must not
    // overwrite the newer upload.
    resolveFirst(withEvidence("a.pdf", "ev-a"));
    await waitFor(() => expect(screen.getByText("b.pdf")).toBeInTheDocument());
    expect(screen.queryByText("a.pdf")).not.toBeInTheDocument();
  });

  // F5: every founder_air.py error raises `detail={"code": …}`, and api.js's
  // _buildError sets "Request failed" whenever detail is an object without
  // a `message` — so a rejected upload for an unsupported file type reads
  // exactly like a rejected upload for a network blip.
  it("F5: a rejected upload with a known error code shows type-specific copy, not the generic 'Request failed'", async () => {
    const b = makeBundle({
      levers: LEVERS_META.map((m) => leverRow(m, m.key === "architecture"
        ? { claimed_level: 1, required_document: "Arch doc" }
        : {})),
    });
    b.catalog.documents.architecture = { 1: "Arch doc" };
    vi.spyOn(founderApi, "getAir").mockResolvedValue(b);
    vi.spyOn(founderApi, "uploadAirEvidence").mockRejectedValue(
      new ApiError({ status: 415, code: "unsupported_media", message: "Request failed" }),
    );
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Evidence");
    await screen.findByText("Scientific Principles & Models");

    const archRow = screen.getByText("Architecture & System Definition").closest(".fj-evidence-row");
    const input = archRow.querySelector('input[type="file"]');
    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByRole("alert")).not.toHaveTextContent("Request failed"));
    expect(screen.getByRole("alert").textContent.toLowerCase()).toMatch(/pdf|png|jpe?g|docx|xlsx/);
  });

  // F7: a round submitted from elsewhere (another tab, another session)
  // 409s every subsequent autosave with air_already_submitted. Today the
  // banner just says "Request failed" and the inputs stay enabled,
  // continuing to display optimistic answers that were never written.
  it("F7: air_already_submitted refetches the bundle so the UI flips to read-only", async () => {
    const getAir = vi.spyOn(founderApi, "getAir")
      .mockResolvedValueOnce(makeBundle())
      .mockResolvedValueOnce(makeBundle({
        round: { id: "r1", round_label: "FY26-27-Q2", status: "submitted", submitted_at: "2026-08-01T00:00:00Z", verified_at: null },
      }));
    vi.spyOn(founderApi, "putAirLever").mockRejectedValue(
      new ApiError({ status: 409, code: "air_already_submitted", message: "Request failed" }),
    );
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Technology");
    await screen.findByText("Architecture & System Definition");

    fireEvent.click(screen.getByRole("radio", { name: "architecture-q1-B" }));

    await waitFor(() => expect(getAir).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("radio", { name: "architecture-q1-B" })).toBeDisabled());
  });

  // F8: onDelete removes the row optimistically with no rollback and no
  // refetch, so a delete that fails server-side makes the document vanish
  // from screen while it still survives on the server — and AIR evidence is
  // exactly what ARTPARK verifies against.
  it("F8: a failed delete refetches the bundle so the document that failed to delete reappears", async () => {
    const row = { id: "ev-1", filename: "sourcing-plan.pdf", size_bytes: 1024, uploaded_at: "2026-08-01T00:00:00Z", air_level: 1 };
    const b = makeBundle({
      levers: LEVERS_META.map((m) => leverRow(m, m.key === "architecture"
        ? { claimed_level: 1, required_document: "Arch doc", evidence: [row] }
        : {})),
    });
    b.catalog.documents.architecture = { 1: "Arch doc" };
    const getAir = vi.spyOn(founderApi, "getAir").mockResolvedValue(b);
    vi.spyOn(founderApi, "delAirEvidence").mockRejectedValue(new Error("delete failed"));
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Evidence");
    await screen.findByText("Scientific Principles & Models");

    expect(screen.getByText("sourcing-plan.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    // Optimistic removal happens immediately:
    expect(screen.queryByText("sourcing-plan.pdf")).not.toBeInTheDocument();

    // The delete fails server-side; a refetch brings the truth back.
    await waitFor(() => expect(getAir).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("sourcing-plan.pdf")).toBeInTheDocument());
  });

  it("F8: a failed upload also refetches, so the screen can't drift from the server", async () => {
    const b = makeBundle({
      levers: LEVERS_META.map((m) => leverRow(m, m.key === "architecture"
        ? { claimed_level: 1, required_document: "Arch doc" }
        : {})),
    });
    b.catalog.documents.architecture = { 1: "Arch doc" };
    const getAir = vi.spyOn(founderApi, "getAir").mockResolvedValue(b);
    vi.spyOn(founderApi, "uploadAirEvidence").mockRejectedValue(new Error("network down"));
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Evidence");
    await screen.findByText("Scientific Principles & Models");

    const archRow = screen.getByText("Architecture & System Definition").closest(".fj-evidence-row");
    const input = archRow.querySelector('input[type="file"]');
    const file = new File(["x"], "evidence.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(getAir).toHaveBeenCalledTimes(2));
  });

  // F9: two lever families across five steps is structural, but a lever in
  // any OTHER family must not be silently swallowed — today it renders in
  // Evidence and counts toward `missing` forever, with no step where it can
  // ever be answered.
  it("F9: a lever whose family the wizard has no step for is surfaced, and never blocks submit", async () => {
    const extra = {
      lever: "novel_lever", name: "Novel Lever", family: "financial",
      q1_option: null, q2_option: null, q3_option: null, criteria_checked: [],
      claimed_level: null, verified_level: null, verifier_note: null,
      required_document: null, criteria: [], evidence: [],
    };
    const b = makeBundle({
      levers: [...allClaimed(2), extra],
      rollups: { claimed: { technology: 2, commercial: 2, overall: 2 }, verified: { technology: null, commercial: null, overall: null } },
    });
    vi.spyOn(founderApi, "getAir").mockResolvedValue(b);
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");

    // Surfaced, not silently dropped:
    expect(screen.getByText(/Novel Lever/)).toBeInTheDocument();

    await goto("Scorecard");
    await screen.findByText("Scientific Principles & Models");
    // And doesn't block submit, despite never having (and never being able
    // to get) a claimed level:
    expect(screen.getByRole("button", { name: /submit assessment/i })).not.toBeDisabled();
  });

  // F14: actionError is never cleared on success today, so one transient
  // failure pins a red banner for the rest of the session even after later
  // saves succeed.
  it("F14: a successful save clears a previously shown error banner", async () => {
    vi.spyOn(founderApi, "getAir").mockResolvedValue(makeBundle());
    const putAirLever = vi.spyOn(founderApi, "putAirLever")
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(makeBundle({
        levers: LEVERS_META.map((m) => leverRow(m, m.key === "architecture" ? { q1_option: "B" } : {})),
      }));
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Technology");
    await screen.findByText("Architecture & System Definition");

    fireEvent.click(screen.getByRole("radio", { name: "architecture-q1-A" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("network down"));

    fireEvent.click(screen.getByRole("radio", { name: "architecture-q1-B" }));
    await waitFor(() => expect(putAirLever).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  // F15: EvidenceRow.jsx guards `lever.evidence || []`; the wizard's own
  // delete handler doesn't, so deleting a row crashes the whole step the
  // moment ANY other lever's evidence array is undefined — not just the
  // lever the row belongs to, since onDelete maps over every lever.
  it("F15: deleting a row doesn't crash when another lever's evidence array is undefined", async () => {
    const row = { id: "ev-1", filename: "doc.pdf", size_bytes: 10, uploaded_at: null, air_level: 1 };
    const levers = LEVERS_META.map((m) => {
      if (m.key === "architecture") return leverRow(m, { claimed_level: 1, required_document: "Arch doc", evidence: [row] });
      if (m.key === "user_needs") {
        const r = leverRow(m);
        delete r.evidence;
        return r;
      }
      return leverRow(m);
    });
    const b = makeBundle({ levers });
    b.catalog.documents.architecture = { 1: "Arch doc" };
    vi.spyOn(founderApi, "getAir").mockResolvedValue(b);
    vi.spyOn(founderApi, "delAirEvidence").mockResolvedValue(undefined);
    render(<FounderTlr />);
    await screen.findByText("ARTPARK Innovation Readiness");
    await goto("Evidence");
    await screen.findByText("Scientific Principles & Models");

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(screen.queryByText("doc.pdf")).not.toBeInTheDocument());
  });
});
