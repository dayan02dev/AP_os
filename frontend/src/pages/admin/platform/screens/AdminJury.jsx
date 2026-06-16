// AdminJury — ported verbatim from admin-2.jsx `AdminJury`.
// A-6 · JURY MANAGEMENT — visual preview on local mock data (no backend).
// All data is read from _juryMock; no API calls.

import React from "react";
import { PageHead, Chip } from "../shell/osAtoms";
import { PreviewBadge } from "../../../../components/admin/PreviewBadge";

export function AdminJury() {
  return (
    <div>
      <PreviewBadge />
      <PageHead
        eyebrow="A-6 · JURY MANAGEMENT"
        title='Jury <em>Assignments</em>'
        sub="Manage external jury members, their assignments, and score aggregation."
      />
      <div className="os-card">
        <table className="os-table">
          <thead>
            <tr>
              <th>Startup</th>
              <th>Assigned Jury</th>
              <th>Scores In</th>
              <th>Avg Jury Score</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><b>Karkhana Robotics</b></td>
              <td>Dr. R. Iyer, Dr. P. Suresh</td>
              <td><Chip tone="green">2/2</Chip></td>
              <td className="num"><b>8.4</b></td>
              <td>
                <button
                  className="os-btn sm secondary"
                  onClick={() => window.alert('Jury scoring detail — Karkhana Robotics.')}
                >
                  Details
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AdminJury;
