"""ARTPARK Innovation Readiness (AIR) — the framework as data.

Server-owned so the browser renders whatever we send rather than holding its
own copy of the wording, exactly like founder_mou.ACKNOWLEDGEMENTS and
founder_catalog. Revising a question's text needs no frontend deploy.

Content authority: docs/reference/air-framework.md. Two things there are
deliberate and must not be "tidied": the source maps two options to the same
AIR level in three places, and it defines no qualifying document at some
levels of supply_chain and reliability.
"""
from __future__ import annotations

LEVERS: list[dict] = [
    {"key": "scientific_principles", "name": "Scientific Principles & Models", "family": "technology"},
    {"key": "architecture", "name": "Architecture & System Definition", "family": "technology"},
    {"key": "qualification", "name": "Qualification & Final Design", "family": "technology"},
    {"key": "user_needs", "name": "User Needs & Requirements", "family": "commercial"},
    {"key": "supply_chain", "name": "Supply Chain & Manufacturing", "family": "commercial"},
    {"key": "reliability", "name": "Reliability & Maintainability", "family": "commercial"},
]

LEVER_KEYS: tuple[str, ...] = tuple(l["key"] for l in LEVERS)
TECHNOLOGY_LEVERS: tuple[str, ...] = tuple(l["key"] for l in LEVERS if l["family"] == "technology")
COMMERCIAL_LEVERS: tuple[str, ...] = tuple(l["key"] for l in LEVERS if l["family"] == "commercial")

