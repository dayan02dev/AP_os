# ARTPARK Innovation Readiness (AIR) — framework source

Source of truth for `backend/app/services/air_catalog.py`. Transcribed from the
ARTPARK AIR brief. **Nothing here is invented** — where the source has a quirk
(two options mapping to the same level, a lever with no document defined at some
levels) it is preserved and flagged rather than smoothed over.

AIR integrates the traditional Technology Readiness Level (TRL) with Commercial
Readiness Levels (CRL) plus operational checks, across six transversal levers in
two families.

| Family | Lever key | Name |
|---|---|---|
| Technology / R&D | `scientific_principles` | Scientific Principles & Models |
| Technology / R&D | `architecture` | Architecture & System Definition |
| Technology / R&D | `qualification` | Qualification & Final Design |
| Product / Engineering (CRL) | `user_needs` | User Needs & Requirements |
| Product / Engineering (CRL) | `supply_chain` | Supply Chain & Manufacturing |
| Product / Engineering (CRL) | `reliability` | Reliability & Maintainability |

---

## 1. Self-assessment questions

18 questions — three per lever. Every option maps to one AIR level. The three
questions per lever are **progressive bands**, which is what makes the ladder
rule in §2 necessary.

### `scientific_principles`

**Q1 — How well documented and verified are the core scientific principles of your technology?**
*Focus: Physics, Literature, Prior Art, Feasibility Scan.*

| Opt | Text | AIR |
|---|---|---|
| A | Principles are based only on a high-level idea; no formal literature review or IP scan completed. | 1 |
| B | Comprehensive literature/patent search is complete; core scientific principles are formally documented, and a high-level feasibility scan is done. | 2 |
| C | All critical knowledge gaps have been identified, and initial lab tests have successfully demonstrated POC viability. | 3 |

**Q2 — What is the current maturity of your system's prediction and control models?**
*Focus: Modeling, Simulation, HIL Validation.*

| Opt | Text | AIR |
|---|---|---|
| A | Models are defined in concept only; detailed physics/control models are not yet built or simulated. | 2 |
| B | Models are built, simulations of core scenarios are running, and Hardware-in-the-Loop (HIL) tests have been successfully integrated. | 3 |
| C | Quantitative prototype performance consistently compares against AIR 2 simulation targets, and deviations are understood and documented. | 4 |
| D | The integrated prototype's performance matches the models even in realistic, simulated field conditions (AIR 5: Field Test completed). | 5 |

**Q3 — What is the status of system reliability data and operational qualification?**
*Focus: MTBF, Qualification, Sustained KPIs.*

| Opt | Text | AIR |
|---|---|---|
| A | Prototype is functional in the relevant environment (AIR 5), but long-duration MTBF data collection in an operational demonstration has not yet begun. | 5 |
| B | Prototypes have completed end-to-end operational scenario demonstrations and collected initial long-duration MTBF data in a relevant environment. | 6 |
| C | System-level performance (Task completion rate, uptime) is being measured and reported with real-time telemetry from a live operational pilot (AIR 7). | 7 |
| D | Full Qualification Tests are complete, and final performance benchmarks met using production tooling (formally qualified). | 8 |
| E | System is proven through sustained commercial operation (6+ months); SLA monitoring, fleet health, and remote optimization are fully operational. | 9 |

### `architecture`

**Q1 — What is the current status of your core system architecture and control?**
*Focus: Architecture, Functional Blocks.*

| Opt | Text | AIR |
|---|---|---|
| A | Only high-level functional concepts exist; no formal block diagrams or component lists are complete. | 1 |
| B | High-level system architecture and functional decomposition are defined; candidate components are selected and justified. | 2 |
| C | Basic embedded control systems are implemented and validated on breadboards (e.g., actuator control, safety loops). | 3 |

**Q2 — How complete and tested is your integrated system prototype (hardware and software stack)?**
*Focus: Integration, A/B0 Sample.*

| Opt | Text | AIR |
|---|---|---|
| A | Subsystems are built, but the entire hardware/software stack has not been integrated into a stable A/B0 prototype. | 3 |
| B | Integrated A/B0 lab prototype built and the full middleware/control stack operates stably in a lab environment. | 4 |
| C | System tested in a relevant simulated environment, and all field-driven design iterations (e.g., Bx sample) are implemented. | 5 |

