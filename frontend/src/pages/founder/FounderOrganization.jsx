import { useEffect, useState } from "react";
import { founderApi } from "../../lib/founderApi.js";
import { fmtINR, sum, Loading, ErrorState } from "./ui.jsx";

const BLANK = { name: "", title: "", employment_type: "full-time", monthly_cost: 0 };

export default function FounderOrganization() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(BLANK);

  const load = () => founderApi.listTeam().then(setRows).catch(setError);
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!draft.name.trim()) return;
    await founderApi.addTeam({ ...draft, monthly_cost: Number(draft.monthly_cost) || 0 });
    setDraft(BLANK); load();
  };
  const patch = async (id, field, value) => {
    await founderApi.editTeam(id, { [field]: field === "monthly_cost" ? Number(value) || 0 : value });
    load();
  };
  const remove = async (id) => { await founderApi.delTeam(id); load(); };

  if (error) return <ErrorState error={error} />;
  if (!rows) return <Loading />;
  const monthly = sum(rows, "monthly_cost");

  return (
    <div>
      <span className="eyebrow eyebrow-rule">Cohort management · Organization</span>
      <h1 className="big" style={{ fontFamily: "var(--font-display)" }}>Your team.</h1>
      <p className="lead">Add everyone drawing from the venture. Declare each person's approximate monthly cost inclusive of all deductions. This feeds expense tracking.</p>
      <table className="tbl mt16">
        <thead><tr><th>Name</th><th>Title</th><th>Type</th><th>Monthly cost</th><th></th></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td><input className="cell" defaultValue={m.name} onBlur={(e) => patch(m.id, "name", e.target.value)} /></td>
              <td><input className="cell" defaultValue={m.title || ""} onBlur={(e) => patch(m.id, "title", e.target.value)} /></td>
              <td>
                <select className="cell" defaultValue={m.employment_type} onChange={(e) => patch(m.id, "employment_type", e.target.value)}>
                  <option value="full-time">Full-time</option><option value="contract">Contract</option><option value="intern">Intern</option>
                </select>
              </td>
              <td><input className="cell" type="number" defaultValue={m.monthly_cost} onBlur={(e) => patch(m.id, "monthly_cost", e.target.value)} /></td>
              <td><button className="btn-icon" onClick={() => remove(m.id)} aria-label="Remove">✕</button></td>
            </tr>
          ))}
          <tr className="draft-row">
            <td><input className="cell" placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></td>
            <td><input className="cell" placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></td>
            <td>
              <select className="cell" value={draft.employment_type} onChange={(e) => setDraft({ ...draft, employment_type: e.target.value })}>
                <option value="full-time">Full-time</option><option value="contract">Contract</option><option value="intern">Intern</option>
              </select>
            </td>
            <td><input className="cell" type="number" placeholder="0" value={draft.monthly_cost} onChange={(e) => setDraft({ ...draft, monthly_cost: e.target.value })} /></td>
            <td><button className="btn" onClick={add}>Add</button></td>
          </tr>
        </tbody>
        <tfoot><tr className="tfoot"><td>Monthly payroll</td><td></td><td></td><td>{fmtINR(monthly)}</td><td></td></tr></tfoot>
      </table>
      <div className="muted mt16">Headcount: <strong>{rows.length}</strong> · Annualised payroll: <strong>{fmtINR(monthly * 12)}</strong></div>
    </div>
  );
}
