import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUEUE_FILTERS,
  QUEUE_SCOPE,
  applyQueueFilters,
  describeQueueFilters,
  facetCounts,
  isInactive,
  queueNavigation,
  readQueueFilters,
  sortQueue,
  visibleQueueRows,
} from "../reviewerQueueFilters.js";
import { writeStickyState } from "../../hooks/useStickyState.js";

const row = (id, track, reviewStatus, industry, extra = {}) => ({
  id, track, applicationId: `${track.toUpperCase()}-${id}`, name: `App ${id}`,
  founders: ["F"], industry, stage: "MVP", due: null, ai: null, reviewStatus,
  myScore: null, myReco: reviewStatus === "submitted" ? "yes" : null,
  movedToTrack: null, detached: false, closed: false, ...extra,
});

// Backend order, with every kind of row the reviewer reports tripped over.
const QUEUE = [
  row("v1", "sip", "not-started", "Climate"),
  row("t1", "tir", "not-started", "Health"),
  row("v2", "sip", "submitted", "Climate"),
  row("v3", "sip", "submitted", "Climate", { closed: true }),
  row("t2", "tir", "submitted", "Climate", { detached: true }),
  row("v4", "sip", "not-started", "Climate"),
];
const VIP_NS_CLIMATE = { ...DEFAULT_QUEUE_FILTERS, track: "sip", status: "not-started", domain: "Climate" };
const ids = (rows) => rows.map((r) => r.id);

describe("readQueueFilters", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(readQueueFilters()).toEqual(DEFAULT_QUEUE_FILTERS);
  });

  it("reads the queue's sticky keys", () => {
    writeStickyState(QUEUE_SCOPE, "track", "sip");
    writeStickyState(QUEUE_SCOPE, "status", "not-started");
    writeStickyState(QUEUE_SCOPE, "sortCol", "name");
    writeStickyState(QUEUE_SCOPE, "sortAsc", false);
    const f = readQueueFilters();
    expect(f.track).toBe("sip");
    expect(f.status).toBe("not-started");
    expect(f.sortCol).toBe("name");
    expect(f.sortAsc).toBe(false);
  });
});

describe("visibleQueueRows / isInactive", () => {
  it("hides closed AND detached rows unless inactive rows are shown", () => {
    expect(isInactive(QUEUE[3])).toBe(true);
    expect(isInactive(QUEUE[4])).toBe(true);
    expect(ids(visibleQueueRows(QUEUE, false))).toEqual(["v1", "t1", "v2", "v4"]);
    expect(visibleQueueRows(QUEUE, true)).toHaveLength(6);
  });
});

describe("applyQueueFilters", () => {
  it("filters by effective track, status and industry together", () => {
    expect(ids(applyQueueFilters(visibleQueueRows(QUEUE), VIP_NS_CLIMATE))).toEqual(["v1", "v4"]);
  });

  it("uses the effective track for moved apps", () => {
    const moved = row("m1", "tir", "not-started", "Health", { movedToTrack: "sip" });
    expect(ids(applyQueueFilters([moved], { ...DEFAULT_QUEUE_FILTERS, track: "sip" }))).toEqual(["m1"]);
  });

  it("can leave one facet out (for that facet's chip counts)", () => {
    const f = { ...VIP_NS_CLIMATE };
    expect(ids(applyQueueFilters(visibleQueueRows(QUEUE), f, "status"))).toEqual(["v1", "v2", "v4"]);
  });
});

describe("facetCounts", () => {
  it("counts each facet over rows matching every OTHER active filter", () => {
    const f = { ...DEFAULT_QUEUE_FILTERS, track: "sip" };
    const c = facetCounts(visibleQueueRows(QUEUE), f);
    expect(c.industry.Climate).toBe(3); // v1 v2 v4 — not the TIR or inactive rows
    expect(c.industry.Health).toBeUndefined();
    expect(c.status["not-started"]).toBe(2);
    expect(c.status.submitted).toBe(1);
  });
});

describe("sortQueue", () => {
  it("keeps the backend order with no sort column", () => {
    expect(ids(sortQueue(QUEUE, null, true))).toEqual(ids(QUEUE));
  });

  it("sorts by name descending", () => {
    expect(ids(sortQueue(QUEUE, "name", false))).toEqual(["v4", "v3", "v2", "v1", "t2", "t1"]);
  });
});

