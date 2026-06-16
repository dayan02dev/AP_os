// FullApplicationView — ported verbatim from admin-1.jsx `FullApplicationView`.
//
// NOTE: full-application content is placeholder APP_DETAIL — wire real application
// fields in a follow-up.
//
// A <PreviewBadge/> is pinned at the top to signal that the content is static
// placeholder data while real field wiring is pending.

import React from "react";
import { PreviewBadge } from "../../../../components/admin/PreviewBadge";
import { fieldBullets, isFactField } from "../helpers/adminHelpers";

// ── Placeholder application content (verbatim from admin-1.jsx) ──────────────
const APP_DETAIL = {
  aiSummary: "Evaldam AI addresses the critical pain point of startup valuation and financial decision-making in India, which is currently slow, expensive, inaccurate, and often non-compliant with local regulations. The platform leverages a fine-tuned LLM, proprietary blended valuation methodology, and a curated dataset of Indian comparables to deliver rapid, cost-effective, and regulation-aware valuations. This solution promises a 10x improvement in speed, cost, and compliance, offering a significant advantage over existing global tools and traditional consultants by deeply integrating Indian regulatory knowledge and market realities into its core AI reasoning.",
  fields: [
    { label: 'Problem defined', value: 'Yes', short: true },
    { label: 'Problem describe', value: "Indian startups face a critical, systemic friction during fundraising: inaccurate, slow, expensive, and frequently non-compliant valuation and financial decision-making. Founders either pay ₹50,000–₹2,00,000+ to consultants for reports that are often generic and poorly understood, or they use global tools (like Equidam) that ignore Indian regulatory realities (FEMA pricing floors, Rule 11UA, IBBI certification requirements, CCPS/CCD structures). This leads to excessive founder dilution, failed or delayed rounds, poor capital allocation, and loss of equity. The problem affects thousands of early-stage startups annually, with significant economic and psychological cost to founders and the broader Indian startup ecosystem. Now is the right time because large language models have reached sufficient maturity in structured financial reasoning, and India is experiencing a surge in early-stage activity that desperately needs localized, AI-augmented financial intelligence. Solving this directly contributes to more efficient capital allocation, stronger founder outcomes, and increased global competitiveness of Indian startups." },
    { label: 'Solution stage', value: 'Pilot-ready product', short: true },
    { label: 'Solution describe', value: "Evaldam AI is an AI-powered platform that delivers fast, regulation-aware, transparent, and defensible startup valuations and financial intelligence specifically tuned for the Indian ecosystem. It represents a 10× improvement over existing solutions in three dimensions: • Speed: Reduces valuation report generation from days/weeks to seconds/minutes. • Cost: Dramatically lowers the cost compared to traditional consultants while maintaining or improving quality. • Accuracy & Compliance: Produces outputs that respect Indian regulatory requirements (FEMA, Rule 11UA, IBBI standards) and provides full transparency with assumptions, methodology, and comparables — something generic global tools and many consultants fail to deliver. The platform combines a fine-tuned domain-specific LLM with a proprietary blended valuation methodology (Scorecard + Berkus + VC Method + DCF with India-adjusted inputs) and a growing structured dataset of Indian startup comparables and regulatory rules." },
    { label: 'Solution core tech', value: "The core technology is a fine-tuned Large Language Model specialized on Indian startup finance and regulatory reasoning, combined with a proprietary blended valuation engine and a structured, growing dataset of Indian comparables and regulatory logic. Our \"unfair advantage\" comes from three elements that are difficult to replicate quickly: 1. Deep integration of Indian regulatory knowledge (FEMA pricing guidelines, Rule 11UA/57, IBBI standards, CCPS/CCD mechanics) directly into the AI reasoning layer — global models fundamentally lack this. 2. A proprietary blended methodology that automatically adjusts weighting based on stage, data quality, and Indian market realities. 3. A curated and expanding dataset of Indian startup comparables, outcomes, and regulatory interpretations that improves with usage. This combination creates both a data moat and a regulatory moat that generic AI models or traditional tools cannot easily match." },
    { label: 'Solution contrarian insight', value: "Most people in the startup valuation space treat valuation as either a pure financial modeling exercise or a regulatory compliance checkbox. The rare insight is that in the Indian context, valuation is actually a strategic negotiation and capital allocation tool that sits at the intersection of regulation, psychology, and asymmetric information. Because of FEMA pricing floors and the requirement for professional certification, the valuation number itself becomes a legal anchor that heavily influences founder dilution and investor economics — often more than the underlying business fundamentals in early stages. Founders who understand this dynamic and can generate defensible, regulation-aware valuations quickly gain a significant edge in term sheet negotiations. Most tools and advisors miss this strategic layer entirely." },
  ],
};

