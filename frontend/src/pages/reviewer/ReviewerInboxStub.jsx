// Placeholder for /reviewer/inbox. Session 1 ships only the stub so the
// vertical-slice smoke test (admin invites reviewer → reviewer signs in
// → lands on a meaningful page) can succeed end-to-end.
//
// The real inbox + 6-slider scoring screen lands in Phase 1.5 (the next
// ship after Phase 1). Do not extend this file with real UI here.

import { useAuth } from "../../hooks/useAuth.jsx";

export default function ReviewerInboxStub() {
  const { user, logout } = useAuth();
  return (
    <div style={{ padding: 40, maxWidth: 720, fontFamily: "system-ui" }}>
      <h1>Reviewer inbox</h1>
      <p>
        Signed in as <strong>{user?.email}</strong>
      </p>
      <p>
        Roles: <code>{(user?.roles || []).join(", ") || "(none granted)"}</code>
      </p>
      <p>You'll see applications assigned to you here.</p>
      <p style={{ color: "#888" }}>
        <em>
          The scoring interface arrives in Phase 1.5 — shortly after Phase 1
          ships.
        </em>
      </p>
      <p>
        <button type="button" onClick={logout}>Sign out</button>
      </p>
    </div>
  );
}
