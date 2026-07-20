import { useEffect, useState } from "react";
import { founderApi } from "../../lib/founderApi.js";
import { Loading, ErrorState } from "./ui.jsx";

const SLOTS = ["Morning (9–1)", "Afternoon (2–6)", "Full day (9–6)"];
const AVAIL_META = {
  available: { label: "Available", cls: "green" },
  limited: { label: "Limited", cls: "amber" },
};
const BOOK_STATUS = {
  confirmed: { label: "Confirmed", cls: "green" },
  pending: { label: "Pending", cls: "amber" },
};

export default function FounderAssets() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ asset_id: "", date: "", slot: SLOTS[0] });
  const [saving, setSaving] = useState(false);

  const load = () => founderApi.getAssets().then(setData).catch(setError);
  useEffect(() => { load(); }, []);

  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading label="Loading assets…" />;

  const submit = async () => {
    if (!form.asset_id || !form.date || saving) return;
    setSaving(true);
    try {
      await founderApi.createBooking(form.asset_id, form.date, form.slot);
      setForm({ asset_id: "", date: "", slot: SLOTS[0] });
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <span className="eyebrow eyebrow-rule">Founders resources</span>
      <h1 className="big">Book ARTPARK <span className="hl">assets</span>.</h1>
      <p className="lead">
        Reserve labs, equipment, and space at IISc and ARTPARK. Check availability and lock a
        slot for your team.
      </p>

      <div className="assets-layout mt28">
        <div className="asset-list">
          {data.assets.map((a) => {
            const meta = AVAIL_META[a.avail] || AVAIL_META.available;
            return (
              <div className="asset-row card" key={a.id}>
                <div className="info">
                  <div className="name">{a.name}</div>
                  <div className="loc">{a.loc}</div>
                </div>
                <span className={`st ${meta.cls}`}><span className="d" />{meta.label}</span>
                <button type="button" className="mini ghost" onClick={() => setForm((f) => ({ ...f, asset_id: a.id }))}>
                  Book
                </button>
              </div>
            );
          })}
        </div>

        <div className="assets-side">
          <div className="card card-strong">
            <div className="panel-h">New booking</div>
            <label className="form-field">
              <span className="lbl">Asset</span>
              <select className="field" value={form.asset_id} onChange={(e) => setForm({ ...form, asset_id: e.target.value })}>
                <option value="">Select an asset</option>
                {data.assets.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span className="lbl">Date</span>
              <input type="date" className="field" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </label>
            <label className="form-field">
              <span className="lbl">Slot</span>
              <select className="field" value={form.slot} onChange={(e) => setForm({ ...form, slot: e.target.value })}>
                {SLOTS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-primary"
              style={{ justifyContent: "center" }}
              disabled={saving || !form.asset_id || !form.date}
              onClick={submit}
            >
              Confirm booking
            </button>
          </div>

          <div className="card">
            <div className="panel-h">Your bookings</div>
            <div className="booking-list mt8">
              {data.bookings.length === 0 && <div className="muted">No bookings yet.</div>}
              {data.bookings.map((b) => {
                const meta = BOOK_STATUS[b.status] || BOOK_STATUS.pending;
                return (
                  <div className="booking-row" key={b.id}>
                    <span className={`dot ${meta.cls}`} />
                    <div className="info">
                      <div className="name">{b.asset_name}</div>
                      <div className="meta">{b.date} · {b.slot}</div>
                    </div>
                    <span className={`st ${meta.cls}`}>{meta.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
