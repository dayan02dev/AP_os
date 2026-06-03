// TODO: move rubric to GET /reviewer/rubric endpoint (Phase 4+).
// Hardcoded per Phase 2 decision (Q5 in docs/REVIEWER_REWIRE_PLAN.md).

export const RUBRIC_VERSION = "v3.1 · 2026-04-01";
export const RUBRIC_COHORT  = "TIR 2026";

export const RUBRIC = {
  problem: {
    name: "Problem Quality",
    anchors: [
      ["10", "Existential pain for a clearly-defined market segment with quantified $ impact"],
      ["8",  "Clear pain, identified segment, market sized but unverified"],
      ["6",  "Pain articulated, segment vague, no numbers"],
      ["4",  "Pain assumed, no customer evidence"],
      ["2",  "Solution-first thinking — no real problem"],
    ],
  },
  solution: {
    name: "Solution Fit",
    anchors: [
      ["10", "Solution maps 1:1 to problem · differentiated vs all known alternatives"],
      ["8",  "Solution maps to problem · differentiated vs incumbents"],
      ["6",  "Solution addresses problem · differentiation unclear"],
      ["4",  "Solution loosely tied to problem · me-too risk"],
      ["2",  "Solution looking for a problem"],
    ],
  },
  tech: {
    name: "Tech Depth",
    anchors: [
      ["10", "Novel IP · multiple patents · published research"],
      ["8",  "Genuine technical edge · known to experts"],
      ["6",  "Solid implementation · standard tech stack"],
      ["4",  "Wrapper / integration play"],
      ["2",  "No defensible tech"],
    ],
  },
  founders: {
    name: "Founder Strength",
    anchors: [
      ["10", "2-3 founders, complementary, prior exits or domain mastery, full-time"],
      ["8",  "2+ founders, complementary, full-time, deep domain"],
      ["6",  "2 founders, some skill overlap, full-time"],
      ["4",  "Solo founder with strong background OR co-founders with weak match"],
      ["2",  "Solo founder, generalist, part-time"],
    ],
  },
  commit: {
    name: "Commitment",
    anchors: [
      ["10", "Quit prior job, invested own capital, 2+ years runway personal"],
      ["8",  "Full-time, some personal capital"],
      ["6",  "Full-time, no personal capital"],
      ["4",  "Partial commitment, 'validating'"],
      ["2",  "Side project"],
    ],
  },
};

// Compact rubric for the downloadable scoring.md
export const RUBRIC_COMPACT = [
  ["Problem",    [["10","Existential pain · quantified market"],["8","Clear pain, sized"],["6","Vague segment"],["4","No customer evidence"],["2","Solution-first"]]],
  ["Solution",   [["10","Differentiated vs all alternatives"],["8","Differentiated vs incumbents"],["6","Standard"],["4","Me-too"],["2","Solution looking for problem"]]],
  ["Tech",       [["10","Novel IP · patents · papers"],["8","Genuine edge"],["6","Solid implementation"],["4","Wrapper"],["2","No tech defensibility"]]],
  ["Founders",   [["10","2-3 founders · prior exits"],["8","Strong domain · full-time"],["6","Some overlap"],["4","Solo strong / weak match"],["2","Solo generalist part-time"]]],
  ["Commitment", [["10","Quit · personal capital · 2yr runway"],["8","Full-time + some capital"],["6","Full-time only"],["4","Partial · validating"],["2","Side project"]]],
];
