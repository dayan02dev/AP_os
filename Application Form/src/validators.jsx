// Form validation helpers: email validity, domain suggestions, password rules, strength meter

const { useState: useVS, useEffect: useVE, useRef: useVR } = React;

// ===== Email validation =====

const COMMON_EMAIL_DOMAINS = [
  "gmail.com",
  "outlook.com",
  "yahoo.com",
  "hotmail.com",
  "icloud.com",
  "proton.me",
  "artpark.in",
  "iisc.ac.in",
];

// Strict-enough RFC-inspired email check
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

function validateEmail(email) {
  if (!email || !email.trim()) {
    return { valid: false, state: "empty", message: "Enter your email." };
  }
  const e = email.trim();
  if (!e.includes("@")) {
    return { valid: false, state: "no-at", message: "Email is missing the @ symbol." };
  }
  const atCount = (e.match(/@/g) || []).length;
  if (atCount > 1) {
    return { valid: false, state: "too-many-at", message: "Email should contain only one @." };
  }
  const [local, domain] = e.split("@");
  if (!local) {
    return { valid: false, state: "no-local", message: "Missing username before @." };
  }
  if (!domain) {
    return { valid: false, state: "no-domain", message: "Missing domain after @." };
  }
  if (!domain.includes(".")) {
    return { valid: false, state: "no-tld", message: "Domain needs an extension like .com" };
  }
  if (!EMAIL_REGEX.test(e)) {
    return { valid: false, state: "malformed", message: "This doesn't look quite right." };
  }
  return { valid: true, state: "ok", message: "Looks good." };
}

// Suggest common domains based on what user has typed
function suggestEmailDomains(email) {
  const atIdx = email.lastIndexOf("@");
  if (atIdx === -1) return [];
  const local = email.slice(0, atIdx);
  if (!local) return [];
  const typed = email.slice(atIdx + 1).toLowerCase();
  if (typed.length === 0) {
    return COMMON_EMAIL_DOMAINS.map(d => local + "@" + d);
  }
  // Show domains that start with what was typed
  const matches = COMMON_EMAIL_DOMAINS.filter(d => d.toLowerCase().startsWith(typed) && d.toLowerCase() !== typed);
  return matches.map(d => local + "@" + d);
}

// ===== Password rules =====

function checkPasswordRules(pw) {
  const pwStr = pw || "";
  return [
    { id: "length", label: "At least 8 characters", passed: pwStr.length >= 8 },
    { id: "upper", label: "One uppercase letter (A–Z)", passed: /[A-Z]/.test(pwStr) },
    { id: "lower", label: "One lowercase letter (a–z)", passed: /[a-z]/.test(pwStr) },
    { id: "number", label: "One number (0–9)", passed: /[0-9]/.test(pwStr) },
    { id: "symbol", label: "One special character (!@#$…)", passed: /[^A-Za-z0-9]/.test(pwStr) },
  ];
}

// Returns true if all HARD requirements are met (our minimum bar)
function isPasswordValid(pw) {
  const rules = checkPasswordRules(pw);
  // Required: length, upper, number, symbol (lowercase is nice-to-have for scoring)
  return rules.find(r => r.id === "length").passed
    && rules.find(r => r.id === "upper").passed
    && rules.find(r => r.id === "number").passed
    && rules.find(r => r.id === "symbol").passed;
}

// Password strength scoring: 0–100
// Factors: length, character diversity, non-repetition, common-pattern penalty
function scorePasswordStrength(pw) {
  if (!pw) return { score: 0, level: "empty", label: "—", color: "var(--line-strong)" };
  const pwStr = pw;
  let score = 0;

  // Length — up to 40 points
  score += Math.min(40, pwStr.length * 3);
  if (pwStr.length >= 12) score += 5;
  if (pwStr.length >= 16) score += 5;

  // Character diversity — up to 30 points
  const hasUpper = /[A-Z]/.test(pwStr);
  const hasLower = /[a-z]/.test(pwStr);
  const hasNumber = /[0-9]/.test(pwStr);
  const hasSymbol = /[^A-Za-z0-9]/.test(pwStr);
  const diversity = [hasUpper, hasLower, hasNumber, hasSymbol].filter(Boolean).length;
  score += diversity * 7;

  // Unique chars ratio — up to 15 points
  const uniqueRatio = new Set(pwStr.split("")).size / pwStr.length;
  score += Math.round(uniqueRatio * 15);

  // Penalties
  if (/^[0-9]+$/.test(pwStr)) score -= 20; // all numbers
  if (/^[a-z]+$/i.test(pwStr)) score -= 15; // all letters
  if (/(.)\1{2,}/.test(pwStr)) score -= 8; // 3+ repeated chars
  if (/^(123|abc|qwe|password|admin|letmein|welcome)/i.test(pwStr)) score -= 25; // common prefixes
  if (/(012|123|234|345|456|567|678|789|890|abc|xyz|qwerty|asdf)/i.test(pwStr)) score -= 10;

  score = Math.max(0, Math.min(100, score));

  let level, label, color;
  if (score < 25) { level = "weak"; label = "Weak"; color = "#c84a1a"; }
  else if (score < 50) { level = "fair"; label = "Fair"; color = "#d97706"; }
  else if (score < 75) { level = "good"; label = "Good"; color = "#3213b7"; }
  else { level = "strong"; label = "Strong"; color = "#2a7a3a"; }

  return { score, level, label, color };
}

// ===== EmailInput component with domain autocomplete =====

