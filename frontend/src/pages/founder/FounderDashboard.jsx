// The Process dashboard tab — the residency "command center". Faithful port
// of TIR Onboarding.dc.html's showDashboard block + the Component class's
// renderVals() derivations (derishBarStyle/tasksBarStyle/drawnBarStyle,
// experimentsView's statusColor, the feed's color tokens, segPayrollStyle/
// segOnetimeStyle). Reads the /founder/residency rollup built by
// founder_journey_query.residency_bundle (derisking %, budget stacked bar,
// next milestone) — see backend/app/services/founder_journey_query.py.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { founderApi } from "../../lib/founderApi.js";
import { fmtL, Loading, ErrorState } from "./ui.jsx";
import StatTile from "./components/StatTile.jsx";
import BudgetBar from "./components/BudgetBar.jsx";
import Gantt from "./components/Gantt.jsx";

// Matches the mockup's `statusMeta[e.status].c` (TIR Onboarding.dc.html) —
// the Experiments panel's dot color is driven by experiment status, not risk.
const EXP_STATUS_COLOR = {
  "not-started": "var(--line-strong)",
  running: "var(--accent-amber)",
  validated: "var(--accent-green)",
  invalidated: "var(--accent-coral)",
};

// The backend's FEED entries carry a semantic color token (not a CSS value —
// see founder_journey_query.py's FEED comment); map it to the design tokens
// the mockup's static `feed` array used directly (green/amber/blue/dim).
const FEED_COLOR = {
  green: "var(--accent-green)",
  amber: "var(--accent-amber)",
  blue: "var(--artblue)",
  dim: "var(--ink-dim)",
};

const GRANT_CAP = 2_500_000; // ₹25L non-dilutive — matches founder_journey_query.CAP

