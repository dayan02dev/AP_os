// Vitest setup — runs before every test file.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { clearStickyState } from "../hooks/useStickyState.js";

// Every test starts with clean web storage. jsdom's Storage impl doesn't
// always expose .clear() as a real method, so loop safely.
function clearStorage(store) {
  try {
    if (typeof store === "undefined" || store === null) return;
    if (typeof store.clear === "function") {
      store.clear();
    } else {
      for (const k of Object.keys(store)) store.removeItem(k);
    }
  } catch {
    /* noop */
  }
}

beforeEach(() => {
  clearStorage(typeof localStorage !== "undefined" ? localStorage : null);
  // sessionStorage backs useStickyState (sticky portal filters) — without this
  // a filter set in one test leaks into the next. clearStickyState() also drops
  // the hook's module-level mirror, which storage clearing alone cannot reach.
  clearStorage(typeof sessionStorage !== "undefined" ? sessionStorage : null);
  clearStickyState();
});

afterEach(() => {
  vi.restoreAllMocks();
});
