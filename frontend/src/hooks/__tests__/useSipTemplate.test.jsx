import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { useSipTemplate } from "../useSipTemplate.js";
import { api } from "../../lib/api.js";

vi.mock("../../lib/api.js", () => ({
  api: {
    uploadSipTemplate: vi.fn(),
    getMySipTemplate: vi.fn(),
    applySipTemplate: vi.fn(),
  },
  UPLOAD_TIMEOUT_MS: 60000,
}));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

const fakeFile = new File(["x"], "sip.docx", {
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});

describe("useSipTemplate", () => {
  it("transitions uploading → parsing → completed → applying → done on happy path", async () => {
    api.uploadSipTemplate.mockResolvedValue({
      template_id: "t1", parse_status: "completed", original_filename: "sip.docx",
      parsed_data: { Q5: "Yes — Pvt Ltd, registered in India" },
    });
    api.applySipTemplate.mockResolvedValue({
      applied_fields: ["sip_incorporated", "problem_describe"],
      skipped_fields: [], missing_answers: [],
    });

    const { result } = renderHook(() => useSipTemplate());
    await act(async () => {
      await result.current.upload(fakeFile);
    });

    expect(api.uploadSipTemplate).toHaveBeenCalledWith(fakeFile, expect.any(Object));
    expect(api.applySipTemplate).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(result.current.applyResult).toMatchObject({
        applied_fields: ["sip_incorporated", "problem_describe"],
      });
    });
    expect(result.current.error).toBeNull();
  });

  it("polls GET /me every 3s when upload returns pending, up to MAX_POLLS", async () => {
    api.uploadSipTemplate.mockResolvedValue({
      template_id: "t1", parse_status: "pending",
    });
    let pollCount = 0;
    api.getMySipTemplate.mockImplementation(async () => {
      pollCount += 1;
      return pollCount < 3
        ? { template_id: "t1", parse_status: "processing" }
        : { template_id: "t1", parse_status: "completed",
            parsed_data: { Q5: "Yes — Pvt Ltd, registered in India" } };
    });
    api.applySipTemplate.mockResolvedValue({
      applied_fields: [], skipped_fields: [], missing_answers: [],
    });

    const { result } = renderHook(() => useSipTemplate());
    act(() => { result.current.upload(fakeFile); });

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

    await waitFor(() => {
      expect(api.applySipTemplate).toHaveBeenCalledOnce();
    });
    expect(api.getMySipTemplate).toHaveBeenCalledTimes(3);
  });

  it("does not call apply when parse_status fails", async () => {
    api.uploadSipTemplate.mockResolvedValue({
      template_id: "t1", parse_status: "failed", message: "wrong_track_template",
    });

    const { result } = renderHook(() => useSipTemplate());
    await act(async () => { await result.current.upload(fakeFile); });

    expect(api.applySipTemplate).not.toHaveBeenCalled();
    expect(result.current.template?.parse_status).toBe("failed");
  });

  it("surfaces upload error via error state", async () => {
    const err = new Error("network error");
    api.uploadSipTemplate.mockRejectedValue(err);

    const { result } = renderHook(() => useSipTemplate());
    await act(async () => {
      try { await result.current.upload(fakeFile); } catch { /* swallow */ }
    });

    expect(result.current.error).toBe(err);
    expect(result.current.uploading).toBe(false);
  });

  it("invokes onApplied callback with apply result", async () => {
    api.uploadSipTemplate.mockResolvedValue({
      template_id: "t1", parse_status: "completed",
      parsed_data: { Q5: "Yes — Pvt Ltd, registered in India" },
    });
    const applyResult = {
      applied_fields: ["sip_incorporated"], skipped_fields: [], missing_answers: [],
    };
    api.applySipTemplate.mockResolvedValue(applyResult);

    const onApplied = vi.fn();
    const { result } = renderHook(() => useSipTemplate({ onApplied }));
    await act(async () => { await result.current.upload(fakeFile); });
    await waitFor(() => { expect(onApplied).toHaveBeenCalledWith(applyResult); });
  });
});
