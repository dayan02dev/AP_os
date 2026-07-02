import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../api.js", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));
import { api } from "../api.js";
import { adminPlatformApi } from "../adminPlatformApi.js";

describe("adminPlatformApi seam", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("getPipeline → /admin/platform/applications", () => {
    adminPlatformApi.getPipeline();
    expect(api.get).toHaveBeenCalledWith("/admin/platform/applications");
  });

  it("getPipeline with params → query string", () => {
    adminPlatformApi.getPipeline({ track: "tir", status: "submitted", skip: null, empty: "" });
    expect(api.get).toHaveBeenCalledWith(
      "/admin/platform/applications?track=tir&status=submitted"
    );
  });

  it("getApplication → /admin/platform/applications/{track}/{id}", () => {
    adminPlatformApi.getApplication("tir", "app-1");
    expect(api.get).toHaveBeenCalledWith("/admin/platform/applications/tir/app-1");
  });

  it("decide → POST decision path", () => {
    adminPlatformApi.decide("vip", "app-9", { decision: "accept" });
    expect(api.post).toHaveBeenCalledWith(
      "/admin/platform/applications/vip/app-9/decision",
      { decision: "accept" }
    );
  });

  it("bulkDecide → POST /admin/platform/decisions/bulk", () => {
    adminPlatformApi.bulkDecide({ ids: [1, 2], decision: "reject" });
    expect(api.post).toHaveBeenCalledWith("/admin/platform/decisions/bulk", {
      ids: [1, 2],
      decision: "reject",
    });
  });

  it("patchMeta → PATCH meta path", () => {
    adminPlatformApi.patchMeta("tir", "app-3", { tag: "fast-track" });
    expect(api.patch).toHaveBeenCalledWith(
      "/admin/platform/applications/tir/app-3/meta",
      { tag: "fast-track" }
    );
  });

  it("getBatches → GET /admin/platform/batches", () => {
    adminPlatformApi.getBatches();
    expect(api.get).toHaveBeenCalledWith("/admin/platform/batches");
  });

  it("createBatch → POST /admin/platform/batches", () => {
    adminPlatformApi.createBatch({ name: "Batch A" });
    expect(api.post).toHaveBeenCalledWith("/admin/platform/batches", { name: "Batch A" });
  });

  it("renameBatch → PATCH /admin/platform/batches/{id}", () => {
    adminPlatformApi.renameBatch("b-1", { name: "Renamed" });
    expect(api.patch).toHaveBeenCalledWith("/admin/platform/batches/b-1", { name: "Renamed" });
  });

  it("assignBatch → POST /admin/platform/batches/{id}/applications", () => {
    adminPlatformApi.assignBatch("b-1", { application_ids: ["app-1"] });
    expect(api.post).toHaveBeenCalledWith("/admin/platform/batches/b-1/applications", {
      application_ids: ["app-1"],
    });
  });

  it("assignBatchReviewers → POST /admin/platform/batches/{id}/reviewers", () => {
    adminPlatformApi.assignBatchReviewers("b-1", { reviewer_user_ids: ["r-1"] });
    expect(api.post).toHaveBeenCalledWith("/admin/platform/batches/b-1/reviewers", {
      reviewer_user_ids: ["r-1"],
    });
  });

  it("unassignBatchReviewer → DELETE /admin/platform/batches/{id}/reviewers/{rid}", () => {
    adminPlatformApi.unassignBatchReviewer("b-1", "r-1");
    expect(api.del).toHaveBeenCalledWith("/admin/platform/batches/b-1/reviewers/r-1");
  });

  it("unassignBatch → POST /admin/platform/batches/unassign with items", () => {
    const items = [{ track: "tir", application_id: "app-1" }];
    adminPlatformApi.unassignBatch(items);
    expect(api.post).toHaveBeenCalledWith("/admin/platform/batches/unassign", { items });
  });

  it("getReviewers → GET /admin/platform/reviewers", () => {
    adminPlatformApi.getReviewers();
    expect(api.get).toHaveBeenCalledWith("/admin/platform/reviewers");
  });

  it("patchReviewer → PATCH /admin/platform/reviewers/{id}", () => {
    adminPlatformApi.patchReviewer("r-1", { active: false });
    expect(api.patch).toHaveBeenCalledWith("/admin/platform/reviewers/r-1", { active: false });
  });

  it("rebalance → POST /admin/platform/reviewers/rebalance", () => {
    adminPlatformApi.rebalance();
    expect(api.post).toHaveBeenCalledWith("/admin/platform/reviewers/rebalance", {});
  });

  it("rebalance with body → POST with body", () => {
    adminPlatformApi.rebalance({ strategy: "even" });
    expect(api.post).toHaveBeenCalledWith("/admin/platform/reviewers/rebalance", {
      strategy: "even",
    });
  });

  it("getAuditLog → GET /admin/platform/audit-log", () => {
    adminPlatformApi.getAuditLog();
    expect(api.get).toHaveBeenCalledWith("/admin/platform/audit-log");
  });

  it("getAuditLog with params → query string", () => {
    adminPlatformApi.getAuditLog({ actor: "admin", limit: 50 });
    expect(api.get).toHaveBeenCalledWith("/admin/platform/audit-log?actor=admin&limit=50");
  });

  it("getCalibration → GET reviewer-calibration", () => {
    adminPlatformApi.getCalibration();
    expect(api.get).toHaveBeenCalledWith("/admin/platform/analytics/reviewer-calibration");
  });

  it("getStats → GET /admin/platform/stats", () => {
    adminPlatformApi.getStats();
    expect(api.get).toHaveBeenCalledWith("/admin/platform/stats");
  });
});
