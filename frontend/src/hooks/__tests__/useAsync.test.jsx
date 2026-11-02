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

  it("background reload keeps the previous data when it fails", async () => {
    const fn = vi.fn().mockResolvedValueOnce("first").mockRejectedValueOnce(new Error("blip"));
    const { result } = renderHook(() => useAsync(fn, []));
    await waitFor(() => expect(result.current.data).toBe("first"));
    act(() => { result.current.reload({ background: true }); });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe("first");
    expect(result.current.error).toBeNull();
  });

  it("background reload shows the error when there is no previous data", async () => {
    const err = new Error("down");
    const fn = vi.fn().mockRejectedValue(err);
    const { result } = renderHook(() => useAsync(fn, []));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.reload({ background: true }); });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(err);
  });

  it("background reload is skipped while a request is in flight", async () => {
    let resolve;
    const fn = vi.fn().mockImplementationOnce(() => Promise.resolve("first"))
      .mockImplementation(() => new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useAsync(fn, []));
    await waitFor(() => expect(result.current.data).toBe("first"));
    act(() => { result.current.reload({ background: true }); });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    act(() => { result.current.reload({ background: true }); });
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(fn).toHaveBeenCalledTimes(2);
    await act(async () => { resolve("second"); });
    expect(result.current.data).toBe("second");
  });
});