QUESTIONS: dict[str, list[dict]] = {
    "scientific_principles": [
        {
            "id": "q1",
            "text": "How well documented and verified are the core scientific principles of your technology?",
            "focus": "Physics, Literature, Prior Art, Feasibility Scan.",
            "options": [
                {"id": "A", "level": 1, "text": "Principles are based only on a high-level idea; no formal literature review or IP scan completed."},
                {"id": "B", "level": 2, "text": "Comprehensive literature/patent search is complete; core scientific principles are formally documented, and a high-level feasibility scan is done."},
                {"id": "C", "level": 3, "text": "All critical knowledge gaps have been identified, and initial lab tests have successfully demonstrated POC viability."},
            ],
        },
        {
            "id": "q2",
            "text": "What is the current maturity of your system's prediction and control models?",
            "focus": "Modeling, Simulation, HIL Validation.",
            "options": [
                {"id": "A", "level": 2, "text": "Models are defined in concept only; detailed physics/control models are not yet built or simulated."},
                {"id": "B", "level": 3, "text": "Models are built, simulations of core scenarios are running, and Hardware-in-the-Loop (HIL) tests have been successfully integrated."},
                {"id": "C", "level": 4, "text": "Quantitative prototype performance consistently compares against AIR 2 simulation targets, and deviations are understood and documented."},
                {"id": "D", "level": 5, "text": "The integrated prototype's performance matches the models even in realistic, simulated field conditions (AIR 5: Field Test completed)."},
            ],
        },
        {
            "id": "q3",
            "text": "What is the status of system reliability data and operational qualification?",
            "focus": "MTBF, Qualification, Sustained KPIs.",
            "options": [
                {"id": "A", "level": 5, "text": "Prototype is functional in the relevant environment (AIR 5), but long-duration MTBF data collection in an operational demonstration has not yet begun."},
                {"id": "B", "level": 6, "text": "Prototypes have completed end-to-end operational scenario demonstrations and collected initial long-duration MTBF data in a relevant environment."},
                {"id": "C", "level": 7, "text": "System-level performance (Task completion rate, uptime) is being measured and reported with real-time telemetry from a live operational pilot (AIR 7)."},
                {"id": "D", "level": 8, "text": "Full Qualification Tests are complete, and final performance benchmarks met using production tooling (formally qualified)."},
                {"id": "E", "level": 9, "text": "System is proven through sustained commercial operation (6+ months); SLA monitoring, fleet health, and remote optimization are fully operational."},
            ],
        },
    ],
    "architecture": [
        {
            "id": "q1",
            "text": "What is the current status of your core system architecture and control?",
            "focus": "Architecture, Functional Blocks.",
            "options": [
                {"id": "A", "level": 1, "text": "Only high-level functional concepts exist; no formal block diagrams or component lists are complete."},
                {"id": "B", "level": 2, "text": "High-level system architecture and functional decomposition are defined; candidate components are selected and justified."},
                {"id": "C", "level": 3, "text": "Basic embedded control systems are implemented and validated on breadboards (e.g., actuator control, safety loops)."},
            ],
        },
        {
            "id": "q2",
            "text": "How complete and tested is your integrated system prototype (hardware and software stack)?",
            "focus": "Integration, A/B0 Sample.",
            "options": [
                {"id": "A", "level": 3, "text": "Subsystems are built, but the entire hardware/software stack has not been integrated into a stable A/B0 prototype."},
                {"id": "B", "level": 4, "text": "Integrated A/B0 lab prototype built and the full middleware/control stack operates stably in a lab environment."},
                {"id": "C", "level": 5, "text": "System tested in a relevant simulated environment, and all field-driven design iterations (e.g., Bx sample) are implemented."},
            ],
        },
        {
            "id": "q3",
            "text": "What is the status of your design documentation for manufacturing and customer support?",
            "focus": "Design Freeze, Documentation.",
            "options": [
                {"id": "A", "level": 6, "text": "Pilot-scale prototypes (C samples) are built, but final production documentation (manuals, final drawings) is not yet complete."},
                {"id": "B", "level": 7, "text": "Pilot unit successfully integrated into the customer's operational flow; final maintenance and user documentation has been completed and is ready for publishing."},
                {"id": "C", "level": 8, "text": "Final mechanical/electrical/software design is locked for production (frozen); final user manuals and technical documents are formally released."},
                {"id": "D", "level": 9, "text": "System is deployed widely; post-deployment enhancements and long-term obsolescence management roadmaps are actively managed."},
            ],
        },
    ],
    "qualification": [
        {
            "id": "q1",
            "text": "What is the status of your initial risk assessment and basic safety implementation?",
            "focus": "Hazards, Regulatory Scan.",
            "options": [
                {"id": "A", "level": 1, "text": "No regulatory scan or preliminary hazard list is completed."},
                {"id": "B", "level": 2, "text": "Regulatory scan and preliminary hazard list are documented; basic E-stop/interlock design is defined."},
                {"id": "C", "level": 3, "text": "Physical E-stop and software interlocks are implemented and successfully demonstrated on the AIR 3 prototype."},
            ],
        },
        {
            "id": "q2",
            "text": "How rigorous is your system-level hazard analysis and safety testing?",
            "focus": "FMEA, Standards Mapping.",
            "options": [
                {"id": "A", "level": 3, "text": "Only basic hazard identification is done; no expanded HAZOP/FMEA completed on the integrated system."},
                {"id": "B", "level": 4, "text": "Expanded hazard analysis (HAZOP/FMEA) is completed on the integrated system (AIR 4)."},
                {"id": "C", "level": 5, "text": "Design is mapped against all required standards, and advanced safety tests (e.g., failure modes) are completed in the relevant environment."},
            ],
        },
        {
            "id": "q3",
            "text": "What is the status of official product certification and quality system readiness?",
            "focus": "External Testing, QMS.",
            "options": [
                {"id": "A", "level": 6, "text": "Third-party safety review is completed, but external compliance testing has not yet begun."},
                {"id": "B", "level": 7, "text": "External certification tests are initiated/substantially completed; operational safety drills and incident response plans are documented (AIR 7)."},
                {"id": "C", "level": 8, "text": "Full, independent certification (e.g., CE, FCC, UL) is obtained, and the Quality Management System (QMS) is audited and ready for production."},
                {"id": "D", "level": 9, "text": "System is deployed widely; ongoing regulatory compliance reporting and operational cybersecurity patch management are fully active."},
            ],
        },
    ],
    "user_needs": [
        {
            "id": "q1",
            "text": "What is the current status of your problem validation and requirement baselining?",
            "focus": "Problem, Stakeholder, Requirements.",
            "options": [
                {"id": "A", "level": 1, "text": "Problem is defined but based only on high-level ideas; no expert or secondary research review is complete."},
                {"id": "B", "level": 2, "text": "Secondary market research is complete, and a clear problem/stakeholder map is defined."},
                {"id": "C", "level": 3, "text": "Primary discovery is complete; initial customer requirements are finalized and baselined for development."},
            ],
        },
        {
            "id": "q2",
            "text": "How well is your product hypothesis validated by customers and commercial strategy?",
            "focus": "Hypothesis, Paid PoC, Sales Plan.",
            "options": [
                {"id": "A", "level": 4, "text": "Problem is confirmed by multiple customers, but the product hypothesis and value proposition are still speculative."},
                {"id": "B", "level": 5, "text": "Initial Paid PoC agreement is secured, and high-fidelity prototype usage confirms product-market fit."},
                {"id": "C", "level": 6, "text": "Value and benefits confirmed during customer testing; initial business model and sales process roadmap are documented."},
            ],
        },
        {
            "id": "q3",
            "text": "What is the status of your commercial deployment and long-term viability?",
            "focus": "Agreements, Payment, NPS.",
            "options": [
                {"id": "A", "level": 7, "text": "Multiple paid PoCs are secured and managed, but active payment confirmation and retention metrics are not yet tracked."},
                {"id": "B", "level": 8, "text": "Payment willingness confirmed across a sufficient customer percentage; real buyers identified (B2B); sales maturity processes defined."},
                {"id": "C", "level": 9, "text": "System is proven through sustained commercial operation (6+ months); NPS, support metrics, and renewal rates are actively tracked and optimized."},
            ],
        },
    ],
    "supply_chain": [
        {
            "id": "q1",
            "text": "What is the maturity of your unit cost planning and design for assembly?",
            "focus": "BOM, DFMA, Cost Risk.",
            "options": [
                {"id": "A", "level": 1, "text": "Only high-level feasibility is checked; no detailed BOM or rough cost estimate exists."},
                {"id": "B", "level": 2, "text": "Initial BOM and rough cost estimate are defined (AIR 2)."},
                {"id": "C", "level": 4, "text": "Design for prototyping and assembly (DFMA) review is completed on the integrated prototype (AIR 4)."},
            ],
        },
        {
            "id": "q2",
            "text": "How accurate are your production costs, and what is the status of pilot manufacturing?",
            "focus": "TCO, Vendor Quotes, Pilot Run.",
            "options": [
                {"id": "A", "level": 5, "text": "Prototype is hardened (AIR 5), but final production COGS/TCO is still an estimate."},
                {"id": "B", "level": 6, "text": "Final Costed BOM and TCO model are validated with firm production-volume vendor quotes (AIR 6)."},
                {"id": "C", "level": 7, "text": "Initial pilot manufacturing run (e.g., 5-10 units) is completed using production processes, validating assembly time and quality controls (AIR 7)."},
            ],
        },
        {
            "id": "q3",
            "text": "What is the stability of your supply chain for mass production?",
            "focus": "Contracts, Capacity, Yield.",
            "options": [
                # Source quirk — preserved verbatim. Options A and B both map to
                # AIR 8 in docs/reference/air-framework.md §1 (`supply_chain`
                # Q3); flagged there for ARTPARK content review, not "fixed"
                # here.
                {"id": "A", "level": 8, "text": "Pilot manufacturing results are available, but no long-term supplier contracts (capacity/pricing lock-in) are finalized."},
                {"id": "B", "level": 8, "text": "Final suppliers are locked in with long-term contracts; final Pilot Manufacturing Run is complete, validating yields and test fixtures (AIR 8)."},
                {"id": "C", "level": 9, "text": "Full-scale production is underway with confirmed volume and quality ramp-up; a mature service and spare parts network is established (AIR 9)."},
            ],
        },
    ],
    "reliability": [
        {
            "id": "q1",
            "text": "What is the current maturity of your organizational foundation and accountability?",
            "focus": "Team Setup, Job Definition.",
            "options": [
                {"id": "A", "level": 1, "text": "Core team is onboarded, but work definitions are informal and accountability is often shared/unclear."},
                {"id": "B", "level": 3, "text": "Work definitions are clear, and a formal accountability matrix (RACI) has been established for all AIR 3 activities."},
                {"id": "C", "level": 5, "text": "Clearer job definitions are established across all teams, and formal governance management is in place for external reporting."},
            ],
        },
        {
            "id": "q2",
            "text": "What is the status of your product support infrastructure for customers?",
            "focus": "Manuals, Operational Org.",
            "options": [
                # Source quirk — preserved verbatim. Options A and B both map to
                # AIR 6 in docs/reference/air-framework.md §1 (`reliability`
                # Q2); flagged there for ARTPARK content review, not "fixed"
                # here.
                {"id": "A", "level": 6, "text": "Product is ready for Beta (AIR 6), but no formal maintenance procedures or operational support organization (Org) exist."},
                {"id": "B", "level": 6, "text": "Operational Org is established, and maintenance/troubleshooting guides are drafted."},
                {"id": "C", "level": 7, "text": "On-site support is being actively provided to pilot customers, and the support team is functional and scaling (AIR 7)."},
            ],
        },
        {
            "id": "q3",
            "text": "How mature are your processes for long-term product sustainment and reliability?",
            "focus": "Training, QMS, Optimization.",
            "options": [
                # Source quirk — preserved verbatim. Options A and B both map to
                # AIR 8 in docs/reference/air-framework.md §1 (`reliability`
                # Q3); flagged there for ARTPARK content review, not "fixed"
                # here.
                {"id": "A", "level": 8, "text": "Field Support Plan is being drafted, but formal training for production/support teams is not yet complete."},
                {"id": "B", "level": 8, "text": "Production/support teams are fully trained, and the final Field Support Plan (spares, warranty) is locked down."},
                {"id": "C", "level": 9, "text": "Operational processes demonstrate continuous improvement and team maturity is verified for sustaining long-term commercial operations (AIR 9)."},
            ],
        },
    ],
}

