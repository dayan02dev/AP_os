// SectionBlock — one numbered section header + its list of QuestionBlocks.
//
// Layout:
//   SECTION 02 of 06          (mono eyebrow)
//   02                        (large marker)
//   What problem do you...    (display title)
//   <blurb>
//   <QuestionBlock /> × N

import QuestionBlock from "./QuestionBlock.jsx";

export default function SectionBlock({ section, totalSections, application, applicationId }) {
  return (
    <section className="sec-block">
      <div className="sec-block-head">
        <span className="sec-block-num">
          Section {section.section_number}
        </span>
        <span className="sec-block-of">
          of {String(totalSections).padStart(2, "0")}
        </span>
      </div>
      <h2 className="sec-block-title">
        <span className="marker" aria-hidden="true">{section.section_number}</span>
        {section.section_title}
      </h2>
      {section.blurb && <p className="sec-block-blurb">{section.blurb}</p>}
      <div>
        {section.questions.map((q) => (
          <QuestionBlock
            key={q.key}
            question={q}
            application={application}
            applicationId={applicationId}
          />
        ))}
      </div>
    </section>
  );
}
