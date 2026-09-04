import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../../shell/osAtoms";

export default function ArtInfraCategories({ store }) {
  const [rows, setRows] = useState([]);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => store.listCategories()
    .then((r) => { setRows(r); setError(""); })
    .catch(() => setError("Could not load categories."))
    .finally(() => setLoading(false)), [store]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!label.trim()) return;
    setError("");
    await store.saveCategory({ label: label.trim() });
    setLabel("");
    load();
  };

  // Swap sorts with the adjacent row instead of nudging this row's sort by
  // ±1: an increment collides with the neighbour's existing sort, and the
  // stable sort that follows then leaves both rows exactly where they were —
  // the Sort column changes but the row never visibly moves.
  const move = async (row, direction) => {
    setError("");
    const neighbour = direction < 0
      ? rows.filter((r) => r.sort < row.sort).sort((a, b) => b.sort - a.sort)[0]
      : rows.filter((r) => r.sort > row.sort).sort((a, b) => a.sort - b.sort)[0];
    if (!neighbour) return; // already first (up) or last (down) — no-op
    await Promise.all([
      store.saveCategory({ ...row, sort: neighbour.sort }),
      store.saveCategory({ ...neighbour, sort: row.sort }),
    ]);
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
        sub="Order controls how categories are listed in the admin catalog's category filter." />

      {error && <div className="inline-error">{error}</div>}

      <div className="ai-inline-add">
        <input className="os-input" aria-label="New category label" value={label}
          placeholder="e.g. Optics" onChange={(e) => setLabel(e.target.value)} />
        <button type="button" className="os-btn" onClick={add}>Add category</button>
      </div>

      {loading ? (
        <div className="inline-loading">Loading categories…</div>
      ) : (
        <table className="os-table">
          <thead><tr><th>Category</th><th>Sort</th><th /></tr></thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={c.id}>
                <td>{c.label}</td>
                <td>{c.sort}</td>
                <td className="ai-row-actions">
                  <button type="button" className="os-btn ghost" aria-label={`Move ${c.label} up`}
                    disabled={i === 0} onClick={() => move(c, -1)}>↑</button>
                  <button type="button" className="os-btn ghost" aria-label={`Move ${c.label} down`}
                    disabled={i === rows.length - 1} onClick={() => move(c, 1)}>↓</button>
                  <button type="button" className="os-btn ghost" aria-label={`Delete ${c.label}`}
                    onClick={() => remove(c)}>Delete</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr><td colSpan={3} className="tbl-empty">No categories yet.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
