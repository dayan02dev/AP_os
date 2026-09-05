// Vendor registration and profile.
//
// The field set is fixed by the design spec -- do not extend it. Bank
// account details, IFSC and PAN are DELIBERATELY ABSENT: ARTPARK never pays
// the vendor, so those would be personal data with no feature behind them
// (this codebase already treats founder bank details as database-only and
// never emailed). Do not add them, not even as a placeholder.

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHead } from "../admin/platform/shell/osAtoms";

const TEXT_FIELDS = [
  ["legal_name", "Legal name"],
  ["display_name", "Display name"],
  ["website", "Website"],
  ["contact_name", "Contact name"],
  ["contact_email", "Contact email"],
  ["contact_phone", "Contact phone"],
  ["city", "City"],
  ["state", "State"],
  ["country", "Country"],
  ["gstin", "GSTIN"],
  ["udyam_number", "Udyam number"],
  ["cin", "CIN"],
];

// Must match the store's writable-field allow-list exactly. The PATCH is
// built from this list, never from spreading the loaded row -- the row also
// carries status, user_ids, name and id, which the store rejects.
const WRITABLE_KEYS = [
  ...TEXT_FIELDS.map(([key]) => key),
  "capabilities",
  "categories_served",
  "certifications",
];

// `certifications` is stored as an array (a repeating list, not booleans --
// ISO 13485 is a gating question for founders building medical devices) but
// edited here as one comma-separated text field, same shape as the other
// optional fields. The array<->string conversion happens only at the form's
// edges: on load/after-save (toFormShape) and on save (split back out below)
// -- never on every keystroke, so mid-edit text like "ISO 13485, " isn't
// clobbered by a round-trip through the array.
const toFormShape = (v) => ({
  ...v,
  certifications: (v.certifications || []).join(", "),
});

export default function VendorProfile({ store, vendorId }) {
  const [form, setForm] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Out-of-order guard: if a load is superseded (vendorId changes, or a
  // second load fires before the first resolves) a stale response must not
  // clobber newer state.
  const requestId = useRef(0);

  const loadVendor = useCallback(() => {
    const id = ++requestId.current;
    store
      .getVendorMe(vendorId)
      .then((v) => {
        if (id !== requestId.current) return;
        setForm(toFormShape(v));
        setLoadError("");
      })
      .catch(() => {
        if (id !== requestId.current) return;
        setLoadError("Could not load this vendor.");
      });
  }, [store, vendorId]);

  useEffect(() => {
    loadVendor();
  }, [loadVendor]);

  useEffect(() => {
    let live = true;
    store
      .listCategories()
      .then((rows) => {
        if (live) setCategories(rows);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [store]);

  if (!form) {
    return <div className="vp-loading">{loadError || "Loading…"}</div>;
  }

  const set = (key, value) => {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const toggleCategory = (id) => {
    const cur = form.categories_served || [];
    set("categories_served", cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  const save = async () => {
    setBusy(true);
    setSaveError("");
    try {
      const patch = {};
      for (const key of WRITABLE_KEYS) {
        if (form[key] !== undefined) patch[key] = form[key];
      }
      if (patch.certifications !== undefined) {
        patch.certifications = patch.certifications
          .split(",").map((s) => s.trim()).filter(Boolean);
      }
      const updated = await store.saveVendorProfile(vendorId, patch);
      setForm(toFormShape(updated));
      setSaveError("");
      setSaved(true);
    } catch {
      setSaved(false);
      setSaveError("Could not save your profile. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitForListing = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const updated = await store.submitVendorProfile(vendorId);
      setForm(toFormShape(updated));
      setSubmitError("");
    } catch (e) {
      setSubmitError(
        e && e.message === "profile_incomplete"
          ? "Add a legal name and contact email before submitting."
          : "Could not submit your profile. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = form.status === "invited" || form.status === "registered";

  return (
    <div>
      <PageHead
        eyebrow="Vendor"
        title="Your profile"
        sub="ARTPARK shares these details with a founder only after approving your account."
      />

      {form.status !== "approved" && (
        <div className="vp-note">
          Status: <strong>{form.status}</strong>. Your products stay hidden from founders
          until ARTPARK approves your account.
        </div>
      )}
      {saved && <div className="vp-note">Profile saved.</div>}
      {saveError && <div className="vp-field-err">{saveError}</div>}
      {submitError && <div className="vp-field-err">{submitError}</div>}

      <div className="vp-form">
        <div className="vp-form-row">
          {TEXT_FIELDS.map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                className="os-input"
                aria-label={label}
                value={form[key] ?? ""}
                onChange={(e) => set(key, e.target.value)}
              />
            </label>
          ))}
        </div>

        <label>
          Certifications
          <input
            className="os-input"
            aria-label="Certifications"
            placeholder="ISO 13485, ISO 9001"
            value={form.certifications ?? ""}
            onChange={(e) => set("certifications", e.target.value)}
          />
          <span className="vp-help">Comma-separated. Founders building medical devices screen for ISO 13485.</span>
        </label>

        <label>
          Capabilities
          <textarea
            className="os-input"
            aria-label="Capabilities"
            rows={4}
            value={form.capabilities ?? ""}
            onChange={(e) => set("capabilities", e.target.value)}
          />
          <span className="vp-help">What you actually supply, in your own words.</span>
        </label>

        <div>
          <div className="vp-help">Categories served</div>
          <div className="vp-multi">
            {categories.map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  checked={(form.categories_served || []).includes(c.id)}
                  onChange={() => toggleCategory(c.id)}
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>

        <div className="vp-row-actions">
          {canSubmit && (
            <button type="button" className="os-btn" disabled={submitting} onClick={submitForListing}>
              Submit for listing
            </button>
          )}
          <button type="button" className="os-btn" disabled={busy} onClick={save}>
            Save profile
          </button>
        </div>
      </div>
    </div>
  );
}
