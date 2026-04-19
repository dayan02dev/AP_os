// Profile settings screen — edit name, email, password, phone, org

const { useState: usePS, useEffect: usePE } = React;

function ProfileScreen({ user, onBack, onUpdate, onLogout }) {
  const initial = (() => {
    try { return JSON.parse(localStorage.getItem(`tir:profile:${user.email}`) || "{}"); } catch { return {}; }
  })();

  const [fullName, setFullName] = usePS(initial.fullName || user.email.split("@")[0].split(/[._-]/).map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join(" "));
  const [email, setEmail] = usePS(user.email);
  const [phone, setPhone] = usePS(initial.phone || "");
  const [org, setOrg] = usePS(initial.org || "");
  const [role, setRole] = usePS(initial.role || "");
  const [currentPass, setCurrentPass] = usePS("");
  const [newPass, setNewPass] = usePS("");
  const [confirmPass, setConfirmPass] = usePS("");
  const [savedFlash, setSavedFlash] = usePS("");
  const [err, setErr] = usePS("");

  const saveProfile = (e) => {
    e?.preventDefault();
    setErr("");
    if (!fullName.trim()) return setErr("Full name cannot be empty.");
    if (!/\S+@\S+\.\S+/.test(email)) return setErr("Please enter a valid email.");

    const profile = { fullName: fullName.trim(), phone: phone.trim(), org: org.trim(), role: role.trim() };
    localStorage.setItem(`tir:profile:${email}`, JSON.stringify(profile));

    // Email change — migrate data to new email
    if (email !== user.email) {
      try {
        const oldSubs = localStorage.getItem(`tir:submissions:${user.email}`);
        if (oldSubs) {
          localStorage.setItem(`tir:submissions:${email}`, oldSubs);
          localStorage.removeItem(`tir:submissions:${user.email}`);
        }
        const users = JSON.parse(localStorage.getItem("tir:users") || "{}");
        if (users[user.email]) {
          users[email] = { ...users[user.email], email };
          delete users[user.email];
          localStorage.setItem("tir:users", JSON.stringify(users));
        }
      } catch {}
      onUpdate({ ...user, email });
    }

    setSavedFlash("Profile saved.");
    setTimeout(() => setSavedFlash(""), 2400);
  };

  const changePassword = (e) => {
    e?.preventDefault();
    setErr("");
    if (!currentPass) return setErr("Enter your current password.");
    if (!isPasswordValid(newPass)) return setErr("New password doesn't meet all the requirements.");
    if (newPass !== confirmPass) return setErr("New passwords don't match.");

    // Demo: any current password accepted (we don't actually store them)
    setCurrentPass(""); setNewPass(""); setConfirmPass("");
    setSavedFlash("Password updated.");
    setTimeout(() => setSavedFlash(""), 2400);
  };

  return (
    <div className="eir-screen eir-profile">
      <div className="eir-coord eir-mono">
        <span>ARTPARK / TIR.2026</span>
        <span>profile settings · {user.email}</span>
      </div>

      <div className="eir-profile-body">
        <div className="eir-profile-head">
          <button className="eir-chip-btn eir-mono eir-profile-back" onClick={onBack}>← back to application</button>
        </div>

        <div className="eir-welcome-label eir-mono">
          <span className="eir-dot-live" /> account · signed in
        </div>
        <h1 className="eir-welcome-title">Your <em>profile</em>.</h1>
        <p className="eir-welcome-lede">
          Changes here apply to your ARTPARK TIR account across every cohort. Your submitted applications aren't affected.
        </p>

        {savedFlash && <div className="eir-profile-flash eir-mono">✓ {savedFlash}</div>}
        {err && <div className="eir-auth-err eir-mono">! {err}</div>}

        {/* Section: Personal info */}
        <section className="eir-profile-section">
          <div className="eir-profile-section-head">
            <span className="eir-mono eir-dim eir-profile-section-num">01</span>
            <h2 className="eir-profile-section-title">Personal information</h2>
          </div>

          <form className="eir-profile-form" onSubmit={saveProfile}>
            <div className="eir-profile-field">
              <label className="eir-mono eir-link-label">full name</label>
              <input type="text" className="eir-input eir-input-inline" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your full name" />
            </div>

            <div className="eir-profile-field">
              <label className="eir-mono eir-link-label">email address</label>
              <input type="email" className="eir-input eir-input-inline" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@domain.com" />
              <div className="eir-profile-hint eir-mono eir-dim">
                {email !== user.email ? "↳ this will migrate your account and past submissions" : "↳ we'll send application updates here"}
              </div>
            </div>

            <div className="eir-profile-field">
              <label className="eir-mono eir-link-label">phone number</label>
              <input type="tel" className="eir-input eir-input-inline" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
            </div>

            <div className="eir-profile-grid2">
              <div className="eir-profile-field">
                <label className="eir-mono eir-link-label">organization</label>
                <input type="text" className="eir-input eir-input-inline" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="IISc Bangalore" />
              </div>
              <div className="eir-profile-field">
                <label className="eir-mono eir-link-label">role / title</label>
                <input type="text" className="eir-input eir-input-inline" value={role} onChange={(e) => setRole(e.target.value)} placeholder="PhD candidate" />
              </div>
            </div>

            <div className="eir-q-actions">
              <button type="submit" className="eir-btn eir-btn-primary">
                <span>Save changes</span>
                <span className="eir-btn-key eir-mono">⏎</span>
              </button>
            </div>
          </form>
        </section>

        {/* Section: Password */}
        <section className="eir-profile-section">
          <div className="eir-profile-section-head">
            <span className="eir-mono eir-dim eir-profile-section-num">02</span>
            <h2 className="eir-profile-section-title">Change password</h2>
          </div>

          <form className="eir-profile-form" onSubmit={changePassword}>
            <div className="eir-profile-field">
              <label className="eir-mono eir-link-label">current password</label>
              <PasswordInput
                value={currentPass}
                onChange={setCurrentPass}
                placeholder="Enter current password"
                showRules={false}
                showStrength={false}
                autoComplete="current-password"
              />
            </div>
            <div className="eir-profile-grid2">
              <div className="eir-profile-field">
                <label className="eir-mono eir-link-label">new password</label>
                <PasswordInput
                  value={newPass}
                  onChange={setNewPass}
                  placeholder="Create a strong password"
                  showRules
                  showStrength
                  autoComplete="new-password"
                />
              </div>
              <div className="eir-profile-field">
                <label className="eir-mono eir-link-label">confirm new</label>
                <PasswordInput
                  value={confirmPass}
                  onChange={setConfirmPass}
                  placeholder="Re-enter new password"
                  showRules={false}
                  showStrength={false}
                  autoComplete="new-password"
                  compareTo={newPass}
                />
              </div>
            </div>
            <div className="eir-q-actions">
              <button type="submit" className="eir-btn eir-btn-primary"><span>Update password</span></button>
            </div>
          </form>
        </section>

        {/* Section: Account actions */}
        <section className="eir-profile-section eir-profile-danger">
          <div className="eir-profile-section-head">
            <span className="eir-mono eir-dim eir-profile-section-num">03</span>
            <h2 className="eir-profile-section-title">Account</h2>
          </div>

          <div className="eir-profile-danger-row">
            <div className="eir-profile-danger-copy">
              <div className="eir-profile-danger-title">Sign out</div>
              <div className="eir-profile-danger-sub eir-mono eir-dim">
                ↳ your draft is auto-saved · you can return anytime
              </div>
            </div>
            <button className="eir-btn eir-btn-ghost" onClick={onLogout}>Sign out</button>
          </div>
        </section>

        <div className="eir-welcome-foot eir-mono eir-dim">
          encrypted at rest · changes are saved immediately
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ProfileScreen });
