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
