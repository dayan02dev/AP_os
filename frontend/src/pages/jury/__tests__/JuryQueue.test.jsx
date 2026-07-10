import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Four assigned apps, none picked yet.
const QUEUE = [
  { id: "a1", assignmentId: "as1", applicationId: "TIR-1", track: "tir",
    name: "Alpha Robotics", founders: ["Asha R"], industry: "Robotics",
    stage: "Prototype", due: null, ai: { overall: 7.0 }, picked: false, pickNote: null },
  { id: "a2", assignmentId: "as2", applicationId: "TIR-2", track: "tir",
    name: "Beta Bio", founders: ["Bhavna"], industry: "HealthTech",
    stage: "Lab demo", due: null, ai: { overall: 6.1 }, picked: false, pickNote: null },
  { id: "a3", assignmentId: "as3", applicationId: "SIP-3", track: "sip",
    name: "Gamma Grid", founders: ["Gita"], industry: "Energy",
    stage: "Pilot", due: null, ai: { overall: 8.2 }, picked: false, pickNote: null },
  { id: "a4", assignmentId: "as4", applicationId: "TIR-4", track: "tir",
    name: "Delta Drones", founders: ["Deep"], industry: "Aerospace",
    stage: "Prototype", due: null, ai: { overall: 5.5 }, picked: false, pickNote: null },
];

const putSelections = vi.fn(() => Promise.resolve({ selections: [], submitted_at: "2026-07-10T00:00:00Z" }));

vi.mock("../../../lib/juryApi.js", () => ({
  juryApi: {
    getQueue: () => Promise.resolve(QUEUE),
    getMySelections: () => Promise.resolve({ selections: [] }),
    putSelections: (sel) => putSelections(sel),
    getContent: vi.fn(),
    fileSignedUrl: vi.fn(),
  },
}));

vi.mock("../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({
    user: { email: "juror@artpark.in", full_name: "Dr Rao", roles: ["jury"] },
    logout: vi.fn(),
  }),
}));

import JuryPortal from "../JuryPortal.jsx";

function renderQueue() {
  return render(
    <MemoryRouter initialEntries={["/jury/queue"]}>
      <JuryPortal tab="queue" />
    </MemoryRouter>,
  );
}

const pickBtnOf = (name) =>
  within(screen.getByText(name).closest("tr")).getByRole("button");

describe("JuryQueue + PickBar", () => {
  it("renders the assigned queue rows from the mocked juryApi", async () => {
    renderQueue();
    expect(await screen.findByText("Alpha Robotics")).toBeTruthy();
    expect(screen.getByText("Beta Bio")).toBeTruthy();
    expect(screen.getByText("Gamma Grid")).toBeTruthy();
    expect(screen.getByText("Delta Drones")).toBeTruthy();
  });

  it("a Pick toggle adds the row to the pick bar", async () => {
    renderQueue();
    await screen.findByText("Alpha Robotics");
    expect(screen.getByText(/Your picks:\s*0\s*\/\s*3/)).toBeTruthy();
    fireEvent.click(pickBtnOf("Alpha Robotics"));
    expect(screen.getByText(/Your picks:\s*1\s*\/\s*3/)).toBeTruthy();
  });

  it("blocks a 4th pick — still exactly 3", async () => {
    renderQueue();
    await screen.findByText("Alpha Robotics");
    ["Alpha Robotics", "Beta Bio", "Gamma Grid"].forEach((n) =>
      fireEvent.click(pickBtnOf(n)),
    );
    expect(screen.getByText(/Your picks:\s*3\s*\/\s*3/)).toBeTruthy();
    const delta = pickBtnOf("Delta Drones");
    expect(delta).toBeDisabled();
    fireEvent.click(delta);
    expect(screen.getByText(/Your picks:\s*3\s*\/\s*3/)).toBeTruthy();
  });

  it("Submit is disabled until exactly 3 are picked", async () => {
    renderQueue();
    await screen.findByText("Alpha Robotics");
    const submit = screen.getByRole("button", { name: /Submit/i });
    expect(submit).toBeDisabled();
    fireEvent.click(pickBtnOf("Alpha Robotics"));
    expect(submit).toBeDisabled();
    fireEvent.click(pickBtnOf("Beta Bio"));
    expect(submit).toBeDisabled();
    fireEvent.click(pickBtnOf("Gamma Grid"));
    expect(submit).not.toBeDisabled();
  });
});
