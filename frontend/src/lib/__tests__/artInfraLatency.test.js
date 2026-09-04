import { describe, it, expect, beforeEach } from "vitest";
import { settle, reject, configure, resetLatency } from "../artInfraLatency.js";

describe("artInfraLatency", () => {
  beforeEach(() => resetLatency());

  it("resolves with a deep clone, not the original reference", async () => {
    const original = { nested: { n: 1 } };
    configure({ minMs: 0, maxMs: 0 });
    const out = await settle(original);
    expect(out).toEqual(original);
    expect(out).not.toBe(original);
    out.nested.n = 99;
    expect(original.nested.n).toBe(1);
  });

  it("never resolves in the same microtask", async () => {
    configure({ minMs: 0, maxMs: 0 });
    let settled = false;
    const p = settle(1).then(() => { settled = true; });
    // A synchronous mock would already be true here after one microtask tick.
    await Promise.resolve();
    expect(settled).toBe(false);
    await p;
    expect(settled).toBe(true);
  });

  it("can be told to fail the next call exactly once", async () => {
    configure({ minMs: 0, maxMs: 0, failNext: "boom" });
    await expect(settle({ ok: true })).rejects.toThrow("boom");
    await expect(settle({ ok: true })).resolves.toEqual({ ok: true });
  });

  it("rejects with the given code", async () => {
    configure({ minMs: 0, maxMs: 0 });
    await expect(reject("not_found")).rejects.toThrow("not_found");
  });

  it("settles every concurrent call", async () => {
    configure({ minMs: 5, maxMs: 40 });
    const order = [];
    await Promise.all([
      settle("a").then(() => order.push("a")),
      settle("b").then(() => order.push("b")),
      settle("c").then(() => order.push("c")),
    ]);
    expect(order).toHaveLength(3);
  });
});
