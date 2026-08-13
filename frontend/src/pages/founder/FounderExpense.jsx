// The Expense management tab — Procurement page. Faithful port of
// TIR Onboarding.dc.html's showProcurement block + the Component class's
// addProc()/updProc()/delProc()/syncProc() handlers and the proc*
// renderVals() derivations. BOM/equipment now live on Organization's step 3
// (founder_bom_items/founder_equipment_items feed the "Estimated total" tile
// and the sync action, but aren't edited here anymore).
//
// Totals (Estimated/Quoted/Committed/open·committed counts) come from the
// backend's /founder/expense bundle rather than being recomputed client-side
// from qty×rate — reloading the bundle after every mutation (same convention
// the original FounderExpense/FounderOrganization used) keeps them correct
// without duplicating the server's math.
import { useEffect, useState } from "react";
import { founderApi } from "../../lib/founderApi.js";
import { fmtL, Loading, ErrorState } from "./ui.jsx";
import StatTile from "./components/StatTile.jsx";

const PROC_CATEGORIES = ["BOM", "Equipment", "Service"];
const PROC_STATUS_META = {
  estimate: { label: "Estimate", color: "var(--ink-dim)" },
  quoted: { label: "Quote received", color: "var(--accent-amber)" },
  po: { label: "PO raised", color: "var(--artblue)" },
  received: { label: "Received", color: "var(--accent-green)" },
};

