// AdminVipCohort — the "VIP cohort" admin tab (spec §7 / D4): a new tab in
// the existing /admin portal closing the verification loop for AIR
// self-assessment and MIS reporting. Two screens, one capability gate:
// reads need `view_all_apps` (already required to reach the admin shell at
// all — see rbac.ADMIN_SHELL_ROLES), writes need `manage_vip_cohort`. The
// gate is resolved once here and passed down as `canWrite` so each screen
// disables its own write affordances rather than re-deriving the check
// (rbac.py / rbac.js are hand-synced — see either file's header comment).

import React, { useState } from "react";
import { useAuth } from "../../../../hooks/useAuth.jsx";
import { hasCapability } from "../../../../lib/rbac.js";
import "../../../../styles/admin-vip-cohort.css";
import { AdminVipAirQueue } from "./AdminVipAirQueue.jsx";
import { AdminVipMisCharts } from "./AdminVipMisCharts.jsx";

const SUBTABS = [
  ["air", "AIR verification"],
  ["mis", "MIS submissions"],
];

export function AdminVipCohort() {
  const { user } = useAuth();
  const canWrite = hasCapability(user?.roles || [], "manage_vip_cohort");
  const [tab, setTab] = useState("air");

  return (
    <div>
      <div className="vipc-subnav" role="tablist" aria-label="VIP cohort">
        {SUBTABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={"vipc-subnav-btn" + (tab === id ? " active" : "")}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "air" ? <AdminVipAirQueue canWrite={canWrite} /> : <AdminVipMisCharts canWrite={canWrite} />}
    </div>
  );
}

export default AdminVipCohort;
