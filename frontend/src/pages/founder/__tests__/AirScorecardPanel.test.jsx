import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AirScorecardPanel from "../components/AirScorecardPanel.jsx";

const LEVER_DEFS = [
  { lever: "architecture", name: "Architecture & System Definition", family: "technology" },
  { lever: "manufacturability", name: "Manufacturability", family: "technology" },
  { lever: "reliability", name: "Reliability", family: "technology" },
  { lever: "market", name: "Market Validation", family: "commercial" },
  { lever: "business_model", name: "Business Model", family: "commercial" },
  { lever: "supply_chain", name: "Supply Chain", family: "commercial" },
];

function lever(key, over = {}) {
  const def = LEVER_DEFS.find((l) => l.lever === key);
  return { ...def, claimed_level: null, verified_level: null, ...over };
}

function tileValue(label) {
  return screen.getByText(label).closest(".tile").querySelector(".v").textContent;
}

const round = (over = {}) => ({
  id: "r1", round_label: "FY26-27-Q2", status: "draft",
  submitted_at: null, verified_at: null, ...over,
});

const rollups = (claimed, verified = { technology: null, commercial: null, overall: null }) => ({
  claimed, verified,
});

describe("AirScorecardPanel", () => {
  it("state 2 — nothing answered: renders all six AirBars, the not-started copy, no rule marker, every Tile reads —", () => {
    const levers = LEVER_DEFS.map((d) => lever(d.lever));
    render(
      <AirScorecardPanel
        round={round()}
        levers={levers}
        rollups={rollups({ technology: null, commercial: null, overall: null })}
      />,
    );
    for (const d of LEVER_DEFS) expect(screen.getByText(d.name)).toBeInTheDocument();
    expect(screen.getByText(/haven't started this quarter's AIR self-assessment yet/i)).toBeInTheDocument();
    expect(document.querySelector(".vipd-air-rule")).not.toBeInTheDocument();
    expect(tileValue("Technology AIR")).toBe("—");
    expect(tileValue("Commercial AIR")).toBe("—");
    expect(tileValue("Overall AIR")).toBe("—");
  });

  it("state 3 — technology answered, commercial not: technology Tile is real, commercial/overall are —, still no rule marker", () => {
    const levers = [
      lever("architecture", { claimed_level: 2 }),
      lever("manufacturability", { claimed_level: 3 }),
      lever("reliability", { claimed_level: 4 }),
      lever("market"),
      lever("business_model"),
      lever("supply_chain"),
    ];
    render(
      <AirScorecardPanel
        round={round()}
        levers={levers}
        rollups={rollups({ technology: 2, commercial: null, overall: null })}
      />,
    );
    expect(tileValue("Technology AIR")).toBe("2");
    expect(tileValue("Commercial AIR")).toBe("—");
    expect(tileValue("Overall AIR")).toBe("—");
    expect(document.querySelector(".vipd-air-rule")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Technology \/ Commercial \/ Overall AIR appear once every lever in that group has an answer/i),
    ).toBeInTheDocument();
  });

  it("state 4 — all six answered, draft: submit-gate copy, rule marker present at the exact computed percentage", () => {
    const levers = LEVER_DEFS.map((d, i) => lever(d.lever, { claimed_level: i + 1 }));
    render(
      <AirScorecardPanel
        round={round({ status: "draft" })}
        levers={levers}
        rollups={rollups({ technology: 3, commercial: 4, overall: 5 })}
      />,
    );
    expect(
      screen.getByText(/Draft — submit your scorecard from TLR evaluation to send it for ARTPARK review/i),
    ).toBeInTheDocument();
    const rules = document.querySelectorAll(".vipd-air-rule");
    expect(rules.length).toBeGreaterThan(0);
    const expectedLeft = `${((5 / 9) * 100).toFixed(2)}%`;
    for (const rule of rules) expect(rule.style.left).toBe(expectedLeft);
  });

  it("state 5 — submitted: awaiting-verification copy with the submitted date formatted in", () => {
    const levers = LEVER_DEFS.map((d, i) => lever(d.lever, { claimed_level: i + 1 }));
    render(
      <AirScorecardPanel
        round={round({ status: "submitted", submitted_at: "2026-08-10T12:00:00Z" })}
        levers={levers}
        rollups={rollups({ technology: 3, commercial: 4, overall: 5 })}
      />,
    );
    const expectedDate = new Date("2026-08-10T12:00:00Z").toLocaleDateString();
    expect(screen.getByText(new RegExp(`Submitted ${expectedDate.replace(/\//g, "\\/")} — awaiting ARTPARK verification`))).toBeInTheDocument();
  });

  it("state 1 — verified always null: shows the awaiting-verification badge once a claimed overall exists, not before", () => {
    const partialLevers = [
      lever("architecture", { claimed_level: 2 }),
      lever("manufacturability", { claimed_level: 3 }),
      lever("reliability", { claimed_level: 4 }),
      lever("market"),
      lever("business_model"),
      lever("supply_chain"),
    ];
    const { rerender } = render(
      <AirScorecardPanel
        round={round()}
        levers={partialLevers}
        rollups={rollups({ technology: 2, commercial: null, overall: null })}
      />,
    );
    expect(screen.queryByText(/Awaiting ARTPARK verification/i)).not.toBeInTheDocument();

    const fullLevers = LEVER_DEFS.map((d, i) => lever(d.lever, { claimed_level: i + 1 }));
    rerender(
      <AirScorecardPanel
        round={round()}
        levers={fullLevers}
        rollups={rollups({ technology: 3, commercial: 4, overall: 5 })}
      />,
    );
    expect(screen.getByText(/Awaiting ARTPARK verification/i)).toBeInTheDocument();
  });
});
