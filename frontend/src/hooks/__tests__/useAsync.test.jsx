import { describe, it, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAsync } from "../useAsync.js";

describe("useAsync", () => {
  it("starts in loading state then resolves to data", async () => {
    const fn = vi.fn().mockResolvedValue({ id: 1 });
    const { result } = renderHook(() => useAsync(fn, []));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual({ id: 1 });
    expect(result.current.error).toBeNull();
  });

  it("captures rejection in error state", async () => {
    const err = new Error("boom");
    const fn = vi.fn().mockRejectedValue(err);
    const { result } = renderHook(() => useAsync(fn, []));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe(err);
    expect(result.current.data).toBeNull();
  });

  it("reload re-runs the fn and updates data", async () => {
    let call = 0;
    const fn = vi.fn().mockImplementation(() => Promise.resolve(++call));
    const { result } = renderHook(() => useAsync(fn, []));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe(1);

    act(() => { result.current.reload(); });
    await waitFor(() => expect(result.current.data).toBe(2));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
