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
    expect(meta.textContent).not.toContain("AI cross-check");
    const note = screen.getByTestId("vipnav-verify-note");
    expect(note.getAttribute("role")).toBe("note");
    expect(within(note).getByText("Founder to verify").className).toContain("m3-founder");
    expect(note.textContent).toContain("Claimed by the founders, not yet verified.");
    expect(note.textContent).toContain("They may have overstated it");
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
    expect(within(snap).getAllByText("Founder to verify").length).toBe(2);
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
    const bars = panel().querySelectorAll(".m3-seg .hi");
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
    expect(within(panel()).getByText("Founder to verify")).toBeTruthy();
    expect(panel().textContent).not.toContain("[To be confirmed]");
    fireEvent.click(navBtn("Competitors"));
    expect(within(panel()).getByText("Founder to verify")).toBeTruthy();
    fireEvent.click(navBtn("Team and ownership"));
    expect(within(panel()).getAllByText("Founder to verify").length).toBeGreaterThan(0);
  });

  it("drops AI cross-check tags and keeps the founder chip", () => {
    const memo = { ...FIXTURE, headline: "Rivals [Needs AI cross-verification]; ask [Needs founder verification]" };
    render(<VipNavigatorMemo memo={memo} appId="app-tags" />);
    const h = document.querySelector(".m3-headline");
    expect(h.textContent).toBe("Rivals; ask Founder to verify");
    expect(h.querySelector(".m3-verify")).toBeNull();
    expect(within(h).getByText("Founder to verify").className).toContain("m3-founder");
  });

  it("shows a dash for a value that was only an AI cross-check tag", () => {
    const memo = { ...FIXTURE, headline: "[Needs AI cross-verification]" };
    render(<VipNavigatorMemo memo={memo} appId="app-tag-only" />);
    expect(document.querySelector(".m3-headline").textContent).toBe("—");
    expect(document.querySelector(".m3-verify")).toBeNull();
  });

  it("keeps the surrounding text when [To be confirmed] is embedded", () => {
    const memo = { ...FIXTURE, headline: "Sells to [To be confirmed] buyers" };
    setup({ memo });
    const h = screen.getByRole("heading", { level: 3 });
    expect(h.textContent).toBe("Sells to Founder to verify buyers");
    expect(within(h).getByText("Founder to verify").className).toContain("m3-pending");
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

// Shapes seen in generated memos: percent strings, TBC sizes, sentence-long
// global sizes, string-or-list rationale, zero slice numbers.
const TBCX = "[To be confirmed]";
const withSections = (over, top = {}) => ({
  ...FIXTURE, ...top, sections: { ...FIXTURE.sections, ...over },
});
const MARKET = withSections({
  market: {
    rows: [
      { segment: "Cold rooms", global_size: "$4.2B (2025, global)", slice_low_cr: 230, slice_high_cr: 780,
        slice_label: "~₹230–780 Cr", rationale: ["Storage held 68.0% (2025).", "Food & beverages ≈ 84%."], source: "Fake Research, 2026" },
      { segment: "Pharma chain", global_size: TBCX, slice_low_cr: 0, slice_high_cr: 0,
        slice_label: TBCX, rationale: "No third-party figure.", source: TBCX },
      { segment: "Seafood", global_size: "India: USD 19.35B (2026), projected USD 25.35B by 2031, 5.55% CAGR. Transport is 54.07% of the market.",
        slice_low_cr: 0, slice_high_cr: 110, slice_label: "~₹30–110 Cr", rationale: "Plain rationale.", source: "Fake Mordor" },
    ],
    total: [TBCX, "Combined slice not stated."], beachhead: ["Packhouses in Pune."], tam_note: "Deck TAM unsourced.",
  },
});

describe("VipNavigatorMemo — market cards", () => {
  const goMarket = (memo) => { setup({ memo }); fireEvent.click(navBtn("Market")); };

  it("renders one card per segment with Global market / Realistic slice stats", () => {
    goMarket(MARKET);
    const cards = panel().querySelectorAll(".m3-seg");
    expect(cards).toHaveLength(3);
    expect(within(cards[0]).getByText("Cold rooms")).toBeTruthy();
    expect(within(cards[0]).getByText("Global market")).toBeTruthy();
    expect(within(cards[0]).getByText("Realistic slice")).toBeTruthy();
    expect(within(cards[0]).getByText("$4.2B (2025, global)")).toBeTruthy();
    expect(within(cards[0]).getByText("~₹230–780 Cr")).toBeTruthy();
    expect(panel().textContent).not.toMatch(/globally/);
  });

  it("renders the rationale as bullets, never a comma-joined list", () => {
    goMarket(MARKET);
    expect(within(panel()).getByText("Storage held 68.0% (2025).").tagName).toBe("LI");
    expect(within(panel()).getByText("Food & beverages ≈ 84%.").tagName).toBe("LI");
    expect(within(panel()).getByText("Plain rationale.")).toBeTruthy();
    expect(panel().textContent).not.toContain(".,");
  });

  it("shows TBC sizes as chips and the total / beachhead lists as bullets", () => {
    goMarket(MARKET);
    expect(panel().textContent).not.toContain(TBCX);
    const card = panel().querySelectorAll(".m3-seg")[1];
    expect(within(card).getAllByText("Founder to verify").length).toBeGreaterThanOrEqual(2);
    expect(within(panel()).getByText("Combined slice not stated.").tagName).toBe("LI");
    expect(within(panel()).getByText("Packhouses in Pune.").tagName).toBe("LI");
  });

  it("draws a bar only for rows with two positive slice numbers, never a zero", () => {
    goMarket(MARKET);
    const cards = panel().querySelectorAll(".m3-seg");
    expect(cards[0].querySelector(".m3-seg-bar")).toBeTruthy();
    expect(cards[1].querySelector(".m3-seg-bar")).toBeNull();
    expect(cards[2].querySelector(".m3-seg-bar")).toBeNull();
    expect(panel().querySelector(".m3-key")).toBeTruthy();
    expect(panel().textContent).not.toMatch(/₹0\b/);
  });

  it("hides the legend when no row has numbers and marks long sizes", () => {
    const rows = MARKET.sections.market.rows.slice(1);
    goMarket(withSections({ market: { ...MARKET.sections.market, rows } }));
    expect(panel().querySelector(".m3-seg-bar")).toBeNull();
    expect(panel().querySelector(".m3-key")).toBeNull();
    const long = within(panel()).getByText(/USD 19.35B/).closest(".m3-stat-v");
    expect(long.className).toContain("long");
  });

  it("scales bars across the rows that have numbers", () => {
    goMarket(FIXTURE);
    const bars = panel().querySelectorAll(".m3-seg .hi");
    expect(bars).toHaveLength(2);
    expect(bars[0].style.width).toBe("100%");
    expect(bars[1].style.width).toBe("50%");
  });
});

describe("VipNavigatorMemo — percent cells, labels, empty questions", () => {
  const FUNDS = withSections({
    funds: { rows: [
      ["Deploy", "Sensors", "~32%", "₹70 L"],
      ["Models", ["ML engineers", "Compute"], "24%", "₹60 L"],
      ["Validation", "Lab", 15, "₹30 L"],
      ["Other", "Gap", TBCX, TBCX],
      ["Misc", "x", "n/a", "₹1 L"],
    ], total: "₹2 Cr", note: "" },
    team: { ...FIXTURE.sections.team, holders: [["A", "Founder", 60, true], ["B", "Founder", TBCX, false], ["C", "Investor", "CCD", "[To be confirmed]"]] },
  });

  it("use of funds: percent shown as-is, % appended only to bare numbers, bar from leading number", () => {
    setup({ memo: FUNDS });
    fireEvent.click(navBtn("Use of funds"));
    const t = panel().textContent;
    expect(t).not.toContain("%%");
    expect(t).not.toContain(TBCX);
    expect(within(panel()).getByText("~32%")).toBeTruthy();
    expect(within(panel()).getByText("15%")).toBeTruthy();
    expect(within(panel()).getByText("Compute").tagName).toBe("LI");
    const segs = panel().querySelectorAll(".m3-stack i");
    expect(Array.from(segs).map((s) => s.style.width)).toEqual(["32%", "24%", "15%"]);
  });

  it("team holders: equity strings kept, no stray %", () => {
    setup({ memo: FUNDS });
    fireEvent.click(navBtn("Team and ownership"));
    const t = panel().textContent;
    expect(t).not.toContain("]%");
    expect(within(panel()).getByText("60%")).toBeTruthy();
    expect(within(panel()).getByText("CCD")).toBeTruthy();
  });

  it("competitors: falls back to 'Advantage' when the company name is unknown", () => {
    setup({ memo: { ...FIXTURE, name: TBCX } });
    fireEvent.click(navBtn("Competitors"));
    expect(within(panel()).getAllByText("Advantage").length).toBeGreaterThan(0);
    expect(panel().textContent).not.toContain("advantage");
  });

  it("questions: an empty list still renders the section with a neutral line", () => {
    setup({ memo: { ...FIXTURE, questions: [] } });
    fireEvent.click(navBtn("Questions for the founders"));
    expect(within(panel()).getByText("No founder questions were generated.")).toBeTruthy();
  });

  it("list-valued fields rendered inline never join with commas", () => {
    const memo = withSections({}, { headline: ["Head one.", "Head two."] });
    setup({ memo });
    expect(document.body.textContent).not.toContain("Head one.,Head two.");
  });

  it("meta counts unique source files and section sources hide e-mail addresses", () => {
    const memo = { ...FIXTURE, source_files: ["a.pdf", "a.pdf", "b.pdf"],
      sources: { ...FIXTURE.sources, what: "Deck_founder@gmail.com_v2.pdf · Application" } };
    setup({ memo });
    expect(screen.getByTestId("vipnav-meta").textContent).toContain("2 uploaded files");
    expect(panel().textContent).not.toContain("@gmail.com");
  });
});