# ── §4 Measurement criteria ─────────────────────────────────────────────────
# lever key → AIR level → list of criteria strings. supply_chain defines
# criteria only at levels 1, 2, 4, 6, 8, 9 in the source — the other levels
# are deliberately left absent, not filled in.
CRITERIA: dict[str, dict[int, list[str]]] = {
    "scientific_principles": {
        1: [
            "Comprehensive literature & patent search: survey papers, patents, standards, prior art.",
            "Identify core scientific principles: physics, kinematics, sensing limits, control theory.",
            "High-level feasibility assessment: energy, computation, sensing limits.",
            "Identify critical knowledge gaps that would block progress.",
        ],
        2: [
            "Develop physics & control models: kinematics, dynamics, control loops, failure-mode assumptions.",
            "Simulate core scenarios (motion, SLAM, grasping) and log results.",
        ],
        3: [
            "Quantitative performance comparison against AIR 2 simulation targets; define Sim-to-Real error margin for key KPIs.",
            "Hardware-in-the-loop tests.",
            "Collect test datasets: sensor logs, video, telemetry.",
        ],
        4: [
            "Basic reliability & MTBF estimation via accelerated or cyclic tests.",
            "Preliminary EMC/EMI checks.",
        ],
        5: [
            "Harden prototype for the relevant environment (sealing, shock/vibration, packaging; Bx samples) and document environmental tolerance ranges.",
            "Field-relevant performance tests.",
            "Stress & corner-case testing.",
        ],
        6: [
            "Run operational scenario demonstrations end-to-end under realistic constraints.",
            "Long-duration reliability tests for MTBF data.",
        ],
        7: [
            "Measure mission-level KPIs: task completion rate, uptime, MTTR, safety incidents.",
            "Operational data collection & telemetry.",
        ],
        8: [
            "Execute full qualification tests: environmental, EMC, safety, functional, performance.",
            "Complete certification testing for intended markets.",
        ],
        9: [
            "Operational monitoring & analytics: SLA monitoring, fleet health telemetry, remote updates.",
            "Ongoing regulatory compliance & reporting.",
        ],
    },
    "architecture": {
        1: [
            "State-of-the-art benchmarking: map competing systems and their capability gaps.",
        ],
        2: [
            "Define system architecture: block diagrams for mechanics, electronics, software.",
            "Identify candidate components with justification.",
            "Specify target use-cases & KPIs (accuracy, payload, speed, uptime, latency, safety).",
        ],
        3: [
            "Build breadboard subsystems.",
            "Implement basic embedded control (drivers, PID loops, safety watchdogs).",
            "Prototype perception pipelines.",
        ],
        4: [
            "Build integrated lab prototype (A/B0 sample).",
            "Integrate middleware & control stack.",
            "Document a system integration & test plan with acceptance criteria.",
        ],
        5: [
            "Define the relevant test environment.",
            "Implement design iterations from field results.",
        ],
        6: [
            "Build pilot-scale prototypes (C sample).",
            "Update cost model and TCO estimates.",
        ],
        7: [
            "Integrate with customer systems.",
            "Run an operator training programme with SOPs.",
        ],
        8: [
            "Finalise production-intent design (mechanical, electrical, software, packaging).",
            "Complete user manuals & technical docs.",
        ],
        9: [
            "Widespread deployment & operations across intended use cases.",
            "Post-deployment enhancements & roadmap.",
        ],
    },
    "qualification": {
        1: [
            "High-level regulatory & ethical scan.",
        ],
        2: [
            "Preliminary hazard list with mitigation ideas.",
        ],
        3: [
            "Implement emergency stop & interlocks, with current/temperature monitoring.",
        ],
        4: [
            "Expanded hazard analysis: detailed hazards, failure modes, mitigations (preliminary HAZOP).",
        ],
        5: [
            "Advanced safety system tests under realistic failure modes.",
            "Begin regulatory and standards mapping.",
        ],
        6: [
            "Third-party safety review and gap analysis.",
            "Begin formal compliance planning for the deployment region.",
        ],
        7: [
            "Operational safety drills & incident response with local teams.",
        ],
        8: [
            "Quality management system readiness: production QA, change control, traceability.",
        ],
        9: [
            "Operational cybersecurity & patch management: secure updates, vulnerability management, incident response.",
        ],
    },
    "user_needs": {
        1: [
            "Build hypothesis: problem/need assessed, existing solutions checked, market opportunity hypothesised.",
            "Application heatmap with numerical weightage.",
        ],
        2: [
            "Secondary market research to baseline data.",
            "Customer problem statements (segment, problem, impact).",
            "High-level solution view integrated with the usage environment.",
        ],
        3: [
            "Initiated customer discovery: primary interviews defining personas and prioritised needs.",
            "Initial customer/market requirements baselined.",
            "Competitor benchmarking and solution uniqueness.",
        ],
        4: [
            "Feedback established with several possible customers (5-10 B2B, 10-20 B2C).",
            "Problem importance confirmed by multiple users.",
            "Value hypothesis articulated and business case documented.",
        ],
        5: [
            "Product-market fit established with multiple customer relationships.",
            "Initial customer willing to give a first MoU / paid PoC.",
        ],
        6: [
            "Value and benefits confirmed by customer testing.",
            "Key value-chain partnerships formed.",
            "Initial business model & sales strategy developed.",
        ],
        7: [
            "Signed customer agreements (sales / paid PoCs).",
            "First sales or test sales.",
            "Multiple paid PoCs managed with configuration, validation and feedback.",
        ],
        8: [
            "Payment confirmed from a sufficient share of initial customers.",
            "Real buyers and decision-makers identified.",
            "Sales model standardised; CRM deployed.",
        ],
        9: [
            "Business model & TCO validated in the field.",
            "Customer satisfaction & retention tracked (NPS, support metrics, renewals).",
        ],
    },
    "supply_chain": {
        1: [
            "High-level feasibility assessment including energy, computation and sensing limits.",
        ],
        2: [
            "Initial BOM & cost estimate with cost drivers.",
        ],
        4: [
            "Design for prototyping & assembly review of prototype components.",
        ],
        6: [
            "Preliminary supply chain & vendor sourcing, identifying long-lead items and alternates.",
            "Update cost model and TCO estimates.",
        ],
        8: [
            "Pilot manufacturing run validating assembly, yields and test fixtures.",
            "Finalise suppliers & contracts with capacity commitments.",
        ],
        9: [
            "Full-scale production ramp at planned volumes with quality.",
            "Mature service & spare-parts network with RMA processes.",
        ],
    },
    "reliability": {
        1: [
            "Team onboarded and functional per the Team_Needs sheet.",
        ],
        2: [
            "Team performing the activity needed to support the stage gate.",
        ],
        3: [
            "Work definitions started; accountability clear even across multiple roles.",
        ],
        4: [
            "Refined work definitions with non-overlapping areas covered.",
        ],
        5: [
            "Clearer job definitions; accountability, engagement and governance management established.",
        ],
        6: [
            "Develop maintenance & troubleshooting procedures, manuals and spare-parts lists.",
            "Operational organisation with clear ownership and contracts.",
        ],
        7: [
            "On-site support & monitoring with engineers available for debugging.",
            "Implement field-driven fixes with rapid patch cycles.",
        ],
        8: [
            "Train production & support teams.",
            "Field support & logistics plan: spares, service network, warranty policies.",
        ],
        9: [
            "Executive review of programme health and scaling strategy.",
        ],
    },
}

