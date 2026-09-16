import React, { useState } from "react";

const SECTION_LABELS = {
  title_block: "Title block",
  deal_snapshot: "Deal snapshot",
  company_explanation: "What does this company do?",
  why_solution_matters: "Why this solution matters",
  product_business_model: "Product and business model",
  technology_edge: "Technology edge",
  competitive_landscape: "Competitive landscape",
  addressable_market: "Addressable market",
  founding_team: "Founding team",
  milestones: "Milestones and timeline",
  use_of_funds: "Use of funds",
  risks_mitigants: "Key risks and mitigants",
  ic_recommendation: "IC recommendation",
  ic_reviewer_notes: "IC reviewer notes",
  attribution: "Source attribution",
};

function renderValue(value) {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return <p>{String(value)}</p>;
  if (Array.isArray(value)) return <ul>{value.map((item, i) => <li key={i}>{renderValue(item)}</li>)}</ul>;
  if (typeof value === "object") {
    return <div className="vip-memo-object">{Object.entries(value).map(([key, item]) => (
      <div key={key}><strong>{key.replaceAll("_", " ")}</strong>{renderValue(item)}</div>
    ))}</div>;
  }
  return null;
}

export default function VipMemoPreview({ memo, onDownload, generating = false }) {
  const [open, setOpen] = useState({});
  if (!memo) return null;
  return (
    <section className="vip-memo-card" aria-label="VIP investment memo">
      <header className="vip-memo-head">
        <div>
          <div className="vip-memo-kicker">VIP investment memo · pilot</div>
          <h3 className="vip-memo-title">Investment Committee Memo.</h3>
        </div>
        {onDownload && (
          <div className="vip-memo-actions" aria-label="Download investment memo">
            <button className="os-btn secondary" onClick={() => onDownload("pdf")}>Download PDF</button>
            <button className="os-btn secondary" onClick={() => onDownload("docx")}>Download DOCX</button>
          </div>
        )}
      </header>
      {memo.memo_scores && (
        <div className="vip-memo-score-grid" aria-label="Memo scores">
          {Object.entries(memo.memo_scores).map(([key, value]) => (
            <div className="vip-memo-score" key={key}>
              <span className="vip-memo-score-label">{key.replaceAll("_", " ")}</span>
              <strong className="vip-memo-score-value">
                {typeof value === "object" ? value.score : value}<small> / 10</small>
              </strong>
            </div>
          ))}
        </div>
      )}
      <div className="vip-memo-sections">
        {Object.entries(SECTION_LABELS).map(([key, label], index) => {
          const value = memo[key];
          if (value == null) return null;
          const isOpen = key in open ? open[key] : index === 0;
          return (
            <div className={`vip-memo-section${isOpen ? " is-open" : ""}`} key={key}>
              <button type="button" onClick={() => setOpen(prev => ({ ...prev, [key]: !isOpen }))} aria-expanded={isOpen}>
                <span className="vip-memo-toggle" aria-hidden="true">{isOpen ? "−" : "+"}</span>
                <strong>{label}</strong>
              </button>
              {isOpen && <div className="vip-memo-body">{renderValue(value)}</div>}
            </div>
          );
        })}
      </div>
      {generating && <p className="vip-memo-status">Generating memo — this can take a moment.</p>}
    </section>
  );
}
