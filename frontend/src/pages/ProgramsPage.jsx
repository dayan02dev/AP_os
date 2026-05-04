// ProgramsPage — React landing page at "/" replacing the static
// programs.html. Includes the TIR/SIP track cards plus a side-by-side
// comparison table ported from the Remix design.

export default function ProgramsPage() {
  return (
    <div className="programs-page">
      <div className="programs-beta-bar">
        <span className="programs-beta-tag">Beta</span>
        <span className="programs-beta-msg">
          ARTPARK Programs is in beta — expect refinements as we build a
          renowned innovation hub.
        </span>
      </div>

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
            <a href="#tracks" className="programs-nav-link">
              Tracks
            </a>
            <a href="#compare" className="programs-nav-link">
              Compare
            </a>
            <a href="#faq" className="programs-nav-link">
              FAQ
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
            <a href="/tir" className="programs-btn programs-btn-primary">
              Apply to TIR <span>→</span>
            </a>
            <a
              href="/sip"
              className="programs-btn programs-btn-primary programs-btn-violet"
            >
              Apply to SIP <span>→</span>
            </a>
          </nav>
        </div>
      </header>

      <section className="programs-hero">
        <div className="programs-hero-inner">
          <span className="programs-eyebrow">
            <span className="programs-eyebrow-dot" />
            Programs · 2026 · Two paths
          </span>
          <h1 className="programs-hero-h1">
            From <span className="programs-hl">lab-proven</span> research and
            innovation to{" "}
            <span className="programs-blue">step-change products.</span>
          </h1>
          <p className="programs-hero-lede">
            ARTPARK supports deep-tech translation along two distinct paths.
            Early-stage technologists come in through the{" "}
            <strong>Technology Innovators in Residence (TIR)</strong> program
            to mature their IP; incorporated startups with a pitch-ready
            proposition enter through the{" "}
            <strong>Startup Incubation Program (SIP)</strong> for direct
            investment and acceleration. Pick the path that matches where you
            are today.
          </p>
        </div>
      </section>

      <section id="tracks" className="programs-tracks">
        <div className="programs-tracks-head">
          <span className="programs-block-eyebrow">Choose your track</span>
          <h2 className="programs-block-title">
            Two programs. One destination. Pick where you are today.
          </h2>
        </div>

        <div className="programs-track-grid">
          <article className="programs-track programs-track-tir">
            <div className="programs-track-tag-row">
              <span className="programs-track-pill">TIR</span>
              <span className="programs-track-status">
                <span className="programs-track-led" />
                Open
              </span>
            </div>
            <h3 className="programs-track-title">
              Technology Innovator in Residence
            </h3>
            <div className="programs-track-subhead">
              Researchers · TRL 3 · Pre-company
            </div>
            <p className="programs-track-lede">
              6 months, funding, and IISc infrastructure to retire risk on a
              step-change technology and incorporate the spin-out.
            </p>
            <dl className="programs-track-specs">
              <div>
                <dt>Kickoff</dt>
                <dd>₹25L · 0% equity</dd>
              </div>
              <div>
                <dt>Subsequent Funding</dt>
                <dd className="programs-hl-text">Up to ₹2 Cr through SIP</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>6 months</dd>
              </div>
              <div>
                <dt>TRL target</dt>
                <dd>3 → 4</dd>
              </div>
            </dl>
            <div className="programs-track-cta">
              <a
                href="/apply/signup?track=tir"
                className="programs-btn programs-btn-primary"
              >
                Apply to TIR <span>→</span>
              </a>
              <a href="/tir" className="programs-btn programs-btn-ghost">
                Full brief
              </a>
            </div>
          </article>

          <article className="programs-track programs-track-sip">
            <div className="programs-track-tag-row">
              <span className="programs-track-pill programs-track-pill-violet">
                SIP
              </span>
              <span className="programs-track-status">
                <span className="programs-track-led programs-track-led-violet" />
                Open
              </span>
            </div>
            <h3 className="programs-track-title">
              Startup Incubation Program
            </h3>
            <div className="programs-track-subhead">
              Registered startups · TRL 4+ · Pitch-ready
            </div>
            <p className="programs-track-lede">
              Direct investment, customer pipeline, and ARTPARK's scale-up
              infrastructure to move from demonstrated to deployed.
            </p>
            <dl className="programs-track-specs">
              <div>
                <dt>Engagement</dt>
                <dd className="programs-hl-text">Direct investment</dd>
              </div>
              <div>
                <dt>Entity</dt>
                <dd>Registered Indian</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>Up to 18 months</dd>
              </div>
              <div>
                <dt>TRL entry</dt>
                <dd>4 or higher</dd>
              </div>
            </dl>
            <div className="programs-track-cta">
              <a
                href="/apply-sip/signup?track=sip"
                className="programs-btn programs-btn-primary programs-btn-violet"
              >
                Apply to SIP <span>→</span>
              </a>
              <a href="/sip" className="programs-btn programs-btn-ghost">
                Full brief
              </a>
            </div>
          </article>
        </div>
      </section>

      <section id="compare" className="programs-compare">
        <div className="programs-compare-inner">
          <div className="programs-tracks-head">
            <span className="programs-block-eyebrow">Side-by-side</span>
            <h2 className="programs-block-title">
              Which path fits you right now?
            </h2>
          </div>
          <div className="programs-compare-table">
            <div className="programs-cmp-cell programs-cmp-head">
              Dimension
            </div>
            <div className="programs-cmp-cell programs-cmp-head programs-cmp-head-tir">
              <div>Track 01</div>
              <strong>Technology Innovator in Residence</strong>
            </div>
            <div className="programs-cmp-cell programs-cmp-head programs-cmp-head-sip">
              <div>Track 02</div>
              <strong>Startup Incubation Program</strong>
            </div>

            <CompareRow
              dim="Stage of maturity"
              note="Technology readiness level at entry"
              tir={
                <>
                  <strong>TRL 3</strong> — lab/in-house validated. Core risks
                  still open.
                </>
              }
              sip={
                <>
                  <strong>TRL 4+</strong> — ARTPARK- or independently-
                  demonstrated technology.
                </>
              }
            />
            <CompareRow
              dim="Entity required"
              note="Who applies"
              tir={
                <>
                  Individual or team of up to 3.{" "}
                  <strong>No company required</strong> at apply.
                </>
              }
              sip={
                <>
                  <strong>Incorporated Indian startup</strong> (Pvt Ltd, DPIIT-
                  recognized preferred).
                </>
              }
            />
            <CompareRow
              dim="Funding structure"
              note="Capital and equity"
              tir={
                <>
                  <strong>₹25L</strong> for the first 6 months, with up to{" "}
                  <strong>₹2 Cr</strong> subsequent investment through the SIP
                  process.
                </>
              }
              sip={
                <>
                  <strong>Direct equity investment</strong> on negotiated
                  terms, sized to the round. Follow-on pathways.
                </>
              }
            />
            <CompareRow
              dim="IP ownership"
              note="Who owns what you build"
              tir={
                <>
                  Prior IP retained by owners.{" "}
                  <strong>New IP during TIR owned by ARTPARK</strong>,
                  exclusively licensed to the spin-out.
                </>
              }
              sip={
                <>
                  <strong>Startup retains IP.</strong> Standard investor
                  rights apply.
                </>
              }
            />
            <CompareRow
              dim="Time commitment"
              note="What you sign up for"
              tir={
                <>
                  <strong>Full-time, on-campus</strong> at ARTPARK, IISc
                  Bangalore. NOC required if affiliated.
                </>
              }
              sip={
                <>
                  <strong>Full-time on the startup</strong>. Founders commit
                  exclusively to the company.
                </>
              }
            />
            <CompareRow
              isLast
              dim="Best for"
              note="The archetype this is designed for"
              tir={
                <>
                  Researchers translating a hard technology into product
                  reality. Pre-company. IP-heavy.
                </>
              }
              sip={
                <>
                  Founders with traction and a pitch, needing capital +
                  ARTPARK's infra to scale a deep-tech startup.
                </>
              }
            />
          </div>
        </div>
      </section>

      <section className="programs-final-cta">
        <div className="programs-final-cta-inner">
          <h2>Ready to apply?</h2>
          <p>Pick the track that matches where you are today.</p>
          <div className="programs-final-cta-row">
            <a
              href="/apply/signup?track=tir"
              className="programs-btn programs-btn-light"
            >
              Apply to TIR <span>→</span>
            </a>
            <a
              href="/apply-sip/signup?track=sip"
              className="programs-btn programs-btn-light programs-btn-violet-text"
            >
              Apply to SIP <span>→</span>
            </a>
          </div>
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
            <a href="#compare">Compare</a>
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
          <span>Programs · Beta · v0.2</span>
        </div>
      </footer>
    </div>
  );
}

function CompareRow({ dim, note, tir, sip, isLast }) {
  const cls = `programs-cmp-cell ${isLast ? "programs-cmp-row-last" : ""}`;
  return (
    <>
      <div className={`${cls} programs-cmp-dim`}>
        {dim}
        {note && <span className="programs-cmp-note">{note}</span>}
      </div>
      <div className={`${cls} programs-cmp-val`}>{tir}</div>
      <div className={`${cls} programs-cmp-val`}>{sip}</div>
    </>
  );
}