**Q3 — What is the status of your design documentation for manufacturing and customer support?**
*Focus: Design Freeze, Documentation.*

| Opt | Text | AIR |
|---|---|---|
| A | Pilot-scale prototypes (C samples) are built, but final production documentation (manuals, final drawings) is not yet complete. | 6 |
| B | Pilot unit successfully integrated into the customer's operational flow; final maintenance and user documentation has been completed and is ready for publishing. | 7 |
| C | Final mechanical/electrical/software design is locked for production (frozen); final user manuals and technical documents are formally released. | 8 |
| D | System is deployed widely; post-deployment enhancements and long-term obsolescence management roadmaps are actively managed. | 9 |

### `qualification`

**Q1 — What is the status of your initial risk assessment and basic safety implementation?**
*Focus: Hazards, Regulatory Scan.*

| Opt | Text | AIR |
|---|---|---|
| A | No regulatory scan or preliminary hazard list is completed. | 1 |
| B | Regulatory scan and preliminary hazard list are documented; basic E-stop/interlock design is defined. | 2 |
| C | Physical E-stop and software interlocks are implemented and successfully demonstrated on the AIR 3 prototype. | 3 |

**Q2 — How rigorous is your system-level hazard analysis and safety testing?**
*Focus: FMEA, Standards Mapping.*

| Opt | Text | AIR |
|---|---|---|
| A | Only basic hazard identification is done; no expanded HAZOP/FMEA completed on the integrated system. | 3 |
| B | Expanded hazard analysis (HAZOP/FMEA) is completed on the integrated system (AIR 4). | 4 |
| C | Design is mapped against all required standards, and advanced safety tests (e.g., failure modes) are completed in the relevant environment. | 5 |

**Q3 — What is the status of official product certification and quality system readiness?**
*Focus: External Testing, QMS.*

| Opt | Text | AIR |
|---|---|---|
| A | Third-party safety review is completed, but external compliance testing has not yet begun. | 6 |
| B | External certification tests are initiated/substantially completed; operational safety drills and incident response plans are documented (AIR 7). | 7 |
| C | Full, independent certification (e.g., CE, FCC, UL) is obtained, and the Quality Management System (QMS) is audited and ready for production. | 8 |
| D | System is deployed widely; ongoing regulatory compliance reporting and operational cybersecurity patch management are fully active. | 9 |

### `user_needs`

**Q1 — What is the current status of your problem validation and requirement baselining?**
*Focus: Problem, Stakeholder, Requirements.*

| Opt | Text | AIR |
|---|---|---|
| A | Problem is defined but based only on high-level ideas; no expert or secondary research review is complete. | 1 |
| B | Secondary market research is complete, and a clear problem/stakeholder map is defined. | 2 |
| C | Primary discovery is complete; initial customer requirements are finalized and baselined for development. | 3 |

**Q2 — How well is your product hypothesis validated by customers and commercial strategy?**
*Focus: Hypothesis, Paid PoC, Sales Plan.*

| Opt | Text | AIR |
|---|---|---|
| A | Problem is confirmed by multiple customers, but the product hypothesis and value proposition are still speculative. | 4 |
| B | Initial Paid PoC agreement is secured, and high-fidelity prototype usage confirms product-market fit. | 5 |
| C | Value and benefits confirmed during customer testing; initial business model and sales process roadmap are documented. | 6 |

**Q3 — What is the status of your commercial deployment and long-term viability?**
*Focus: Agreements, Payment, NPS.*

| Opt | Text | AIR |
|---|---|---|
| A | Multiple paid PoCs are secured and managed, but active payment confirmation and retention metrics are not yet tracked. | 7 |
| B | Payment willingness confirmed across a sufficient customer percentage; real buyers identified (B2B); sales maturity processes defined. | 8 |
| C | System is proven through sustained commercial operation (6+ months); NPS, support metrics, and renewal rates are actively tracked and optimized. | 9 |

### `supply_chain`

**Q1 — What is the maturity of your unit cost planning and design for assembly?**
*Focus: BOM, DFMA, Cost Risk.*

| Opt | Text | AIR |
|---|---|---|
| A | Only high-level feasibility is checked; no detailed BOM or rough cost estimate exists. | 1 |
| B | Initial BOM and rough cost estimate are defined (AIR 2). | 2 |
| C | Design for prototyping and assembly (DFMA) review is completed on the integrated prototype (AIR 4). | 4 |

