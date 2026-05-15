// Schema-driven definition of every wizard question, per track.
//
// Used by ReviewApplicationPage to render the Application tab. The page is
// track-agnostic — it picks TIR_SCHEMA or SIP_SCHEMA based on the URL's
// :track param. Any `if (track === 'tir')` inside the render path means
// something needs to move into here instead.
//
// Each section: { section_number, section_title, blurb?, questions[] }.
// Each question: { number, key, label, help?, type, required, options?, items? }
//   number    — short label like "01" rendered next to the question
//   key       — DB column name on tir_applications / sip_applications. The
//               renderer reads application[key] directly.
//   type      — one of:
//                 "text"        — short/long text, email
//                 "choice"      — single-select; uses options[]
//                 "files"       — array of file objects (FileGridAnswer)
//                 "file"        — single file object (FileGridAnswer · max 1)
//                 "video"       — URL → loom/youtube/vimeo embed or link card
//                 "team"        — TIR basic_teammates jsonb array
//                 "captable"    — SIP sip_founders jsonb array
//                 "declaration" — 4 declaration_* booleans, rendered via items[]
//
// Only columns the *current* wizard surfaces are listed. Legacy columns
// (solution_ten_x, basic_incubators, evidence_deck, …) stay in the DB for
// historical applications but aren't rendered here — the wizard no longer
// asks for them so the reviewer doesn't need to see them either.

