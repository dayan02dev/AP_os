import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../../shell/osAtoms";

const BLANK_INVITE = { display_name: "", contact_email: "" };

const EDIT_FIELDS = [
  ["display_name", "Display name"], ["contact_name", "Contact name"],
  ["contact_email", "Contact email"], ["contact_phone", "Contact phone"],
  ["artpark_ref", "ARTPARK ref"], ["notes", "Notes (internal)"],
];

export default function ArtInfraVendors({ store }) {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [inviting, setInviting] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => store.adminListVendors()
    .then((r) => { setRows(r); setError(""); })
    .catch(() => setError("Could not load vendors."))
    .finally(() => setLoading(false)), [store]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setError("");
    try {
      const { id, ...patch } = editing;
      await store.saveVendorProfile(id, patch);
      setEditing(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const invite = async () => {
    setError("");
    try {
      await store.inviteVendor(inviting);
      setInviting(null);
      load();
    } catch (e) {
      setError(e.message === "vendor_exists"
        ? "A vendor with that name already exists."
        : e.message);
    }
  };

  const act = async (fn, id) => {
    setError("");
    try { await fn(id); load(); }
    catch (e) { setError(e.message); }
  };

  return (
    <div>
      <PageHead eyebrow="Art Infra" title="Vendors"
        sub="Contact details here are what a founder sees behind Show contact."
        actions={<button type="button" className="os-btn"
          onClick={() => setInviting({ ...BLANK_INVITE })}>+ Invite vendor</button>} />

      {error && <div className="inline-error">{error}</div>}

      {loading ? (
        <div className="inline-loading">Loading vendors…</div>
      ) : (
        <table className="os-table">
          <thead>
            <tr>
              <th>Vendor</th><th>Contact</th><th>Email</th><th>Phone</th>
              <th>ARTPARK ref</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const label = v.display_name || v.name;
              return (
                <tr key={v.id}>
                  <td>{label}</td>
                  <td>{v.contact_name || "—"}</td>
                  <td>{v.contact_email || "—"}</td>
                  <td>{v.contact_phone || "—"}</td>
                  <td>{v.artpark_ref || "—"}</td>
                  <td><span className={`ai-status ai-status-${v.status}`}>{v.status}</span></td>
                  <td className="ai-row-actions">
                    <button type="button" className="os-btn ghost" aria-label={`Edit ${label}`}
                      onClick={() => setEditing({ ...v })}>Edit</button>
                    {v.status !== "approved" && (
                      <button type="button" className="os-btn ghost"
                        aria-label={`Approve ${label}`}
                        onClick={() => act(store.approveVendor, v.id)}>Approve</button>
                    )}
                    {v.status === "approved" && (
                      <button type="button" className="os-btn ghost"
                        aria-label={`Suspend ${label}`}
                        onClick={() => act(store.suspendVendor, v.id)}>Suspend</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !error && (
              <tr><td colSpan={7} className="tbl-empty">No vendors yet.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {editing && (
        <div className="modal-bg" onClick={() => setEditing(null)}>
          <div className="modal ai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mhead"><h2>Edit vendor</h2></div>
            <div className="ai-form">
              {EDIT_FIELDS.map(([key, label]) => (
                <label key={key}>{label}
                  <input className="os-input" value={editing[key] || ""}
                    onChange={(e) => setEditing({ ...editing, [key]: e.target.value })} />
                </label>
              ))}
            </div>
            <div className="ai-modal-foot">
              <button type="button" className="os-btn ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="os-btn"
                disabled={!(editing.display_name || "").trim()}
                onClick={save}>Save vendor</button>
            </div>
          </div>
        </div>
      )}

      {inviting && (
        <div className="modal-bg" onClick={() => setInviting(null)}>
          <div className="modal ai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mhead"><h2>Invite vendor</h2></div>
            <div className="ai-form">
              <label>Display name
                <input className="os-input" value={inviting.display_name}
                  onChange={(e) => setInviting({ ...inviting, display_name: e.target.value })} />
              </label>
              <label>Contact email
                <input className="os-input" value={inviting.contact_email}
                  onChange={(e) => setInviting({ ...inviting, contact_email: e.target.value })} />
              </label>
            </div>
            <div className="ai-modal-foot">
              <button type="button" className="os-btn ghost" onClick={() => setInviting(null)}>Cancel</button>
              <button type="button" className="os-btn"
                disabled={!inviting.contact_email.trim()}
                onClick={invite}>Send invite</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