**Q2 — How accurate are your production costs, and what is the status of pilot manufacturing?**
*Focus: TCO, Vendor Quotes, Pilot Run.*

| Opt | Text | AIR |
|---|---|---|
| A | Prototype is hardened (AIR 5), but final production COGS/TCO is still an estimate. | 5 |
| B | Final Costed BOM and TCO model are validated with firm production-volume vendor quotes (AIR 6). | 6 |
| C | Initial pilot manufacturing run (e.g., 5-10 units) is completed using production processes, validating assembly time and quality controls (AIR 7). | 7 |

**Q3 — What is the stability of your supply chain for mass production?**
*Focus: Contracts, Capacity, Yield.*

| Opt | Text | AIR |
|---|---|---|
| A | Pilot manufacturing results are available, but no long-term supplier contracts (capacity/pricing lock-in) are finalized. | 8 |
| B | Final suppliers are locked in with long-term contracts; final Pilot Manufacturing Run is complete, validating yields and test fixtures (AIR 8). | 8 |
| C | Full-scale production is underway with confirmed volume and quality ramp-up; a mature service and spare parts network is established (AIR 9). | 9 |

> **Source quirk — preserved.** Q3 options A and B both map to AIR 8. Kept as
> two distinct options because they describe genuinely different states
> (results available vs. contracts locked). Flagged for ARTPARK content review.

### `reliability`

**Q1 — What is the current maturity of your organizational foundation and accountability?**
*Focus: Team Setup, Job Definition.*

| Opt | Text | AIR |
|---|---|---|
| A | Core team is onboarded, but work definitions are informal and accountability is often shared/unclear. | 1 |
| B | Work definitions are clear, and a formal accountability matrix (RACI) has been established for all AIR 3 activities. | 3 |
| C | Clearer job definitions are established across all teams, and formal governance management is in place for external reporting. | 5 |

**Q2 — What is the status of your product support infrastructure for customers?**
*Focus: Manuals, Operational Org.*

| Opt | Text | AIR |
|---|---|---|
| A | Product is ready for Beta (AIR 6), but no formal maintenance procedures or operational support organization (Org) exist. | 6 |
| B | Operational Org is established, and maintenance/troubleshooting guides are drafted. | 6 |
| C | On-site support is being actively provided to pilot customers, and the support team is functional and scaling (AIR 7). | 7 |

**Q3 — How mature are your processes for long-term product sustainment and reliability?**
*Focus: Training, QMS, Optimization.*

| Opt | Text | AIR |
|---|---|---|
| A | Field Support Plan is being drafted, but formal training for production/support teams is not yet complete. | 8 |
| B | Production/support teams are fully trained, and the final Field Support Plan (spares, warranty) is locked down. | 8 |
| C | Operational processes demonstrate continuous improvement and team maturity is verified for sustaining long-term commercial operations (AIR 9). | 9 |

> **Source quirks — preserved.** Q2 options A and B both map to AIR 6, and Q3
> options A and B both map to AIR 8. Kept as distinct options. Flagged for
> ARTPARK content review.

---

## 2. Scoring rules

**R1 — Option to level.** Each option maps to its stated AIR level, per §1.

**R2 — Lever level is a ladder, not a max.** Walk a lever's questions in order.
A question may only lift the lever's level if the preceding question is answered
at its *own maximum*:

```
level = level_of(q1)
if q1 is at max(q1):  level = max(level, level_of(q2))
if q2 is at max(q2):  level = max(level, level_of(q3))
```

Because the bands overlap, a plain `max()` would let a venture claim AIR 7 on Q3
while admitting AIR 1 on Q1. A stage-gate framework must not permit skipping a
gate. An unanswered question contributes nothing and stops the ladder.

Per-question maxima (derived from §1, and asserted by the tests):

| Lever | Q1 max | Q2 max | Q3 max |
|---|---|---|---|
| `scientific_principles` | 3 | 5 | 9 |
| `architecture` | 3 | 5 | 9 |
| `qualification` | 3 | 5 | 9 |
| `user_needs` | 3 | 6 | 9 |
| `supply_chain` | 4 | 7 | 9 |
| `reliability` | 5 | 7 | 9 |

**R3 — Rollups.**

