// Support ticket widget — floating button + modal + simulated send + confirmation

const { useState: useSupS, useEffect: useSupE, useRef: useSupR } = React;

const SUPPORT_EMAIL = "support@artpark.in";

function SupportButton({ userEmail }) {
  const [open, setOpen] = useSupS(false);
  return (
    <>
      <button className="eir-support-fab" onClick={() => setOpen(true)} aria-label="Report a problem">
        <span className="eir-support-fab-icon">?</span>
        <span className="eir-support-fab-label eir-mono">support</span>
      </button>
      {open && <SupportModal onClose={() => setOpen(false)} userEmail={userEmail} />}
    </>
  );
}

function SupportModal({ onClose, userEmail }) {
  const [stage, setStage] = useSupS("form"); // form | sending | sent
  const [category, setCategory] = useSupS("technical");
  const [subject, setSubject] = useSupS("");
  const [message, setMessage] = useSupS("");
  const [contactEmail, setContactEmail] = useSupS(userEmail || "");
  const [ticketId, setTicketId] = useSupS("");
  const firstRef = useSupR(null);

  useSupE(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    setTimeout(() => firstRef.current?.focus(), 50);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, []);

  const canSubmit = subject.trim().length >= 4 && message.trim().length >= 10 && /\S+@\S+\.\S+/.test(contactEmail);

  const send = (e) => {
    e?.preventDefault();
    if (!canSubmit) return;
    setStage("sending");

    // Also fire a mailto as a "real" fallback so a ticket actually leaves the browser
    // (runs in a hidden iframe to avoid navigating away from the app)
    try {
      const body = `Category: ${category}\nContact: ${contactEmail}\n\n${message}\n\n---\nSent from ARTPARK TIR application portal`;
      const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`[TIR Support] ${subject}`)}&body=${encodeURIComponent(body)}`;
      const frame = document.createElement("iframe");
      frame.style.display = "none";
      frame.src = mailto;
      document.body.appendChild(frame);
      setTimeout(() => frame.remove(), 2000);
    } catch (e) {}

    // Simulate backend processing + return ticket id
    const id = "TIR-" + Math.floor(Math.random() * 90000 + 10000);
    setTimeout(() => {
      setTicketId(id);
      setStage("sent");
      // Persist ticket locally so user has a record
      try {
        const tix = JSON.parse(localStorage.getItem("tir:tickets") || "[]");
        tix.unshift({ id, subject, category, message, contactEmail, ts: Date.now() });
        localStorage.setItem("tir:tickets", JSON.stringify(tix.slice(0, 20)));
      } catch (e) {}
    }, 1400);
  };

  return (
    <div className="eir-sup-backdrop" onClick={onClose}>
      <div className="eir-sup-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="eir-sup-head">
          <div className="eir-sup-head-left">
            <span className="eir-mono eir-dim eir-sup-eyebrow">support · TIR.2026</span>
            <h3 className="eir-sup-title">
              {stage === "sent" ? "Ticket received" : "Report a problem"}
            </h3>
          </div>
          <button className="eir-sup-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {stage === "form" && (
          <form className="eir-sup-body" onSubmit={send}>
            <p className="eir-sup-lede">
              Stuck on something, seeing a bug, or need a deadline extension? Send us a note — we reply within 24 hours.
            </p>

            <div className="eir-sup-field">
              <label className="eir-mono eir-link-label">category</label>
              <div className="eir-sup-catlist">
                {[
                  { k: "technical", label: "Technical issue" },
                  { k: "application", label: "Application question" },
                  { k: "account", label: "Account / login" },
                  { k: "other", label: "Something else" },
                ].map((c) => (
                  <button
                    type="button"
                    key={c.k}
                    className={`eir-sup-cat ${category === c.k ? "is-on" : ""}`}
                    onClick={() => setCategory(c.k)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="eir-sup-field">
              <label className="eir-mono eir-link-label">subject</label>
              <input
                ref={firstRef}
                type="text"
                className="eir-input"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. CV upload keeps failing"
                maxLength={120}
              />
            </div>

            <div className="eir-sup-field">
              <label className="eir-mono eir-link-label">describe the issue</label>
              <textarea
                className="eir-textarea"
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What were you trying to do? What happened instead? Include any error messages."
                maxLength={2000}
              />
              <div className="eir-sup-hint eir-mono eir-dim">{message.length} / 2000 chars</div>
            </div>

            <div className="eir-sup-field">
              <label className="eir-mono eir-link-label">your email for our reply</label>
              <input
                type="email"
                className="eir-input"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="you@domain.com"
              />
            </div>

            <div className="eir-sup-actions">
              <button
                type="submit"
                className={`eir-btn ${canSubmit ? "eir-btn-primary" : "eir-btn-disabled"}`}
                disabled={!canSubmit}
              >
                <span>Send to {SUPPORT_EMAIL}</span>
              </button>
              <button type="button" className="eir-link-btn eir-mono" onClick={onClose}>cancel</button>
            </div>

            <div className="eir-sup-foot eir-mono eir-dim">
              ↳ your message goes directly to the ARTPARK TIR support team · response within 24 hours
            </div>
          </form>
        )}

        {stage === "sending" && (
          <div className="eir-sup-body eir-sup-sending">
            <div className="eir-sup-spinner">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="20" stroke="var(--line)" strokeWidth="2" />
                <path d="M24 4 A20 20 0 0 1 44 24" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
                  <animateTransform attributeName="transform" type="rotate" from="0 24 24" to="360 24 24" dur="0.9s" repeatCount="indefinite" />
                </path>
              </svg>
            </div>
            <p className="eir-sup-sending-text">Sending your message to <strong>{SUPPORT_EMAIL}</strong>…</p>
          </div>
        )}

        {stage === "sent" && (
          <div className="eir-sup-body eir-sup-sent">
            <div className="eir-sup-check">
              <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
                <circle cx="28" cy="28" r="26" stroke="var(--accent)" strokeWidth="1.5" />
                <path d="M16 28 L24 36 L40 20" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </div>
            <div className="eir-sup-sent-body">
              <div className="eir-mono eir-dim">ticket id</div>
              <div className="eir-sup-ticketid">#{ticketId}</div>
              <h4 className="eir-sup-sent-title">Message sent.</h4>
              <p className="eir-sup-sent-text">
                We've received your message and sent a copy to your inbox at <strong>{contactEmail}</strong>.
                Our team reads every ticket — <strong>you'll hear back within 24 hours</strong>, usually much sooner.
              </p>
              <div className="eir-sup-sent-meta eir-mono eir-dim">
                <div>↳ filed under: {category}</div>
                <div>↳ sent to: {SUPPORT_EMAIL}</div>
                <div>↳ timestamp: {new Date().toLocaleString()}</div>
              </div>
            </div>
            <div className="eir-sup-actions">
              <button className="eir-btn eir-btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { SupportButton, SupportModal });
