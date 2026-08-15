import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useStickyState, STICKY_PREFIX, clearStickyState } from "../useStickyState.js";

// jsdom's Storage is Proxy-backed, so vi.spyOn(sessionStorage, ...) silently
// fails to intercept — the spy records zero calls while the real method runs.
// Replacing the whole global is the only way to exercise the failure paths.
function stubStorage(overrides) {
  vi.stubGlobal("sessionStorage", {
    length: 0,
    key: () => null,
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useStickyState", () => {
  it("returns the initial value when nothing is stored", () => {
    const { result } = renderHook(() => useStickyState("admin.pipeline", "status", "all"));
    expect(result.current[0]).toBe("all");
  });

  it("restores the last set value on a fresh mount of the same scope+field", () => {
    const first = renderHook(() => useStickyState("admin.pipeline", "status", "all"));
    act(() => { first.result.current[1]("rejected"); });
    expect(first.result.current[0]).toBe("rejected");
    first.unmount();

    const second = renderHook(() => useStickyState("admin.pipeline", "status", "all"));
    expect(second.result.current[0]).toBe("rejected");
  });

  it("writes the value to sessionStorage under the namespaced key", () => {
    const { result } = renderHook(() => useStickyState("reviewer.queue", "track", "all"));
    act(() => { result.current[1]("tir"); });
    expect(sessionStorage.getItem(`${STICKY_PREFIX}reviewer.queue.track`)).toBe('"tir"');
  });

  it("supports the updater-function form like useState", () => {
    const { result } = renderHook(() => useStickyState("admin.pipeline", "sortAsc", true));
    act(() => { result.current[1]((prev) => !prev); });
    expect(result.current[0]).toBe(false);

    const remounted = renderHook(() => useStickyState("admin.pipeline", "sortAsc", true));
    expect(remounted.result.current[0]).toBe(false);
  });

  it("keeps two scopes independent so one tab's filter never leaks into another", () => {
    const apps = renderHook(() => useStickyState("admin.pipeline.applications", "status", "all"));
    act(() => { apps.result.current[1]("evaluated"); });

    const rejected = renderHook(() => useStickyState("admin.pipeline.rejected", "status", "all"));
    expect(rejected.result.current[0]).toBe("all");
  });

  it("falls back to the initial value when the stored JSON is corrupt", () => {
    sessionStorage.setItem(`${STICKY_PREFIX}admin.pipeline.status`, "{not json");
    const { result } = renderHook(() => useStickyState("admin.pipeline", "status", "all"));
    expect(result.current[0]).toBe("all");
  });

  it("still works in-memory when sessionStorage reads throw (Safari private mode)", () => {
    stubStorage({ getItem: () => { throw new Error("denied"); } });
    const { result } = renderHook(() => useStickyState("admin.pipeline", "status", "all"));
    expect(result.current[0]).toBe("all");
    act(() => { result.current[1]("evaluated"); });
    expect(result.current[0]).toBe("evaluated");
  });

  it("still works in-memory when sessionStorage writes throw (quota exceeded)", () => {
    stubStorage({ setItem: () => { throw new Error("QuotaExceededError"); } });
    const { result } = renderHook(() => useStickyState("admin.pipeline", "status", "all"));
    act(() => { result.current[1]("evaluated"); });
    expect(result.current[0]).toBe("evaluated");
  });

  it("still survives a remount when storage is completely unavailable", () => {
    // Blocked storage (private mode, hardened privacy settings) must not silently
    // put us back to the old reset-on-every-navigation behaviour: the filter
    // should still survive unmount for the life of the page.
    stubStorage({
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    });
    const first = renderHook(() => useStickyState("admin.pipeline", "status", "all"));
    act(() => { first.result.current[1]("evaluated"); });
    first.unmount();

    const second = renderHook(() => useStickyState("admin.pipeline", "status", "all"));
    expect(second.result.current[0]).toBe("evaluated");
  });

  it("clearStickyState removes sticky keys but leaves other storage alone", () => {
    const { result } = renderHook(() => useStickyState("admin.pipeline", "status", "all"));
    act(() => { result.current[1]("evaluated"); });
    sessionStorage.setItem("unrelated.key", "keep-me");

    clearStickyState();

    expect(sessionStorage.getItem(`${STICKY_PREFIX}admin.pipeline.status`)).toBeNull();
    expect(sessionStorage.getItem("unrelated.key")).toBe("keep-me");
  });

  it("clearStickyState also clears filters held only in memory", () => {
    stubStorage({
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    });
    const first = renderHook(() => useStickyState("admin.pipeline", "status", "all"));
    act(() => { first.result.current[1]("evaluated"); });
    first.unmount();

    clearStickyState();

    const second = renderHook(() => useStickyState("admin.pipeline", "status", "all"));
    expect(second.result.current[0]).toBe("all");
  });

  it("clearStickyState does not throw when storage is unavailable", () => {
    const stickyKey = `${STICKY_PREFIX}admin.pipeline.status`;
    stubStorage({
      length: 1,
      key: () => stickyKey,
      removeItem: () => { throw new Error("denied"); },
    });
    expect(() => clearStickyState()).not.toThrow();
  });
});