# ── §3 Qualifying documents ──────────────────────────────────────────────
# lever key → AIR level → required document label. supply_chain has no
# document defined at AIR 1, 3, 5 or 7; reliability has none at AIR 2 or 4.
# These gaps are deliberate — see required_document() for the fallback rule.
DOCUMENTS: dict[str, dict[int, str]] = {
    "scientific_principles": {
        1: "Research & Feasibility Report",
        2: "Simulation Report",
        3: "Lab Validation Report",
        4: "Reliability & EMC Report",
        5: "Field Readiness Report",
        6: "Operational Demo Logs",
        7: "Pilot Performance Dashboard",
        8: "Compliance Package",
        9: "Sustained Ops Report",
    },
    "architecture": {
        1: "Competitor Analysis Report",
        2: "System Architecture Document",
        3: "Subsystem Test Videos",
        4: "Integration Test Plan & Report",
        5: "Design Iteration Log",
        6: "Pilot Build Report",
        7: "Training Manuals",
        8: "Design Freeze Package",
        9: "Product Roadmap",
    },
    "qualification": {
        1: "Regulatory Scan Memo",
        2: "Preliminary Hazard List",
        3: "Safety Demo Video",
        4: "Draft HAZOP/FMEA",
        5: "Standards Mapping Document",
        6: "3rd Party Safety Review",
        7: "Incident Response Plan",
        8: "QMS Manual",
        9: "Cybersecurity Audit Log",
    },
    "user_needs": {
        1: "Hypothesis Brief",
        2: "Market Research Report",
        3: "Customer Discovery Log",
        4: "Value Proposition Canvas",
        5: "Signed MoU / PoC Agreement",
        6: "Pilot Test Plan & Sales Strategy",
        7: "Executed Customer Contracts",
        8: "Sales Pipeline Report",
        9: "ROI & Retention Dashboard",
    },
    "supply_chain": {
        2: "Draft BOM",
        4: "DFMA Report",
        6: "Sourcing Plan & TCO Model",
        8: "Pilot Run Report",
        9: "Production Dashboard",
    },
    "reliability": {
        1: "Team Roster",
        3: "Org Chart & RACI",
        5: "Governance Structure",
        6: "Maintenance Manual Draft",
        7: "Support Log",
        8: "Training Records",
        9: "Program Health Report",
    },
}