function EmailInput({ value, onChange, placeholder, autoFocus, showValidation = true, className = "" }) {
  const [focused, setFocused] = useVS(false);
  const [showSuggest, setShowSuggest] = useVS(false);
  const [highlight, setHighlight] = useVS(0);
  const wrapRef = useVR(null);

  const suggestions = suggestEmailDomains(value || "");
  const validation = validateEmail(value || "");
  const showSug = focused && showSuggest && suggestions.length > 0;

  useVE(() => {
    // Close suggestions on outside click
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setShowSuggest(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const handleChange = (e) => {
    onChange(e.target.value);
    setShowSuggest(true);
    setHighlight(0);
  };

  const applySuggestion = (s) => {
    onChange(s);
    setShowSuggest(false);
  };

  const handleKey = (e) => {
    if (!showSug) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Tab" && suggestions[highlight]) { e.preventDefault(); applySuggestion(suggestions[highlight]); }
    else if (e.key === "Enter" && showSug && suggestions[highlight]) {
      // Only capture enter when user is actively navigating with arrows (highlight > 0)
      // so that hitting Enter on a valid email still submits the form
      if (highlight > 0) { e.preventDefault(); applySuggestion(suggestions[highlight]); }
    }
    else if (e.key === "Escape") { setShowSuggest(false); }
  };

  const status = !value ? "idle" : validation.valid ? "valid" : "invalid";

  return (
    <div className={`eir-vfield eir-email-wrap ${className}`} ref={wrapRef}>
      <div className={`eir-vinput-wrap status-${status}`}>
        <input
          type="email"
          className="eir-input"
          value={value || ""}
          onChange={handleChange}
          onFocus={() => { setFocused(true); setShowSuggest(true); }}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKey}
          placeholder={placeholder || "you@domain.com"}
          autoFocus={autoFocus}
          autoComplete="email"
        />
        {value && showValidation && (
          <span className={`eir-vstatus eir-vstatus-${status}`} aria-hidden>
            {status === "valid" ? "✓" : "✗"}
          </span>
        )}
      </div>

      {showSug && (
        <ul className="eir-email-sug" role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={s}
              className={`eir-email-sug-item ${i === highlight ? "is-hi" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); applySuggestion(s); }}
              onMouseEnter={() => setHighlight(i)}
              role="option"
              aria-selected={i === highlight}
            >
              <span className="eir-email-sug-full">{s}</span>
              <span className="eir-mono eir-dim eir-email-sug-key">↵</span>
            </li>
          ))}
        </ul>
      )}

      {showValidation && value && !validation.valid && !showSug && (
        <div className="eir-vmsg eir-vmsg-err eir-mono">↳ {validation.message}</div>
      )}
      {showValidation && value && validation.valid && (
        <div className="eir-vmsg eir-vmsg-ok eir-mono">✓ {validation.message}</div>
      )}
    </div>
  );
}

// ===== PasswordInput component with rules + strength meter =====

function PasswordInput({ value, onChange, placeholder, showRules = true, showStrength = true, className = "", autoComplete = "new-password", compareTo }) {
  const [focused, setFocused] = useVS(false);
  const [reveal, setReveal] = useVS(false);
  const rules = checkPasswordRules(value);
  const strength = scorePasswordStrength(value);
  const allPassed = rules.every(r => r.passed);
  const matchesCompare = compareTo !== undefined ? (value === compareTo && value.length > 0) : null;

  const shouldShow = showRules && (focused || (value && value.length > 0));

  return (
    <div className={`eir-vfield eir-pw-wrap ${className}`}>
      <div className="eir-vinput-wrap">
        <input
          type={reveal ? "text" : "password"}
          className="eir-input"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder || "Strong password"}
          autoComplete={autoComplete}
        />
        <button type="button" className="eir-pw-reveal eir-mono" onClick={() => setReveal(!reveal)} tabIndex={-1}>
          {reveal ? "hide" : "show"}
        </button>
      </div>

      {showStrength && value && (
        <div className="eir-pw-strength">
          <div className="eir-pw-strength-bar">
            {[1, 2, 3, 4].map((seg) => {
              const threshold = seg * 25;
              const filled = strength.score >= threshold - 15;
              return (
                <div
                  key={seg}
                  className={`eir-pw-strength-seg ${filled ? "is-filled" : ""}`}
                  style={filled ? { background: strength.color } : {}}
                />
              );
            })}
          </div>
          <div className="eir-pw-strength-label eir-mono" style={{ color: strength.color }}>
            {strength.label.toUpperCase()} · {strength.score}/100
          </div>
        </div>
      )}

      {shouldShow && (
        <ul className="eir-pw-rules">
          {rules.map((r) => (
            <li key={r.id} className={`eir-pw-rule ${r.passed ? "is-ok" : ""}`}>
              <span className="eir-pw-rule-mark eir-mono">{r.passed ? "✓" : "○"}</span>
              <span className="eir-pw-rule-label">{r.label}</span>
            </li>
          ))}
          {compareTo !== undefined && (
            <li className={`eir-pw-rule ${matchesCompare ? "is-ok" : ""}`}>
              <span className="eir-pw-rule-mark eir-mono">{matchesCompare ? "✓" : "○"}</span>
              <span className="eir-pw-rule-label">Matches the password above</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

Object.assign(window, {
  validateEmail, isPasswordValid, checkPasswordRules, scorePasswordStrength,
  EmailInput, PasswordInput, COMMON_EMAIL_DOMAINS,
});
