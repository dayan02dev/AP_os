// Spec-field editor for one category. This is a SCHEMA editor with a
// non-technical audience: archiving is soft, and the copy says so, because an
// admin cannot undo a destructive edit from a typo.

import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../../shell/osAtoms";

const TYPES = [
  ["text", "Text"], ["number", "Number"], ["enum", "One of a list"],
  ["multi_enum", "Several from a list"], ["boolean", "Yes / no"],
];

const slugKey = (s) =>
  (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export default function ArtInfraSpecFields({ store, categoryId, categoryLabel, onBack }) {
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState({ label: "", key: "", data_type: "text",
    unit: "", enum_options: "", required: false });
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => store.listSpecFields(categoryId)
    .then((r) => { setRows(r.filter((f) => !f.archived_at)); setError(""); })
    .catch(() => setError("Could not load fields."))
    .finally(() => setLoading(false)), [store, categoryId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!draft.label.trim()) return;
    setError("");
    try {
      await store.saveSpecField({
        category_id: categoryId,
        key: draft.key.trim() || slugKey(draft.label),
        label: draft.label.trim(),
        data_type: draft.data_type,
        unit: draft.unit.trim() || null,
        enum_options: ["enum", "multi_enum"].includes(draft.data_type)
          ? draft.enum_options.split(",").map((s) => s.trim()).filter(Boolean)
          : null,
        required: draft.required,
      });
      setDraft({ label: "", key: "", data_type: "text", unit: "",
        enum_options: "", required: false });
      load();
    } catch (e) {
      setError(e.message === "duplicate_key"
        ? "There is already a field with that key in this category."
        : "Could not add that field.");
    }
  };

  const archive = async (row) => {
    setError("");
    try { await store.archiveSpecField(row.id); load(); }
    catch { setError("Could not archive that field."); }
  };

  // Only label / unit / help_text are free to edit here. `key` is the
  // identity a product's stored values are keyed under -- changing it would
  // orphan every existing value -- and `data_type` changes are restricted to
  // widening by the spec, which is out of scope for this inline editor, so
  // neither is exposed as an editable field.
  const saveEdit = async () => {
    setError("");
    try {
      await store.saveSpecField({
        id: editing.id, category_id: editing.category_id, key: editing.key,
        data_type: editing.data_type,
        label: editing.label.trim(), unit: editing.unit.trim() || null,
        help_text: editing.help_text.trim(),
      });
      setEditing(null);
      load();
    } catch {
      setError("Could not save that field.");
    }
  };

  const needsOptions = ["enum", "multi_enum"].includes(draft.data_type);

  return (
    <div>
      <PageHead eyebrow="Art Infra" title={`${categoryLabel} — details`}
        breadcrumb={[{ label: "Categories", onClick: onBack }, { label: categoryLabel }]}
        sub="These are the fields a vendor fills in for every product in this category." />

      <div className="vp-note">
        Archiving a field hides it from new and existing forms. Existing products keep their
        values, and nothing is deleted — re-adding the same key later brings the field back.
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="ai-inline-add">
        <input className="os-input" aria-label="Field label" placeholder="e.g. IP rating"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value,
            key: draft.key || slugKey(e.target.value) })} />
        <input className="os-input" aria-label="Field key" placeholder="ip_rating"
          value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} />
        <select className="os-input" aria-label="Field type" value={draft.data_type}
          onChange={(e) => setDraft({ ...draft, data_type: e.target.value })}>
          {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input className="os-input" aria-label="Unit" placeholder="unit (optional)"
          value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
        {needsOptions && (
          <input className="os-input" aria-label="Options"
            placeholder="comma,separated,options" value={draft.enum_options}
            onChange={(e) => setDraft({ ...draft, enum_options: e.target.value })} />
        )}
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" aria-label="Required" checked={draft.required}
            onChange={(e) => setDraft({ ...draft, required: e.target.checked })} />
          Required
        </label>
        <button type="button" className="os-btn" onClick={add}>Add field</button>
      </div>

      {loading ? (
        <div className="inline-loading">Loading fields…</div>
      ) : (
        <table className="os-table">
          <thead>
            <tr><th>Field</th><th>Key</th><th>Type</th><th>Unit</th><th>Required</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id}>
                <td>{f.label}</td>
                <td className="os-mono os-text-xs">{f.key}</td>
                <td>{(TYPES.find(([v]) => v === f.data_type) || [])[1] || f.data_type}</td>
                <td>{f.unit || "—"}</td>
                <td>{f.required ? "Yes" : "—"}</td>
                <td className="ai-row-actions">
                  <button type="button" className="os-btn ghost"
                    aria-label={`Edit ${f.label}`}
                    onClick={() => setEditing({ ...f, unit: f.unit || "",
                      help_text: f.help_text || "" })}>
                    Edit
                  </button>
                  <button type="button" className="os-btn ghost"
                    aria-label={`Archive ${f.label}`} onClick={() => archive(f)}>
                    Archive
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr><td colSpan={6} className="tbl-empty">No fields yet for this category.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {editing && (
        <div className="modal-bg" onClick={() => setEditing(null)}>
          <div className="modal ai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mhead"><h2>Edit field</h2></div>
            <div className="ai-form">
              {/* `key` and `data_type` are not editable here -- see saveEdit. */}
              <label>Label
                <input className="os-input" aria-label="Edit label" value={editing.label}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
              </label>
              <label>Unit
                <input className="os-input" aria-label="Edit unit" value={editing.unit}
                  onChange={(e) => setEditing({ ...editing, unit: e.target.value })} />
              </label>
              <label>Help text
                <input className="os-input" aria-label="Edit help text" value={editing.help_text}
                  onChange={(e) => setEditing({ ...editing, help_text: e.target.value })} />
              </label>
            </div>
            <div className="ai-modal-foot">
              <button type="button" className="os-btn ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className="os-btn"
                disabled={!editing.label.trim()} onClick={saveEdit}>
                Save field
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
