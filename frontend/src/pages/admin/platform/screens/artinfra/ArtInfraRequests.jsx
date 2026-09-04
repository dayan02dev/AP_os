import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../../shell/osAtoms";
import ListToolbar from "../ListToolbar";

const STATUS = [["pending", "Pending"], ["approved", "Approved"],
  ["declined", "Declined"], ["", "All"]];

export default function ArtInfraRequests({ store, onChange }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const [declining, setDeclining] = useState(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => store.listRequests({ status })
    .then((r) => { setRows(r); setError(""); })
    .catch(() => setError("Could not load requests."))
    .finally(() => setLoading(false)), [store, status]);
  useEffect(() => { load(); }, [load]);

  const approve = async (id) => {
    setError("");
    try { await store.approveRequest(id); await load(); onChange?.(); }
    catch { setError("Could not approve that request."); }
  };

  const confirmDecline = async () => {
    if (!reason.trim()) { setError("A reason is required — the founder sees it."); return; }
    try {
      await store.declineRequest(declining.id, reason);
      setDeclining(null); setReason(""); setError("");
      await load(); onChange?.();
    } catch { setError("Could not decline that request."); }
  };

  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => !q
    || r.product_name.toLowerCase().includes(q)
    || r.vendor_name.toLowerCase().includes(q));

  return (
    <div>
      <PageHead eyebrow="Art Infra" title="Contact requests"
        sub="Approving one discloses that vendor's contact for every product they list." />

      <ListToolbar
        search={search} onSearch={setSearch}
        searchLabel="Search requests" searchPlaceholder="Product or vendor…"
        segments={[{ ariaLabel: "Status", value: status, onChange: setStatus, options: STATUS }]}
        count={visible.length} total={rows.length}
      />

      {error && <div className="inline-error">{error}</div>}

      {loading ? (
        <div className="inline-loading">Loading requests…</div>
      ) : (
        <table className="os-table">
          <thead>
            <tr><th>Product</th><th>Vendor</th><th>What they need</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td>{r.product_name}</td>
                <td>{r.vendor_name}</td>
                <td className="ai-review-body">{r.note}</td>
                <td><span className={`ai-status ai-status-${r.status}`}>{r.status}</span></td>
                <td className="ai-row-actions">
                  {r.status === "pending" && (
                    <>
                      <button type="button" className="os-btn ghost"
                        onClick={() => approve(r.id)}>Approve</button>
                      <button type="button" className="os-btn ghost"
                        onClick={() => { setDeclining(r); setReason(""); }}>Decline</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && !error && (
              <tr><td colSpan={5} className="tbl-empty">Nothing in this queue.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {declining && (
        <div className="modal-bg" onClick={() => setDeclining(null)}>
          <div className="modal ai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mhead"><h2>Decline this request</h2></div>
            <div className="ai-form">
              <label>Reason
                <textarea className="os-input" aria-label="Reason" rows={4} value={reason}
                  onChange={(e) => setReason(e.target.value)} />
              </label>
              <p className="os-sub">The founder sees this on the product.</p>
            </div>
            <div className="ai-modal-foot">
              <button type="button" className="os-btn ghost"
                onClick={() => setDeclining(null)}>Cancel</button>
              <button type="button" className="os-btn"
                onClick={confirmDecline}>Confirm decline</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
