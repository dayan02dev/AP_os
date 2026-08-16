// AdminVipMisMatrix — the MIS submissions matrix (spec §7): startups ×
// periods with status chips (submitted / draft / overdue), one calendar
// kind (monthly/quarterly) at a time. Reads GET
// /admin/platform/vip/mis/matrix?kind=, which only reflects periods that
// already exist — a founder's own GET /founder/mis is the only thing that
// lazily generates them (services/admin_vip_query.fetch_mis_matrix), so a
// startup missing a given period's cell here means "not generated yet",
// which this renders as its own dash mark rather than a false "draft".
//
// Opening an existing cell drills into AdminVipMisPeriod in place (the same
// pattern AdminIiscRoster uses for AdminProfessorDetail).

import React, { useState } from "react";
import { adminVipApi } from "../../../../lib/adminVipApi.js";
import { useAsync } from "../ui.jsx";
import { LoadingState, ErrorState, EmptyState } from "../ui.jsx";
import { PageHead } from "../shell/osAtoms";
import { vipErrorInfo } from "./vipCohortHelpers.js";
import { AdminVipMisPeriod } from "./AdminVipMisPeriod.jsx";

const KINDS = [["monthly", "Monthly"], ["quarterly", "Quarterly"]];

function statusWord(cell) {
  if (!cell) return null;
  if (cell.status === "submitted") return "submitted";
  return cell.overdue ? "overdue" : "draft";
}

export function AdminVipMisMatrix({ canWrite }) {
  const [kind, setKind] = useState("monthly");
  const [selected, setSelected] = useState(null);
  const { data, loading, error, reload } = useAsync(() => adminVipApi.getMisMatrix(kind), [kind]);

  if (selected) {
    return (
      <AdminVipMisPeriod
        applicationId={selected.applicationId}
        kind={kind}
        periodKey={selected.periodKey}
        canWrite={canWrite}
        onBack={() => setSelected(null)}
        onChanged={reload}
        onNavigatePeriod={(periodKey) => setSelected((s) => ({ ...s, periodKey }))}
      />
    );
  }

  const periodKeys = data?.period_keys || [];
  const startups = data?.startups || [];

  return (
    <div>
      <PageHead
        eyebrow="VIP COHORT · MIS"
        title="MIS <em>submissions</em>"
        sub="Startups × reporting periods. Open a cell to read a period; reopen returns it to draft for correction."
      />

      <div className="vipc-subnav" role="group" aria-label="Reporting calendar">
        {KINDS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={"vipc-subnav-btn" + (kind === v ? " active" : "")}
            aria-pressed={kind === v}
            onClick={() => setKind(v)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState label="Loading the MIS matrix…" />
      ) : error ? (
        <ErrorState error={{ message: vipErrorInfo(error).message }} onRetry={reload} />
      ) : startups.length === 0 ? (
        <EmptyState label={`No ${kind} periods have been generated for any VIP startup yet.`} />
      ) : (
        <div className="vipc-matrix-wrap">
          <table className="vipc-matrix-table">
            <thead>
              <tr>
                <th className="startup-col">Startup</th>
                {periodKeys.map((p) => <th key={p.period_key}>{p.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {startups.map((s) => (
                <tr key={s.application_id}>
                  <td className="startup-col">{s.startup}</td>
                  {periodKeys.map((p) => {
                    const cell = s.periods[p.period_key];
                    const word = statusWord(cell);
                    return (
                      <td key={p.period_key}>
                        {cell ? (
                          <button
                            className={`vipc-cell-btn is-${word}`}
                            aria-label={`${s.startup} — ${p.label} — ${word}`}
                            onClick={() => setSelected({ applicationId: s.application_id, periodKey: p.period_key })}
                          >
                            {word.charAt(0).toUpperCase() + word.slice(1)}
                          </button>
                        ) : (
                          <span className="vipc-cell-missing" title="No period generated for this startup yet">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default AdminVipMisMatrix;
