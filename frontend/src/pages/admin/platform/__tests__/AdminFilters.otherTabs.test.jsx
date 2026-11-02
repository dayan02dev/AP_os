// Admin filters outside the Applications tab: Admin Review (Gate 1 B batch
// filter, ADM-F4), Accepted tab filters, Manage Applications drawer picker
// (ADM-F5) and the reviewer-application adapter (ADM-F8).
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, act, renderHook, waitFor } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn(), loadDetail: vi.fn(() => new Promise(() => {})) }));
vi.mock("../../../../hooks/useAuth.jsx", () => ({ useAuth: () => ({ user: { email: "a@x.in" } }) }));
vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: { bulkDecide: vi.fn(), bulkAssignReviewerApps: vi.fn(), bulkRemoveReviewerApps: vi.fn(), getPipeline: vi.fn() },
}));
vi.mock("../../../../lib/icDocumentsApi", () => ({ icDocumentsApi: { list: vi.fn(), fileUrl: vi.fn() } }));

import { useAdminData } from "../../../../hooks/useAdminData";
import { adaptPipelineRow, adaptReviewerApplication } from "../../../../lib/adminDataAdapter";
import AdminGate1 from "../screens/AdminGate1";
import { AdminSelectedApplications } from "../screens/AdminSelectedApplications";
import { ManageApplicationsDrawer } from "../screens/ManageApplicationsDrawer";
import { writeStickyState } from "../../../../hooks/useStickyState.js";

const be = (o) => ({
  id: o.id, applicationId: o.appId, track: o.track, native_track: o.native || o.track, name: o.name,
  founder: "F", industry: o.industry || "Climate", status: o.status, batches: o.batches || [],
  batch: o.batches?.[0]?.name ?? null, submitted_at: "2026-07-01T00:00:00Z", moved_to_track: o.moved || null,
  gate2_decision: o.g2 || null, reco: null, review_count: 0,
});
const ok = (data) => ({ data, loading: false, error: null, reload: vi.fn() });

beforeEach(() => vi.clearAllMocks());

describe("Admin Review · B batch filter", () => {
  const EVAL = [
    be({ id: "e1", appId: "TIR-1", track: "tir", name: "EvalOne", status: "evaluated", batches: [{ id: "b1", name: "Batch A" }] }),
    be({ id: "e2", appId: "VIP-2", track: "sip", name: "EvalTwo", status: "evaluated", batches: [{ id: "b2", name: "Batch V" }] }),
  ].map(adaptPipelineRow);
  beforeEach(() => {
    useAdminData.mockImplementation((kind, params) => ok({ startups: params?.status === "evaluated" ? EVAL : EVAL, total: 2 }));
  });
  it("picking a batch narrows the list", () => {
    render(<AdminGate1 goDetail={vi.fn()} />);
    fireEvent.click(screen.getByText("B · Batch decision"));
    fireEvent.click(screen.getByRole("button", { name: /^Batch A \(1\)/ }));
    expect(screen.getByText("EvalOne")).toBeInTheDocument();
    expect(screen.queryByText("EvalTwo")).not.toBeInTheDocument();
  });
  it("ADM-F4: a stale sticky batch falls back to All", () => {
    writeStickyState("admin.gate1", "batch", "Batch Gone");
    render(<AdminGate1 goDetail={vi.fn()} />);
    fireEvent.click(screen.getByText("B · Batch decision"));
    // correct: fall back to All when the remembered batch no longer exists
    expect(screen.queryByText("EvalOne")).toBeInTheDocument();
  });
});

describe("Accepted tab filters", () => {
  const JR = [
    be({ id: "a1", appId: "TIR-11", track: "tir", name: "AccTir", status: "jury_review" }),
    be({ id: "a2", appId: "TIR-12", track: "sip", native: "tir", moved: "sip", name: "AccMoved", status: "jury_review" }),
  ].map(adaptPipelineRow);
  const OF = [be({ id: "a3", appId: "VIP-13", track: "sip", name: "AccOffered", status: "offered" })].map(adaptPipelineRow);
  beforeEach(() => {
    useAdminData.mockImplementation((kind, params) => {
      if (kind === "icDocuments") return ok({ documents: [], byKey: {}, listByKey: { "tir:a1": [{ id: "d1", signed: true }] } });
      return ok({ startups: params?.status === "offered" ? OF : JR, total: 1 });
    });
  });
  const names = () => ["AccTir", "AccMoved", "AccOffered"].filter((n) => screen.queryByText(n));
  it("track VIP (effective) / decision Accepted / search by ID", () => {
    render(<AdminSelectedApplications goDetail={vi.fn()} />);
    expect(names()).toHaveLength(3);
    fireEvent.click(within(screen.getByRole("group", { name: "Filter by track" })).getByText("VIP"));
    expect(names().sort()).toEqual(["AccMoved", "AccOffered"]);
    fireEvent.click(within(screen.getByRole("group", { name: "Filter by track" })).getByText("All tracks"));
    fireEvent.click(within(screen.getByRole("group", { name: "Filter by decision" })).getByText(/^Accepted/));
    expect(names()).toEqual(["AccTir"]);
    fireEvent.click(within(screen.getByRole("group", { name: "Filter by decision" })).getByText(/^All/));
    fireEvent.change(screen.getByLabelText("Search selected applications"), { target: { value: "tir-12" } });
    expect(names()).toEqual(["AccMoved"]);
  });
});

describe("Manage Applications drawer — assign picker", () => {
  const PIPE = [
    be({ id: "p1", appId: "TIR-21", track: "tir", name: "OpenApp", status: "submitted" }),
    be({ id: "p2", appId: "TIR-22", track: "tir", name: "RejectedApp", status: "rejected" }),
    be({ id: "p3", appId: "TIR-23", track: "tir", name: "AcceptedApp", status: "jury_review" }),
  ].map(adaptPipelineRow);
  beforeEach(() => {
    useAdminData.mockImplementation((kind) => {
      if (kind === "reviewerApplications") return ok({ applications: [] });
      return ok({ startups: PIPE, total: 3 });
    });
  });
  it("ADM-F5: picker excludes closed apps (rejected / accepted)", () => {
    render(<ManageApplicationsDrawer reviewer={{ id: "r1", name: "R", batches: [] }} onClose={vi.fn()} />);
    expect(screen.queryByLabelText("Assign candidate RejectedApp")).toBeNull();
    expect(screen.queryByLabelText("Assign candidate AcceptedApp")).toBeNull();
  });
  it("ADM-F5: picker search finds an app by its display ID", () => {
    render(<ManageApplicationsDrawer reviewer={{ id: "r1", name: "R", batches: [] }} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search applications to assign"), { target: { value: "TIR-21" } });
    expect(screen.queryByLabelText("Assign candidate OpenApp")).not.toBeNull();
  });
  it("ADM-F8: adapter keeps detached / effective_track / display_id", () => {
    const a = adaptReviewerApplication({ id: "x", track: "tir", effective_track: "sip", display_id: "TIR-9", detached: true, assignment_id: null, status: "evaluated" });
    expect(a.detached).toBe(true);
    expect(a.effective_track).toBe("sip");
    expect(a.display_id).toBe("TIR-9");
  });
});
