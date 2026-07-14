// PortalSwitcher — the constant "SWITCH ROLE" button + dropdown shared by the
// Leadership, Reviewer and Admin portal topbars so the switcher looks and
// behaves identically everywhere (the leadership-page styling is the
// reference). Self-contained inline styles (no portal-scoped CSS) so it renders
// the same under .adm-portal / .rv-portal / the leadership shell.
//
// Lists every staff portal this account can reach; the current one is marked
// active. Renders nothing when the account can reach fewer than two portals.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.jsx";

const PORTALS = [
  { key: "leadership", label: "Leadership", to: "/leadership" },
  { key: "reviewer", label: "Reviewer", to: "/reviewer" },
  { key: "jury", label: "Jury Member", to: "/jury" },
  { key: "admin", label: "Admin", to: "/admin" },
];

export default function PortalSwitcher({ current }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const roles = user?.roles || [];
  // Portals this account can reach: any role it holds, plus the current portal.
  const options = PORTALS.filter((p) => p.key === current || roles.includes(p.key));
  if (options.length < 2) return null; // nowhere to switch — hide entirely

  const go = (p) => {
    setOpen(false);
    if (p.key !== current) navigate(p.to);
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch role"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 14px",
          border: "1px solid var(--line-strong, #c8c8d0)",
          borderRadius: 2,
          background: "var(--bg-paper, #fff)",
          color: "var(--ink, #242424)",
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          cursor: "pointer",
          whiteSpace: "nowrap",
          lineHeight: 1.2,
        }}
      >
        Switch role <span style={{ fontSize: 9, color: "var(--ink-dim, #8a8a92)" }}>▾</span>
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 9998 }}
          />
          <div
            role="menu"
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 0,
              minWidth: 220,
              background: "var(--bg-paper, #fff)",
              border: "1px solid var(--line-strong, #c8c8d0)",
              borderRadius: 2,
              boxShadow: "0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1)",
              padding: 6,
              zIndex: 9999,
            }}
          >
            <div
              style={{
                padding: "8px 12px",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: "var(--ink-dim, #8a8a92)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                borderBottom: "1px solid var(--line, #e3e3e8)",
                marginBottom: 4,
              }}
            >
              Switch role
            </div>
            {options.map((p) => {
              const isCur = p.key === current;
              return (
                <button
                  key={p.key}
                  role="menuitem"
                  onClick={() => go(p)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "9px 12px",
                    fontSize: 13,
                    fontWeight: isCur ? 600 : 500,
                    color: isCur ? "var(--artblue, #3213b7)" : "var(--ink-soft, #4a4a52)",
                    background: isCur ? "var(--bg-soft, #f6f6f8)" : "transparent",
                    border: "none",
                    borderRadius: 6,
                    cursor: isCur ? "default" : "pointer",
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: isCur ? "var(--artblue, #3213b7)" : "var(--line-strong, #c8c8d0)",
                    }}
                  />
                  <span>{p.label}</span>
                  {isCur && (
                    <span style={{ marginLeft: "auto", fontWeight: 700, color: "var(--artblue, #3213b7)" }}>
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
