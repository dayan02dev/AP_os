// Latency, jitter and failure injection for the Art Infra mock.
//
// Phase 1's mock wrapped everything in Promise.resolve(), so every call
// settled in issue order and nothing could ever reject. Five bugs survived
// review because of it: loaders with no out-of-order guard, an undebounced
// double-fetch, mutation call sites with no error path. This module exists so
// those reproduce on a laptop instead of in staging.

const DEFAULTS = { minMs: 40, maxMs: 260 };

let minMs = DEFAULTS.minMs;
let maxMs = DEFAULTS.maxMs;
let failNext = null;   // one-shot: next call rejects with this code
let failEvery = 0;     // 0 = off; N = every Nth call rejects
let callCount = 0;

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const delay = () => minMs + Math.random() * Math.max(0, maxMs - minMs);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function configure(opts = {}) {
  if (opts.minMs !== undefined) minMs = opts.minMs;
  if (opts.maxMs !== undefined) maxMs = opts.maxMs;
  if (opts.failNext !== undefined) failNext = opts.failNext;
  if (opts.failEvery !== undefined) failEvery = opts.failEvery;
}

export function resetLatency() {
  minMs = DEFAULTS.minMs;
  maxMs = DEFAULTS.maxMs;
  failNext = null;
  failEvery = 0;
  callCount = 0;
}

function shouldFail() {
  if (failNext) {
    const code = failNext;
    failNext = null;          // one-shot
    return code;
    }
  callCount += 1;
  if (failEvery > 0 && callCount % failEvery === 0) return "injected_failure";
  return null;
}

export async function settle(value) {
  await wait(delay());
  const code = shouldFail();
  if (code) throw new Error(code);
  return clone(value);
}

export async function reject(code) {
  await wait(delay());
  throw new Error(code);
}
