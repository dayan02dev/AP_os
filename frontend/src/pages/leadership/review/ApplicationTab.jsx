// ApplicationTab — schema-driven render of every wizard answer, grouped by
// the section blocks defined in applicationSchemas.js.

import SectionBlock from "./SectionBlock.jsx";

export default function ApplicationTab({ schema, application, applicationId }) {
  if (!Array.isArray(schema) || schema.length === 0) {
    return (
      <div className="inline-error" role="alert">
        Schema for this track isn't available yet — can't render the application.
      </div>
    );
  }
  return (
    <>
      {schema.map((section) => (
        <SectionBlock
          key={section.section_number}
          section={section}
          totalSections={schema.length}
          application={application}
          applicationId={applicationId}
        />
      ))}
    </>
  );
}