def question_max(lever: str, q_id: str) -> int:
    """Highest AIR level obtainable on one question. The ladder rule in
    air_scoring depends on this, which is why it is derived from the options
    rather than written down twice.

    Fails closed on an unrecognised (lever, q_id): the ladder rule reads
    `got < question_max(...)` to decide whether a question was answered at
    its own maximum, i.e. whether the gate is satisfied. Returning 0 for an
    unknown question — the previous behaviour — makes any real answer
    (level >= 1) look like it is "at max", which *satisfies* the gate
    instead of blocking it: the one case that must never silently pass. So
    an unknown question raises rather than returning a value the ladder
    could compare against.
    """
    for q in QUESTIONS.get(lever, []):
        if q["id"] == q_id:
            return max(o["level"] for o in q["options"])
    raise KeyError(f"no such question: {lever}/{q_id}")


def level_for_option(lever: str, q_id: str, option_id: str) -> int | None:
    for q in QUESTIONS.get(lever, []):
        if q["id"] == q_id:
            for o in q["options"]:
                if o["id"] == option_id:
                    return o["level"]
    return None


def required_document(lever: str, level: int) -> str | None:
    """The document to upload for a claimed level.

    The source defines no document at some levels of supply_chain and
    reliability. Rather than invent one, fall back to the highest defined
    level at or below the claim — the founder is asked for evidence they
    should already have. Returns None only where nothing is defined below.
    """
    defined = DOCUMENTS.get(lever, {})
    candidates = [lv for lv in defined if lv <= level]
    return defined[max(candidates)] if candidates else None


def criteria_for(lever: str, level: int) -> list[str]:
    return list(CRITERIA.get(lever, {}).get(level, []))
