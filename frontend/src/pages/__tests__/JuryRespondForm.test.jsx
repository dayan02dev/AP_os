// JuryRespondForm tests — mock lib/api.js + react-router useParams.
// Mirrors MentorRespondForm.test.jsx structure.

import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/* Mock react-router-dom useParams                                      */
/* ------------------------------------------------------------------ */

vi.mock("react-router-dom", () => ({
  useParams: () => ({ token: "test-token-123" }),
}));

/* ------------------------------------------------------------------ */
/* Mock lib/api.js                                                       */
/* ------------------------------------------------------------------ */

vi.mock("../../lib/api.js", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from "../../lib/api.js";
import JuryRespondForm from "../JuryRespondForm.jsx";

/* ------------------------------------------------------------------ */
/* Helpers                                                               */
/* ------------------------------------------------------------------ */

function renderForm() {
  return render(<JuryRespondForm />);
}

const JOIN_Q = /would you like to join the artpark tir jury and mentor panel/i;
const yesRadio = () => screen.getByRole("radio", { name: /count me in/i });
const noRadio = () => screen.getByRole("radio", { name: /not this time/i });

// Mentoring and future-comms both render plain Yes/No radios, so a bare
// /^yes$/ query is ambiguous — always scope to the named radiogroup.
const inGroup = (name) => within(screen.getByRole("radiogroup", { name }));

// Fill the minimum an accepting juror must provide (expertise + LinkedIn +
// mentoring + honorarium choice) so individual tests can focus on one branch.
async function fillRequired({ honorarium = "no" } = {}) {
  fireEvent.click(yesRadio());
  const expertise = await waitFor(() => screen.getByLabelText(/areas of expertise/i));
  fireEvent.change(expertise, { target: { value: "Robotics, HealthTech ," } });
  fireEvent.change(screen.getByLabelText(/linkedin profile/i), {
    target: { value: "https://linkedin.com/in/drrao" },
  });
  fireEvent.click(inGroup("mentoring").getByRole("radio", { name: /^yes$/i }));
  fireEvent.click(
    inGroup("honorarium").getByRole("radio", {
      name: honorarium === "yes" ? /yes, please/i : /pro bono/i,
    }),
  );
}

describe("JuryRespondForm — load states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads token and shows name + Accept/Decline", async () => {
    api.get.mockResolvedValueOnce({ name: "Dr. Rao", email: "rao@x.com", status: "invited" });
    renderForm();

    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/jury/respond/test-token-123"));
    await waitFor(() => expect(screen.getByText(/Dr\. Rao/i)).toBeInTheDocument());
    expect(screen.getByText(JOIN_Q)).toBeInTheDocument();
    expect(yesRadio()).toBeInTheDocument();
    expect(noRadio()).toBeInTheDocument();
  });

  it("explains the two-phase engagement and the honorarium up front", async () => {
    api.get.mockResolvedValueOnce({ name: "Dr. Rao", email: "rao@x.com", status: "invited" });
    renderForm();

    await waitFor(() => screen.getByText(JOIN_Q));
    expect(screen.getByText(/pick the three ventures you would most like to mentor/i)).toBeInTheDocument();
    expect(screen.getByText(/one day per month per startup/i)).toBeInTheDocument();
    expect(screen.getByText(/monthly honorarium/i)).toBeInTheDocument();
  });

  it("shows invalid state on an unknown token (404)", async () => {
    const err = Object.assign(new Error("Not found"), { status: 404 });
    api.get.mockRejectedValueOnce(err);
    renderForm();

    await waitFor(() => expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument());
    expect(screen.queryByText(JOIN_Q)).not.toBeInTheDocument();
  });

  it("shows already-responded state when status !== 'invited'", async () => {
    api.get.mockResolvedValueOnce({ name: "Dr. Rao", email: "rao@x.com", status: "accepted" });
    renderForm();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /already responded/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(JOIN_Q)).not.toBeInTheDocument();
  });
});

