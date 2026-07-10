// JuryRespondForm tests — mock lib/api.js + react-router useParams.
// Mirrors MentorRespondForm.test.jsx structure.

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

describe("JuryRespondForm — load states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads token and shows name + Accept/Decline", async () => {
    api.get.mockResolvedValueOnce({ name: "Dr. Rao", email: "rao@x.com", status: "invited" });
    renderForm();

    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/jury/respond/test-token-123"));
    await waitFor(() => expect(screen.getByText(/Dr\. Rao/i)).toBeInTheDocument());
    expect(screen.getByText(/join the artpark tir jury panel/i)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^Yes$/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^No$/i })).toBeInTheDocument();
  });

  it("shows invalid state on an unknown token (404)", async () => {
    const err = Object.assign(new Error("Not found"), { status: 404 });
    api.get.mockRejectedValueOnce(err);
    renderForm();

    await waitFor(() => expect(screen.getByText(/invalid or expired/i)).toBeInTheDocument());
    expect(screen.queryByText(/jury panel\?/i)).not.toBeInTheDocument();
  });

  it("shows already-responded state when status !== 'invited'", async () => {
    api.get.mockResolvedValueOnce({ name: "Dr. Rao", email: "rao@x.com", status: "accepted" });
    renderForm();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /already responded/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/join the artpark tir jury panel/i)).not.toBeInTheDocument();
  });
});

describe("JuryRespondForm — Accept path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValueOnce({ name: "Dr. Rao", email: "rao@x.com", status: "invited" });
  });

  it("reveals expertise + linkedin inputs, submits {accept:true, expertise_domains, linkedin_url}, shows success screen mentioning email", async () => {
    api.post.mockResolvedValueOnce({ status: "ok" });
    renderForm();

    await waitFor(() => screen.getByText(/join the artpark tir jury panel/i));

    fireEvent.click(screen.getByRole("radio", { name: /^Yes$/i }));

    const expertiseInput = await waitFor(() => screen.getByLabelText(/expertise/i));
    fireEvent.change(expertiseInput, { target: { value: "Robotics, HealthTech ," } });

    const linkedinInput = screen.getByLabelText(/linkedin/i);
    fireEvent.change(linkedinInput, { target: { value: "https://linkedin.com/in/drrao" } });

    const submitBtn = screen.getByRole("button", { name: /submit/i });
    fireEvent.click(submitBtn);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/jury/respond/test-token-123", {
        accept: true,
        expertise_domains: ["Robotics", "HealthTech"],
        linkedin_url: "https://linkedin.com/in/drrao",
      }),
    );

    await waitFor(() => expect(screen.getByText(/rao@x\.com/i)).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: /on the panel/i })).toBeInTheDocument();
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

    await waitFor(() => screen.getByText(/join the artpark tir jury panel/i));

    fireEvent.click(screen.getByRole("radio", { name: /^No$/i }));

    const submitBtn = await waitFor(() => screen.getByRole("button", { name: /submit/i }));
    fireEvent.click(submitBtn);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/jury/respond/test-token-123", { accept: false }),
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /thank you/i })).toBeInTheDocument(),
    );
  });
});
