// Mock data for the reviewer-v2 portal (Phase 2).
// Ported from os/data.js — no window globals; pure named exports.
// Phase 3: this file is unused once the API client fetches real data.

export const STARTUPS = [
  { id: "s01", name: "Karkhana Robotics", founders: ["Aanya Mehta", "Rohit Kapoor"], domain: "Robotics", stage: "Pre-seed", trl: 5, sub: "12 Apr 2026", flag: "darkgreen", completeness: 92,
    ai: { overall: 8.4, conf: 92, problem: 8.6, solution: 8.2, tech: 9.0, founders: 7.8, commit: 8.4, integrity: 8.4 },
    rev: { overall: 7.9, problem: 8.0, solution: 7.5, tech: 8.5, founders: 7.5, commit: 8.0, integrity: 8.0, reco: "yes", notes: "Strong technical team, deck is tight. Tech score may be a touch high — they over-claim throughput." },
    flags: ["Throughput claim unverified"], variance: 0.5, chip: "EVALUATED" },
  { id: "s02", name: "Saathi Health AI", founders: ["Dr. Priya Iyer", "Vikram Shah", "Neha Bhat"], domain: "HealthTech", stage: "Seed", trl: 6, sub: "14 Apr 2026", flag: "darkgreen", completeness: 88,
    ai: { overall: 8.9, conf: 94, problem: 9.2, solution: 8.8, tech: 8.5, founders: 9.0, commit: 9.0, integrity: 8.8 },
    rev: { overall: 8.6, problem: 9.0, solution: 8.5, tech: 8.0, founders: 9.0, commit: 9.0, integrity: 8.0, reco: "yes", notes: "Best problem-statement in batch. Team has clinical credibility." },
    flags: [], variance: 0.3, chip: "SHORTLISTED" },
  { id: "s03", name: "GridPulse", founders: ["Arjun Rao", "Mira Sen"], domain: "CleanTech", stage: "Pre-seed", trl: 4, sub: "10 Apr 2026", flag: "green", completeness: 74,
    ai: { overall: 7.2, conf: 81, problem: 7.8, solution: 7.0, tech: 7.5, founders: 6.5, commit: 7.2, integrity: 7.0 },
    rev: { overall: 5.8, problem: 6.5, solution: 5.5, tech: 6.0, founders: 5.0, commit: 6.0, integrity: 6.0, reco: "maybe", notes: "I disagree on Founders score — sole founder, no team yet. Idea is real, execution risk high." },
    flags: ["Single founder", "Pilot data not shared"], variance: 1.4, chip: "EVALUATED" },
  { id: "s04", name: "Lumen Surgical", founders: ["Dr. Kabir Joshi", "Anika Reddy"], domain: "MedDevice", stage: "Seed", trl: 7, sub: "09 Apr 2026", flag: "darkgreen", completeness: 95,
    ai: { overall: 8.1, conf: 90, problem: 8.0, solution: 8.5, tech: 8.8, founders: 7.5, commit: 8.0, integrity: 8.0 },
    rev: { overall: 8.3, problem: 8.5, solution: 8.5, tech: 9.0, founders: 7.5, commit: 8.0, integrity: 8.5, reco: "yes", notes: "Regulatory pathway looks plausible. Strong IP." },
    flags: [], variance: 0.2, chip: "JURY REVIEW" },
  { id: "s05", name: "Tarang Acoustics", founders: ["Ishaan Patel"], domain: "Robotics", stage: "Pre-seed", trl: 3, sub: "11 Apr 2026", flag: "orange", completeness: 54,
    ai: { overall: 5.4, conf: 62, problem: 6.0, solution: 5.5, tech: 6.5, founders: 4.5, commit: 5.0, integrity: 5.0 },
    rev: { overall: 5.1, problem: 5.5, solution: 5.0, tech: 6.0, founders: 4.5, commit: 5.0, integrity: 5.0, reco: "no", notes: "Too early. Pitch deck thin." },
    flags: ["No team", "GitHub link 404", "Pitch deck missing financial plan"], variance: 0.3, chip: "IN REVIEW" },
  { id: "s06", name: "Anvaya Bio", founders: ["Sneha Krishnan", "Devansh Gupta"], domain: "BioTech", stage: "Seed", trl: 5, sub: "13 Apr 2026", flag: "darkgreen", completeness: 86,
    ai: { overall: 7.8, conf: 88, problem: 8.0, solution: 7.5, tech: 8.0, founders: 7.5, commit: 8.0, integrity: 7.5 },
    rev: { overall: 7.2, problem: 7.5, solution: 7.0, tech: 7.5, founders: 7.0, commit: 7.5, integrity: 7.0, reco: "yes", notes: "Solid science but slow commercial path." },
    flags: ["Long horizon to revenue"], variance: 0.6, chip: "JURY REVIEW" },
  { id: "s07", name: "Drishti Vision", founders: ["Karan Malhotra", "Tanvi Joshi", "Sahil Rao"], domain: "AI/CV", stage: "Pre-seed", trl: 4, sub: "08 Apr 2026", flag: "green", completeness: 70,
    ai: { overall: 6.8, conf: 78, problem: 7.0, solution: 6.5, tech: 7.5, founders: 7.0, commit: 6.5, integrity: 6.0 },
    rev: { overall: 7.5, problem: 7.5, solution: 7.5, tech: 8.0, founders: 7.5, commit: 7.0, integrity: 7.5, reco: "yes", notes: "Reviewer sees more upside than AI. Founders are seasoned." },
    flags: [], variance: 0.7, chip: "EVALUATED" },
  { id: "s08", name: "Yantra Mobility", founders: ["Aditi Shenoy", "Ravi Pillai"], domain: "Robotics", stage: "Seed", trl: 6, sub: "07 Apr 2026", flag: "darkgreen", completeness: 90,
    ai: { overall: 7.5, conf: 85, problem: 7.5, solution: 7.5, tech: 8.0, founders: 7.5, commit: 7.0, integrity: 7.5 },
    rev: { overall: 8.5, problem: 8.5, solution: 9.0, tech: 9.0, founders: 8.0, commit: 8.5, integrity: 8.0, reco: "yes", notes: "Underrated by AI. The integration story is compelling." },
    flags: ["Variance with AI on Solution"], variance: 1.0, chip: "EVALUATED" },
  { id: "s09", name: "Pravaha Water", founders: ["Meera Krishnamurthy"], domain: "CleanTech", stage: "Pre-seed", trl: 5, sub: "15 Apr 2026", flag: "darkgreen", completeness: 84,
    ai: { overall: 7.0, conf: 83, problem: 8.5, solution: 7.0, tech: 7.5, founders: 6.5, commit: 6.5, integrity: 6.0 },
    flags: [], variance: null, chip: "PROCESSING" },
  { id: "s10", name: "Kaleido Quantum", founders: ["Dr. Aman Khanna"], domain: "DeepTech", stage: "Pre-seed", trl: 2, sub: "16 Apr 2026", flag: "orange", completeness: 48,
    ai: { overall: 5.0, conf: 55, problem: 5.5, solution: 4.5, tech: 6.5, founders: 5.0, commit: 4.5, integrity: 4.0 },
    flags: ["Pitch deck < 3 pages", "No prototype evidence"], chip: "NEW" },
  { id: "s11", name: "Bandhu AgriCare", founders: ["Pooja Nair", "Siddharth Iyer"], domain: "AgriTech", stage: "Seed", trl: 6, sub: "06 Apr 2026", flag: "darkgreen", completeness: 88,
    ai: { overall: 8.0, conf: 91, problem: 8.5, solution: 8.0, tech: 7.5, founders: 8.5, commit: 8.0, integrity: 7.5 },
    rev: { overall: 8.0, problem: 8.0, solution: 8.0, tech: 7.5, founders: 8.5, commit: 8.0, integrity: 8.0, reco: "yes" },
    flags: [], variance: 0.0, chip: "ACCEPTED" },
  { id: "s12", name: "Lithos Materials", founders: ["Aryan Banerjee", "Ishita Roy"], domain: "Materials", stage: "Pre-seed", trl: 3, sub: "05 Apr 2026", flag: "green", completeness: 68,
    ai: { overall: 6.0, conf: 74, problem: 6.5, solution: 6.0, tech: 7.0, founders: 5.5, commit: 5.5, integrity: 6.0 },
    rev: { overall: 5.5, problem: 6.0, solution: 5.0, tech: 6.5, founders: 5.5, commit: 5.0, integrity: 5.0, reco: "no" },
    flags: [], variance: 0.5, chip: "REJECTED" },
  { id: "s13", name: "Saavera Mobility", founders: ["Rishabh Verma", "Anjali Menon"], domain: "Mobility", stage: "Seed", trl: 6, sub: "04 Apr 2026", flag: "darkgreen", completeness: 82,
    ai: { overall: 7.6, conf: 87, problem: 7.5, solution: 8.0, tech: 7.5, founders: 7.5, commit: 7.5, integrity: 7.5 },
    rev: { overall: 7.4, problem: 7.5, solution: 7.5, tech: 7.5, founders: 7.0, commit: 7.5, integrity: 7.0, reco: "yes" },
    flags: [], variance: 0.2, chip: "JURY REVIEW" },
  { id: "s14", name: "Vidyut Storage", founders: ["Hrithik Sharma"], domain: "CleanTech", stage: "Pre-seed", trl: 4, sub: "03 Apr 2026", flag: "green", completeness: 72,
    ai: { overall: 6.5, conf: 79, problem: 7.0, solution: 6.5, tech: 7.0, founders: 6.0, commit: 6.0, integrity: 6.5 },
    rev: { overall: 7.8, problem: 8.0, solution: 8.0, tech: 8.0, founders: 7.5, commit: 7.5, integrity: 7.5, reco: "yes", notes: "Reviewer thinks AI under-scored. Push to next round." },
    flags: ["Variance >1.0"], variance: 1.3, chip: "EVALUATED" },
  { id: "s15", name: "Mihira Diagnostics", founders: ["Dr. Tara Pillai", "Yash Goyal"], domain: "HealthTech", stage: "Seed", trl: 7, sub: "01 Apr 2026", flag: "darkgreen", completeness: 96,
    ai: { overall: 8.7, conf: 93, problem: 9.0, solution: 8.5, tech: 8.5, founders: 9.0, commit: 8.5, integrity: 8.5 },
    rev: { overall: 8.8, problem: 9.0, solution: 8.5, tech: 9.0, founders: 9.0, commit: 8.5, integrity: 8.5, reco: "yes" },
    flags: [], variance: 0.1, chip: "ACCEPTED" },
  { id: "s16", name: "Nakshatra Drones", founders: ["Aakash Pillai", "Riya Bose"], domain: "Robotics", stage: "Pre-seed", trl: 5, sub: "02 Apr 2026", flag: "green", completeness: 76,
    ai: { overall: 7.0, conf: 84, problem: 7.0, solution: 7.5, tech: 7.5, founders: 6.5, commit: 7.0, integrity: 6.5 },
    rev: { overall: 7.2, problem: 7.0, solution: 7.5, tech: 7.5, founders: 7.0, commit: 7.0, integrity: 7.0, reco: "maybe" },
    flags: [], variance: 0.2, chip: "WAITLISTED" },
];

