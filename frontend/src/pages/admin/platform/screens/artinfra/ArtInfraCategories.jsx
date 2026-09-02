import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../../shell/osAtoms";

export default function ArtInfraCategories({ store }) {
  const [rows, setRows] = useState([]);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => store.listCategories().then(setRows), [store]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!label.trim()) return;
    setError("");
    await store.saveCategory({ label: label.trim() });
    setLabel("");
    load();
  };

  const move = async (row, delta) => {
    setError("");
    await store.saveCategory({ ...row, sort: row.sort + delta });
    load();
  };

  const remove = async (row) => {
    setError("");
    try { await store.deleteCategory(row.id); load(); }
    catch (e) {
      setError(e.message === "category_in_use"
        ? `${row.label} is still used by a product — recategorise those products first.`
        : e.message);
    }
  };

  return (
    <div>
      <PageHead eyebrow="Art Infra" title="Categories"
        sub="Category order controls the founder-facing filter order." />

      {error && <div className="inline-error">{error}</div>}

      <div className="ai-inline-add">
        <input className="os-input" aria-label="New category label" value={label}
          placeholder="e.g. Optics" onChange={(e) => setLabel(e.target.value)} />
        <button type="button" className="os-btn" onClick={add}>Add category</button>
      </div>

      <table className="os-table">
        <thead><tr><th>Category</th><th>Sort</th><th /></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>{c.label}</td>
              <td>{c.sort}</td>
              <td className="ai-row-actions">
                <button type="button" className="os-btn ghost" aria-label={`Move ${c.label} up`}
                  onClick={() => move(c, -1)}>↑</button>
                <button type="button" className="os-btn ghost" aria-label={`Move ${c.label} down`}
                  onClick={() => move(c, 1)}>↓</button>
                <button type="button" className="os-btn ghost" aria-label={`Delete ${c.label}`}
                  onClick={() => remove(c)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
