// Tweaks panel — floating bottom-right, syncs with host via postMessage

const { useState: useTS, useEffect: useTE } = React;

function TweaksPanel({ open, onClose, config, setConfig, user }) {
  if (!open) return null;

  const update = (patch) => {
    const next = { ...config, ...patch };
    setConfig(next);
    window.parent?.postMessage({ type: "__edit_mode_set_keys", edits: patch }, "*");
  };

  const themes = window.THEME_ORDER;

  const seedDemoData = () => {
    const email = user?.email;
    if (!email) {
      alert("Please sign in first — demo data is seeded under your signed-in email.");
      return;
    }

    // 1. Seed an in-progress draft (midway through — roughly 55% complete)
    const fakeParsed = {
      fullName: email.split("@")[0].split(/[._-]/).map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join(" "),
      email: email,
      phone: "+91 98765 43210",
      org: "IISc Bangalore",
      degree: "PhD",
      _meta: {
        fullName: { label: "full name", confidence: "high" },
        email: { label: "email", confidence: "high" },
        phone: { label: "phone number", confidence: "low" },
        org: { label: "current organization", confidence: "high" },
        degree: { label: "highest degree", confidence: "low" },
      },
      _order: ["fullName", "email", "phone", "org", "degree"],
    };
    const fakeAnswers = {
      fullName: fakeParsed.fullName,
      email: email,
      phone: "+91 98765 43210",
      org: "IISc Bangalore",
      degree: "PhD",
      problemStatement: "Soil moisture sensors for smallholder farmers in rain-fed regions are still too expensive (\u20b912-18k per unit) and require proprietary gateways. 72% of Karnataka farmers we surveyed can't afford current solutions.",
      whoAffected: "~6 million smallholder farmers across rain-fed agricultural belts in Karnataka, Maharashtra, and AP. Women farmers disproportionately, since irrigation decisions often fall to them but the tools assume male literacy patterns.",
      approach: "A \u20b9800 open-hardware soil probe that speaks LoRaWAN directly to village-level community gateways, with a Kannada/Marathi voice interface via missed-call. No smartphone required.",
      trl: "3 — validated in controlled lab conditions",
    };

    localStorage.setItem("tir:uploaded", JSON.stringify({
      cv: { name: "CV_" + email.split("@")[0] + ".pdf", size: 284912 },
      linkedin: "linkedin.com/in/" + email.split("@")[0],
      github: "",
    }));
    localStorage.setItem("tir:parsed", JSON.stringify(fakeParsed));
    localStorage.setItem("tir:answers", JSON.stringify(fakeAnswers));
    localStorage.setItem("tir:stepIdx", "14"); // midway through ~25 questions
    localStorage.setItem("tir:sectionIdx", "2");

    // 2. Seed two past submissions
    const pastSubs = [
      {
        id: "TIR-48291",
        cycle: "TIR cohort 2024",
        ts: Date.now() - 365 * 24 * 60 * 60 * 1000, // ~1 year ago
        status: "not shortlisted",
        answers: {
          fullName: fakeParsed.fullName,
          email: email,
          problemStatement: "Early-warning system for crop disease detection using low-cost multispectral imaging on edge devices.",
          approach: "ResNet-lite model running on \u20b92000 edge camera, trained on Mysuru field data across 3 crop varieties.",
          trl: "2 \u2014 concept validated",
        },
      },
      {
        id: "TIR-52104",
        cycle: "TIR cohort 2025",
        ts: Date.now() - 120 * 24 * 60 * 60 * 1000, // ~4 months ago
        status: "shortlisted \u2192 interview",
        answers: {
          fullName: fakeParsed.fullName,
          email: email,
          problemStatement: "Affordable soil moisture monitoring for rain-fed agriculture.",
          approach: "Open-hardware LoRa probe + IVR interface in local languages.",
          trl: "3 \u2014 lab-validated",
        },
      },
    ];
    localStorage.setItem(`tir:submissions:${email}`, JSON.stringify(pastSubs));

    alert(
      "\u2713 Seeded demo data for " + email + ":\n\n" +
      "\u2022 1 draft in progress (\u224855% complete)\n" +
      "\u2022 2 past submissions\n\n" +
      "Sign out and sign back in (as a Returning user) to see the choice screen populated."
    );
  };

  const clearAllData = () => {
    if (!confirm("This will clear ALL local data \u2014 drafts, submissions, accounts. Continue?")) return;
    Object.keys(localStorage).filter(k => k.startsWith("tir:")).forEach(k => localStorage.removeItem(k));
    alert("All data cleared. Refreshing\u2026");
    location.reload();
  };

  return (
    <div className="eir-tweaks">
      <div className="eir-tweaks-head">
        <div className="eir-mono eir-tweaks-title">Tweaks</div>
        <button className="eir-tweaks-x" onClick={onClose}>×</button>
      </div>

      <div className="eir-tweaks-body">

        <div className="eir-tweaks-group">
          <div className="eir-mono eir-tweaks-label">theme</div>
          <div className="eir-tweaks-themes">
            {themes.map((k) => (
              <button
                key={k}
                className={`eir-tweaks-theme ${config.theme === k ? "is-on" : ""}`}
                onClick={() => update({ theme: k })}
              >
                <span className={`eir-tweaks-swatch swatch-${k}`} />
                <span>{window.THEMES[k].name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="eir-tweaks-group">
          <div className="eir-mono eir-tweaks-label">accent color</div>
          <div className="eir-tweaks-swatches">
            {[
              { k: "default", c: null, label: "artblue" },
              { k: "ink", c: "#0a0a0a", label: "ink black" },
              { k: "rust", c: "#c84a1a", label: "rust" },
              { k: "forest", c: "#2a5a3a", label: "forest" },
              { k: "plum", c: "#6a1a4a", label: "plum" },
              { k: "olive", c: "#5a6b2a", label: "olive" },
            ].map((s) => (
              <button
                key={s.k}
                className={`eir-tweaks-accent ${config.accent === s.k ? "is-on" : ""}`}
                onClick={() => update({ accent: s.k })}
                title={s.label}
              >
                <span
                  className="eir-tweaks-accent-chip"
                  style={{ background: s.c || "var(--accent)" }}
                />
                <span className="eir-mono">{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="eir-tweaks-group">
          <div className="eir-mono eir-tweaks-label">typography</div>
          <div className="eir-tweaks-seg">
            {["mono-display", "serif-display", "sans-display"].map((t) => (
              <button
                key={t}
                className={`eir-tweaks-segbtn ${config.typography === t ? "is-on" : ""}`}
                onClick={() => update({ typography: t })}
              >
                {t.replace("-display", "")}
              </button>
            ))}
          </div>
        </div>

        <div className="eir-tweaks-group">
          <div className="eir-mono eir-tweaks-label">question layout</div>
          <div className="eir-tweaks-seg">
            {[
              { k: "one", label: "one at a time" },
              { k: "sectioned", label: "sectioned" },
            ].map((t) => (
              <button
                key={t.k}
                className={`eir-tweaks-segbtn ${config.layout === t.k ? "is-on" : ""}`}
                onClick={() => update({ layout: t.k })}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="eir-tweaks-group">
          <div className="eir-mono eir-tweaks-label">tone</div>
          <div className="eir-tweaks-seg">
            {[
              { k: "warm", label: "warm" },
              { k: "formal", label: "formal" },
            ].map((t) => (
              <button
                key={t.k}
                className={`eir-tweaks-segbtn ${config.tone === t.k ? "is-on" : ""}`}
                onClick={() => update({ tone: t.k })}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="eir-tweaks-group">
          <div className="eir-mono eir-tweaks-label">progress style</div>
          <div className="eir-tweaks-seg">
            {[
              { k: "ruler", label: "ruler" },
              { k: "section", label: "section" },
              { k: "dots", label: "dots" },
              { k: "bar", label: "bar" },
            ].map((t) => (
              <button
                key={t.k}
                className={`eir-tweaks-segbtn ${config.progress === t.k ? "is-on" : ""}`}
                onClick={() => update({ progress: t.k })}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="eir-tweaks-group">
          <div className="eir-mono eir-tweaks-label">background</div>
          <div className="eir-tweaks-seg">
            {[
              { k: "auto", label: "auto" },
              { k: "grid", label: "grid" },
              { k: "lines", label: "lines" },
              { k: "dots", label: "dots" },
              { k: "none", label: "none" },
            ].map((t) => (
              <button
                key={t.k}
                className={`eir-tweaks-segbtn ${config.bg === t.k ? "is-on" : ""}`}
                onClick={() => update({ bg: t.k })}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="eir-tweaks-group eir-tweaks-demo">
          <div className="eir-mono eir-tweaks-label">demo data</div>
          <button className="eir-tweaks-demo-btn" onClick={seedDemoData}>
            <span className="eir-tweaks-demo-icon">✨</span>
            <span className="eir-tweaks-demo-main">
              <span className="eir-tweaks-demo-title">Seed sample draft + submissions</span>
              <span className="eir-mono eir-tweaks-demo-sub">
                {user?.email ? `for ${user.email}` : "sign in first"}
              </span>
            </span>
          </button>
          <button className="eir-tweaks-demo-btn eir-tweaks-demo-danger" onClick={clearAllData}>
            <span className="eir-tweaks-demo-icon">⌫</span>
            <span className="eir-tweaks-demo-main">
              <span className="eir-tweaks-demo-title">Clear all data</span>
              <span className="eir-mono eir-tweaks-demo-sub">reset everything locally</span>
            </span>
          </button>
          <button
            className="eir-tweaks-demo-btn"
            onClick={() => {
              if (!user?.email) { alert("Sign in first so there's an active session to kick out."); return; }
              const teammate = prompt("Which teammate is taking over? (enter their email)", "cofounder@example.com");
              if (!teammate) return;
              const name = teammate.split("@")[0];
              window.simulateTeammateTakeover(teammate, name);
              onClose?.();
            }}
          >
            <span className="eir-tweaks-demo-icon">◉</span>
            <span className="eir-tweaks-demo-main">
              <span className="eir-tweaks-demo-title">Simulate teammate takeover</span>
              <span className="eir-mono eir-tweaks-demo-sub">kick out this session</span>
            </span>
          </button>
        </div>

      </div>
    </div>
  );
}

window.TweaksPanel = TweaksPanel;