export default function FounderDashboard() {
  const navigate = useNavigate();
  const [residency, setResidency] = useState(null);
  const [headcount, setHeadcount] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([founderApi.getResidency(), founderApi.listTeam()])
      .then(([r, team]) => {
        setResidency(r);
        setHeadcount((team || []).length);
      })
      .catch(setError);
  }, []);

  if (error) return <ErrorState error={error} />;
  if (!residency || headcount === null) return <Loading label="Loading your dashboard…" />;

  const { app, tiles, experiments, feed, expense } = residency;
  const nextMilestone = tiles.next_milestone;
  const segments = expense.segments || {};

  return (
    <div className="fj-dash">
      <div className="fj-dash-header">
        <div>
          <span className="eyebrow eyebrow-rule">Residency dashboard</span>
          <h1 className="fj-h1">{app.project_name}</h1>
          <div className="fj-dash-sub">TIR · {app.cohort} · {(app.team_names || []).join(", ")}</div>
        </div>
        <div className="fj-dash-week">
          <div className="fj-dash-week-label">Week {app.week} of {app.weeks_total}</div>
          <div className="fj-dash-week-sub">{app.weeks_remaining} weeks remaining</div>
        </div>
      </div>

      <div className="fj-dash-tiles">
        <StatTile
          label="Derisking progress"
          value={<>{tiles.derisking_pct}<small>%</small></>}
          meter={{ value: tiles.derisking_pct, color: "var(--accent-green)" }}
          sub={`${tiles.validated} of ${tiles.total_experiments} experiments validated`}
        />
        <StatTile
          label="Workplan"
          value={<>{tiles.tasks_done}<small>/{tiles.tasks_total}</small></>}
          meter={{
            value: tiles.tasks_total ? (tiles.tasks_done / tiles.tasks_total) * 100 : 0,
            color: "var(--artblue)",
          }}
          sub="activities complete"
        />
        <StatTile
          label="Budget drawn"
          value={fmtL(tiles.budget_drawn)}
          meter={{ value: tiles.budget_pct, color: "var(--artblue)" }}
          sub={`${tiles.budget_pct}% of ₹25L non-dilutive`}
        />
        <StatTile
          dark
          label="Next milestone"
          value={nextMilestone ? nextMilestone.label : "All milestones cleared"}
          sub={nextMilestone ? `Week ${nextMilestone.week} · in ${nextMilestone.in_weeks} weeks` : ""}
        />
      </div>

      <div className="fj-dash-two">
        <div className="card fj-dash-card">
          <div className="fj-dash-card-title">Experiments</div>
          <div className="fj-dash-exp-list">
            {experiments.map((e) => (
              <div className="fj-dash-exp-row" key={e.id}>
                <span
                  className="fj-dash-exp-dot"
                  style={{ background: EXP_STATUS_COLOR[e.status] || EXP_STATUS_COLOR["not-started"] }}
                />
                <span className="fj-dash-exp-short">{e.short}</span>
                <span className="fj-dash-exp-status">{e.status_label}</span>
                <span className="fj-dash-exp-range">{e.range_label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card fj-dash-card">
          <div className="fj-dash-card-title">This week</div>
          <div className="fj-dash-feed-list">
            {feed.map((f, i) => (
              <div className="fj-dash-feed-row" key={i}>
                <span className="fj-dash-feed-dot" style={{ background: FEED_COLOR[f.color] || FEED_COLOR.dim }} />
                <div>
                  <div className="fj-dash-feed-text">{f.text}</div>
                  <div className="fj-dash-feed-meta">{f.meta}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card fj-dash-card">
        <div className="fj-dash-card-head">
          <div className="fj-dash-card-title">Expense tracking</div>
          <a
            href="#"
            className="fj-dash-link"
            onClick={(e) => { e.preventDefault(); navigate("/founder/org"); }}
          >
            Manage organization →
          </a>
        </div>

        <div className="fj-dash-expense-tiles">
          <div className="fj-dash-mini-tile">
            <span className="fj-dash-mini-label">Team payroll · monthly</span>
            <span className="fj-dash-mini-value">{fmtL(expense.monthly_payroll)}</span>
            <span className="fj-dash-mini-sub">{headcount} people · {fmtL(expense.payroll_drawn)} drawn</span>
          </div>
          <div className="fj-dash-mini-tile">
            <span className="fj-dash-mini-label">Bill of materials</span>
            <span className="fj-dash-mini-value">{fmtL(expense.bom_total)}</span>
            <span className="fj-dash-mini-sub">one-time</span>
          </div>
          <div className="fj-dash-mini-tile">
            <span className="fj-dash-mini-label">Equipment</span>
            <span className="fj-dash-mini-value">{fmtL(expense.equip_total)}</span>
            <span className="fj-dash-mini-sub">one-time</span>
          </div>
          <div className="fj-dash-mini-tile">
            <span className="fj-dash-mini-label">Remaining</span>
            <span className="fj-dash-mini-value">{fmtL(expense.remaining)}</span>
            <span className="fj-dash-mini-sub">of ₹25L account</span>
          </div>
        </div>

        <div className="fj-dash-drawn">
          <div className="fj-dash-drawn-head">
            <span className="fj-dash-drawn-label">Total drawn</span>
            <span className="fj-dash-drawn-value">
              <strong>{fmtL(tiles.budget_drawn)}</strong> · {tiles.budget_pct}%
            </span>
          </div>
          <BudgetBar
            total={GRANT_CAP}
            segments={[
              { label: "Payroll drawn", value: segments.payroll_amount ?? expense.payroll_drawn, color: "var(--artblue)" },
              { label: "Capital (BOM + equipment)", value: segments.capital_amount ?? (expense.bom_total + expense.equip_total), color: "var(--accent-violet)" },
              { label: "Remaining", value: segments.remaining_amount ?? expense.remaining, color: "var(--line)" },
            ]}
          />
        </div>

        <div className="fj-dash-proc-footer">
          <div className="fj-dash-proc-text">
            Procurement · <strong>{fmtL(expense.proc_committed)}</strong> committed
            {" · "}<strong>{fmtL(expense.proc_quoted)}</strong> quoted · {expense.proc_count} items
          </div>
          <a
            href="#"
            className="fj-dash-link"
            onClick={(e) => { e.preventDefault(); navigate("/founder/expense"); }}
          >
            View procurement →
          </a>
        </div>
      </div>

      <div className="card fj-dash-card">
        <div className="fj-dash-card-head">
          <div className="fj-dash-card-title">Cycle timeline</div>
          <a
            href="#"
            className="fj-dash-link"
            onClick={(e) => { e.preventDefault(); navigate("/founder/approach"); }}
          >
            Adjust →
          </a>
        </div>
        <Gantt compact experiments={experiments} />
      </div>
    </div>
  );
}