```
technology_air = min(scientific_principles, architecture, qualification)
commercial_air = min(user_needs, supply_chain, reliability)
overall_air    = min(all six)
```

A venture is only as mature as its weakest lever. Technology and Commercial are
surfaced separately because that TRL-plus-CRL split is what AIR exists to express.

**R4 — Claimed vs verified.** Every level exists twice: computed from the
founder's answers (`claimed`) and as recorded by an ARTPARK verifier
(`verified`). Rollups are computed independently over each set. A rollup over a
set with any lever unscored is `None`, not a partial minimum.

---

## 3. Qualifying documents

The document a founder must upload for the level they claim on each lever.

| AIR | `scientific_principles` | `architecture` | `qualification` | `user_needs` | `supply_chain` | `reliability` |
|---|---|---|---|---|---|---|
| 1 | Research & Feasibility Report | Competitor Analysis Report | Regulatory Scan Memo | Hypothesis Brief | — | Team Roster |
| 2 | Simulation Report | System Architecture Document | Preliminary Hazard List | Market Research Report | Draft BOM | — |
| 3 | Lab Validation Report | Subsystem Test Videos | Safety Demo Video | Customer Discovery Log | — | Org Chart & RACI |
| 4 | Reliability & EMC Report | Integration Test Plan & Report | Draft HAZOP/FMEA | Value Proposition Canvas | DFMA Report | — |
| 5 | Field Readiness Report | Design Iteration Log | Standards Mapping Document | Signed MoU / PoC Agreement | — | Governance Structure |
| 6 | Operational Demo Logs | Pilot Build Report | 3rd Party Safety Review | Pilot Test Plan & Sales Strategy | Sourcing Plan & TCO Model | Maintenance Manual Draft |
| 7 | Pilot Performance Dashboard | Training Manuals | Incident Response Plan | Executed Customer Contracts | — | Support Log |
| 8 | Compliance Package | Design Freeze Package | QMS Manual | Sales Pipeline Report | Pilot Run Report | Training Records |
| 9 | Sustained Ops Report | Product Roadmap | Cybersecurity Audit Log | ROI & Retention Dashboard | Production Dashboard | Program Health Report |

> **Gaps are real.** `supply_chain` defines no document at AIR 1, 3, 5 or 7, and
> `reliability` none at AIR 2 or 4 — the source simply does not specify one.
> **Resolution rule:** when a claimed level has no document defined, require the
> document from the highest defined level at or below it; if none exists at or
> below (only `supply_chain` at AIR 1), require none. This is a derived rule, not
> from the source — it is the smallest rule that never invents a document.

---

## 4. Measurement criteria

The specific checks behind each (lever, level). The founder ticks the criteria
for the level their answers produce — roughly three checks, not all of these.

### `scientific_principles`
- **1** — Comprehensive literature & patent search: survey papers, patents, standards, prior art. · Identify core scientific principles: physics, kinematics, sensing limits, control theory. · High-level feasibility assessment: energy, computation, sensing limits. · Identify critical knowledge gaps that would block progress.
- **2** — Develop physics & control models: kinematics, dynamics, control loops, failure-mode assumptions. · Simulate core scenarios (motion, SLAM, grasping) and log results.
- **3** — Quantitative performance comparison against AIR 2 simulation targets; define Sim-to-Real error margin for key KPIs. · Hardware-in-the-loop tests. · Collect test datasets: sensor logs, video, telemetry.
- **4** — Basic reliability & MTBF estimation via accelerated or cyclic tests. · Preliminary EMC/EMI checks.
- **5** — Harden prototype for the relevant environment (sealing, shock/vibration, packaging; Bx samples) and document environmental tolerance ranges. · Field-relevant performance tests. · Stress & corner-case testing.
- **6** — Run operational scenario demonstrations end-to-end under realistic constraints. · Long-duration reliability tests for MTBF data.
- **7** — Measure mission-level KPIs: task completion rate, uptime, MTTR, safety incidents. · Operational data collection & telemetry.
- **8** — Execute full qualification tests: environmental, EMC, safety, functional, performance. · Complete certification testing for intended markets.
- **9** — Operational monitoring & analytics: SLA monitoring, fleet health telemetry, remote updates. · Ongoing regulatory compliance & reporting.

