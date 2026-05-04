// SipMarketingPage — React port of "ARTPARK SIP.html". Lives at /sip.
//
// All copy ported verbatim from the Remix design (₹2 Cr equity, 12-18mo,
// TRL 4→7, 31 May close, 1 Aug cohort, etc.). Uses violet accents via the
// .programs-page wrapper plus a `programs-sip` modifier that swaps
// --programs-accent to violet. Final CTA links to /apply-sip/signup?track=sip.

export default function SipMarketingPage() {
  return (
    <div className="programs-page programs-sip">
      <header className="programs-header">
        <div className="programs-header-inner">
          <a href="/" className="programs-lockup">
            <img
              className="programs-iisc"
              src="/assets/iisc-logo-blue.png"
              alt="Indian Institute of Science"
            />
            <img src="/assets/artpark-logo.png" alt="ARTPARK" />
          </a>
          <nav className="programs-nav">
            <a href="/" className="programs-nav-link">
              ← Programs
            </a>
            <a
              href="/apply/signin"
              className="programs-nav-returning"
              title="Resume an existing application"
            >
              <span className="programs-nav-returning-eyebrow">
                Returning user
              </span>
              <span className="programs-nav-returning-cta">Sign in →</span>
            </a>
            <a
              href="/apply-sip/signup?track=sip"
              className="programs-btn programs-btn-primary"
            >
              Apply now <span>→</span>
            </a>
          </nav>
        </div>
      </header>

      <section className="programs-sip-hero">
        <div className="programs-sip-hero-inner">
          <span className="programs-eyebrow">
            <span className="programs-eyebrow-dot" />
            SIP 2026 · Applications open
          </span>
          <h1 className="programs-sip-h1">
            Capital and conviction for{" "}
            <span className="programs-hl">deep-tech startups</span> ready to{" "}
            <span className="programs-accent-color">scale.</span>
          </h1>
          <p className="programs-sip-lede">
            The <strong>Startup Incubation Program</strong> at ARTPARK invests
            in incorporated deep-tech startups in AI, robotics, novel
            materials, sensors, and cyber-physical systems — with up to{" "}
            <strong>₹2 Cr</strong> in direct equity investment, IISc-anchored
            infrastructure, and a path to follow-on capital.
          </p>
          <div className="programs-sip-cta-row">
            <a
              href="/apply-sip/signup?track=sip"
              className="programs-btn programs-btn-primary"
            >
              Apply now <span>→</span>
            </a>
            <a href="#program" className="programs-btn programs-btn-ghost">
              Learn more
            </a>
          </div>
          <div className="programs-sip-deadline">
            <DeadlineItem label="Applications close" val="31 May 2026" />
            <DeadlineItem label="Cohort begins" val="1 Aug 2026" />
            <DeadlineItem label="Program length" val="12–18 months" />
          </div>
        </div>
      </section>

      <section className="programs-sip-stats">
        <div className="programs-sip-stats-inner">
          <Stat
            val="₹2 Cr"
            label="direct equity investment"
            sub="Up to ₹2 Cr in seed-stage capital, sized to the round and your milestones."
          />
          <Stat
            val="12–18mo"
            label="incubation period"
            sub="Structured support from term sheet through scale-up and follow-on rounds."
          />
          <Stat
            val="34"
            label="companies incubated"
            sub="Since 2020 — cumulative valuation exceeding ₹1,300 Cr."
          />
          <Stat
            val="TRL 4→7"
            label="target trajectory"
            sub="From ARTPARK-demonstrated to field-deployed with paying customers."
          />
        </div>
      </section>

      <section id="program" className="programs-sip-block">
        <BlockHead
          eyebrow="What you get"
          title={
            <>
              Capital, infrastructure, and a network built for{" "}
              <em className="programs-em">deep-tech scale-up</em>.
            </>
          }
        />
        <div className="programs-sip-get-grid">
          <GetCard
            num="01 — Capital"
            title="Up to ₹2 Cr direct investment"
            body="Seed-stage equity investment, sized to your round and structured around milestones. Standard term sheets; clear path to follow-on rounds via ARTPARK's investor network."
          />
          <GetCard
            num="02 — Infrastructure"
            title="ARTPARK labs & IISc access"
            body="Dedicated workspace at ARTPARK with access to robotics, AI, sensor, and manufacturing facilities. Co-location with IISc research groups and industry partners."
          />
          <GetCard
            num="03 — Mentorship"
            title="Operator + investor network"
            body="Ongoing engagement with founders-in-residence, sector operators, and ARTPARK's investor and customer network — focused on go-to-market, hiring, and commercial deployment."
          />
          <GetCard
            num="04 — Customer access"
            title="Pilots & deployment partners"
            body="Warm introductions to enterprise, government, and public-sector pilots in manufacturing, health, agriculture, mobility, and defense — sectors where ARTPARK has active deployment partnerships."
          />
          <GetCard
            num="05 — Follow-on capital"
            title="Series-A pathway"
            body="Structured introductions to ARTPARK's syndicate of deep-tech investors at the right stage. Demo-day showcase to a curated investor and customer audience."
          />
          <GetCard
            num="06 — Outcomes"
            title="TRL 4 → TRL 7"
            body="From ARTPARK-demonstrated technology to field-deployed product with paying customers, scaled team, and the operational maturity to raise a Series A."
          />
        </div>
      </section>

      <section id="timeline" className="programs-sip-timeline-block">
        <div className="programs-sip-timeline-inner">
          <BlockHead
            eyebrow="Timeline"
            title="From application to term sheet, in five clear steps."
          />
          <div className="programs-sip-timeline">
            <TlStep
              active
              num="01"
              date="4 May — 31 May"
              title="Application window"
              body="Submit application with deck, demo, and cap table. Closes 31 May 2026, 5pm IST."
            />
            <TlStep
              num="02"
              date="15 Jun 2026"
              title="Shortlist & first call"
              body="Selected startups invited for an introductory call with the ARTPARK investment team."
            />
            <TlStep
              num="03"
              date="Jun — Jul 2026"
              title="Diligence & pitch"
              body="Technical, commercial, and team diligence. Pitch to the SIP investment committee."
            />
            <TlStep
              num="04"
              date="1 Aug 2026"
              title="Term sheet & onboarding"
              body="Term sheet issued to selected startups. Onboarding into ARTPARK facilities."
            />
            <TlStep
              num="05"
              date="2027 — 2028"
              title="Scale & demo day"
              body="Quarterly milestones, pilot deployments, and demo day to follow-on investors."
            />
          </div>
        </div>
      </section>

      <section className="programs-sip-block">
        <BlockHead
          eyebrow="Who should apply"
          title="Built for incorporated deep-tech startups with a working prototype."
        />
        <div className="programs-sip-who-grid">
          <div className="programs-sip-who-card programs-sip-who-do">
            <h3>We're looking for</h3>
            <ul>
              <li>Indian-registered private limited companies (DPIIT recognition preferred)</li>
              <li>A working prototype at TRL 4 or above with demonstrated technical differentiation</li>
              <li>Founding team of 2–4 with complementary technical, domain, and commercial skills</li>
              <li>Deep-tech in AI, robotics, novel materials, sensors, mechatronics, or cyber-physical systems</li>
              <li>Clear early signals of product-market fit — pilots, LOIs, design partners, or initial revenue</li>
              <li>Applications to manufacturing, space, health, agriculture, mobility, or defense</li>
              <li>Founders willing to operate primarily out of ARTPARK / IISc Bangalore for the cohort period</li>
            </ul>
          </div>
          <div className="programs-sip-who-card programs-sip-who-dont">
            <h3>Not a fit if</h3>
            <ul>
              <li>You haven't yet incorporated — apply to <a href="/tir">TIR</a> instead</li>
              <li>Your technology is below TRL 4 (no working prototype yet)</li>
              <li>Your innovation is incremental or primarily software-only (pure SaaS, consumer apps)</li>
              <li>You've already raised a priced Series A or beyond</li>
              <li>You can't commit to a primary presence at ARTPARK / IISc Bangalore for the program period</li>
              <li>Your cap table is materially encumbered (ESOP-heavy, complex prior rounds, IP held externally)</li>
            </ul>
          </div>
        </div>
      </section>

      <section id="terms" className="programs-sip-terms-block">
        <div className="programs-sip-terms-inner">
          <BlockHead
            eyebrow="Terms in brief"
            title="Clear terms, no surprises."
          />
          <div className="programs-sip-terms-list">
            <Term k="Investment size" v={<>Up to ₹2 Cr direct equity</>} hl />
            <Term k="Equity range" v={<>Negotiated per round, typical seed dilution</>} hl />
            <Term k="Instrument" v="CCPS or priced equity, on standard terms" />
            <Term k="Disbursal" v="Tranched against agreed milestones" />
            <Term k="Program duration" v="12–18 months active incubation" />
            <Term k="Team requirement" v="2–4 founders, registered Indian entity" />
            <Term k="IP ownership" v="Startup retains all IP; standard investor rights" />
            <Term k="Space" v="Dedicated workspace at ARTPARK (1% equity allocation)" />
            <Term k="Commitment" v="Primary operations at ARTPARK / IISc Bangalore" />
            <Term k="TRL trajectory" v="TRL 4 (demonstrated) → TRL 7 (deployed)" />
          </div>
          <p className="programs-sip-terms-fine">
            <strong>How the investment works:</strong> SIP makes a direct
            equity investment of up to ₹2 Cr at standard seed-stage terms.
            Indicative dilution is 1% per ₹50L of investment, plus 1%
            allocation for ARTPARK workspace and infrastructure access.
            Disbursal is tranched against agreed technical and commercial
            milestones. Detailed term sheets are issued only to startups that
            clear diligence and the investment committee.
          </p>
        </div>
      </section>

      <section id="faq" className="programs-sip-faq-block">
        <div className="programs-sip-faq-inner">
          <BlockHead eyebrow="FAQ" title="Common questions." />
          <FAQ
            open
            q="What's the minimum stage I need to apply?"
            a={
              <>
                SIP is for <strong>incorporated Indian startups</strong> with
                a working prototype at <strong>TRL 4 or above</strong>, a
                founding team of 2–4, and early signals of product-market fit
                (pilots, LOIs, design partners, or initial revenue). If
                you're pre-incorporation or your tech is below TRL 4, apply
                to <a href="/tir">TIR</a> instead.
              </>
            }
          />
          <FAQ
            q="How is the investment structured?"
            a="SIP makes a direct equity investment of up to ₹2 Cr, typically through CCPS or priced equity on standard seed-stage terms. Indicative dilution is around 1% per ₹50L invested, plus a 1% allocation for ARTPARK workspace and infrastructure. Disbursal is tranched against milestones agreed at the time of the term sheet."
          />
          <FAQ
            q="Who owns the IP?"
            a="Your startup retains all IP. ARTPARK takes standard investor rights — no transfer or licensing of IP to ARTPARK is required. If your prior IP came through TIR, the existing license arrangements continue unchanged."
          />
          <FAQ
            q="Do I have to be physically at ARTPARK?"
            a="Yes — primary operations should be at ARTPARK / IISc Bangalore for the duration of the program. This is what unlocks lab access, customer introductions, and the day-to-day mentorship that makes incubation work. Limited remote arrangements for sales or field deployment are fine."
          />
          <FAQ
            q="What if we already have outside investors?"
            a="That's fine, provided your cap table is clean and prior investors are aligned with ARTPARK joining the round. We'll need a current cap table, term sheet history, and consents during diligence. Materially encumbered cap tables (heavy ESOP, complex preferences, IP held externally) are usually a non-starter."
          />
          <FAQ
            q="Can I apply if I went through TIR?"
            a="Yes — SIP is the natural next step for high-performing TIRs. The application process is lighter for graduating TIRs since ARTPARK already has the technical and team context, but the investment committee still makes an independent call on funding terms."
          />
          <FAQ
            q="How long does the diligence process take?"
            a="For shortlisted startups: roughly 4–6 weeks from first call to investment-committee decision, including technical diligence, commercial review, founder reference calls, and the final pitch."
          />
          <FAQ
            q="What sectors are in scope?"
            a="AI, robotics, novel materials, sensors, mechatronics, manufacturing technology, and cyber-physical systems — applied to manufacturing, space, health, agriculture, mobility, defense, or other deep-tech-suited sectors. Pure SaaS, consumer apps, and fintech are out of scope."
          />
          <FAQ
            q="How do I submit my application?"
            a="Only via the online form linked on this page. No email, social-media, or third-party submissions. Applications must be complete at submission — including pitch deck, demo video or link, current cap table, and team profiles."
          />
          <FAQ
            q="Can I apply to both TIR and SIP?"
            a={
              <>
                Each person is expected to apply to <strong>one program only</strong>. Duplicate applications will be flagged and the second one removed. If you've already started a TIR application and want to switch to SIP (or vice-versa), email{" "}
                <a href="mailto:connect@artpark.in">connect@artpark.in</a>.
              </>
            }
          />
        </div>
      </section>

      <section className="programs-sip-final-cta">
        <div className="programs-sip-final-cta-inner">
          <h2>
            Ready to take your prototype to <em>production</em>?
          </h2>
          <p>
            Applications for SIP 2026 close on 31 May, 5pm IST. Most teams
            complete the form in 90–120 minutes.
          </p>
          <a
            href="/apply-sip/signup?track=sip"
            className="programs-btn programs-btn-light"
          >
            Start your application <span>→</span>
          </a>
        </div>
      </section>

      <footer className="programs-footer">
        <div className="programs-footer-inner">
          <div className="programs-footer-brand">
            <img src="/assets/artpark-logo.png" alt="ARTPARK" />
            <p>
              ARTPARK (AI &amp; Robotics Technology Park) is a not-for-profit
              Section-8 company at the Indian Institute of Science, Bangalore,
              committed to building and deploying AI &amp; Robotics
              technologies for{" "}
              <strong>Society, Economy, and Sovereignty</strong>.
            </p>
          </div>
          <div className="programs-footer-col">
            <h4>Programs</h4>
            <a href="/tir">Technology Innovator in Residence (TIR)</a>
            <a href="/sip">Startup Incubation Program (SIP)</a>
            <a href="/#compare">Compare</a>
          </div>
          <div className="programs-footer-col">
            <h4>Apply</h4>
            <a href="/apply/signup?track=tir">TIR application</a>
            <a href="/apply-sip/signup?track=sip">SIP application</a>
            <a
              href="https://www.artpark.in"
              target="_blank"
              rel="noopener noreferrer"
            >
              Contact
            </a>
          </div>
        </div>
        <div className="programs-footer-bot">
          <span>© 2026 ARTPARK · AI &amp; Robotics Technology Park @ IISc</span>
          <span>SIP.2026 · v1.0</span>
        </div>
      </footer>
    </div>
  );
}