describe("JuryRespondForm — Accept path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValueOnce({ name: "Dr. Rao", email: "rao@x.com", status: "invited" });
  });

  // REGRESSION: `Shell` used to be declared inside the component, so every
  // keystroke remounted the subtree and the field lost focus after one
  // character — the reported "can't type in the domain / LinkedIn cell" bug.
  // Typing character-by-character through userEvent reproduces it exactly;
  // fireEvent.change sets the value in one shot and would NOT catch it.
  it("keeps focus while typing into the expertise and LinkedIn fields", async () => {
    const user = userEvent.setup();
    renderForm();

    await waitFor(() => screen.getByText(JOIN_Q));
    fireEvent.click(yesRadio());

    const expertise = await waitFor(() => screen.getByLabelText(/areas of expertise/i));
    await user.click(expertise);
    await user.keyboard("Robotics");
    expect(screen.getByLabelText(/areas of expertise/i)).toHaveValue("Robotics");
    expect(screen.getByLabelText(/areas of expertise/i)).toHaveFocus();

    const linkedin = screen.getByLabelText(/linkedin profile/i);
    await user.click(linkedin);
    await user.keyboard("https://linkedin.com/in/rao");
    expect(screen.getByLabelText(/linkedin profile/i)).toHaveValue("https://linkedin.com/in/rao");
    expect(screen.getByLabelText(/linkedin profile/i)).toHaveFocus();
  });

  it("submits the full accept payload and shows the welcome screen", async () => {
    api.post.mockResolvedValueOnce({ status: "ok" });
    renderForm();

    await waitFor(() => screen.getByText(JOIN_Q));
    await fillRequired({ honorarium: "no" });

    fireEvent.change(screen.getByLabelText(/institution/i), { target: { value: "IISc" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = api.post.mock.calls[0];
    expect(body).toMatchObject({
      accept: true,
      expertise_domains: ["Robotics", "HealthTech"],
      linkedin_url: "https://linkedin.com/in/drrao",
      affiliation: "IISc",
      mentoring_opt_in: true,
      honorarium_opt_in: false,
    });
    // Opting out of the honorarium must not send a bank block at all.
    expect(body.bank_details).toBeUndefined();

    await waitFor(() => expect(screen.getByText(/rao@x\.com/i)).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: /welcome to the panel/i })).toBeInTheDocument();
  });

  it("collects bank details and sends them when the honorarium is accepted", async () => {
    api.post.mockResolvedValueOnce({ status: "ok" });
    renderForm();

    await waitFor(() => screen.getByText(JOIN_Q));
    await fillRequired({ honorarium: "yes" });

    fireEvent.change(await waitFor(() => screen.getByLabelText(/account holder name/i)), {
      target: { value: "A N Example" },
    });
    fireEvent.change(screen.getByLabelText(/account number/i), { target: { value: "123456789012" } });
    fireEvent.change(screen.getByLabelText(/ifsc/i), { target: { value: "hdfc0001234" } });

    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = api.post.mock.calls[0];
    expect(body.honorarium_opt_in).toBe(true);
    expect(body.bank_details).toMatchObject({
      account_name: "A N Example",
      account_number: "123456789012",
      ifsc: "HDFC0001234", // upper-cased on the way out
    });
  });

  it("blocks submission when the honorarium is accepted but bank details are blank", async () => {
    renderForm();

    await waitFor(() => screen.getByText(JOIN_Q));
    await fillRequired({ honorarium: "yes" });

    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    expect(api.post).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("blocks accept until expertise + LinkedIn are filled", async () => {
    renderForm();

    await waitFor(() => screen.getByText(JOIN_Q));
    fireEvent.click(yesRadio());

    const submitBtn = await waitFor(() => screen.getByRole("button", { name: /submit/i }));
    fireEvent.click(submitBtn);

    expect(api.post).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("JuryRespondForm — Decline path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValueOnce({ name: "Dr. Rao", email: "rao@x.com", status: "invited" });
  });

  it("posts {accept:false} and shows a thank-you screen", async () => {
    api.post.mockResolvedValueOnce({ status: "ok" });
    renderForm();

    await waitFor(() => screen.getByText(JOIN_Q));

    fireEvent.click(noRadio());

    const submitBtn = await waitFor(() => screen.getByRole("button", { name: /submit/i }));
    fireEvent.click(submitBtn);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/jury/respond/test-token-123", { accept: false }),
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /thank you/i })).toBeInTheDocument(),
    );
  });

  // Declining must never surface the bank / honorarium block.
  it("does not ask a declining juror for any details", async () => {
    renderForm();
    await waitFor(() => screen.getByText(JOIN_Q));
    fireEvent.click(noRadio());

    expect(screen.queryByLabelText(/areas of expertise/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/account number/i)).not.toBeInTheDocument();
  });
});
