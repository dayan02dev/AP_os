import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import VipNavigatorMemo from "../VipNavigatorMemo.jsx";
import FIXTURE from "./fixtures/vipMemoV2.fake.json";

const APP = "app-acme";
const KEY = `vipnav.read.${APP}`;

function setup(props = {}) {
  const onDownload = vi.fn();
  const utils = render(<VipNavigatorMemo memo={FIXTURE} appId={APP} onDownload={onDownload} {...props} />);
  return { ...utils, onDownload };
}

const nav = () => screen.getByRole("navigation", { name: "Memo sections" });
const navBtn = (name) => within(nav()).getByRole("button", { name: new RegExp(name) });
const panel = () => screen.getByTestId("vipnav-panel");

// jsdom's Storage can't be spied on reliably here; use an in-memory stand-in.
function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    clear: () => data.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VipNavigatorMemo — header + snapshot", () => {
  it("renders the eyebrow, headline, plain text and meta line", () => {
    setup();
    expect(screen.getByText("VIP memo · Acme Robotics")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: FIXTURE.headline })).toBeTruthy();
    expect(screen.getByText(FIXTURE.plain)).toBeTruthy();
    const meta = screen.getByTestId("vipnav-meta");
    expect(meta.textContent).toContain("Prepared by Test fixture team from the application, 3 uploaded files and independent research · 15 Jan 2026.");
    expect(meta.textContent).toContain("marks facts to check with the founders.");
    expect(within(meta).getByText("To confirm")).toBeTruthy();
  });

  it("renders the snapshot (ask + instrument, sector, stage, location, team)", () => {
    setup();
    const snap = screen.getByTestId("vipnav-snapshot");
    for (const label of ["Ask", "Sector", "Stage", "Location", "Team"]) {
      expect(within(snap).getByText(label)).toBeTruthy();
    }
    expect(within(snap).getByText("₹1.0 Cr")).toBeTruthy();
    expect(within(snap).getByText("Robotics")).toBeTruthy();
    expect(within(snap).getByText("TRL 4 · Active pilots")).toBeTruthy();
    expect(within(snap).getByText("Wile Coyote + 1")).toBeTruthy();
    // instrument + location are "[To be confirmed]" → chips, never raw text
    expect(within(snap).getAllByText("To confirm").length).toBe(2);
    expect(snap.textContent).not.toContain("[To be confirmed]");
  });

  it("does not render the IC recommendation", () => {
    setup();
    expect(screen.queryByTestId("vipnav-reco")).toBeNull();
    expect(screen.queryByText("IC recommendation")).toBeNull();
    expect(screen.queryByText("CONDITIONAL APPROVAL")).toBeNull();
    expect(screen.queryByText(FIXTURE.recommendation.summary)).toBeNull();
  });
});

