// ARTPARK SIP application — question schema.
//
// Mirrors questions.jsx (TIR) but with SIP-specific gates, traction, evidence,
// and a cap-table input. Sections retain the same order/IDs (basic, problem,
// solution, execution, evidence, declaration) so the wizard plumbing reuses
// the same SECTION_INTRO / CELEBRATE flow.
//
// Two SIP-only early exits live in AppSip.jsx, triggered by:
//   sipIncorporated == "Not yet — we're still pre-incorporation"
//   sipTRL          == "TRL 3 or earlier — research stage"

const SECTIONS_SIP = [
  {
    id: "basic",
    index: "01",
    label: "Basic Details",
    blurb:
      "Most of this was auto-filled from your CV. Take a moment to review.",
    questions: [
      {
        id: "fullName",
        kind: "short",
        prompt: "What's your full name?",
        help: "As you'd like it to appear on the application.",
        placeholder: "e.g. Dr. Arun Kumar",
        cvAutoFill: true,
        required: true,
      },
      {
        id: "phone",
        kind: "short",
        prompt: "A phone number we can reach you on?",
        help: "We'll use this for interview scheduling only.",
        placeholder: "+91 98765 43210",
        cvAutoFill: true,
        required: true,
      },
      {
        id: "email",
        kind: "email",
        prompt: "And your email?",
        help: "This will be your login anchor and primary channel.",
        placeholder: "you@domain.com",
        cvAutoFill: true,
        required: true,
      },
      {
        id: "org",
        kind: "short",
        prompt: "Your company / startup name?",
        help: "Legal entity name if incorporated, or working name if you're pre-incorporation. Shown on the leadership dashboard and decision memos.",
        placeholder: "e.g. ColpAI Health Pvt Ltd",
        cvAutoFill: true,
        required: true,
      },
      {
        id: "degree",
        kind: "single",
        prompt: "Highest technology degree achieved (lead applicant)?",
        help:
          "Self-taught engineers with shipped work get equivalent weight — pick whatever's truthful.",
        options: [
          "Bachelor's Degree",
          "Master's Degree",
          "PhD",
          "Self-taught / Other",
        ],
        cvAutoFill: true,
        required: true,
      },
      // ── Co-founders (mirrors TIR Q6/Q7; persisted to basic_has_team +
      // basic_teammates by migration 021_sip_team_and_dpiit.sql) ──
      {
        id: "hasTeam",
        kind: "single",
        prompt: "Do you have a team?",
        help: "Solo founders are very welcome. We'll just tailor the rest of the form.",
        options: ["Yes — I have co-founders", "No — going solo for now"],
        required: true,
      },
      {
        id: "teammates",
        kind: "teamInvite",
        prompt: "Invite your co-founders to collaborate on this application.",
        help: "We'll email each person an invite. Everyone shares access to this single application — but only one person can edit at a time. We ask the same three onboarding questions (name, phone, current org) about each teammate.",
        maxMembers: 3,
        required: true,
        conditional: (a) => a.hasTeam === "Yes — I have co-founders",
      },
      // ── SIP-specific gates ──
      {
        id: "sipIncorporated",
        kind: "single",
        prompt:
          "Is your venture incorporated as a Private Limited company in India?",
        help:
          "VIP is for incorporated companies translating lab-proven research into a product. If you're not yet incorporated, you may be a stronger fit for the TIR (Technology Innovator in Residence) track.",
        options: [
          "Yes — Pvt Ltd, registered in India",
          "Not yet — we're still pre-incorporation",
        ],
        required: true,
      },
      {
        id: "sipTRL",
        kind: "single",
        prompt: "Where is your core IP / technology today (TRL)?",
        help:
          "VIP is calibrated for ventures with a working prototype or beyond. Anything earlier is usually a better fit for TIR.",
        options: [
          "TRL 3 or earlier — research stage",
          "TRL 4 — lab-validated prototype",
          "TRL 5 — pilot-tested in a relevant environment",
          "TRL 6+ — demonstrated in operational setting",
        ],
        required: true,
        conditional: (a) =>
          a.sipIncorporated === "Yes — Pvt Ltd, registered in India",
      },
      {
        id: "sipDpiit",
        kind: "dpiit",
        prompt: "Is your startup DPIIT registered?",
        help:
          "ARTPARK can invest only in DPIIT-recognised startups, and we report this for every applicant. If you're recognised, share your recognition number and date — both are on your DPIIT certificate. \"Not yet\" is a perfectly valid answer.",
        // Only an incorporated Pvt Ltd can hold DPIIT recognition, so this
        // mirrors sipTRL's gate — the question is hidden for pre-incorporation
        // applicants (who get routed to the fit-check screen anyway).
        conditional: (a) =>
          a.sipIncorporated === "Yes — Pvt Ltd, registered in India",
        required: true,
        // Persisted via fieldMap-sip.js's expandForPatch special case:
        // sipDpiit → basic_dpiit_registered + basic_dpiit_recognition_number
        // + basic_dpiit_recognition_date. Columns added in
        // backend/migrations/021_sip_team_and_dpiit.sql.
      },
      {
        id: "sipFounders",
        kind: "captable",
        prompt: "Who's on the cap table?",
        help:
          "Add each shareholder one at a time — name (or entity), type, and % share. Numbering is automatic. Keep it directional if a final cap table isn't signed yet — we just want a clear picture of ownership.",
        types: [
          "Founder",
          "Co-founder",
          "Advisor",
          "Employee pool (ESOP)",
          "Investor",
          "Other",
        ],
        maxEntries: 12,
        required: true,
      },
      // ── Shared ──
      {
        id: "incubatorAssociation",
        kind: "single",
        prompt:
          "Are you currently (or have you been) associated with any other incubator or accelerator?",
        help:
          "Incubators add value in different ways. We need a clear picture of any prior association, especially if they've funded your work.",
        options: ["No", "Yes"],
        required: true,
      },
      {
        id: "incubatorDetails",
        kind: "long",
        prompt: "Tell us more about your incubator/accelerator association.",
        help:
          "Names of programs, dates, any funding/grants received, and the nature of support.",
        placeholder:
          "e.g. IIT Madras Incubation Cell — 2024, ₹10L seed grant, equity-free…",
        maxChars: 800,
        minWords: 20,
        required: true,
        conditional: (a) => a.incubatorAssociation === "Yes",
      },
      {
        id: "hearAbout",
        kind: "single",
        prompt: "How did you hear about ARTPARK?",
        help: "Helps us understand what's working.",
        options: [
          "Referral from friend/colleague",
          "IISc faculty or staff",
          "Social media (LinkedIn, Twitter, etc.)",
          "Event or conference",
          "Search engine",
          "Partner organization",
          "News article or press",
          "Other",
        ],
        required: true,
      },
    ],
  },
  {
    id: "problem",
    index: "02",
    label: "Problem & Importance",
    blurb:
      "The thing that pulled you in. Clarity beats jargon — imagine you're telling a brilliant friend from an adjacent technology field.",
    questions: [
      {
        id: "problemDescribe",
        kind: "long",
        prompt: (a) =>
          `OK ${((a && a.fullName) || "there").split(" ")[0]} — what specific "critical problem" in your chosen sector are you solving?`,
        helpIntro: "Please make sure your answer covers:",
        helpItems: [
          "Who is feeling the pain because it's unsolved?",
          "Can you quantify it — market size, urgency, human cost, environmental impact?",
          "Why is now the right time, and how does solving it contribute to India's transformation and global competitiveness?",
        ],
        placeholder:
          "Smallholder farmers lack access to real-time soil intelligence, leading to 20–30% yield loss despite increased fertilizer usage. India has 140M+ hectares of farmland, and inefficient input usage drives ₹1.2L Cr annual losses plus environmental degradation. Now is the time because low-cost edge sensing + on-device ML has crossed the cost threshold for rural deployment…",
        maxChars: 2000,
        minWords: 80,
        required: true,
      },
    ],
  },
  {
    id: "solution",
    index: "03",
    label: "Your Solution",
    blurb:
      "How you're approaching it, what makes your angle defensible, and where you are on revenue.",
    questions: [
      {
        id: "solutionDescribe",
        kind: "long",
        prompt:
          "Describe your solution. Does it represent a 10× improvement (on technological, economic or operational metrics) — rather than an incremental gain — over existing state-of-the-art solutions? How so?",
        help:
          "As we build for the future, we want to back long-term step-change innovation. The bigger the impact, the more excited we are.",
        placeholder:
          "We're building a low-cost IoT soil sensor network with on-device ML for nutrient prediction. Sensor cost drops from ₹15,000 to ₹1,200 and accuracy improves 3× through adaptive calibration — turning what was a per-farm capital expense into a per-acre operating cost…",
        maxChars: 2000,
        minWords: 80,
        required: true,
      },
      {
        id: "coreTech",
        kind: "long",
        prompt:
          "What's the core technology that makes this special and hard to replicate?",
        helpIntro: "Please make sure your answer covers:",
        helpItems: [
          "What is the specific lab-proven research or cutting-edge advance you intend to translate?",
          "What is your \"unfair advantage\" — is it protected by a patent, a unique design or insight, or a proprietary dataset that others cannot easily replicate?",
        ],
        placeholder:
          "A magnetic-induction soil sensor architecture (patent pending) combined with an adaptive calibration algorithm trained on a proprietary dataset of 10,000+ Indian soil samples across 7 agro-climatic zones — neither the hardware design nor the dataset can be replicated without years of fieldwork…",
        maxChars: 2000,
        minWords: 60,
        required: true,
      },
      {
        id: "contrarianInsight",
        kind: "long",
        prompt:
          "What do you believe about your field that most experts disagree with?",
        help:
          "Share a contrarian belief, or a genuinely rare insight most experts don't think about. We're looking for sharp, well-formed thinking — not just a hot take.",
        placeholder: "Most of the field assumes…, but our work suggests…",
        maxChars: 1500,
        minWords: 0,
        required: false,
        optional: true,
      },
      {
        id: "sipTraction",
        kind: "single",
        prompt: "Where are you on the path to revenue?",
        help:
          "Pick the most accurate bucket. We don't expect VIP applicants to have audited revenue — pilots and design partners count.",
        options: [
          "Pre-revenue — building toward our first pilot",
          "Active pilots (paid or unpaid) with design partners",
          "Paying pilots — customers have paid for early access",
          "Live paying customers — repeat revenue",
        ],
        required: true,
      },
      {
        id: "sipTractionDetails",
        kind: "long",
        prompt: "Tell us about your pilots, design partners, or customers.",
        help:
          "Who are they, what are they paying for (or what's the LOI), and what specific outcome have they signed up for? You can attach signed LOIs, MoUs, or POs below.",
        placeholder:
          "We're piloting with 3 dairy cooperatives across MH and KA — Amul Pvt Ltd, Mahaan Foods, and a regional FPO. Two are paid pilots (₹4–6L each, 6 months) targeting a 15% reduction in cold-chain losses. Signed LOIs attached.",
        maxChars: 2000,
        minWords: 40,
        required: true,
      },
      {
        // Rendered inline under sipTractionDetails — flatten skips this so it
        // doesn't get its own page. Same backend write column either way.
        id: "sipTractionFiles",
        kind: "sipTractionFiles",
        prompt: "Attach signed LOIs, MoUs, or POs (optional, up to 5).",
        help:
          "PDF/JPG/PNG, 5MB each. These reinforce the traction story you just wrote — but the field above is enough on its own.",
        accept: ".pdf,.png,.jpg,.jpeg",
        maxFiles: 5,
        maxMB: 5,
        optional: true,
        inlineAfter: "sipTractionDetails",
        attachLabel: "lois / mous / pos · optional",
      },
    ],
  },
  {
    id: "execution",
    index: "04",
    label: "Execution Plan",
    blurb: "What's your roadmap?",
    questions: [
      {
        id: "willBreak",
        kind: "long",
        prompt:
          "What technical hurdles did you overcome to get this deployed in the real world?",
        help:
          "You've taken your prototype out of the lab and run early tests in the field — what broke when you did, and how did you handle it? Environmental noise, edge cases, material fatigue, latency, integration friction. The 2–3 most consequential hurdles you've worked through so far.",
        placeholder:
          "Sensor calibration drift in dusty environments — solved with on-device thermal compensation tuned across 3 customer pilot sites. ROS-to-firmware latency cut from 80ms to 12ms after rewriting the message bus. Actuator wear-and-tear addressed via a swappable cartridge…",
        maxChars: 1000,
        minWords: 30,
        required: true,
      },
      {
        id: "milestone",
        kind: "long",
        prompt:
          "What are the most critical milestones you aim to achieve over the next 12 months?",
        help:
          "What does a successful deployment look like? One or two sharp outcomes beat a vague roadmap. Share quarterly milestones tied to specific outcomes and budgets. You can also attach supporting docs below (PDF/XLS).",
        placeholder:
          "Q1: bench-validated prototype. Q2: closed-loop pilot with 3 partner sites. Q3: 100-unit field deployment with measured uptime ≥ 95%…",
        maxChars: 2000,
        minWords: 60,
        required: true,
      },
      {
        // Inline attachment under milestone — flatten skips this entry.
        id: "milestoneFiles",
        kind: "milestoneFiles",
        prompt: "Supporting docs (optional).",
        help:
          "PDF/XLS/CSV/PNG/JPG, 5MB each, up to 3 files. A budget sheet or quarterly plan helps the reviewer.",
        accept: ".pdf,.xls,.xlsx,.csv,.png,.jpg,.jpeg",
        maxFiles: 3,
        maxMB: 5,
        optional: true,
        inlineAfter: "milestone",
        attachLabel: "supporting docs · optional",
      },
      {
        id: "infrastructure",
        kind: "long",
        prompt:
          "What ARTPARK infrastructure or facilities would unblock you over the next 12 months?",
        help:
          "E.g., high-performance computing, specialized sensors, rapid prototyping labs, anechoic chambers, wet labs, robotics testbeds.",
        placeholder:
          "GPU cluster for training perception models, a 6-DOF motion-capture arena, and CNC + 3D-printing for weekly hardware iterations…",
        maxChars: 1000,
        minWords: 25,
        required: true,
      },
      {
        id: "failure",
        kind: "long",
        prompt:
          "Tell us about a significant research direction or prototype failure — how did you pivot, and what did it teach you about commercialization?",
        help:
          "Optional. Deep tech rewards delayed gratification — we want to see you've done the time.",
        placeholder:
          "In 2022, our first sensor architecture couldn't survive monsoon humidity. We pivoted to a sealed module after talking to 12 field operators…",
        maxChars: 1000,
        minWords: 30,
        optional: true,
      },
      {
        id: "hwSwIntegration",
        kind: "long",
        prompt: "How do you manage complex hardware-software integration?",
        help:
          "Optional. Tell us about a time you had to troubleshoot a system in which physical and digital components interacted unexpectedly.",
        placeholder:
          "Our control loop was fine in sim but oscillated on hardware — turned out to be a 12 ms I²C jitter we only caught with a logic analyzer…",
        maxChars: 1000,
        minWords: 30,
        optional: true,
      },
    ],
  },
  {
    id: "evidence",
    index: "05",
    label: "Evidence",
    blurb: "Show, don't just tell.",
    questions: [
      {
        id: "sipPitchDeck",
        kind: "sipPitchDeck",
        prompt: "Upload your latest pitch deck.",
        help: "PDF, max 5 MB. The version you'd send a serious investor today. If your deck is bigger, run it through any PDF compressor (e.g. ilovepdf.com) — image-heavy decks usually shrink 5–10×.",
        accept: ".pdf",
        maxMB: 5,
        required: true,
      },
      {
        id: "sipCapTableFile",
        kind: "sipCapTableFile",
        prompt: "Upload your current cap table.",
        help: "PDF, XLS, XLSX or CSV. A directional cap table is fine if it isn't yet signed off.",
        accept: ".pdf,.xls,.xlsx,.csv",
        maxMB: 10,
        required: true,
      },
      {
        id: "sipDemoVideo",
        kind: "short",
        prompt: "A demo video of your product (under 3 minutes).",
        help:
          "A Loom, YouTube or Drive link. Optional but strongly encouraged — shows the real thing.",
        placeholder: "https://www.loom.com/share/…",
        optional: true,
      },
      {
        id: "sipPatents",
        kind: "sipPatents",
        prompt: "Patents, publications, or other technical evidence.",
        help:
          "PDFs of granted patents, accepted publications, white papers, etc. Up to 5 files.",
        accept: ".pdf,.png,.jpg,.jpeg,.doc,.docx",
        maxFiles: 5,
        maxMB: 10,
        optional: true,
      },
    ],
  },
  {
    id: "declaration",
    index: "06",
    label: "Declaration",
    blurb: "Last step. Just a few confirmations.",
    questions: [
      {
        id: "declarations",
        kind: "declarations",
        prompt: "A few things to confirm.",
        help: "Tick each to submit.",
        items: [
          {
            key: "truthful",
            label:
              "I confirm the information I've submitted is true and relevant to the questions asked.",
          },
          { key: "refChecks", label: "I consent to reference checks." },
          {
            key: "terms",
            label: "I agree to the program terms and data policy.",
          },
          {
            key: "newsletter",
            label:
              "I'd like to receive newsletters and future communication from ARTPARK.",
          },
        ],
        required: true,
      },
    ],
  },
];

function flattenQuestionsSip(sections, answers) {
  const out = [];
  sections.forEach((s, si) => {
    s.questions.forEach((q) => {
      if (q.conditional && !q.conditional(answers || {})) return;
      // Inline children are rendered under their parent question, not as a
      // standalone step. Keep them in SECTIONS_SIP so review/completion logic
      // and findInlineChildSip() can still see them.
      if (q.inlineAfter) return;
      out.push({ section: s, sectionIdx: si, q, globalIdx: out.length });
    });
  });
  return out;
}

function findInlineChildSip(parentId) {
  for (const s of SECTIONS_SIP) {
    for (const q of s.questions) {
      if (q.inlineAfter === parentId) return q;
    }
  }
  return null;
}

export { SECTIONS_SIP, flattenQuestionsSip, findInlineChildSip };
