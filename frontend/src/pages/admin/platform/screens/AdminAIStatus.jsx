// AdminAIStatus — A-6 AI Pipeline Status (Task 16)
//
// Faithful port of AdminAIStatus from admin-2.jsx prototype.
// All data is inline mock — no global OS_DATA singleton calls.
// Entire screen is preview — no backend endpoint for real pipeline status yet.

import React from "react";
import { PageHead, Stat } from "../shell/osAtoms";
import { PreviewBadge } from "../../../../components/admin/PreviewBadge";

const MOCK_TASKS = [
  { name: 'Pravaha Water · Layer 2 scoring',         step: 'Extracting evidence from pitch.pdf',  pct: 62 },
  { name: 'Kaleido Quantum · Layer 1 validation',    step: 'Checking deck completeness',           pct: 88 },
  { name: 'Mihira Diagnostics · Reviewer assignment', step: 'Matching to domain experts',          pct: 34 },
];

const MOCK_LOG = [
  '[10:42:18] OK Pravaha Water · scoring complete · 7.0',
  '[10:38:02] -> Pravaha Water · extracting team data',
  '[10:36:14] -> Pravaha Water · parsing pitch.pdf',
  '[10:35:03] .. Pravaha Water · job started',
  '[10:31:55] OK Karkhana Robotics · review submitted',
  '[10:24:11] OK Tarang Acoustics · scoring complete · 5.4',
  '[10:18:33] !! Tarang Acoustics · 3 flags raised',
  '[10:14:02] .. Tarang Acoustics · job started',
].join('\n');

export function AdminAIStatus() {
  return (
    <div>
      <PageHead
        eyebrow="A-6 · AI PIPELINE"
        title="AI <em>pipeline status</em>"
        sub="Layer 2 (auto-scoring) and Layer 3 (reviewer matching) execution status."
        actions={[
          <PreviewBadge key="preview" />,
          <button key="cfg" className="os-btn ghost">Configure</button>,
        ]}
      />
      <div className="os-stats-row os-mb-lg">
        <Stat tone="l2" num="237" label="Scored today"   meta="↑ 11 since 9 AM" />
        <Stat tone="l2" num="3"   label="Running now"    meta="Avg 4m 12s" />
        <Stat tone="l3" num="11"  label="Queued"         meta="Next: 2 min" />
        <Stat tone="l4" num="98.4%" label="Success rate" meta="7d trailing" />
      </div>

      <div className="os-grid-sidebar">
        <div className="os-card">
          <div className="os-card-head">
            <div className="os-card-title">Active jobs</div>
            <span className="os-chip green">● 3 RUNNING</span>
          </div>
          <div className="os-stack">
            {MOCK_TASKS.map((t, i) => (
              <div
                key={i}
                style={{
                  padding: '12px 0',
                  borderBottom: i < MOCK_TASKS.length - 1 ? '1px dashed var(--line)' : 'none',
                }}
              >
                <div className="os-row between os-mb-sm">
                  <span style={{ fontWeight: 600 }}>{t.name}</span>
                  <span className="os-mono os-text-xs">{t.pct}%</span>
                </div>
                <div className="os-text-xs os-text-soft os-mb-sm">→ {t.step}</div>
                <div className="os-scorebar-track">
                  <div
                    className="os-scorebar-fill"
                    style={{ width: t.pct + '%', background: 'var(--l2-cyan)' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="os-card">
          <div className="os-card-title os-mb">Pipeline log</div>
          <div className="os-rubric" style={{ maxHeight: 360, overflow: 'auto' }}>
            <div className="head">
              <span>$ artpark-ai watch</span>
              <span className="ver">v3.1</span>
            </div>
            <pre>{MOCK_LOG}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminAIStatus;
