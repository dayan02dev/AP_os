import { useState } from "react";

// Normalise a field to a bullet list.
// Priority: field.bullets (array) > "•"-delimited value > sentence split.
function fieldBullets(f) {
  if (Array.isArray(f.bullets)) return f.bullets.map(String);
  const text = String(f.value || "").trim();
  if (!text) return [];
  if (/[•·]/.test(text)) return text.split(/\s*[•·]\s+/).map((x) => x.trim()).filter(Boolean);
  const protected_ = text
    .replace(/(\d)\.(\d)/g, "$1~D~$2")
    .replace(/(e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|Inc|Ltd|No|Fig|Rs|approx)\./gi, "$1~D~");
  return protected_
    .split(/(?<=[.!?])\s+(?=[A-Z₹"'(])/)
    .map((x) => x.replace(/~D~/g, ".").trim())
    .filter(Boolean);
}

function isFactField(f) {
  if (f.short === true) return true;
  if (Array.isArray(f.bullets)) return false;
  const v = String(f.value || "");
  return v.length <= 48 && !/[.!?]/.test(v);
}

// ── Wizard-style sections (Q2 answer: full application read view) ──────────
const PURPLE = "#3213b7";
const eyebrowMono = { fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.18em" };
const pill       = { fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", fontWeight: 600, color: PURPLE, border: "1px solid #ccc2f0", background: "#ece9fb", padding: "4px 11px", borderRadius: 999 };
const pillGhost  = { ...pill, color: "var(--ink-dim)", border: "1px solid var(--line)", background: "transparent" };
const answerBox  = { background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "18px 22px", fontSize: 16, lineHeight: 1.62, color: "var(--ink)" };

function buildSections(s, detail) {
  // The real answers will come from the DB's answers JSONB column (Phase 3).
  // For now, we pull from the static APP_DETAIL mock for every app.
  const f = detail.fields;
  return [
    {
      num: "01", title: "Basic details", blurb: "Who is applying, and how to reach them.",
      questions: [
        { prompt: "What's your full name?",            help: "As you'd like it to appear on the application.", required: true, answer: s.founders[0] },
        { prompt: "A phone number we can reach you on?", help: "We'll use this for interview scheduling only.", required: true, answer: "+91 98765 43210" },
        { prompt: "And your email?",                   help: "This will be your login anchor and primary channel.", required: true, answer: (s.founders[0] || "founder").toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "") + "@" + (s.name || "company").toLowerCase().replace(/[^a-z0-9]+/g, "") + ".in" },
        { prompt: "Where are you right now?",          help: "Current organization, institution, or 'Independent'.", required: true, answer: s.name },
        { prompt: "Highest technology degree achieved?", help: "Self-taught engineers with shipped work get equivalent weight.", required: true, choice: true, answer: "Master's Degree" },
      ],
    },
    {
      num: "02", title: "Problem & importance", blurb: "The thing that pulled you in. What won't let you go.",
      questions: [
        { prompt: "What specific critical problem in your chosen sector are you solving?", help: "Who is feeling the pain? Can you quantify it — market size, urgency, human cost? Why is now the right time?", required: true, answer: f[1] ? (Array.isArray(f[1].bullets) ? f[1].bullets.join(" ") : f[1].value) : "" },
        { prompt: "Do you think the problem you want to solve is well-defined?",          help: "Honest answers help us support you better — either response is fine.", required: true, choice: true, answer: f[0] ? f[0].value : "Yes" },
      ],
    },
    {
      num: "03", title: "Your solution", blurb: "How you're approaching it, and what makes your angle defensible.",
      questions: [
        { prompt: "Describe your solution. Does it represent a 10× improvement over existing state-of-the-art?", help: "The bigger the impact, the more excited we are.", required: true, answer: f[3] ? (Array.isArray(f[3].bullets) ? f[3].bullets.join(" ") : f[3].value) : "" },
        { prompt: "What's the core technology that makes this special and hard to replicate?",                    help: "What is the lab-proven research or cutting-edge advance?", required: true, answer: f[4] ? (Array.isArray(f[4].bullets) ? f[4].bullets.join(" ") : f[4].value) : "" },
      ],
    },
    {
      num: "04", title: "Execution plan", blurb: "What's your roadmap?",
      questions: [
        { prompt: "How far along are you?", help: "No wrong answer — this just helps us help you better.", required: true, choice: true, answer: f[2] ? f[2].value : "Pilot-ready product" },
        { prompt: "What are the most critical milestones you aim to achieve during this residency?", help: "One or two sharp outcomes beat a vague roadmap.", required: true, answer: "Q1: Close 10 paid design partners. Q2: Ship the self-serve API. Q3: Reach ₹1Cr ARR." },
      ],
    },
    {
      num: "05", title: "Evidence", blurb: "Show, don't just tell.",
      questions: [
        { prompt: "Upload your latest pitch deck.",         help: "PDF, max 25MB. The version you'd send a serious investor today.", required: true, file: true, answer: "pitch-deck.pdf · 14 pages · 6.2 MB" },
        { prompt: "A demo video of your product (under 3 minutes).", help: "Loom, YouTube or Drive link. Optional but strongly encouraged.", optional: true, answer: "https://loom.com/demo-link" },
      ],
    },
    {
      num: "06", title: "Declaration", blurb: "Last step. Just a few confirmations.",
      decl: [
        "I confirm the information I've submitted is true and relevant to the questions asked.",
        "I consent to reference checks.",
        "I agree to the program terms and data policy.",
        "I'd like to receive newsletters and future communication from ARTPARK.",
      ],
    },
  ];
}

export default function FullApplicationView({ s, onBack }) {
  const detail = s.detail || { aiSummary: "", fields: [] };
  const SECTIONS = buildSections(s, detail);

  return (
    <div style={{ maxWidth: 840, margin: "0 auto" }}>
      <div className="os-row between" style={{ marginBottom: 32 }}>
        <button className="os-btn ghost sm" onClick={onBack}>← Back to review</button>
        <span className="os-text-dim os-uppercase" style={{ ...eyebrowMono }}>
          {s.name} · full application
        </span>
      </div>

      {SECTIONS.map((sec, si) => (
        <SectionBlock key={si} sec={sec} />
      ))}

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 28, marginBottom: 48 }}>
        <button className="os-btn" onClick={onBack}>← Back to review</button>
      </div>
    </div>
  );
}

function SectionBlock({ sec }) {
  return (
    <div style={{ marginBottom: 56 }}>
      <div className="os-row between" style={{ marginBottom: 18 }}>
        <span style={eyebrowMono}>
          <span style={{ background: "#aafcf0", color: "#3213b7", padding: "2px 7px", fontWeight: 700 }}>SECTION</span>
          <span className="os-text-dim" style={{ marginLeft: 8 }}>{sec.num}</span>
        </span>
        <span className="os-text-dim" style={eyebrowMono}>OF 06</span>
      </div>

      <div style={{ fontSize: 72, fontWeight: 800, color: PURPLE, lineHeight: 1, fontFamily: "var(--font-display)" }}>
        {sec.num}
      </div>
      <h2 style={{ fontSize: 40, fontWeight: 800, margin: "10px 0 0", letterSpacing: "-0.02em", color: "var(--ink)" }}>
        {sec.title}
      </h2>
      <p className="os-text-soft" style={{ fontSize: 16, marginTop: 10 }}>{sec.blurb}</p>

      {sec.decl ? (
        <div style={{ ...answerBox, marginTop: 28 }}>
          <div className="os-stack gap-sm">
            {sec.decl.map((d, di) => (
              <div key={di} className="os-row gap-sm" style={{ alignItems: "flex-start" }}>
                <span className="os-chip green" style={{ flexShrink: 0 }}>✓ AGREED</span>
                <span className="os-text-soft" style={{ fontSize: 14.5, lineHeight: 1.5 }}>{d}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 24 }}>
          {(sec.questions || []).map((q, qi) => (
            <div key={qi} style={{ borderTop: "1px solid var(--line)", padding: "28px 0" }}>
              <div className="os-row between" style={{ marginBottom: 12 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: PURPLE }}>
                  {String(qi + 1).padStart(2, "0")} →
                </span>
                {q.required && <span style={pill}>REQUIRED</span>}
                {q.optional && <span style={pillGhost}>OPTIONAL</span>}
              </div>
              <h3 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.01em", lineHeight: 1.3, color: "var(--ink)" }}>
                {q.prompt}
              </h3>
              {q.help && (
                <p className="os-text-soft" style={{ fontSize: 15, marginTop: 8, lineHeight: 1.5 }}>{q.help}</p>
              )}
              <div style={{ marginTop: 16 }}>
                {q.file ? (
                  <div style={{ ...answerBox, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                    <span className="os-mono" style={{ fontSize: 14 }}>{q.answer}</span>
                    <span className="os-chip green" style={{ flexShrink: 0 }}>UPLOADED</span>
                  </div>
                ) : q.choice ? (
                  <div style={{ ...answerBox, display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ color: PURPLE, fontWeight: 700 }}>●</span>
                    <span style={{ fontWeight: 600 }}>{q.answer}</span>
                  </div>
                ) : (
                  <div style={answerBox}>{q.answer}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
