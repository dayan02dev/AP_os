import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../../shell/osAtoms";

const BLANK = { id: null, name: "", contact_name: "", contact_email: "",
  contact_phone: "", artpark_ref: "", notes: "" };

export default function ArtInfraVendors({ store }) {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => store.listVendors()
    .then((r) => { setRows(r); setError(""); })
    .catch(() => setError("Could not load vendors."))
    .finally(() => setLoading(false)), [store]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setError("");
    await store.saveVendor(editing);
    setEditing(null);
    load();
  };

  const remove = async (vendor) => {
    setError("");
    try { await store.deleteVendor(vendor.id); load(); }
    catch (e) {
      setError(e.message === "vendor_in_use"
        ? `${vendor.name} is still used by a product — reassign those products first.`
        : e.message);
    }
  };

  return (
    <div>
      <PageHead eyebrow="Art Infra" title="Vendors"
        sub="Contact details here are what a founder sees behind Show contact."
        actions={<button type="button" className="os-btn"
          onClick={() => setEditing({ ...BLANK })}>+ New vendor</button>} />

      {error && <div className="inline-error">{error}</div>}

      {loading ? (
        <div className="inline-loading">Loading vendors…</div>
      ) : (
        <table className="os-table">
          <thead>
            <tr><th>Vendor</th><th>Contact</th><th>Email</th><th>Phone</th><th>ARTPARK ref</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td>{v.name}</td>
                <td>{v.contact_name || "—"}</td>
                <td>{v.contact_email || "—"}</td>
                <td>{v.contact_phone || "—"}</td>
                <td>{v.artpark_ref || "—"}</td>
                <td className="ai-row-actions">
                  <button type="button" className="os-btn ghost" aria-label={`Edit ${v.name}`}
                    onClick={() => setEditing({ ...v })}>Edit</button>
                  <button type="button" className="os-btn ghost" aria-label={`Delete ${v.name}`}
                    onClick={() => remove(v)}>Delete</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr><td colSpan={6} className="tbl-empty">No vendors yet.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {editing && (
        <div className="modal-bg" onClick={() => setEditing(null)}>
          <div className="modal ai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mhead"><h2>{editing.id ? "Edit vendor" : "New vendor"}</h2></div>
            <div className="ai-form">
              {[
                ["name", "Name"], ["contact_name", "Contact name"],
                ["contact_email", "Contact email"], ["contact_phone", "Contact phone"],
                ["artpark_ref", "ARTPARK ref"], ["notes", "Notes"],
              ].map(([key, label]) => (
                <label key={key}>{label}
                  <input className="os-input" value={editing[key] || ""}
                    onChange={(e) => setEditing({ ...editing, [key]: e.target.value })} />
                </label>
              ))}
            </div>
            <div className="ai-modal-foot">
              <button type="button" className="os-btn ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="os-btn" disabled={!editing.name.trim()}
                onClick={save}>Save vendor</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
