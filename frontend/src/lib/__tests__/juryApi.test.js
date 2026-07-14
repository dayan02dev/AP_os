import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../api.js", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), put: vi.fn() },
}));
import { api } from "../api.js";
import { juryApi } from "../juryApi.js";

describe("juryApi seam", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("getQueue → GET /jury/queue", () => {
    juryApi.getQueue();
    expect(api.get).toHaveBeenCalledWith("/jury/queue");
  });

  it("getContent → GET /jury/applications/{track}/{id}/content", () => {
    juryApi.getContent("tir", "app-1");
    expect(api.get).toHaveBeenCalledWith("/jury/applications/tir/app-1/content");
  });

  it("fileSignedUrl → GET signed-url with encoded storage_path", () => {
    juryApi.fileSignedUrl("tir", "app-1", "tir/app-1/resume.pdf");
    expect(api.get).toHaveBeenCalledWith(
      "/jury/applications/tir/app-1/files/signed-url?storage_path=tir%2Fapp-1%2Fresume.pdf"
    );
  });

  it("getMySelections → GET /jury/selections/mine", () => {
    juryApi.getMySelections();
    expect(api.get).toHaveBeenCalledWith("/jury/selections/mine");
  });

  it("putSelections → PUT /jury/selections with {selections}", () => {
    const selections = [
      { application_id: "a1", application_track: "tir", note: "great fit" },
      { application_id: "a2", application_track: "sip", note: "" },
      { application_id: "a3", application_track: "tir", note: "" },
    ];
    juryApi.putSelections(selections);
    expect(api.put).toHaveBeenCalledWith("/jury/selections", { selections });
  });
});