function DeadlineItem({ label, val }) {
  return (
    <div className="programs-sip-deadline-item">
      <div className="programs-sip-deadline-label">{label}</div>
      <div className="programs-sip-deadline-val">{val}</div>
    </div>
  );
}

function Stat({ val, label, sub }) {
  return (
    <div className="programs-sip-stat">
      <div className="programs-sip-stat-val">{val}</div>
      <div className="programs-sip-stat-label">{label}</div>
      <div className="programs-sip-stat-sub">{sub}</div>
    </div>
  );
}

function BlockHead({ eyebrow, title }) {
  return (
    <div className="programs-sip-block-head">
      <span className="programs-block-eyebrow">{eyebrow}</span>
      <h2 className="programs-block-title">{title}</h2>
    </div>
  );
}

function GetCard({ num, title, body }) {
  return (
    <div className="programs-sip-get-card">
      <div className="programs-sip-get-card-num">{num}</div>
      <h3 className="programs-sip-get-card-title">{title}</h3>
      <p className="programs-sip-get-card-body">{body}</p>
    </div>
  );
}

function TlStep({ active, num, date, title, body }) {
  return (
    <div
      className={`programs-sip-tl-step${active ? " is-active" : ""}`}
    >
      <div className="programs-sip-tl-node">{num}</div>
      <div className="programs-sip-tl-date">{date}</div>
      <h4 className="programs-sip-tl-title">{title}</h4>
      <p className="programs-sip-tl-body">{body}</p>
    </div>
  );
}

function Term({ k, v, hl }) {
  return (
    <div className="programs-sip-term-item">
      <div className="programs-sip-term-key">{k}</div>
      <div
        className={`programs-sip-term-val${hl ? " programs-sip-term-hl" : ""}`}
      >
        {v}
      </div>
    </div>
  );
}

function FAQ({ q, a, open }) {
  return (
    <details className="programs-sip-faq" open={open}>
      <summary>{q}</summary>
      <div className="programs-sip-faq-ans">{a}</div>
    </details>
  );
}
