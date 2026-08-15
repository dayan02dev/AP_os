// Sticky filter state — a drop-in `useState` that remembers its value across
// unmounts for the lifetime of the browser tab.
//
// Both staff portals fully unmount their list screens when you open an
// application (the admin shell swaps `page` to 'detail'; the reviewer portal
// navigates to /reviewer/eval/...), so plain `useState` filters snapped back to
// their defaults every single time. Persisting to sessionStorage means the list
// you come back to is the list you left, until you change it yourself.
//
// sessionStorage (not localStorage) is deliberate: filters survive navigation
// and a page refresh, but a closed tab starts clean, so nobody inherits a
// mystery filter days later.

import { useCallback, useRef, useState } from "react";

export const STICKY_PREFIX = "apos.filter.v1.";

export function stickyKey(scope, field) {
  return `${STICKY_PREFIX}${scope}.${field}`;
}

// Every storage touch is wrapped: sessionStorage throws outright in Safari
// private mode and when the quota is blown. A filter is a convenience — it must
// never be able to take a portal down, so a failure degrades to plain in-memory
// state rather than propagating.
function read(key, initial) {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null || raw === undefined) return initial;
    return JSON.parse(raw);
  } catch {
    // Unreadable or corrupt (hand-edited, or written by an older build whose
    // shape has since changed) — fall back to the default.
    return initial;
  }
}

function write(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — the in-memory value still applies for this view */
  }
}

/** Drop every persisted filter. Called on sign-out so the next person to use
 *  this tab does not inherit the previous user's view. */
export function clearStickyState() {
  try {
    const store = sessionStorage;
    const doomed = [];
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (typeof k === "string" && k.startsWith(STICKY_PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => store.removeItem(k));
  } catch {
    /* storage unavailable — nothing persisted, nothing to clear */
  }
}

export function useStickyState(scope, field, initial) {
  const key = stickyKey(scope, field);
  const keyRef = useRef(key);
  keyRef.current = key;

  const [value, setValue] = useState(() => read(key, initial));

  const set = useCallback((next) => {
    setValue((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      write(keyRef.current, resolved);
      return resolved;
    });
  }, []);

  return [value, set];
}
