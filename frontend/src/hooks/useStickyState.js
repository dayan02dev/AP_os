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

// In-page mirror of every value we have written. sessionStorage throws outright
// in Safari private mode and under hardened privacy settings, and silently
// caps out on quota. Without this mirror those cases would drop us straight
// back to the old behaviour — filters resetting on every navigation — which is
// the exact bug this hook exists to fix. The mirror keeps filters sticky for
// the life of the page even when nothing can be persisted; sessionStorage adds
// survival across a reload on top.
const mirror = new Map();

function read(key, initial) {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw !== null && raw !== undefined) return JSON.parse(raw);
  } catch {
    /* unreadable or corrupt — fall through to the mirror */
  }
  return mirror.has(key) ? mirror.get(key) : initial;
}

function write(key, value) {
  mirror.set(key, value);
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — the mirror still carries it for this page */
  }
}

/** Persist a sticky value from OUTSIDE the hook, using the same key format and
 *  the same mirror-plus-sessionStorage path a `useStickyState` setter uses.
 *
 *  It exists so a component that does not own a piece of sticky state can still
 *  move it: the admin shell's detail view walks a sequence with Prev/Next, and
 *  when that sequence came from the Gate-1 stack, the stack's remembered
 *  position has to follow. The alternative — writing `sessionStorage` with a
 *  hand-built key string — would put the key format in two files and let them
 *  drift.
 *
 *  A mounted `useStickyState(scope, field)` will NOT re-render from this: it
 *  only re-reads its store on mount. Use it for state whose owner is unmounted
 *  (or about to remount), which is exactly the sticky-filter case. */
export function writeStickyState(scope, field, value) {
  write(stickyKey(scope, field), value);
}

/** Drop every persisted filter — both the stored copy and the in-page mirror.
 *  Called on sign-out so the next person to use this tab does not inherit the
 *  previous user's view, and by the test setup for per-test isolation. */
export function clearStickyState() {
  mirror.clear();
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
