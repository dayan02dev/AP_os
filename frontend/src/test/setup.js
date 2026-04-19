// Vitest setup — runs before every test file.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";

// Every test starts with a clean localStorage. jsdom's Storage impl doesn't
// always expose .clear() as a real method, so loop safely.
beforeEach(() => {
  try {
    if (typeof localStorage !== "undefined") {
      if (typeof localStorage.clear === "function") {
        localStorage.clear();
      } else {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
      }
    }
  } catch {
    /* noop */
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});