### `architecture`
- **1** — State-of-the-art benchmarking: map competing systems and their capability gaps.
- **2** — Define system architecture: block diagrams for mechanics, electronics, software. · Identify candidate components with justification. · Specify target use-cases & KPIs (accuracy, payload, speed, uptime, latency, safety).
- **3** — Build breadboard subsystems. · Implement basic embedded control (drivers, PID loops, safety watchdogs). · Prototype perception pipelines.
- **4** — Build integrated lab prototype (A/B0 sample). · Integrate middleware & control stack. · Document a system integration & test plan with acceptance criteria.
- **5** — Define the relevant test environment. · Implement design iterations from field results.
- **6** — Build pilot-scale prototypes (C sample). · Update cost model and TCO estimates.
- **7** — Integrate with customer systems. · Run an operator training programme with SOPs.
- **8** — Finalise production-intent design (mechanical, electrical, software, packaging). · Complete user manuals & technical docs.
- **9** — Widespread deployment & operations across intended use cases. · Post-deployment enhancements & roadmap.

### `qualification`
- **1** — High-level regulatory & ethical scan.
- **2** — Preliminary hazard list with mitigation ideas.
- **3** — Implement emergency stop & interlocks, with current/temperature monitoring.
- **4** — Expanded hazard analysis: detailed hazards, failure modes, mitigations (preliminary HAZOP).
- **5** — Advanced safety system tests under realistic failure modes. · Begin regulatory and standards mapping.
- **6** — Third-party safety review and gap analysis. · Begin formal compliance planning for the deployment region.
- **7** — Operational safety drills & incident response with local teams.
- **8** — Quality management system readiness: production QA, change control, traceability.
- **9** — Operational cybersecurity & patch management: secure updates, vulnerability management, incident response.

### `user_needs`
- **1** — Build hypothesis: problem/need assessed, existing solutions checked, market opportunity hypothesised. · Application heatmap with numerical weightage.
- **2** — Secondary market research to baseline data. · Customer problem statements (segment, problem, impact). · High-level solution view integrated with the usage environment.
- **3** — Initiated customer discovery: primary interviews defining personas and prioritised needs. · Initial customer/market requirements baselined. · Competitor benchmarking and solution uniqueness.
- **4** — Feedback established with several possible customers (5-10 B2B, 10-20 B2C). · Problem importance confirmed by multiple users. · Value hypothesis articulated and business case documented.
- **5** — Product-market fit established with multiple customer relationships. · Initial customer willing to give a first MoU / paid PoC.
- **6** — Value and benefits confirmed by customer testing. · Key value-chain partnerships formed. · Initial business model & sales strategy developed.
- **7** — Signed customer agreements (sales / paid PoCs). · First sales or test sales. · Multiple paid PoCs managed with configuration, validation and feedback.
- **8** — Payment confirmed from a sufficient share of initial customers. · Real buyers and decision-makers identified. · Sales model standardised; CRM deployed.
- **9** — Business model & TCO validated in the field. · Customer satisfaction & retention tracked (NPS, support metrics, renewals).

### `supply_chain`
- **1** — High-level feasibility assessment including energy, computation and sensing limits.
- **2** — Initial BOM & cost estimate with cost drivers.
- **4** — Design for prototyping & assembly review of prototype components.
- **6** — Preliminary supply chain & vendor sourcing, identifying long-lead items and alternates. · Update cost model and TCO estimates.
- **8** — Pilot manufacturing run validating assembly, yields and test fixtures. · Finalise suppliers & contracts with capacity commitments.
- **9** — Full-scale production ramp at planned volumes with quality. · Mature service & spare-parts network with RMA processes.

### `reliability`
- **1** — Team onboarded and functional per the Team_Needs sheet.
- **2** — Team performing the activity needed to support the stage gate.
- **3** — Work definitions started; accountability clear even across multiple roles.
- **4** — Refined work definitions with non-overlapping areas covered.
- **5** — Clearer job definitions; accountability, engagement and governance management established.
- **6** — Develop maintenance & troubleshooting procedures, manuals and spare-parts lists. · Operational organisation with clear ownership and contracts.
- **7** — On-site support & monitoring with engineers available for debugging. · Implement field-driven fixes with rapid patch cycles.
- **8** — Train production & support teams. · Field support & logistics plan: spares, service network, warranty policies.
- **9** — Executive review of programme health and scaling strategy.
