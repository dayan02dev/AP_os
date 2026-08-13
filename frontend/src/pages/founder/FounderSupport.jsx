import { useEffect, useState } from "react";
import { founderApi } from "../../lib/founderApi.js";
import { Loading, ErrorState } from "./ui.jsx";

const AREAS = ["IT", "Facilities"];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const PRIORITY_CLASS = { Low: "", Medium: "blue", High: "amber", Urgent: "coral" };
const STATUS_META = {
  open: { label: "Open", cls: "amber" },
  "in-progress": { label: "In progress", cls: "blue" },
  resolved: { label: "Resolved", cls: "green" },
};
const BLANK = { area: "IT", priority: "Medium", subject: "", description: "" };

export default function FounderSupport() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  const load = () => founderApi.getSupport().then(setData).catch(setError);
  useEffect(() => { load(); }, []);

  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading label="Loading support…" />;

  const submit = async () => {
    if (!form.subject.trim() || saving) return;
    setSaving(true);
    try {
      await founderApi.createTicket(form);
      setForm(BLANK);
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <span className="eyebrow eyebrow-rule">Founders resources</span>
      <h1 className="big">Raise a <span className="hl">support ticket</span>.</h1>
      <p className="lead">IT and Facilities support for your residency. Log an issue and track it through to resolution.</p>

      <div className="support-layout mt28">
        <div className="card card-strong">
          <div className="panel-h">New ticket</div>
          <label className="form-field">
            <span className="lbl">Area</span>
            <select className="field" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}>
              {AREAS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          <label className="form-field">
            <span className="lbl">Priority</span>
            <select className="field" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          <label className="form-field">
            <span className="lbl">Subject</span>
            <input className="field" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Short summary" />
          </label>
          <label className="form-field">
            <span className="lbl">Description</span>
            <textarea
              className="apply-textarea"
              style={{ minHeight: 90 }}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What's happening, and where?"
            />
          </label>
          <button type="button" className="btn btn-primary" style={{ justifyContent: "center" }} disabled={saving || !form.subject.trim()} onClick={submit}>
            Submit ticket
          </button>
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div className="ticket-list-head">Your tickets</div>
          {data.tickets.length === 0 && <div className="muted" style={{ padding: "18px 24px" }}>No tickets yet.</div>}
          {data.tickets.map((t) => {
            const meta = STATUS_META[t.status] || STATUS_META.open;
            return (
              <div className="ticket-row" key={t.id}>
                <span className="ref">{t.ref}</span>
                <div className="info">
                  <div className="subject">{t.subject}</div>
                  <div className="area">{t.area}</div>
                </div>
                <span className={`priority ${PRIORITY_CLASS[t.priority] || ""}`}>{t.priority}</span>
                <span className={`st ${meta.cls}`}><span className="d" />{meta.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
