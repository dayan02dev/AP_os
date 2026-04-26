// ARTPARK TIR Application — question schema (Bucket 3, manager spec).
// Section 1 (Professional Profile) is handled by the PRE-QUESTION upload step.
// Section 2 Basic Info fields are tagged as cvAutoFill so they show a "parsed" chip.
//
// Bucket 3 changes vs. previous schema:
//   • basic: replaced single `incubators` field with two-step
//     `incubatorAssociation` (Yes/No) + conditional `incubatorDetails`.
//   • problem: removed `problemImportance` (folded into `problemDescribe`);
//     `problemDescribe` is now always asked first, ungated by problemDefined.
//   • solution: removed tenX, hurdles, moat, nationalScale, customers; added
//     optional `contrarianInsight`.
//   • execution: `stage` moves here from solution (with greeting prompt);
//     `willBreak` becomes conditional on stage; `budget` removed; new required
//     `infrastructure`; new optional `hwSwIntegration`; `milestone` keeps its
//     own follow-up `milestoneFiles` question (optional file uploads).
//   • evidence: removed `deck` (pitch deck no longer collected).
//
// Phase A polish PRESERVED: section indices 01–06 (not 02–07), "Highest
// degree" (not "Highest technology degree"), softened newsletter copy.

const SECTIONS = [
  {
    id: "basic",
    index: "01",
    label: "Basic Details",
    blurb: "Most of this was auto-filled from your CV. Take a moment to review.",
    questions: [
      // Contact + background first — these are the fields the resume parser
      // can auto-fill, so the user is mostly confirming values here.
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
        prompt: "Where are you right now?",
        help: "Current organization, institution, or 'Independent'. We actively seek outliers from non-tier-1 places.",
        placeholder: "e.g. IISc Bangalore / Independent / Company Name",
        cvAutoFill: true,
        required: true,
      },
      {
        id: "degree",
        kind: "single",
        prompt: "Highest technology degree achieved?",
        help: "Self-taught engineers with shipped work get equivalent weight — pick whatever's truthful.",
        options: ["Bachelor's Degree", "Master's Degree", "PhD", "Self-taught / Other"],
        cvAutoFill: true,
        required: true,
      },
      // Order matches the v3 spec: team → incubator (with conditional
      // detail) → hearAbout last.
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
      {
        id: "incubatorAssociation",
        kind: "single",
        prompt: "Are you currently (or have you been) associated with any other incubator or accelerator?",
        help: "There are many incubators and accelerators, and they all add value in different ways. It is important for us to understand your association with any of them, and if they have funded your work in any way.",
        options: ["No", "Yes"],
        required: true,
      },
      {
        id: "incubatorDetails",
        kind: "long",
        prompt: "Tell us more about your incubator/accelerator association.",
        help: "Names of the programs, dates, any funding or grants received, and the nature of support (mentorship, infrastructure, equity, etc.).",
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
    label: "What problem do you want to solve passionately?",
    blurb: "Clarity beats jargon — imagine you are telling a brilliant friend from an adjacent technology field.",
    questions: [
      {
        id: "problemDescribe",
        kind: "long",
        // Greeting prompt: addresses the applicant by first name. Falls back
        // to "there" until fullName is filled.
        prompt: (a) => `OK ${((a && a.fullName) || "there").split(" ")[0]} — what specific "critical problem" in your chosen sector are you solving?`,
        helpIntro: "Please make sure your answer covers:",
        helpItems: [
          "Who is feeling the pain because it's unsolved?",
          "Can you quantify it — market size, urgency, human cost, environmental impact?",
          "Why is now the right time, and how does solving it contribute to India's transformation and global competitiveness?",
        ],
        placeholder: "(An example, if we were still in the 1990s) Naturally blue LEDs don't exist because they require specialized, high-energy semiconductors—specifically gallium nitride (GaN)—that are notoriously difficult to grow without massive defects. As a result, most lighting (which is white) cannot use LEDs. CFLs use a lot of power – about double that of LEDs. Lack of electric power keeps over 1 billion people mostly in the dark in Africa and Asia. Now is the time to solve the problem because we have a new technology on the horizon just as usage of power for lighting in the developed and developing countries has accelerated from 5% to 15% every year, resulting in billions of tonnes of CO2 emissions….",
        maxChars: 2000,
        minWords: 80,
        required: true,
      },
      {
        id: "problemDefined",
        kind: "single",
        prompt: "Do you think the problem you want to solve is well-defined?",
        help: "Honest answers help us support you better.",
        options: ["Yes", "No"],
        required: true,
      },
    ],
  },
  {
    id: "solution",
    index: "03",
    label: "What's your solution and technology?",
    blurb: "How you are solving the problem, and what makes your approach special.",
    questions: [
      {
        id: "solutionDescribe",
        kind: "long",
        prompt: "Describe your solution.",
        helpIntro: "Make sure you cover:",
        helpItems: [
          "Does it represent a 10× improvement (on technological, economic or operational metrics) — rather than just an incremental gain — over existing state-of-the-art solutions? How so?",
        ],
        help: "We want to back big step-change innovations that shape the future. The larger the potential impact, the more excited we are.",
        placeholder: "We're building a low-cost IoT soil sensor network with on-device ML for nutrient prediction. Sensor cost drops from ₹15,000 to ₹1,200 and accuracy improves 3× through adaptive calibration — turning what was a per-farm capital expense into a per-acre operating cost…",
        maxChars: 2000,
        minWords: 80,
        required: true,
      },
      {
        id: "coreTech",
        kind: "long",
        prompt: "What's the core technology that makes this special and hard to replicate?",
        helpIntro: "Please make sure your answer covers:",
        helpItems: [
          "What is the specific lab-proven research or cutting-edge scientific / technological advance that you intend to translate?",
          "What is your \"unfair advantage\" — is it protected by a patent, a unique design or insight, or a proprietary dataset that others cannot easily replicate?",
        ],
        placeholder: "A magnetic-induction soil sensor architecture (patent pending) combined with an adaptive calibration algorithm trained on a proprietary dataset of 10,000+ Indian soil samples across 7 agro-climatic zones — neither the hardware design nor the dataset can be replicated without years of fieldwork…",
        maxChars: 2000,
        minWords: 60,
        required: true,
      },
      // Bucket 3: replaces tenX/hurdles/moat/nationalScale/customers with a
      // single optional "contrarian belief" question. Answers in the dropped
      // five columns are preserved on already-submitted apps but no longer
      // collected from new applicants.
      {
        id: "contrarianInsight",
        kind: "long",
        prompt: "Share a genuinely rare insight in your field of expertise that most people in that field haven't thought about.",
        help: "It could even be a contrarian view that most experts disagree with. We are looking for sharp, well-formed thinking — not just a 'hot take.'",
        placeholder: "Most of the field assumes…, but our work suggests…",
        maxChars: 1500,
        minWords: 0,
        required: false,
        optional: true,
      },
    ],
  },
  {
    id: "execution",
    index: "04",
    label: "What's your roadmap?",
    blurb: "What does success look like, and what stands in your way?",
    questions: [
      // Bucket 3: stage moves here from solution. DB column stays
      // `solution_stage` so existing data still loads — this is a UI placement
      // change, not a column rename.
      {
        id: "stage",
        kind: "single",
        prompt: (a) => `${((a && a.fullName) || "there").split(" ")[0]}, how far along are you?`,
        help: "No wrong answer — this just helps us help you better.",
        options: [
          "Still exploring",
          "Literature / research stage",
          "Simulations completed",
          "Lab demos / proof of concept",
          "Prototype built",
          "Pilot-ready product",
          "Deployed in real setting with real users",
        ],
        required: true,
      },
      {
        id: "willBreak",
        kind: "long",
        prompt: "What are the primary technical hurdles you need to overcome?",
        help: "Share the top 2–3 things that will break moving from the lab to the real world. (Edge cases, material fatigue, latency, defect rate, etc.)",
        placeholder: "Sensor calibration drift in dusty environments, ROS-to-firmware latency at the edge, and physical wear-and-tear on actuators…",
        maxChars: 1000,
        minWords: 30,
        required: true,
        // Bucket 3: not asked when applicant is still exploring — the question
        // presupposes a concrete solution.
        conditional: (a) => a.stage && a.stage !== "Still exploring",
      },
      {
        id: "milestone",
        kind: "long",
        prompt: "What are the most critical milestone(s) you aim to achieve during this residency?",
        help: "What does a successful deployment look like? One or two sharp outcomes beat a vague roadmap. Share quarterly milestones tied to specific outcomes and budgets. You can also upload a PDF/XLS on the Evidence step.",
        placeholder: "Q1: bench-validated prototype. Q2: closed-loop pilot with 3 partner sites. Q3: 100-unit field deployment with measured uptime ≥ 95%…",
        maxChars: 2000,
        minWords: 60,
        required: true,
      },
      // The dedicated milestone-files question was folded into the
      // Evidence section per the latest spec — applicants attach
      // supporting PDF/XLS docs on the same screen as their evidence
      // files. The execution_milestone_files JSONB column + storage
      // bucket are kept intact so prior submissions still render their
      // attachments; only the wizard UI surface for it is gone.
      // Bucket 3: replaces `budget` (a free-text essay question). Required.
      {
        id: "infrastructure",
        kind: "long",
        prompt: "What specific advanced infrastructure or facilities are essential for your success during this residency?",
        help: "For example: high-performance computing, specialized sensors, rapid prototyping labs, anechoic chambers, wet labs, robotics testbeds.",
        placeholder: "GPU cluster for training perception models, a 6-DOF motion-capture arena, and CNC + 3D-printing for weekly hardware iterations…",
        maxChars: 1000,
        minWords: 25,
        required: true,
      },
      {
        id: "failure",
        kind: "long",
        prompt: "Tell us about a significant research direction or prototype failure — how did you pivot, and what did it teach you about commercialization?",
        help: "Optional. Deep tech rewards delayed gratification — we want to see you've done the time.",
        placeholder: "In 2022, our first sensor architecture couldn't survive monsoon humidity. We pivoted to a sealed module after talking to 12 field operators…",
        maxChars: 1000,
        minWords: 30,
        optional: true,
      },
      // Bucket 3: new optional question.
      {
        id: "hwSwIntegration",
        kind: "long",
        prompt: "How do you manage complex hardware-software integration?",
        help: "Optional. Tell us about a time you had to troubleshoot a system in which physical and digital components interacted unexpectedly.",
        placeholder: "Our control loop was fine in sim but oscillated on hardware — turned out to be a 12 ms I²C jitter we only caught with a logic analyzer…",
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
        id: "evidenceFiles",
        kind: "files",
        prompt: "Share evidence — publications, patents, prototype photos.",
        help: "Optional, but strong signal. Multiple files OK.",
        accept: ".pdf,.png,.jpg,.jpeg,.doc,.docx",
        multi: true,
        optional: true,
      },
      {
        id: "video",
        kind: "short",
        prompt: "A video of your prototype or product (under 3 minutes).",
        help: "A Loom, YouTube, or Drive link is perfect. Optional but strongly encouraged — photos can be staged, video shows the real thing.",
        placeholder: "https://www.loom.com/share/…",
        optional: true,
      },
      // Bucket 3: pitch-deck question removed per manager spec. Old
      // submissions retain `evidence_deck`; new applicants don't see it.
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
          { key: "truthful", label: "I confirm the information I've submitted is true and relevant to the questions asked." },
          { key: "refChecks", label: "I consent to reference checks." },
          { key: "terms", label: "I agree to the program terms and data policy." },
          { key: "newsletter", label: "I'd like to receive newsletters and future communication from ARTPARK." },
        ],
        required: true,
      },
    ],
  },
];

function flattenQuestions(sections, answers) {
  const out = [];
  sections.forEach((s, si) => {
    s.questions.forEach((q) => {
      if (q.conditional && !q.conditional(answers || {})) return;
      out.push({ section: s, sectionIdx: si, q, globalIdx: out.length });
    });
  });
  return out;
}

export { SECTIONS, flattenQuestions };