describe("VipNavigatorMemo — navigation + reading progress", () => {
  it("lists sections 01–10 plus Questions, starts on section 01 and marks it read", () => {
    setup();
    const buttons = within(nav()).getAllByRole("button");
    expect(buttons).toHaveLength(11);
    expect(buttons[0].textContent).toContain("01");
    expect(buttons[9].textContent).toContain("10");
    expect(buttons[10].textContent).toContain("Questions for the founders");
    expect(navBtn("What the company does").getAttribute("aria-current")).toBe("true");
    expect(within(panel()).getByText("01 of 10 · What the company does")).toBeTruthy();
    expect(within(panel()).getByRole("heading", { level: 4, name: FIXTURE.takeaways.what })).toBeTruthy();
    expect(within(panel()).getByText("Sources · Application · Pitch deck")).toBeTruthy();
    expect(screen.getByText("1 of 10 sections read")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({ what: 1 });
  });

  it("switches sections from the nav, ticks them read and persists the set", () => {
    setup();
    fireEvent.click(navBtn("Market"));
    expect(navBtn("Market").getAttribute("aria-current")).toBe("true");
    expect(navBtn("What the company does").getAttribute("aria-current")).toBeNull();
    expect(within(panel()).getByText("06 of 10 · Market")).toBeTruthy();
    expect(within(panel()).getByText("Realistic opportunity, per year")).toBeTruthy();
    expect(screen.getByText("2 of 10 sections read")).toBeTruthy();
    expect(within(navBtn("Market")).getByLabelText("read")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({ what: 1, market: 1 });
  });

  it("restores the read set from localStorage", () => {
    localStorage.setItem(KEY, JSON.stringify({ team: 1, risks: 1 }));
    setup();
    expect(screen.getByText("3 of 10 sections read")).toBeTruthy();
  });

  it("survives unavailable or corrupt storage", () => {
    localStorage.setItem(KEY, "{not json");
    setup();
    expect(screen.getByText("1 of 10 sections read")).toBeTruthy();
    localStorage.setItem = () => { throw new Error("quota"); };
    fireEvent.click(navBtn("Competitors"));
    expect(within(panel()).getByText("05 of 10 · Competitors")).toBeTruthy();
    expect(screen.getByText("2 of 10 sections read")).toBeTruthy();
  });

  it("does not count Questions toward the 10-section progress", () => {
    setup();
    fireEvent.click(navBtn("Questions for the founders"));
    expect(within(panel()).getByText("Next step · Questions for the founders")).toBeTruthy();
    expect(within(panel()).getByText("Fake question three?")).toBeTruthy();
    expect(screen.getByText("1 of 10 sections read")).toBeTruthy();
  });

  it("prev / next footer buttons walk the sequence", () => {
    setup();
    expect(within(panel()).queryByRole("button", { name: /←/ })).toBeNull();
    fireEvent.click(within(panel()).getByRole("button", { name: /Why it matters/ }));
    expect(within(panel()).getByText("02 of 10 · Why it matters")).toBeTruthy();
    fireEvent.click(within(panel()).getByRole("button", { name: "← What the company does" }));
    expect(within(panel()).getByText("01 of 10 · What the company does")).toBeTruthy();
  });

  it("← → keys move between sections and do not bubble to the page", () => {
    const pageKeys = vi.fn();
    document.addEventListener("keydown", pageKeys);
    setup();
    fireEvent.keyDown(navBtn("What the company does"), { key: "ArrowRight" });
    expect(within(panel()).getByText("02 of 10 · Why it matters")).toBeTruthy();
    fireEvent.keyDown(navBtn("Why it matters"), { key: "ArrowLeft" });
    expect(within(panel()).getByText("01 of 10 · What the company does")).toBeTruthy();
    expect(pageKeys).not.toHaveBeenCalled();
    document.removeEventListener("keydown", pageKeys);
  });
});

describe("VipNavigatorMemo — section bodies", () => {
  it("renders every section body from the schema", () => {
    setup();
    const go = (n) => fireEvent.click(navBtn(n));
    expect(within(panel()).getByText("Fake paragraph one about the arm.")).toBeTruthy();
    expect(within(panel()).getByText(/A fake arm for fake widgets/)).toBeTruthy();
    go("Why it matters");
    expect(within(panel()).getByText("Getting worse")).toBeTruthy();
    expect(within(panel()).getByText("Plan B")).toBeTruthy();
    go("The product");
    expect(within(panel()).getByText("Fake Arm")).toBeTruthy();
    expect(within(panel()).getAllByText("Indicative price")).toHaveLength(2);
    go("Technology edge");
    expect(within(panel()).getByText("Fake gripper")).toBeTruthy();
    go("Competitors");
    expect(within(panel()).getAllByText("Acme Robotics advantage")).toHaveLength(2);
    expect(within(panel()).getByText("Fake warehouses")).toBeTruthy();
    expect(within(panel()).getByText("RivalBot")).toBeTruthy();
    expect(within(panel()).getByText("Fake mapping note.")).toBeTruthy();
    go("Market");
    expect(within(panel()).getByText("₹6–20 Cr")).toBeTruthy();
    expect(within(panel()).getByText("Source · Fake Publisher, 2025")).toBeTruthy();
    expect(within(panel()).getByText("₹10–30 Cr")).toBeTruthy();
    expect(within(panel()).getByText(/Fake warehouses in a fake city/)).toBeTruthy();
    const bars = panel().querySelectorAll(".m3-mrow .hi");
    expect(bars[0].style.width).toBe("100%");
    expect(bars[1].style.width).toBe("50%");
    go("Team and ownership");
    expect(within(panel()).getAllByText("Road Runner")).toHaveLength(2); // members + cap table
    expect(within(panel()).getByText("Fake roboticist")).toBeTruthy();
    expect(within(panel()).getByText("60%")).toBeTruthy();
    expect(within(panel()).getByText("To check with the founders")).toBeTruthy();
    expect(within(panel()).getByText("Whether both founders are full-time")).toBeTruthy();
    go("12-month plan");
    expect(within(panel()).getByText("Fake prototype v2")).toBeTruthy();
    expect(within(panel()).getByText(/Fake lab space/)).toBeTruthy();
    go("Use of funds");
    expect(within(panel()).getByText("₹50 L")).toBeTruthy();
    expect(panel().querySelectorAll(".m3-stack i")).toHaveLength(3);
    go("Risks");
    expect(within(panel()).getByText("Fake risk D")).toBeTruthy();
  });

  it("renders a dashed TO CONFIRM chip wherever a value contains [To be confirmed]", () => {
    setup();
    fireEvent.click(navBtn("The product"));
    expect(within(panel()).getByText("To confirm")).toBeTruthy();
    expect(panel().textContent).not.toContain("[To be confirmed]");
    fireEvent.click(navBtn("Competitors"));
    expect(within(panel()).getByText("To confirm")).toBeTruthy();
    fireEvent.click(navBtn("Team and ownership"));
    expect(within(panel()).getAllByText("To confirm").length).toBeGreaterThan(0);
  });

  it("keeps the surrounding text when [To be confirmed] is embedded", () => {
    const memo = { ...FIXTURE, headline: "Sells to [To be confirmed] buyers" };
    setup({ memo });
    const h = screen.getByRole("heading", { level: 3 });
    expect(h.textContent).toBe("Sells to To confirm buyers");
    expect(within(h).getByText("To confirm").className).toContain("m3-pending");
  });
});

// The pilot memos store long text as bullet lists: a bullet is a string, or
// [lead, ...sub-points]; risks may be {title, risk, handled} objects.
const POINTS = {
  ...FIXTURE,
  plain: ["Plain point one.", "Plain point two."],
  sections: {
    ...FIXTURE.sections,
    what: { paragraphs: ["What point one.", "What point two."], analogy: ["Like a crane.", "But smaller."] },
    why: { rows: [["Hard to copy", [["Lead moat.", "Sub moat a.", "Sub moat b."], "Second moat."]]] },
    product: { columns: ["Offer", "What the buyer gets", "Indicative price"],
      offers: [["Fake Arm", ["Gets one arm.", "Gets an app."], ["₹5 L", "Pilot free"]]], note: ["Product note one.", "Product note two."] },
    competitors: { groups: [{ segment: "Fake warehouses", rows: [["RivalBot", "Fake arms", "Needs fake engineers", "Self-taught", "Series A"]] }],
      note: ["Comp note one.", "Comp note two."] },
    milestones: { rows: [["Q1", ["Ship v2.", "Sign pilot."], "₹20 L"]], infra: ["Lab space", "GPU time"], note: ["Plan note one."] },
    risks: { rows: [{ title: "Regulatory", risk: ["No licence yet.", "Class unclear."], handled: ["Test licence held.", "Tranche funds."] }, ["Legacy risk", "Legacy mitigant"]] },
  },
};

describe("VipNavigatorMemo — bullet-point content", () => {
  const items = (el) => Array.from(el.querySelectorAll(":scope > li")).map((li) => li.firstChild.textContent);

  it("renders the header plain text as bullets", () => {
    setup({ memo: POINTS });
    const ul = screen.getByText("Plain point one.").closest("ul");
    expect(items(ul)).toEqual(["Plain point one.", "Plain point two."]);
  });

  it("renders list-valued section text as bullets, with nested sub-points", () => {
    setup({ memo: POINTS });
    expect(screen.getByText("What point two.").tagName).toBe("LI");
    expect(screen.getByText("Think of it like this:")).toBeTruthy();
    expect(screen.getByText("But smaller.").tagName).toBe("LI");
    fireEvent.click(navBtn("Why it matters"));
    const lead = within(panel()).getByText("Lead moat.");
    const sub = lead.closest("li").querySelector("ul");
    expect(items(sub)).toEqual(["Sub moat a.", "Sub moat b."]);
    expect(within(panel()).getByText("Second moat.").tagName).toBe("LI");
  });

  it("renders product offers, competitors and risks as cards without wide tables", () => {
    setup({ memo: POINTS });
    fireEvent.click(navBtn("The product"));
    expect(within(panel()).getByText("Gets an app.").tagName).toBe("LI");
    expect(within(panel()).getByText("Pilot free").tagName).toBe("LI");
    expect(within(panel()).getByText("Product note two.").tagName).toBe("LI");
    fireEvent.click(navBtn("Competitors"));
    expect(panel().querySelector("table")).toBeNull();
    expect(within(panel()).getByText("RivalBot")).toBeTruthy();
    expect(within(panel()).getByText("Comp note two.").tagName).toBe("LI");
    fireEvent.click(navBtn("12-month plan"));
    expect(within(panel()).getByText("Sign pilot.").tagName).toBe("LI");
    expect(within(panel()).getByText("GPU time").tagName).toBe("LI");
    fireEvent.click(navBtn("Risks"));
    expect(panel().querySelector("table")).toBeNull();
    expect(within(panel()).getByText("Regulatory")).toBeTruthy();
    expect(within(panel()).getByText("Class unclear.").tagName).toBe("LI");
    expect(within(panel()).getByText("Tranche funds.").tagName).toBe("LI");
    expect(within(panel()).getByText("Legacy mitigant")).toBeTruthy();
  });
});

describe("VipNavigatorMemo — downloads + print", () => {
  it("download buttons call onDownload with the format", () => {
    const { onDownload } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Download DOCX" }));
    expect(onDownload.mock.calls).toEqual([["pdf"], ["docx"]]);
  });

  it("stacks every section for print and returns to the navigator after", () => {
    setup();
    act(() => { window.dispatchEvent(new Event("beforeprint")); });
    const all = screen.getByTestId("vipnav-print");
    for (const t of ["What the company does", "Market", "Risks and how they're handled", "Questions for the founders"]) {
      expect(within(all).getByText(new RegExp(t))).toBeTruthy();
    }
    expect(within(all).getByText("RivalBot")).toBeTruthy();
    act(() => { window.dispatchEvent(new Event("afterprint")); });
    expect(screen.queryByTestId("vipnav-print")).toBeNull();
  });
});