describe("queueNavigation", () => {
  it("walks only rows matching the filters (VIP · Not started · Climate)", () => {
    const n = queueNavigation(QUEUE, VIP_NS_CLIMATE, "v1");
    expect(n.hasPosition).toBe(true);
    expect(n.prev).toBeNull();
    expect(n.next.id).toBe("v4");
  });

  it("never offers closed or detached rows", () => {
    const n = queueNavigation(QUEUE, DEFAULT_QUEUE_FILTERS, "v2");
    expect(n.next.id).toBe("v4");
    expect(n.prev.id).toBe("t1");
  });

  it("follows the queue sort", () => {
    const n = queueNavigation(QUEUE, { ...DEFAULT_QUEUE_FILTERS, track: "sip", sortCol: "name", sortAsc: false }, "v4");
    expect(n.prev).toBeNull();
    expect(n.next.id).toBe("v1"); // v3 closed, v2 already submitted
  });

  it("RFV-1: manual Prev/Next skip already-submitted apps unless filtering on Submitted", () => {
    const vip = { ...DEFAULT_QUEUE_FILTERS, track: "sip" };
    expect(queueNavigation(QUEUE, vip, "v1").next.id).toBe("v4");
    expect(queueNavigation(QUEUE, vip, "v4").prev.id).toBe("v1");
  });

  it("RFV-1: drafts and not-started apps stay in Prev/Next", () => {
    const rows = [
      row("a", "sip", "not-started", "Climate"),
      row("b", "sip", "submitted", "Climate"),
      row("c", "sip", "draft", "Climate"),
    ];
    const n = queueNavigation(rows, DEFAULT_QUEUE_FILTERS, "a");
    expect(n.next.id).toBe("c");
    expect(queueNavigation(rows, DEFAULT_QUEUE_FILTERS, "c").prev.id).toBe("a");
  });

  it("RFV-1: the Submitted filter walks submitted apps", () => {
    const rows = [
      row("a", "sip", "submitted", "Climate"),
      row("b", "sip", "not-started", "Climate"),
      row("c", "sip", "submitted", "Climate"),
    ];
    const f = { ...DEFAULT_QUEUE_FILTERS, status: "submitted" };
    expect(queueNavigation(rows, f, "a").next.id).toBe("c");
    expect(queueNavigation(rows, f, "c").prev.id).toBe("a");
    expect(queueNavigation(rows, f, "a").browsing).toBe(true);
  });

  it("RFV-2: 'left' counts the current app while it is not yet submitted", () => {
    expect(queueNavigation(QUEUE, VIP_NS_CLIMATE, "v1").remaining).toBe(2); // v1 + v4
    expect(queueNavigation(QUEUE, VIP_NS_CLIMATE, "v1").browsing).toBe(false);
  });

  it("RFV-2: a My-reco filter is a browsing filter (no 'left' count)", () => {
    const f = { ...DEFAULT_QUEUE_FILTERS, reco: "yes" };
    expect(queueNavigation(QUEUE, f, "v2").browsing).toBe(true);
    expect(queueNavigation(QUEUE, { ...DEFAULT_QUEUE_FILTERS, reco: "none" }, "v1").browsing).toBe(false);
  });

  it("anchors on the full list, so an app that no longer matches still has a Next", () => {
    const after = QUEUE.map((r) => (r.id === "v1" ? { ...r, reviewStatus: "submitted", myReco: "yes" } : r));
    const n = queueNavigation(after, VIP_NS_CLIMATE, "v1");
    expect(n.hasPosition).toBe(true);
    expect(n.next.id).toBe("v4");
    expect(n.upNext.id).toBe("v4");
    expect(n.remaining).toBe(1);
  });

  it("upNext skips submitted rows and wraps to earlier ones", () => {
    const n = queueNavigation(QUEUE, { ...DEFAULT_QUEUE_FILTERS, track: "sip" }, "v4");
    expect(n.next).toBeNull();
    expect(n.upNext.id).toBe("v1");
  });

  it("upNext is null when nothing is left in the filter", () => {
    const n = queueNavigation(QUEUE, VIP_NS_CLIMATE, "v4", {
      anchorRow: QUEUE[5],
    });
    expect(n.upNext.id).toBe("v1");
    const done = QUEUE.map((r) => (r.id === "v1" ? { ...r, reviewStatus: "submitted" } : r));
    expect(queueNavigation(done, VIP_NS_CLIMATE, "v4").upNext).toBeNull();
    // Only the current app (not yet submitted) is left; 0 once it is submitted.
    expect(queueNavigation(done, VIP_NS_CLIMATE, "v4").remaining).toBe(1);
    const allDone = done.map((r) => (r.id === "v4" ? { ...r, reviewStatus: "submitted" } : r));
    expect(queueNavigation(allDone, VIP_NS_CLIMATE, "v4", { anchorRow: QUEUE[5] }).remaining).toBe(0);
  });

  it("uses the anchor row for position when the fresh row sorts elsewhere", () => {
    // Sorted by status: the just-submitted v1 would jump to the end; the
    // anchor keeps it where the reviewer saw it.
    const f = { ...DEFAULT_QUEUE_FILTERS, sortCol: "status", sortAsc: true };
    const after = QUEUE.map((r) => (r.id === "v1" ? { ...r, reviewStatus: "submitted" } : r));
    const n = queueNavigation(after, f, "v1", { anchorRow: QUEUE[0] });
    expect(n.next.id).toBe("t1");
  });

  it("reports no position for an app that is not in the queue", () => {
    expect(queueNavigation(QUEUE, DEFAULT_QUEUE_FILTERS, "zzz").hasPosition).toBe(false);
  });
});

describe("describeQueueFilters", () => {
  it("names the active filters", () => {
    expect(describeQueueFilters(VIP_NS_CLIMATE)).toBe("VIP · Not started · Climate");
    expect(describeQueueFilters(DEFAULT_QUEUE_FILTERS)).toBe("");
    expect(describeQueueFilters({ ...DEFAULT_QUEUE_FILTERS, reco: "maybe", search: " acme " })).toBe("My reco: Maybe · “acme”");
  });
});
