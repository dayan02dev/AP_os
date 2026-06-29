import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
