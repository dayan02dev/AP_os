import { useEffect, useRef, useState } from "react";
import { founderApi } from "../../lib/founderApi.js";
import { Loading, ErrorState } from "./ui.jsx";

export default function FounderMou({ me, onSigned }) {
  const [mou, setMou] = useState(null);
  const [error, setError] = useState(null);
  const [signerName, setSignerName] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  // Ticked acknowledgement ids. The list itself is server-owned (GET /mou)
  // so the wording can be revised without a frontend deploy.
  const [acked, setAcked] = useState([]);
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  const ackList = mou?.acknowledgements || [];
  const allAcked = ackList.length > 0 && ackList.every((a) => acked.includes(a.id));
  const toggleAck = (id) =>
    setAcked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  useEffect(() => {
    founderApi.getMou().then((m) => { setMou(m); setSignerName(m.signer_name || ""); }).catch(setError);
  }, []);

  // signature pad
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || mou?.signed) return;
    const ctx = c.getContext("2d");
    if (!ctx) return; // jsdom (no optional `canvas` pkg) returns null in tests
    ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.strokeStyle = "#242424";
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    const start = (e) => { drawing.current = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); };
    const move = (e) => { if (!drawing.current) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); setHasInk(true); e.preventDefault(); };
    const end = () => { drawing.current = false; };
    c.addEventListener("pointerdown", start); c.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => { c.removeEventListener("pointerdown", start); c.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
  }, [mou]);

  const clearPad = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    ctx?.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const sign = async () => {
    if (!signerName.trim() || !hasInk || !allAcked) return;
    setBusy(true); setError(null);
    try {
      const png = canvasRef.current.toDataURL("image/png");
      await founderApi.signMou(signerName.trim(), png, acked);
      const fresh = await founderApi.getMou();
      setMou(fresh);
      onSigned?.();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const download = async () => {
    const { url } = await founderApi.mouSignedUrl();
    window.open(url, "_blank", "noopener");
  };

  if (error && !mou) return <ErrorState error={error} />;
  if (!mou) return <Loading label="Loading MOU…" />;

  return (
    <div>
      <span className="eyebrow eyebrow-rule">Onboarding · Sign MOU</span>
      <div className="mou">
        <div className="mou-head"><span className="ttl">Memorandum of Understanding</span><span className="meta">{mou.template_version}</span></div>
        <div className="mou-body"><pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-body)", fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.6, margin: 0 }}>{mou.body}</pre></div>
      </div>

      {mou.signed ? (
        <div className="signed">
          <div className="top"><span className="ttl">MOU signed ✓</span></div>
          <div className="sub">Signed by {mou.signer_name} on {new Date(mou.signed_at).toLocaleDateString()}. Your cohort tabs are unlocked.</div>
          <div className="frame"><button className="btn btn-primary" onClick={download}>Download signed MOU</button></div>
        </div>
      ) : (
        <div className="panel" style={{ marginTop: 24 }}>
          <div className="panel-h">Sign to accept</div>

          <fieldset className="mou-acks">
            <legend className="lbl">
              Acknowledgements — please confirm each of the following
            </legend>
            {ackList.map((a, i) => (
              <label className="mou-ack" key={a.id}>
                <input
                  type="checkbox"
                  checked={acked.includes(a.id)}
                  onChange={() => toggleAck(a.id)}
                />
                <span className="mou-ack-num">{i + 1}.</span>
                <span className="mou-ack-text">{a.text}</span>
              </label>
            ))}
            {!allAcked && (
              <div className="mou-ack-hint">
                All {ackList.length} acknowledgements must be confirmed before you can sign.
              </div>
            )}
          </fieldset>

          <label className="lbl">Full legal name</label>
          <input className="inp" value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Your full name" />
          <div className="sigpad" style={{ marginTop: 14, border: "1px solid var(--line-strong)", borderRadius: 2 }}>
            <canvas id="sigpad" ref={canvasRef} width={520} height={180} />
          </div>
          {error && <div style={{ color: "var(--accent-coral)", marginTop: 8 }}>{error.message}</div>}
          <div className="row-actions" style={{ marginTop: 14 }}>
            <button className="btn" onClick={clearPad} type="button">Clear</button>
            <button
              className="btn btn-primary"
              onClick={sign}
              disabled={busy || !signerName.trim() || !hasInk || !allAcked}
            >
              {busy ? "Signing…" : "Sign & submit"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