export const TIR_SCHEMA = [
  {
    section_number: "01",
    section_title: "Basic details",
    blurb: "Who is applying, and how to reach them.",
    questions: [
      {
        number: "01",
        key: "basic_full_name",
        label: "What's your full name?",
        help: "As you'd like it to appear on the application.",
        type: "text",
        required: true,
      },
      {
        number: "02",
        key: "basic_phone",
        label: "A phone number we can reach you on?",
        help: "Used for interview scheduling.",
        type: "text",
        required: true,
      },
      {
        number: "03",
        key: "basic_email",
        label: "And your email?",
        help: "Login anchor and primary channel.",
        type: "text",
        required: true,
      },
      {
        number: "04",
        key: "basic_org",
        label: "Where are you right now?",
        help: "Current organization, institution, or 'Independent'.",
        type: "text",
        required: true,
      },
      {
        number: "05",
        key: "basic_degree",
        label: "Highest technology degree achieved?",
        help: "Self-taught engineers with shipped work get equivalent weight.",
        type: "choice",
        options: [
          "Bachelor's Degree",
          "Master's Degree",
          "PhD",
          "Self-taught / Other",
        ],
        required: true,
      },
      {
        number: "06",
        key: "basic_has_team",
        label: "Do you have a team?",
        help: "Solo founders are very welcome.",
        type: "choice",
        options: ["Yes — I have co-founders", "No — going solo for now"],
        required: true,
      },
      {
        number: "07",
        key: "basic_teammates",
        label: "Co-founders invited to collaborate on this application.",
        help: "Each invited teammate answers the same three onboarding questions.",
        type: "team",
        required: false,
      },
      {
        number: "08",
        key: "basic_incubator_association",
        label:
          "Are you currently (or have you been) associated with any other incubator or accelerator?",
        help: "We need a clear picture of any prior association, especially funding.",
        type: "choice",
        options: ["No", "Yes"],
        required: true,
      },
      {
        number: "09",
        key: "basic_incubator_details",
        label: "Tell us more about your incubator/accelerator association.",
        help: "Programs, dates, funding/grants, nature of support.",
        type: "text",
        required: false,
      },
      {
        number: "10",
        key: "basic_hear_about",
        label: "How did you hear about ARTPARK?",
        type: "choice",
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
    section_number: "02",
    section_title: "Problem & importance",
    blurb: "Clarity beats jargon. Imagine telling a brilliant friend from an adjacent field.",
    questions: [
      {
        number: "11",
        key: "problem_describe",
        label:
          "What specific \"critical problem\" in your chosen sector are you solving?",
        help:
          "Who is feeling the pain? Can you quantify it — market size, urgency, human cost, environmental impact? Why now?",
        type: "text",
        required: true,
      },
      {
        number: "12",
        key: "problem_defined",
        label: "Do you think the problem you want to solve is well-defined?",
        help: "Honest answers help us support you better.",
        type: "choice",
        options: ["Yes", "No"],
        required: true,
      },
    ],
  },
  {
    section_number: "03",
    section_title: "Solution & technology",
    blurb: "How you're solving it, and what makes your approach hard to replicate.",
    questions: [
      {
        number: "13",
        key: "solution_describe",
        label: "Describe your solution.",
        help:
          "Does it represent a 10× improvement (technological, economic, or operational) over existing state-of-the-art? How so?",
        type: "text",
        required: true,
      },
      {
        number: "14",
        key: "solution_core_tech",
        label:
          "What's the core technology that makes this special and hard to replicate?",
        help:
          "Specific lab-proven research or scientific advance. Unfair advantage — patent, design, dataset.",
        type: "text",
        required: true,
      },
      {
        number: "15",
        key: "solution_contrarian_insight",
        label:
          "Share a genuinely rare insight in your field that most experts haven't thought about.",
        help: "Could be a contrarian view. We want sharp thinking, not hot takes.",
        type: "text",
        required: false,
      },
    ],
  },
  {
    section_number: "04",
    section_title: "Roadmap",
    blurb: "What does success look like, and what stands in your way?",
    questions: [
      {
        number: "16",
        key: "solution_stage",
        label: "How far along are you?",
        help: "No wrong answer — this helps us help you better.",
        type: "choice",
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
        number: "17",
        key: "execution_will_break",
        label: "Primary technical hurdles you need to overcome.",
        help:
          "Top 2–3 things that will break moving from the lab to the real world.",
        type: "text",
        required: false,
      },
      {
        number: "18",
        key: "execution_milestone",
        label:
          "Most critical milestones during this residency.",
        help: "Quarterly outcomes tied to budgets. Sharp outcomes beat vague roadmaps.",
        type: "text",
        required: true,
      },
      {
        number: "19",
        key: "execution_milestone_files",
        label: "Supporting documents for the milestone plan.",
        help: "Budget sheet or quarterly plan — PDF / XLS / CSV / image, up to 3 files.",
        type: "files",
        required: false,
      },
      {
        number: "20",
        key: "execution_infrastructure",
        label: "Specific advanced infrastructure you need from us.",
        help:
          "GPU cluster, motion-capture arena, robotics testbeds, wet labs — be concrete.",
        type: "text",
        required: true,
      },
      {
        number: "21",
        key: "execution_failure",
        label:
          "A significant research direction or prototype failure — how did you pivot?",
        help: "Optional. Deep tech rewards delayed gratification.",
        type: "text",
        required: false,
      },
      {
        number: "22",
        key: "execution_hwsw_integration",
        label: "How do you manage complex hardware-software integration?",
        help:
          "A time when physical and digital components interacted unexpectedly.",
        type: "text",
        required: false,
      },
    ],
  },
  {
    section_number: "05",
    section_title: "Evidence",
    blurb: "Show, don't just tell.",
    questions: [
      {
        number: "23",
        key: "evidence_files",
        label: "Share evidence — publications, patents, prototype photos.",
        help: "Optional, but strong signal. Multiple files OK.",
        type: "files",
        required: false,
      },
      {
        number: "24",
        key: "evidence_video_url",
        label: "A video of your prototype or product (under 3 minutes).",
        help: "Loom, YouTube, or Drive link. Optional but strongly encouraged.",
        type: "video",
        required: false,
      },
    ],
  },
  {
    section_number: "06",
    section_title: "Declaration",
    blurb: "A few confirmations.",
    questions: [
      {
        number: "25",
        key: "declarations",
        label: "Applicant confirmations.",
        type: "declaration",
        items: [
          {
            key: "declaration_truthful",
            label:
              "Information submitted is true and relevant to the questions asked.",
          },
          {
            key: "declaration_ref_checks",
            label: "Consent to reference checks.",
          },
          {
            key: "declaration_terms",
            label: "Agree to programme terms and data policy.",
          },
          {
            key: "declaration_newsletter",
            label: "Newsletter & future communication opt-in.",
          },
        ],
        required: true,
      },
    ],
  },
];

export const SIP_SCHEMA = [
  {
    section_number: "01",
    section_title: "Basic details",
    blurb: "Who is applying. SIP is for incorporated Pvt Ltd ventures.",
    questions: [
      {
        number: "01",
        key: "basic_full_name",
        label: "What's your full name?",
        help: "As you'd like it to appear on the application.",
        type: "text",
        required: true,
      },
      {
        number: "02",
        key: "basic_phone",
        label: "A phone number we can reach you on?",
        type: "text",
        required: true,
      },
      {
        number: "03",
        key: "basic_email",
        label: "And your email?",
        type: "text",
        required: true,
      },
      {
        number: "04",
        key: "basic_org",
        label: "Registered company name.",
        help: "The Pvt Ltd entity you're applying with.",
        type: "text",
        required: true,
      },
      {
        number: "05",
        key: "basic_degree",
        label: "Highest technology degree achieved (lead applicant)?",
        type: "choice",
        options: [
          "Bachelor's Degree",
          "Master's Degree",
          "PhD",
          "Self-taught / Other",
        ],
        required: true,
      },
      {
        number: "06",
        key: "sip_incorporated",
        label:
          "Is your venture incorporated as a Private Limited company in India?",
        help:
          "SIP is for incorporated companies translating lab-proven research into a product.",
        type: "choice",
        options: [
          "Yes — Pvt Ltd, registered in India",
          "Not yet — we're still pre-incorporation",
        ],
        required: true,
      },
      {
        number: "07",
        key: "sip_trl",
        label: "Where is your core IP / technology today (TRL)?",
        help: "SIP is calibrated for ventures with a working prototype or beyond.",
        type: "choice",
        options: [
          "TRL 3 or earlier — research stage",
          "TRL 4 — lab-validated prototype",
          "TRL 5 — pilot-tested in a relevant environment",
          "TRL 6+ — demonstrated in operational setting",
        ],
        required: true,
      },
      {
        number: "08",
        key: "sip_founders",
        label: "Cap table.",
        help: "Each shareholder — name (or entity), type, and % share.",
        type: "captable",
        required: true,
      },
      {
        number: "09",
        key: "basic_incubator_association",
        label:
          "Are you currently (or have you been) associated with any other incubator or accelerator?",
        type: "choice",
        options: ["No", "Yes"],
        required: true,
      },
      {
        number: "10",
        key: "basic_incubator_details",
        label: "Tell us more about your incubator/accelerator association.",
        help: "Names, dates, funding/grants, nature of support.",
        type: "text",
        required: false,
      },
      {
        number: "11",
        key: "basic_hear_about",
        label: "How did you hear about ARTPARK?",
        type: "choice",
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
    section_number: "02",
    section_title: "Problem & importance",
    blurb: "The thing that pulled you in.",
    questions: [
      {
        number: "12",
        key: "problem_describe",
        label:
          "What specific \"critical problem\" in your chosen sector are you solving?",
        help: "Who is feeling the pain? Quantify it. Why now?",
        type: "text",
        required: true,
      },
    ],
  },
  {
    section_number: "03",
    section_title: "Solution & traction",
    blurb: "How you're approaching it, and where you are on revenue.",
    questions: [
      {
        number: "13",
        key: "solution_describe",
        label:
          "Describe your solution. Does it represent a 10× improvement?",
        help:
          "We back long-term step-change innovation. The bigger the impact, the better.",
        type: "text",
        required: true,
      },
      {
        number: "14",
        key: "solution_core_tech",
        label:
          "What's the core technology that makes this special and hard to replicate?",
        help: "Lab-proven research, unfair advantage — patent, design, dataset.",
        type: "text",
        required: true,
      },
      {
        number: "15",
        key: "solution_contrarian_insight",
        label: "What do you believe about your field that most experts disagree with?",
        help: "Sharp, well-formed thinking — not just a hot take.",
        type: "text",
        required: false,
      },
      {
        number: "16",
        key: "sip_traction",
        label: "Where are you on the path to revenue?",
        type: "choice",
        options: [
          "Pre-revenue — building toward our first pilot",
          "Active pilots (paid or unpaid) with design partners",
          "Paying pilots — customers have paid for early access",
          "Live paying customers — repeat revenue",
        ],
        required: true,
      },
      {
        number: "17",
        key: "sip_traction_details",
        label: "Tell us about your pilots, design partners, or customers.",
        help:
          "Who they are, what they're paying for, the outcome they signed up for.",
        type: "text",
        required: true,
      },
      {
        number: "18",
        key: "sip_traction_files",
        label: "Signed LOIs, MoUs, or POs.",
        help: "PDF / image, up to 5 files. Reinforces the traction story.",
        type: "files",
        required: false,
      },
    ],
  },
  {
    section_number: "04",
    section_title: "Execution plan",
    blurb: "Your roadmap.",
    questions: [
      {
        number: "19",
        key: "execution_will_break",
        label:
          "Technical hurdles you overcame to get this deployed in the real world.",
        help:
          "The 2–3 most consequential hurdles you've worked through so far.",
        type: "text",
        required: true,
      },
      {
        number: "20",
        key: "execution_milestone",
        label: "Most critical milestones over the next 12 months.",
        help: "Sharp quarterly outcomes tied to budgets.",
        type: "text",
        required: true,
      },
      {
        number: "21",
        key: "execution_milestone_files",
        label: "Supporting docs for milestones.",
        help: "PDF / XLS / CSV / image, up to 3 files.",
        type: "files",
        required: false,
      },
      {
        number: "22",
        key: "execution_infrastructure",
        label: "ARTPARK infrastructure or facilities you'd need over 12 months.",
        help: "GPU cluster, prototyping labs, sensor testbeds — be concrete.",
        type: "text",
        required: true,
      },
      {
        number: "23",
        key: "execution_failure",
        label:
          "A significant research direction or prototype failure — how did you pivot?",
        help: "Optional. Deep tech rewards delayed gratification.",
        type: "text",
        required: false,
      },
      {
        number: "24",
        key: "execution_hwsw_integration",
        label: "How do you manage complex hardware-software integration?",
        type: "text",
        required: false,
      },
    ],
  },
  {
    section_number: "05",
    section_title: "Evidence",
    blurb: "Show, don't just tell.",
    questions: [
      {
        number: "25",
        key: "sip_pitch_deck",
        label: "Latest pitch deck.",
        help: "PDF, max 25 MB. The version you'd send a serious investor today.",
        type: "file",
        required: true,
      },
      {
        number: "26",
        key: "sip_cap_table_file",
        label: "Current cap table.",
        help: "PDF, XLS, XLSX or CSV. Directional is fine.",
        type: "file",
        required: true,
      },
      {
        number: "27",
        key: "sip_demo_video_url",
        label: "A demo video of your product (under 3 minutes).",
        help: "Loom, YouTube or Drive link. Optional but strongly encouraged.",
        type: "video",
        required: false,
      },
      {
        number: "28",
        key: "sip_patents_files",
        label: "Patents, publications, or other technical evidence.",
        help: "PDFs of granted patents, accepted publications, white papers. Up to 5 files.",
        type: "files",
        required: false,
      },
    ],
  },
  {
    section_number: "06",
    section_title: "Declaration",
    blurb: "A few confirmations.",
    questions: [
      {
        number: "29",
        key: "declarations",
        label: "Applicant confirmations.",
        type: "declaration",
        items: [
          {
            key: "declaration_truthful",
            label:
              "Information submitted is true and relevant to the questions asked.",
          },
          {
            key: "declaration_ref_checks",
            label: "Consent to reference checks.",
          },
          {
            key: "declaration_terms",
            label: "Agree to programme terms and data policy.",
          },
          {
            key: "declaration_newsletter",
            label: "Newsletter & future communication opt-in.",
          },
        ],
        required: true,
      },
    ],
  },
];

export function schemaFor(track) {
  if (track === "sip") return SIP_SCHEMA;
  return TIR_SCHEMA;
}
