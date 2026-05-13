// Minimal "Add user" form. Functional, no visual polish — the screenshot-
// matched UI lands in Task 29 (Udita). This file exists so the vertical-
// slice smoke test (Task 9) is exercisable end-to-end: admin signs in,
// creates a reviewer, the reviewer can land on their inbox.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "../../lib/adminApi.js";

const ROLES = [
  { id: "leadership", label: "Leadership" },
  { id: "admin", label: "Admin" },
  { id: "reviewer", label: "Reviewer" },
  { id: "mentor", label: "Mentor" },
  { id: "founder", label: "Founder" },
  { id: "applicant", label: "Applicant (rare for invites)" },
];

export default function AdminAddUser() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [org, setOrg] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [selectedRoles, setSelectedRoles] = useState(new Set(["reviewer"]));
  const [sendInvite, setSendInvite] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const toggleRole = (r) => {
    const next = new Set(selectedRoles);
    if (next.has(r)) next.delete(r);
    else next.add(r);
    setSelectedRoles(next);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const r = await adminApi.createUser({
        email: email.trim(),
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        organization: org.trim() || null,
        role_title: roleTitle.trim() || null,
        roles: Array.from(selectedRoles),
        send_invite: sendInvite,
      });
      setResult(r);
    } catch (e2) {
      // ApiError carries .details from the backend's 4xx payload.
      const code = e2?.details?.detail?.code || e2?.details?.code;
      const invalid = e2?.details?.detail?.invalid || e2?.details?.invalid;
      if (code === "email_exists") {
        setError("That email is already registered.");
      } else if (code === "invalid_role") {
        setError(`Invalid role(s): ${(invalid || []).join(", ")}`);
      } else if (code === "missing_capability") {
        setError("You don't have permission to create users.");
      } else {
        setError(e2?.message || "Create failed.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div style={{ padding: 40, maxWidth: 720, fontFamily: "system-ui" }}>
        <h1>User created ✓</h1>
        <p>
          <strong>Email:</strong> {result.email}
        </p>
        <p>
          <strong>Roles:</strong> {result.roles.join(", ")}
        </p>
        {result.invite_sent ? (
          <p>Magic-link invite email sent. The new user can sign in once they accept it.</p>
        ) : (
          <p>
            <strong>Temp password (share manually):</strong>{" "}
            <code>{result.temp_password}</code>
            <br />
            <em>The user should change it on first sign-in.</em>
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setEmail("");
            setFullName("");
            setPhone("");
            setOrg("");
            setRoleTitle("");
            setSelectedRoles(new Set(["reviewer"]));
          }}
        >
          Add another
        </button>{" "}
        <button type="button" onClick={() => navigate("/admin/dashboard")}>
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 40, maxWidth: 720, fontFamily: "system-ui" }}>
      <h1>Add user</h1>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label>
          Email
          <br />
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: "100%", padding: 6 }}
          />
        </label>
        <label>
          Full name
          <br />
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            style={{ width: "100%", padding: 6 }}
          />
        </label>
        <label>
          Phone
          <br />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={{ width: "100%", padding: 6 }}
          />
        </label>
        <label>
          Organisation
          <br />
          <input
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            style={{ width: "100%", padding: 6 }}
          />
        </label>
        <label>
          Role / Title
          <br />
          <input
            value={roleTitle}
            onChange={(e) => setRoleTitle(e.target.value)}
            style={{ width: "100%", padding: 6 }}
          />
        </label>
        <fieldset>
          <legend>Roles (one or more)</legend>
          {ROLES.map((r) => (
            <label key={r.id} style={{ display: "block", padding: "2px 0" }}>
              <input
                type="checkbox"
                checked={selectedRoles.has(r.id)}
                onChange={() => toggleRole(r.id)}
              />{" "}
              {r.label}
            </label>
          ))}
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={sendInvite}
            onChange={(e) => setSendInvite(e.target.checked)}
          />{" "}
          Send magic-link invite email (uncheck to get a temp password instead)
        </label>
        <div>
          <button
            type="submit"
            disabled={submitting || selectedRoles.size === 0}
          >
            {submitting ? "Creating…" : "Create user"}
          </button>{" "}
          <button type="button" onClick={() => navigate("/admin/dashboard")}>
            Cancel
          </button>
        </div>
        {error && (
          <p style={{ color: "#b00020" }}>
            <strong>Error:</strong> {error}
          </p>
        )}
      </form>
    </div>
  );
}
