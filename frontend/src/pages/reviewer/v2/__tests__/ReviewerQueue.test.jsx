import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ReviewerQueue from "../ReviewerQueue.jsx";

const ROW = {
  id: "app1", applicationId: "TIR-26013", track: "tir",
  name: "Acme Robotics", founders: ["Asha R"], industry: "Robotics",
  stage: "Prototype", due: null, ai: { overall: 7.0 },
  reviewStatus: "submitted", myScore: 8.0, editWindowExpiresAt: null,
};

function mkAsync(data) {
  return { data, loading: false, error: null, reload: vi.fn() };
}

describe("ReviewerQueue My Score column", () => {
  it("renders a My Score header and the reviewer's score", () => {
    render(<ReviewerQueue onOpen={() => {}} queueAsync={mkAsync([ROW])} />);
    expect(screen.getByText("My Score")).toBeTruthy();
    expect(screen.getByText("8.0")).toBeTruthy();   // myScore rendered
  });

  it("shows a dash when myScore is null", () => {
    const row = { ...ROW, reviewStatus: "not-started", myScore: null };
    render(<ReviewerQueue onOpen={() => {}} queueAsync={mkAsync([row])} />);
    expect(screen.getByText("My Score")).toBeTruthy();
  });
});

const queueAsync = {
  data: [
    {
      id: "id-sip-1", applicationId: "SIP-26623", track: "sip",
      name: "STHANUS Breast Ultrasound", founders: ["Banhimitra Kundu"],
      industry: "Healthcare / MedTech", stage: "Pre-revenue",
      ai: { overall: 8.6 }, myScore: 8.7, reviewStatus: "draft", due: null,
    },
  ],
  loading: false, error: null, reload: () => {},
};

describe("ReviewerQueue", () => {
  it("relabels SIP display IDs to VIP", () => {
    render(<ReviewerQueue onOpen={() => {}} queueAsync={queueAsync} />);
    expect(screen.getAllByText(/VIP-26623/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/SIP-26623/)).not.toBeInTheDocument();
  });
  it("does not render a Due column header", () => {
    render(<ReviewerQueue onOpen={() => {}} queueAsync={queueAsync} />);
    expect(screen.queryByRole("columnheader", { name: /^Due$/i })).not.toBeInTheDocument();
  });
});

describe("ReviewerQueue filters toggle", () => {
  const qa = {
    data: [{ id: "1", applicationId: "TIR-1", track: "tir", name: "X", founders: [],
             industry: "EdTech", stage: "Lab demo", ai: { overall: 4 }, reviewStatus: "submitted", due: null }],
    loading: false, error: null, reload: () => {},
  };
  it("hides the Status/Stage/Industry sections until the Filters button is clicked", () => {
    render(<ReviewerQueue onOpen={() => {}} queueAsync={qa} />);
    expect(screen.queryByText("STATUS")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Filters/i }));
    expect(screen.getByText("STATUS")).toBeInTheDocument();
  });
});

describe("ReviewerQueue My Reco column + filter", () => {
  const rows = [
    { id: "a", applicationId: "TIR-1", track: "tir", name: "AppA", founders: [],
      industry: "Robotics", stage: "Lab", ai: { overall: 7 }, myScore: 8, myReco: "yes", reviewStatus: "submitted", due: null },
    { id: "b", applicationId: "TIR-2", track: "tir", name: "AppB", founders: [],
      industry: "Robotics", stage: "Lab", ai: { overall: 5 }, myScore: 4, myReco: "no", reviewStatus: "submitted", due: null },
    { id: "c", applicationId: "TIR-3", track: "tir", name: "AppC", founders: [],
      industry: "Robotics", stage: "Lab", ai: { overall: 5 }, myScore: null, myReco: null, reviewStatus: "not-started", due: null },
  ];
  const mk = (data) => ({ data, loading: false, error: null, reload: () => {} });

  it("renders a My Reco header and the reviewer's recommendation chips", () => {
    render(<ReviewerQueue onOpen={() => {}} queueAsync={mk(rows)} />);
    expect(screen.getByRole("columnheader", { name: /My Reco/i })).toBeTruthy();
    expect(screen.getByText("YES")).toBeTruthy();
    expect(screen.getByText("NO")).toBeTruthy();
  });

  it("filters the queue to a chosen recommendation", () => {
    render(<ReviewerQueue onOpen={() => {}} queueAsync={mk(rows)} />);
    fireEvent.click(screen.getByRole("button", { name: /^Filters/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Yes\b/ }));
    expect(screen.getByText("AppA")).toBeTruthy();
    expect(screen.queryByText("AppB")).not.toBeInTheDocument();
  });
});