// Queue-canonical overrides (single source of truth for the queue table)
export const QUEUE_ITEM_INDUSTRY = [
  "Robotics & Automation", "Healthcare / MedTech", "Climate Fintech / Urban Resilience",
  "Healthcare / MedTech", "Robotics & Automation", "Artificial Intelligence / Foundational Models",
  "Artificial Intelligence / Foundational Models", "EV Mobility & Services",
];
export const QUEUE_ITEM_STAGE = [
  "Pilot-ready", "Prototype", "Pilot-ready", "Lab demo",
  "Research", "Active pilots", "Lab demo", "Lab demo",
];
export const QUEUE_ITEM_DUE = ["1d", "2d", "3d", "3d", "4d", "5d", "6d", "7d"];

// History rows (past cohort metadata — reviewer scores come from the eval store)
export const HISTORY_ROWS = [
  { appId: "s01", name: "Karkhana Robotics",  date: "18 Apr 2026", aiScore: 8.4, myScore: 7.9, reco: "yes",   adminDec: "approved" },
  { appId: "s15", name: "Mihira Diagnostics", date: "10 Apr 2026", aiScore: 8.7, myScore: 8.8, reco: "yes",   adminDec: "approved" },
  { appId: "s08", name: "Yantra Mobility",    date: "08 Apr 2026", aiScore: 7.5, myScore: 8.5, reco: "yes",   adminDec: "approved" },
  { appId: "s03", name: "GridPulse",          date: "05 Apr 2026", aiScore: 7.2, myScore: 5.8, reco: "maybe", adminDec: "rejected" },
  { appId: "s13", name: "Saavera Mobility",   date: "30 Mar 2026", aiScore: 7.6, myScore: 7.4, reco: "yes",   adminDec: "approved" },
  { appId: "s09", name: "Pravaha Water",      date: "25 Mar 2026", aiScore: 7.0, myScore: 7.0, reco: "yes",   adminDec: "approved" },
  { appId: "s12", name: "Lithos Materials",   date: "20 Mar 2026", aiScore: 6.0, myScore: 5.5, reco: "no",    adminDec: "rejected" },
];

export const OS_DATA = { STARTUPS, HISTORY_ROWS, QUEUE_ITEM_INDUSTRY, QUEUE_ITEM_STAGE, QUEUE_ITEM_DUE };
