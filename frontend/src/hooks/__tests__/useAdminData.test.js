import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAdminData } from "../useAdminData";
import { adminPlatformApi } from "../../lib/adminPlatformApi";

vi.mock("../../lib/adminPlatformApi", () => ({ adminPlatformApi: { getPipeline: vi.fn() } }));

it("fetches + adapts pipeline rows", async () => {
  adminPlatformApi.getPipeline.mockResolvedValue({ applications: [
    { id: "u1", name: "Karkhana", founder: "A", industry: "Robotics", status: "under_review" },
  ], total: 1 });
  const { result } = renderHook(() => useAdminData("pipeline", {}));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.data.startups[0].chip).toBe("IN REVIEW");
});

it("retries a failed load when asked (e.g. a request aborted mid tab-switch)", async () => {
  adminPlatformApi.getPipeline.mockReset();
  adminPlatformApi.getPipeline
    .mockRejectedValueOnce(Object.assign(new Error("Request timed out"), { code: "timeout" }))
    .mockResolvedValueOnce({ applications: [], total: 7 });
  const { result } = renderHook(() => useAdminData("pipeline", {}, { retries: 2, retryDelayMs: 0 }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe(null);
  expect(result.current.data.total).toBe(7);
  expect(adminPlatformApi.getPipeline).toHaveBeenCalledTimes(2);
});

it("keeps the previous data while a reload is in flight", async () => {
  adminPlatformApi.getPipeline.mockReset();
  adminPlatformApi.getPipeline.mockResolvedValueOnce({ applications: [], total: 3 });
  const { result } = renderHook(() => useAdminData("pipeline", {}));
  await waitFor(() => expect(result.current.data?.total).toBe(3));
  adminPlatformApi.getPipeline.mockReturnValueOnce(new Promise(() => {}));
  result.current.reload();
  await waitFor(() => expect(result.current.loading).toBe(true));
  expect(result.current.data.total).toBe(3);
});
