import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../api.js", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));
import { api } from "../api.js";
import { reviewerApi } from "../reviewerApi.js";

describe("reviewerApi v2 seam", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("getQueue → /reviewer/queue", () => {
    reviewerApi.getQueue();
    expect(api.get).toHaveBeenCalledWith("/reviewer/queue");
  });
  it("getContent → content path", () => {
    reviewerApi.getContent("tir", "app-1");
    expect(api.get).toHaveBeenCalledWith("/reviewer/applications/tir/app-1/content");
  });
  it("getHistory → /reviewer/history", () => {
    reviewerApi.getHistory();
    expect(api.get).toHaveBeenCalledWith("/reviewer/history");
  });
  it("getRubric → rubric path with track", () => {
    reviewerApi.getRubric("sip");
    expect(api.get).toHaveBeenCalledWith("/reviewer/rubric?track=sip");
  });
});