export default function FounderExpense() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const load = () => founderApi.getExpense().then(setData).catch(setError);
  useEffect(() => { load(); }, []);

  const addLine = async () => {
    try {
      await founderApi.addProcurement({
        item: "New line item", category: "BOM", qty: 1, estimate: 0,
        vendor: "", quote: 0, lead_weeks: 4, status: "estimate",
      });
      await load();
    } catch (err) {
      setActionError(err);
    }
  };
  const editLine = async (id, field, value) => {
    try {
      const numeric = field === "qty" || field === "estimate" || field === "quote" || field === "lead_weeks";
      await founderApi.editProcurement(id, { [field]: numeric ? Number(value) || 0 : value });
      await load();
    } catch (err) {
      setActionError(err);
    }
  };
  const removeLine = async (id) => {
    try {
      await founderApi.delProcurement(id);
      await load();
    } catch (err) {
      setActionError(err);
    }
  };
  const syncNow = async () => {
    setSyncing(true);
    try {
      await founderApi.syncProcurement();
      await load();
    } catch (err) {
      setActionError(err);
    } finally {
      setSyncing(false);
    }
  };

  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading label="Loading procurement…" />;

  const t = data.totals || {};
  const proc = data.procurement || [];
  const variance = (t.proc_quoted || 0) - (t.proc_estimate || 0);
  const varianceColor = variance > 0 ? "var(--accent-coral)" : "var(--accent-green)";
  const varianceLabel = `${variance >= 0 ? "+" : "−"}${fmtL(Math.abs(variance))}`;

  return (
    <div className="fj-wizard" style={{ maxWidth: 1120 }}>
      <span className="eyebrow eyebrow-rule">Procurement</span>
      <h1 className="fj-h1">Turn your BOM into <span className="hl">purchase estimates</span>.</h1>
      <p className="fj-help" style={{ maxWidth: 760 }}>
        Every bill-of-materials line and piece of equipment becomes a procurement item — get
        quotes, name vendors, track lead times, and raise POs. Estimated cost comes from
        Organization Building; committed spend flows into your expense tracking.
      </p>

      {actionError && (
        <div className="fj-inline-error" role="alert">
          {actionError?.message || "Something went wrong saving that change."}
        </div>
      )}

      <div className="fj-proc-tiles">
        <StatTile label="Estimated total" value={fmtL(t.proc_estimate)} sub="from BOM & equipment" />
        <StatTile
          label="Quoted total"
          value={fmtL(t.proc_quoted)}
          sub={<span style={{ color: varianceColor }}>{varianceLabel} vs estimate</span>}
        />
        <StatTile label="Committed" value={fmtL(t.proc_committed)} sub="POs raised + received" />
        <StatTile
          dark
          label="Items"
          value={String(proc.length)}
          sub={`${t.proc_open_count ?? 0} open · ${t.proc_committed_count ?? 0} committed`}
        />
      </div>

      <div className="fj-proc-scroll">
        <div className="fj-gt fj-proc-table" style={{ "--gt-cols": "1fr 96px 60px 118px 170px 118px 70px 150px 44px" }}>
          <div className="fj-gt-head">
            <div>Item</div><div>Category</div><div>Qty</div><div>Est. unit</div>
            <div>Vendor</div><div>Quoted unit</div><div>Lead</div><div>Status</div><div />
          </div>
          {proc.map((p) => (
            <div className="fj-gt-row" key={p.id}>
              <div>
                <input
                  className="fj-gt-input bare"
                  defaultValue={p.item}
                  onBlur={(e) => editLine(p.id, "item", e.target.value)}
                  placeholder="Item"
                />
              </div>
              <div>
                <select
                  className="fj-gt-input"
                  defaultValue={p.category}
                  onChange={(e) => editLine(p.id, "category", e.target.value)}
                >
                  {PROC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <input
                  type="number" min="0"
                  className="fj-gt-input"
                  defaultValue={p.qty}
                  onBlur={(e) => editLine(p.id, "qty", e.target.value)}
                />
              </div>
              <div className="fj-gt-money">
                <span className="fj-gt-rupee">₹</span>
                <input
                  type="number" min="0" step="500"
                  className="fj-gt-input"
                  defaultValue={p.estimate}
                  onBlur={(e) => editLine(p.id, "estimate", e.target.value)}
                />
              </div>
              <div>
                <input
                  className="fj-gt-input"
                  defaultValue={p.vendor || ""}
                  onBlur={(e) => editLine(p.id, "vendor", e.target.value)}
                  placeholder="Vendor"
                />
              </div>
              <div className="fj-gt-money">
                <span className="fj-gt-rupee">₹</span>
                <input
                  type="number" min="0" step="500"
                  className="fj-gt-input"
                  defaultValue={p.quote}
                  onBlur={(e) => editLine(p.id, "quote", e.target.value)}
                />
              </div>
              <div className="fj-gt-lead">
                <input
                  type="number" min="0"
                  className="fj-gt-input"
                  defaultValue={p.lead_weeks}
                  onBlur={(e) => editLine(p.id, "lead_weeks", e.target.value)}
                />
                <span>w</span>
              </div>
              <div>
                <select
                  className="fj-gt-input fj-proc-status"
                  style={{ color: (PROC_STATUS_META[p.status] || PROC_STATUS_META.estimate).color }}
                  defaultValue={p.status}
                  onChange={(e) => editLine(p.id, "status", e.target.value)}
                >
                  <option value="estimate">Estimate</option>
                  <option value="quoted">Quote received</option>
                  <option value="po">PO raised</option>
                  <option value="received">Received</option>
                </select>
              </div>
              <div className="fj-gt-remove">
                <a href="#" onClick={(e) => { e.preventDefault(); removeLine(p.id); }}>×</a>
              </div>
            </div>
          ))}
          <div className="fj-gt-foot">
            <div>Totals</div><div /><div /><div>{fmtL(t.proc_estimate)}</div>
            <div /><div>{fmtL(t.proc_quoted)}</div><div /><div /><div />
          </div>
        </div>
      </div>

      <div className="fj-proc-actions">
        <a href="#" className="fj-add-row" onClick={(e) => { e.preventDefault(); addLine(); }}>
          + Add a line item
        </a>
        <a href="#" className="fj-sync-row" onClick={(e) => { e.preventDefault(); if (!syncing) syncNow(); }}>
          {syncing ? "Syncing…" : "↺ Sync from BOM & equipment"}
        </a>
      </div>
    </div>
  );
}
