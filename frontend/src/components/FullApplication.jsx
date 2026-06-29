// FullApplication — schema-driven read-only render of one application,
// reused by leadership (inline), the reviewer eval screen, and the admin
// detail screen so all three render identically. Thin wrapper over the
// leadership ApplicationTab + applicationSchemas; the caller injects a
// `signedUrl(applicationId, storagePath) => Promise<{url}>` function so each
// surface uses its own (authorised) signed-URL endpoint for file downloads.

import ApplicationTab from "../pages/leadership/review/ApplicationTab.jsx";
import { schemaFor } from "../pages/leadership/applicationSchemas.js";
import "../styles/review-application.css";

export default function FullApplication({ track, application, applicationId, signedUrl }) {
  return (
    <ApplicationTab
      schema={schemaFor(track)}
      application={application}
      applicationId={applicationId}
      signedUrl={signedUrl}
    />
  );
}
