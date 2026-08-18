// AdminVipMisCharts — the admin cohort MIS charts screen (spec §6/§7): the
// "mis" subtab's new default content, replacing AdminVipMisMatrix as the
// landing view (matrix is still one click away via the Table toggle,
// unedited). A programme manager's whole-portfolio view: every onboarded
// VIP venture's revenue/burn/headcount/paying-customers charts, plus a
// cohort roll-up, sourced from GET /admin/platform/vip/mis/charts.
//
// Three distinct empty states this screen must never collapse into one
// message (VIP_BUILD_STATE.md: "a null with two distinct causes and one
// message true for only one of them" has bitten this project five times):
//   G6 (page-level)   — startups === [] — no VIP venture is onboarded at
//                        all. Gates the ENTIRE page, cohort roll-up
//                        included — a cohort total cannot exist without at
//                        least one onboarded venture (fetch_mis_charts
//                        derives cohort_by_period purely from startups'
//                        own submitted periods), so there is nothing else
//                        to show underneath this message.
//   G5 (per-startup)  — has_any_period is false — this venture is
//                        onboarded but has never once opened its own MIS
//                        page (periods are lazily created only by a
//                        founder's own GET /founder/mis). Distinct from G2:
//                        a founder can never observe G5 about themselves,
//                        because visiting their own page is what closes it.
//   G2 (per-startup)  — has_any_period is true, periods exist, but zero
//                        submitted monthly periods yet (misEmptyReason's
//                        two variants: overdue-backlog vs not-due-yet).
//
// The cohort roll-up is explicitly labelled a partial sum: it totals only
// the startups that reported that exact period_key, never zero-filled for
// absentees (fetch_mis_charts' own documented, not-spec-confirmed default —
// see this repo's MIS graphical-rebuild plan, "invented formulas"). An
// unlabelled total would invite a reader to mistake it for the whole
// cohort's figure, which it is not — so the caption below is load-bearing,
// not decorative.

import React, { useState } from "react";
import { adminVipApi } from "../../../../lib/adminVipApi.js";
import { useAsync, LoadingState, ErrorState, EmptyState } from "../ui.jsx";
import { PageHead } from "../shell/osAtoms";
import { vipErrorInfo } from "./vipCohortHelpers.js";
import { AdminVipMisMatrix } from "./AdminVipMisMatrix.jsx";
import MisChartCard, { GRAPH } from "../../../../components/MisChartCard.jsx";
import { misEmptyReason, misEmptyCopy } from "../../../../lib/misEmptyState.js";
import "../../../../styles/admin-vip-mis-charts.css";

const VIEWS = [["charts", "Charts"], ["table", "Table"]];

export function AdminVipMisCharts({ canWrite }) {
  const [view, setView] = useState("charts"); // "charts" | "table"
  const { data, loading, error, reload } = useAsync(() => adminVipApi.getMisCharts(), []);

  return (
    <div>
      <PageHead
        eyebrow="VIP COHORT · MIS"
        title="MIS <em>reporting</em>"
        sub="Revenue, burn, headcount and paying customers across the cohort. Switch to the table to chase a missing report."
      />

      <div className="vipc-subnav" role="group" aria-label="MIS view">
        {VIEWS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={"vipc-subnav-btn" + (view === v ? " active" : "")}
            aria-pressed={view === v}
            onClick={() => setView(v)}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "table" ? (
        <AdminVipMisMatrix canWrite={canWrite} />
      ) : loading ? (
        <LoadingState label="Loading the MIS cohort…" />
      ) : error ? (
        <ErrorState error={{ message: vipErrorInfo(error).message }} onRetry={reload} />
      ) : data.startups.length === 0 ? (
        // G6: no VIP venture is onboarded at all — page-level, nothing else
        // to show (the cohort roll-up is itself derived from startups).
        <EmptyState label="No VIP startups are onboarded yet." />
      ) : (
        <>
          <section className="mis-cohort-rollup">
            <h3>Cohort total</h3>
            <p className="mis-cohort-rollup-note">
              Partial sum — totals only the startups that reported each
              month; never zero-filled for ventures that haven't reported
              yet, so this is not the whole cohort's figure in any month
              where reporting is incomplete.
            </p>
            <div className="mis-charts-grid">
              {GRAPH.map((g) => (
                <MisChartCard
                  key={g.key}
                  chartKey={g.key}
                  title={g.title}
                  series={data.cohort.series[g.key] || []}
                />
              ))}
            </div>
          </section>

          {data.startups.map((s) => (
            <section className="mis-startup-section" key={s.application_id}>
              <h3>{s.startup}</h3>
              {!s.has_any_period ? (
                // G5: onboarded, but never opened its own MIS page.
                <p className="mis-charts-empty">Hasn't opened MIS reporting yet.</p>
              ) : (
                (() => {
                  const reason = misEmptyReason(s.monthly_status);
                  return reason ? (
                    // G2: opened MIS, periods exist, nothing submitted yet.
                    <p className="mis-charts-empty">{misEmptyCopy(reason)}</p>
                  ) : (
                    <>
                      {s.latest_period && (
                        <p className="mis-startup-latest">Latest: {s.latest_period.label}</p>
                      )}
                      <div className="mis-charts-grid">
                        {GRAPH.map((g) => (
                          <MisChartCard
                            key={g.key}
                            chartKey={g.key}
                            title={g.title}
                            series={s.series[g.key] || []}
                          />
                        ))}
                      </div>
                    </>
                  );
                })()
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}

export default AdminVipMisCharts;
