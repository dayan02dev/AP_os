// MentorRespondForm tests — mock the hook + react-router useParams.
// Four scenarios: No path, Yes path Q2–Q4 reveal, honorarium bank fields,
// submit success screen.

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
/* Mock the hook                                                         */
/* ------------------------------------------------------------------ */

const mockLoad = vi.fn();
const mockSubmit = vi.fn();

vi.mock("../../hooks/useMentorForm.js", () => ({
  useMentorForm: () => ({
    load: mockLoad,
    submit: mockSubmit,
    loading: false,
    submitting: false,
    error: null,
  }),
}));

/* ------------------------------------------------------------------ */
/* Import after mocks are registered                                    */
/* ------------------------------------------------------------------ */

import MentorRespondForm from "../MentorRespondForm.jsx";

/* ------------------------------------------------------------------ */
/* Helpers                                                               */
/* ------------------------------------------------------------------ */

function renderForm() {
  return render(<MentorRespondForm />);
}

/* ------------------------------------------------------------------ */
/* Tests                                                                 */
/* ------------------------------------------------------------------ */

describe("MentorRespondForm — load states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'already responded' copy when already_responded is true", async () => {
    mockLoad.mockResolvedValueOnce({
      mentor_name: "Dr. Ravi Kumar",
      email: "ravi@example.com",
      already_responded: true,
    });
    renderForm();
    await waitFor(() =>
      expect(screen.getByText(/already responded/i)).toBeInTheDocument(),
    );
    // Should NOT show the form
    expect(
      screen.queryByText(/willing to mentor/i),
    ).not.toBeInTheDocument();
  });

  it("shows invalid/expired copy on a 404 error", async () => {
    const err = Object.assign(new Error("Not found"), { status: 404 });
    mockLoad.mockRejectedValueOnce(err);
    renderForm();
    await waitFor(() =>
      expect(screen.getByText(/invalid or expired/i)).toBeInTheDocument(),
    );
  });

  it("shows the form with mentor name on successful load", async () => {
    mockLoad.mockResolvedValueOnce({
      mentor_name: "Dr. Priya Sharma",
      email: "priya@example.com",
      already_responded: false,
    });
    renderForm();
    await waitFor(() =>
      expect(screen.getByText(/Hello, Dr. Priya Sharma/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/willing to mentor/i),
    ).toBeInTheDocument();
  });
});

describe("MentorRespondForm — No path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoad.mockResolvedValueOnce({
      mentor_name: "Test Mentor",
      email: "test@example.com",
      already_responded: false,
    });
  });

  it("reveals submit button after selecting No and submits { willing: false }", async () => {
    mockSubmit.mockResolvedValueOnce({});
    renderForm();

    // Wait for form to appear
    await waitFor(() =>
      screen.getByText(/willing to mentor/i),
    );

    // Click "No"
    fireEvent.click(screen.getByRole("radio", { name: /^No$/i }));

    // Submit button should appear
    const submitBtn = await waitFor(() =>
      screen.getByRole("button", { name: /submit/i }),
    );
    expect(submitBtn).toBeInTheDocument();

    fireEvent.click(submitBtn);

    await waitFor(() =>
      expect(mockSubmit).toHaveBeenCalledWith("test-token-123", { willing: false }),
    );

    // Thank-you copy for No path
    await waitFor(() =>
      expect(
        screen.getByText(/truly appreciate and respect your decision/i),
      ).toBeInTheDocument(),
    );
  });
});

describe("MentorRespondForm — Yes path reveals Q2–Q4", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoad.mockResolvedValueOnce({
      mentor_name: "Test Mentor",
      email: "test@example.com",
      already_responded: false,
    });
  });

  it("reveals Q2 days input and Q3 honorarium radios when Yes is selected", async () => {
    renderForm();
    await waitFor(() => screen.getByText(/willing to mentor/i));

    // Click "Yes"
    fireEvent.click(screen.getByRole("radio", { name: /^Yes$/i }));

    // Q2 should appear
    await waitFor(() =>
      expect(
        screen.getByLabelText(/how many days/i),
      ).toBeInTheDocument(),
    );

    // Q3 should appear
    expect(
      screen.getByText(/open to a small honorarium/i),
    ).toBeInTheDocument();

    // Q4 should appear
    expect(
      screen.getByText(/future communications/i),
    ).toBeInTheDocument();
  });
});

describe("MentorRespondForm — honorarium Yes reveals bank fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoad.mockResolvedValueOnce({
      mentor_name: "Test Mentor",
      email: "test@example.com",
      already_responded: false,
    });
  });

  it("shows account name / account number / IFSC when honorarium is Yes", async () => {
    renderForm();
    await waitFor(() => screen.getByText(/willing to mentor/i));

    // Select willing = Yes
    fireEvent.click(screen.getByRole("radio", { name: /^Yes$/i }));

    // Wait for Q3 radios
    await waitFor(() =>
      screen.getByText(/open to a small honorarium/i),
    );

    // Select honorarium = Yes (second group of Yes/No radios)
    const allYesRadios = screen.getAllByRole("radio", { name: /^Yes$/i });
    // allYesRadios[0] = willing yes (already checked), [1] = honorarium yes
    fireEvent.click(allYesRadios[1]);

    // Bank fields should appear
    await waitFor(() =>
      expect(
        screen.getByLabelText(/account holder name/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/account number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ifsc/i)).toBeInTheDocument();
  });
});

describe("MentorRespondForm — success screen on submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoad.mockResolvedValueOnce({
      mentor_name: "Dr. Anjali Singh",
      email: "anjali@example.com",
      already_responded: false,
    });
  });

  it("shows the success screen after a successful Yes submission", async () => {
    mockSubmit.mockResolvedValueOnce({});
    renderForm();

    await waitFor(() => screen.getByText(/willing to mentor/i));

    // Select Yes
    fireEvent.click(screen.getByRole("radio", { name: /^Yes$/i }));

    // Fill in days
    await waitFor(() => screen.getByLabelText(/how many days/i));
    fireEvent.change(screen.getByLabelText(/how many days/i), {
      target: { value: "3 days per month" },
    });

    // Submit
    const submitBtn = screen.getByRole("button", { name: /submit/i });
    fireEvent.click(submitBtn);

    await waitFor(() =>
      expect(
        screen.getByText(/Welcome aboard/i),
      ).toBeInTheDocument(),
    );
  });
});