export function FullApplicationView({ s, onBack }) {
  const PURPLE = '#3213b7';
  const f = APP_DETAIL.fields;
  const founders = s.founders || [];
  const email = (founders[0] || 'founder').toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')
    + '@' + (s.name || 'company').toLowerCase().replace(/[^a-z0-9]+/g, '') + '.in';

  const SECTIONS = [
    {
      num: '01', title: 'Basic details', blurb: 'Who is applying, and how to reach them.',
      questions: [
        { prompt: "What's your full name?", help: "As you'd like it to appear on the application.", required: true, answer: founders[0] || '—' },
        { prompt: 'A phone number we can reach you on?', help: "We'll use this for interview scheduling only.", required: true, answer: '+91 98765 43210' },
        { prompt: 'And your email?', help: 'This will be your login anchor and primary channel.', required: true, answer: email },
        { prompt: 'Where are you right now?', help: "Current organization, institution, or 'Independent'.", required: true, answer: s.name },
        { prompt: 'Highest technology degree achieved?', help: 'Self-taught engineers with shipped work get equivalent weight.', required: true, choice: true, answer: "Master's Degree" },
      ],
    },
    {
      num: '02', title: 'Problem & importance', blurb: "The thing that pulled you in. What won't let you go.",
      questions: [
        { prompt: 'What specific critical problem in your chosen sector are you solving?', help: 'Who is feeling the pain? Can you quantify it — market size, urgency, human cost? Why is now the right time?', required: true, answer: f[1].value },
        { prompt: 'Do you think the problem you want to solve is well-defined?', help: 'Honest answers help us support you better — either response is fine.', required: true, choice: true, answer: f[0].value },
      ],
    },
    {
      num: '03', title: 'Your solution', blurb: "How you're approaching it, and what makes your angle defensible.",
      questions: [
        { prompt: 'Describe your solution. Does it represent a 10× improvement over existing state-of-the-art — rather than an incremental gain?', help: 'The bigger the impact, the more excited we are.', required: true, answer: f[3].value },
        { prompt: "What's the core technology that makes this special and hard to replicate?", help: 'What is the lab-proven research or cutting-edge advance, and what is the "unfair advantage"?', required: true, answer: f[4].value },
        { prompt: 'What do you believe about your field that most experts disagree with?', help: "Share a contrarian belief or a genuinely rare insight most experts don't think about.", optional: true, answer: f[5].value },
      ],
    },
    {
      num: '04', title: 'Execution plan', blurb: "What's your roadmap?",
      questions: [
        { prompt: 'How far along are you?', help: 'No wrong answer — this just helps us help you better.', required: true, choice: true, answer: f[2].value },
        { prompt: 'What are the most critical milestones you aim to achieve during this residency?', help: 'One or two sharp outcomes beat a vague roadmap.', required: true, answer: 'Q1: Close 10 paid design partners across Indian VCs, accelerators and CA firms. Q2: Ship the self-serve valuation API with FEMA / Rule 11UA compliance checks built in. Q3: Reach ₹1Cr ARR with 500+ defensible valuations delivered and an IBBI-aligned audit trail for each report.' },
      ],
    },
    {
      num: '05', title: 'Evidence', blurb: "Show, don't just tell.",
      questions: [
        { prompt: 'Upload your latest pitch deck.', help: "PDF, max 25MB. The version you'd send a serious investor today.", required: true, file: true, answer: 'pitch-evaldam-ai.pdf · 14 pages · 6.2 MB' },
        { prompt: 'A demo video of your product (under 3 minutes).', help: 'Loom, YouTube or Drive link. Optional but strongly encouraged.', optional: true, answer: 'https://www.loom.com/share/evaldam-ai-demo' },
      ],
    },
    {
      num: '06', title: 'Declaration', blurb: 'Last step. Just a few confirmations.',
      decl: [
        "I confirm the information I've submitted is true and relevant to the questions asked.",
        'I consent to reference checks.',
        'I agree to the program terms and data policy.',
        "I'd like to receive newsletters and future communication from ARTPARK.",
      ],
    },
  ];

  const eyebrowMono = { fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.18em' };
  const pill = { fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em', fontWeight: 600, color: PURPLE, border: '1px solid #cdc4f1', background: '#efecfb', padding: '4px 11px', borderRadius: 999 };
  const pillGhost = { ...pill, color: 'var(--ink-dim)', border: '1px solid var(--line)', background: 'transparent' };
  const answerBox = { background: '#fff', border: '1px solid var(--line)', borderRadius: 2, padding: '18px 22px', fontSize: 16, lineHeight: 1.62, color: 'var(--ink)' };

  return (
    <div style={{ maxWidth: 840, margin: '0 auto' }}>
      <PreviewBadge />

      <div className="os-row between" style={{ marginBottom: 32 }}>
        <button className="os-btn ghost sm" onClick={onBack}>← Back to review</button>
        <span className="os-text-dim os-uppercase" style={{ ...eyebrowMono }}>{s.name} · full application</span>
      </div>

      {SECTIONS.map((sec, si) => (
        <div key={si} style={{ marginBottom: 56 }}>
          <div className="os-row between" style={{ marginBottom: 18 }}>
            <span style={eyebrowMono}>
              <span style={{ background: '#bcd7cd', color: '#234f45', padding: '2px 7px', fontWeight: 700 }}>SECTION</span>
              <span className="os-text-dim" style={{ marginLeft: 8 }}>{sec.num}</span>
            </span>
            <span className="os-text-dim" style={eyebrowMono}>OF 06</span>
          </div>

          <div style={{ fontSize: 72, fontWeight: 800, color: PURPLE, lineHeight: 1, fontFamily: 'var(--font-mono)' }}>{sec.num}</div>
          <h2 style={{ fontSize: 40, fontWeight: 800, margin: '10px 0 0', letterSpacing: '-0.02em', color: 'var(--ink)' }}>{sec.title}</h2>
          <p className="os-text-soft" style={{ fontSize: 16, marginTop: 10 }}>{sec.blurb}</p>

          {sec.decl ? (
            <div style={{ ...answerBox, marginTop: 28 }}>
              <div className="os-stack gap-sm">
                {sec.decl.map((d, di) => (
                  <div key={di} className="os-row gap-sm" style={{ alignItems: 'flex-start' }}>
                    <span className="os-chip green" style={{ flexShrink: 0 }}>✓ AGREED</span>
                    <span className="os-text-soft" style={{ fontSize: 14.5, lineHeight: 1.5 }}>{d}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 24 }}>
              {sec.questions.map((q, qi) => (
                <div key={qi} style={{ borderTop: '1px solid var(--line)', padding: '28px 0' }}>
                  <div className="os-row between" style={{ marginBottom: 12 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: PURPLE }}>{String(qi + 1).padStart(2, '0')} →</span>
                    {q.required && <span style={pill}>REQUIRED</span>}
                    {q.optional && <span style={pillGhost}>OPTIONAL</span>}
                  </div>
                  <h3 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: '-0.01em', lineHeight: 1.3, color: 'var(--ink)' }}>{q.prompt}</h3>
                  {q.help && <p className="os-text-soft" style={{ fontSize: 15, marginTop: 8, lineHeight: 1.5 }}>{q.help}</p>}
                  <div style={{ marginTop: 16 }}>
                    {q.file ? (
                      <div style={{ ...answerBox, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                        <span className="os-mono" style={{ fontSize: 14 }}>{q.answer}</span>
                        <span className="os-chip green" style={{ flexShrink: 0 }}>UPLOADED</span>
                      </div>
                    ) : q.choice ? (
                      <div style={{ ...answerBox, display: 'flex', alignItems: 'center', gap: 12 }}>
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
      ))}

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 28, marginBottom: 48 }}>
        <button className="os-btn" onClick={onBack}>← Back to review</button>
      </div>
    </div>
  );
}
