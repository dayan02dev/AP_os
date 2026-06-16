// AdminPsychometry — A-5 Psychometry Pipeline (Task 16)
//
// Faithful port of AdminPsychometry from admin-2.jsx prototype.
// All data is inline mock — no global OS_DATA singleton calls.
// Entire screen is preview — no backend for psychometry yet.

import React from "react";
import { PageHead, Chip } from "../shell/osAtoms";
import { PreviewBadge } from "../../../../components/admin/PreviewBadge";

export function AdminPsychometry() {
  return (
    <div>
      <PageHead
        eyebrow="A-5 · PSYCHOMETRY"
        title="Psychometry <em>Pipeline</em>"
        sub="Manage Korn Ferry test distribution and archetype reviews."
        actions={[<PreviewBadge key="preview" />]}
      />
      <div className="os-card">
        <table className="os-table">
          <thead>
            <tr>
              <th>Startup</th>
              <th>Founders Invited</th>
              <th>Tests Completed</th>
              <th>Archetypes Gen</th>
              <th>Jury Shortlisted</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><b>Karkhana Robotics</b></td>
              <td>2</td>
              <td><Chip tone="green">2/2</Chip></td>
              <td><Chip tone="green">YES</Chip></td>
              <td><Chip tone="blue">YES</Chip></td>
              <td>
                <button
                  className="os-btn sm secondary"
                  onClick={() => window.alert('Karkhana Robotics — psychometry profile report.')}
                >
                  View Profile
                </button>
              </td>
            </tr>
            <tr>
              <td><b>Mihira Diagnostics</b></td>
              <td>3</td>
              <td><Chip tone="amber">1/3</Chip></td>
              <td><Chip>NO</Chip></td>
              <td><Chip>NO</Chip></td>
              <td>
                <button
                  className="os-btn sm ghost"
                  onClick={() => window.alert('Psychometry invite resent to Mihira Diagnostics.')}
                >
                  Resend Invite
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AdminPsychometry;
