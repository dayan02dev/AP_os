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
    </div>
  );
}
