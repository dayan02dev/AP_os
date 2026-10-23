// TeamListAnswer — TIR / VIP basic_teammates jsonb array.
//
// The wizard writes { fullName, email, phone, org, ... }; a few hand-patched
// rows use full_name / name / current_org instead.
// We render a small numbered list — name (bold) + email/org meta below.

import EmptyAnswer from "./EmptyAnswer.jsx";

export default function TeamListAnswer({ value }) {
  if (!Array.isArray(value) || value.length === 0) return <EmptyAnswer />;
  return (
    <ul className="ans-team" role="list">
      {value.map((entry, idx) => {
        const name =
          entry?.fullName ||
          entry?.full_name ||
          entry?.name ||
          entry?.email ||
          "(unnamed teammate)";
        const email = entry?.email || "";
        const org = entry?.current_org || entry?.org || "";
        const meta = [email, org].filter(Boolean).join(" · ");
        return (
          <li key={idx} className="ans-team-row">
            <span className="key">{String(idx + 1).padStart(2, "0")}</span>
            <span>
              <span className="name">{name}</span>
              {meta && <div className="meta">{meta}</div>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
