import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { profileCompletionApi } from "../lib/profileCompletionApi.js";

export default function ProfileCompletionPage() {
  const { token } = useParams();
  const [state, setState] = useState({ phase: "loading" });
  const [file, setFile] = useState(null);
  const [linkedin, setLinkedin] = useState("");
  const [evFiles, setEvFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    profileCompletionApi.getState(token)
      .then((r) => { if (alive) setState(r.valid ? { phase: "form", ...r } : { phase: r.reason || "invalid" }); })
      .catch(() => { if (alive) setState({ phase: "invalid" }); });
    return () => { alive = false; };
  }, [token]);

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const r = state.needs_evidence
        ? await profileCompletionApi.submitEvidence(token, evFiles)
        : await profileCompletionApi.submit(token, { file, linkedinUrl: linkedin });
      setState((s) => ({ ...s, phase: r.preview ? "preview_done" : "done" }));
    } catch (e) {
      setErr(e?.message || "Something went wrong. Please try again.");
    } finally { setBusy(false); }
  };

  const Shell = ({ children }) => (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "40px 20px", fontFamily: "'Open Sans',sans-serif" }}>
      <div style={{ background: "#3213b7", color: "#fff", padding: "10px 16px", fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase" }}>
        ARTPARK TIR · Complete your application
      </div>
      <div style={{ border: "1px solid #e4e2ee", borderTop: 0, padding: 24 }}>{children}</div>
    </div>
  );

  if (state.phase === "loading") return <Shell>Loading…</Shell>;
  if (state.phase === "expired") return <Shell><h2>This link has expired</h2><p>Your upload window has closed. Please contact the ARTPARK team if you still need to add your details.</p></Shell>;
  if (state.phase === "used") return <Shell><h2>Already submitted</h2><p>This link was already used. Thank you — no further action is needed.</p></Shell>;
  if (state.phase === "invalid") return <Shell><h2>Invalid link</h2><p>We couldn't recognise this link. Please use the link from your email.</p></Shell>;
  if (state.phase === "done") return <Shell><h2>Thank you!</h2><p>Your details have been added to your application.</p></Shell>;
  if (state.phase === "preview_done") return <Shell><h2>Preview</h2><p>This is a preview — nothing was saved.</p></Shell>;

  const single = !(state.needs_resume && state.needs_linkedin);
  return (
    <Shell>
      {state.is_preview && (
        <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", padding: 10, marginBottom: 16, fontSize: 13 }}>
          Preview — nothing you submit here will be saved.
        </div>
      )}
      <h2 style={{ marginTop: 0 }}>Hello {state.applicant_name},</h2>
      {state.needs_evidence ? (
        <p>While reviewing your application ({state.display_id}), we found some of your evidence files need re-uploading due to some technical issues. Please re-upload them below.</p>
      ) : (
        <p>In TIR we assess the founder as closely as the idea. We couldn't find your{" "}
          {state.needs_resume && state.needs_linkedin ? "résumé and LinkedIn" : state.needs_resume ? "résumé" : "LinkedIn"}{" "}
          in your application ({state.display_id}). Please add {single ? "it" : "them"} below.</p>
      )}

      {state.needs_evidence && (
        <div style={{ margin: "16px 0" }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Re-upload your evidence files (PDF/JPG/PNG)</div>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple
            onChange={(e) => setEvFiles(e.target.files)} />
          <div style={{ fontSize: 13, color: "#8a8a92", marginTop: 6 }}>
            {evFiles?.length ? `${evFiles.length} file(s) selected` : "Select all the evidence you originally submitted."}
          </div>
        </div>
      )}

      {state.needs_resume && (
        <div style={{ margin: "16px 0" }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Upload résumé (PDF/DOCX)</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <label htmlFor="resume" style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: "#fff", color: "#3213b7", border: "1.5px solid #3213b7",
              padding: "9px 18px", borderRadius: 8, cursor: "pointer",
              fontSize: 14, fontWeight: 600, lineHeight: 1,
            }}>
              <span aria-hidden="true">↑</span>{file ? "Change file" : "Choose file"}
            </label>
            <input id="resume" type="file" accept=".pdf,.doc,.docx" style={{ display: "none" }}
              onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <span style={{ fontSize: 13, color: file ? "#242424" : "#8a8a92" }}>
              {file ? file.name : "No file chosen"}
            </span>
          </div>
        </div>
      )}
      {state.needs_linkedin && (
        <div style={{ margin: "16px 0" }}>
          <label htmlFor="linkedin" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>LinkedIn profile URL</label>
          <input id="linkedin" type="url" placeholder="https://linkedin.com/in/…" value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)} style={{ width: "100%", padding: 10, boxSizing: "border-box" }} />
        </div>
      )}
      {err && <p style={{ color: "#b3262b", fontSize: 13 }}>{err}</p>}
      <button onClick={submit} disabled={busy || (state.needs_evidence
        ? evFiles.length === 0
        : (state.needs_resume && !file && !linkedin.trim()))}
        style={{ background: "#3213b7", color: "#fff", border: 0, padding: "12px 24px", fontSize: 15, cursor: "pointer" }}>
        {busy ? "Submitting…" : "Submit →"}
      </button>
    </Shell>
  );
}
