// The Organization tab — 3-step wizard (Team / Roles / BOM & equipment).
// Faithful port of TIR Onboarding.dc.html's showOrgTeam/showOrgRoles/showOrgBom
// blocks + the Component class's addMember()/setHat()/addBom()/addEquip()
// handlers and the org* renderVals() derivations.
//
// Deviation from the mockup (documented, backend-constrained): the mockup's
// Type select offers Full-time/Part-time/Contract/Advisor, and its "+ Add…"
// links insert a blank (empty-name) row for inline editing. The real backend
// (migration 037) only allows employment_type in ('full-time','contract',
// 'intern'), and TeamMemberIn/BomItemIn/EquipmentItemIn require a non-empty
// name — both predate this rebuild and are out of scope here ("do not touch
// backend"). So the Type select uses the three backend-supported values, and
// "+ Add…" inserts a row with a placeholder label the founder overwrites
// inline (onBlur-to-save), matching the Workplan step's addTask() pattern.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { founderApi } from "../../lib/founderApi.js";
import { fmtINR, fmtL, lineTotal, sum, Loading, ErrorState } from "./ui.jsx";
import Stepper from "./components/Stepper.jsx";

const ORG_STEP_LABELS = ["Team", "Roles", "BOM & equipment"];
const TOTAL_ORG_STEPS = ORG_STEP_LABELS.length;

// Transcribed verbatim from TIR Onboarding.dc.html's hatMeta.
const HAT_META = [
  { key: "business", title: "Business", roles: "CEO / CBO", accent: "var(--artblue)",
    desc: "Owns direction, fundraising, and commercial accountability — the person who carries the venture." },
  { key: "technology", title: "Technology", roles: "CTO", accent: "var(--accent-violet)",
    desc: "Owns the core tech, architecture, and the derisking experiments that prove it." },
  { key: "product", title: "Product", roles: "CPO", accent: "var(--accent-green)",
    desc: "Owns what gets built, for whom, and in what order it ships." },
  { key: "customer", title: "Customer", roles: "Voice of customer", accent: "var(--accent-amber)",
    desc: "Owns discovery, pilots, and the feedback loop with real users and buyers." },
];

export default function FounderOrganization() {
  const navigate = useNavigate();

  const [orgStep, setOrgStep] = useState(0);
  const [orgFurthest, setOrgFurthest] = useState(0);
  const [team, setTeam] = useState(null);
  const [approach, setApproach] = useState(null);
  const [bom, setBom] = useState(null);
  const [equipment, setEquipment] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    Promise.all([founderApi.listTeam(), founderApi.getApproach(), founderApi.getExpense()])
      .then(([tm, ap, ex]) => {
        setTeam(tm || []);
        setApproach(ap || {});
        setBom((ex && ex.bom) || []);
        setEquipment((ex && ex.equipment) || []);
      })
      .catch(setError);
  }, []);

  const go = useCallback((i) => {
    const clamped = Math.max(0, Math.min(TOTAL_ORG_STEPS - 1, i));
    setOrgStep(clamped);
    setOrgFurthest((f) => Math.max(f, clamped));
  }, []);
  const next = () => go(orgStep + 1);
  const back = () => go(orgStep - 1);

  // ---- team (step 0 · Team, referenced as select options in step 1) ----
  const addMember = useCallback(async () => {
    try {
      const row = await founderApi.addTeam({
        name: "New team member", title: "", employment_type: "full-time", monthly_cost: 0,
      });
      setTeam((prev) => [...(prev || []), row]);
    } catch (err) {
      setActionError(err);
    }
  }, []);
  const updateMember = useCallback((id, field, value) => {
    setTeam((prev) => (prev || []).map((m) => (m.id === id ? { ...m, [field]: value } : m)));
    const cast = field === "monthly_cost" ? Number(value) || 0 : value;
    founderApi.editTeam(id, { [field]: cast }).catch((err) => setActionError(err));
  }, []);
  const removeMember = useCallback((id) => {
    setTeam((prev) => (prev || []).filter((m) => m.id !== id));
    founderApi.delTeam(id).catch((err) => setActionError(err));
  }, []);

  // ---- hats (step 1 · Roles) ----
  const setHat = useCallback((key, memberId) => {
    setApproach((prev) => {
      const nextApproach = { ...(prev || {}), [`${key}_member_id`]: memberId || null };
      founderApi.putApproach({
        business_member_id: nextApproach.business_member_id || null,
        technology_member_id: nextApproach.technology_member_id || null,
        product_member_id: nextApproach.product_member_id || null,
        customer_member_id: nextApproach.customer_member_id || null,
        notes: nextApproach.notes || null,
      }).catch((err) => setActionError(err));
      return nextApproach;
    });
  }, []);

  // ---- BOM (step 2) ----
  const addBomLine = useCallback(async () => {
    try {
      const row = await founderApi.addBom({ item: "New component", qty: 1, unit_cost: 0 });
      setBom((prev) => [...(prev || []), row]);
    } catch (err) {
      setActionError(err);
    }
  }, []);
  const updateBom = useCallback((id, field, value) => {
    setBom((prev) => (prev || []).map((b) => (b.id === id ? { ...b, [field]: value } : b)));
    const cast = field === "qty" || field === "unit_cost" ? Number(value) || 0 : value;
    founderApi.editBom(id, { [field]: cast }).catch((err) => setActionError(err));
  }, []);
  const removeBom = useCallback((id) => {
    setBom((prev) => (prev || []).filter((b) => b.id !== id));
    founderApi.delBom(id).catch((err) => setActionError(err));
  }, []);

  // ---- Equipment (step 2) ----
  const addEquipLine = useCallback(async () => {
    try {
      const row = await founderApi.addEquipment({ item: "New equipment", cost: 0 });
      setEquipment((prev) => [...(prev || []), row]);
    } catch (err) {
      setActionError(err);
    }
  }, []);
  const updateEquip = useCallback((id, field, value) => {
    setEquipment((prev) => (prev || []).map((e) => (e.id === id ? { ...e, [field]: value } : e)));
    const cast = field === "cost" ? Number(value) || 0 : value;
    founderApi.editEquipment(id, { [field]: cast }).catch((err) => setActionError(err));
  }, []);
  const removeEquip = useCallback((id) => {
    setEquipment((prev) => (prev || []).filter((e) => e.id !== id));
    founderApi.delEquipment(id).catch((err) => setActionError(err));
  }, []);

  const goDashboard = () => navigate("/founder/dashboard");

  if (error) return <ErrorState error={error} />;
  const loaded = team && approach && bom && equipment;
  if (!loaded) return <Loading label="Loading your organization…" />;

  const teamOptions = team.map((m) => ({
    id: m.id,
    label: (m.name || "Unnamed") + (m.title ? " · " + m.title : ""),
  }));
  const doneCount = Math.min(orgFurthest + 1, TOTAL_ORG_STEPS);

  return (
    <div className="fj-onboarding">
      <Stepper
        steps={ORG_STEP_LABELS}
        current={orgStep}
        furthest={orgFurthest}
        onGo={go}
        eyebrow="Organization building · Technology Innovator in Residence"
        progressLabel={`${doneCount} of ${TOTAL_ORG_STEPS} steps`}
      />

      {actionError && (
        <div className="fj-inline-error" role="alert">
          {actionError?.message || "Something went wrong saving that change."}
        </div>
      )}

      <div className="fj-wizard-body">
        {orgStep === 0 && (
          <TeamStep team={team} onAdd={addMember} onChange={updateMember} onRemove={removeMember} onNext={next} />
        )}

        {orgStep === 1 && (
          <RolesStep approach={approach} teamOptions={teamOptions} onSetHat={setHat} onBack={back} onNext={next} />
        )}

        {orgStep === 2 && (
          <BomStep
            bom={bom}
            equipment={equipment}
            onAddBom={addBomLine}
            onChangeBom={updateBom}
            onRemoveBom={removeBom}
            onAddEquip={addEquipLine}
            onChangeEquip={updateEquip}
            onRemoveEquip={removeEquip}
            onBack={back}
            onSaveAndGo={goDashboard}
          />
        )}
      </div>
    </div>
  );
}

// ============ STEP 0 · TEAM ============
function TeamStep({ team, onAdd, onChange, onRemove, onNext }) {
  const monthly = sum(team, "monthly_cost");

  return (
    <div className="fj-wizard" style={{ maxWidth: 980 }}>
      <span className="eyebrow eyebrow-rule">Organization building</span>
      <h1 className="fj-h1">Build your founding <span className="hl">team</span>.</h1>
      <p className="fj-help">
        Add everyone drawing from the venture — founders, hires, and contractors. Declare each
        person's approximate monthly cost <strong>inclusive of all deductions</strong> — PF,
        taxes, and benefits. This feeds the expense tracking on your dashboard.
      </p>

      <div className="fj-gt" style={{ marginTop: 30, "--gt-cols": "1fr 220px 150px 190px 44px" }}>
        <div className="fj-gt-head">
          <div>Name</div><div>Role / title</div><div>Type</div><div>Monthly cost (all-in)</div><div />
        </div>
        {team.map((m) => (
          <div className="fj-gt-row" key={m.id}>
            <div>
              <input
                className="fj-gt-input bare"
                defaultValue={m.name}
                onBlur={(e) => onChange(m.id, "name", e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div>
              <input
                className="fj-gt-input"
                defaultValue={m.title || ""}
                onBlur={(e) => onChange(m.id, "title", e.target.value)}
                placeholder="e.g. ML Engineer"
              />
            </div>
            <div>
              <select
                className="fj-gt-input"
                defaultValue={m.employment_type}
                onChange={(e) => onChange(m.id, "employment_type", e.target.value)}
              >
                <option value="full-time">Full-time</option>
                <option value="part-time">Part-time</option>
                <option value="contract">Contract</option>
                <option value="advisor">Advisor</option>
              </select>
            </div>
            <div className="fj-gt-money">
              <span className="fj-gt-rupee">₹</span>
              <input
                type="number" min="0" step="5000"
                className="fj-gt-input"
                defaultValue={m.monthly_cost}
                onBlur={(e) => onChange(m.id, "monthly_cost", e.target.value)}
              />
            </div>
            <div className="fj-gt-remove">
              <a href="#" onClick={(e) => { e.preventDefault(); onRemove(m.id); }}>×</a>
            </div>
          </div>
        ))}
        <div className="fj-gt-foot">
          <div>Monthly payroll</div><div /><div /><div>{fmtL(monthly)}</div><div />
        </div>
      </div>

      <div className="fj-org-meta">
        <div>Headcount: <strong>{team.length}</strong></div>
        <div>Annualised payroll: <strong>{fmtL(monthly * 12)}</strong></div>
      </div>

      <a href="#" className="fj-add-row" onClick={(e) => { e.preventDefault(); onAdd(); }}>+ Add a team member</a>

      <div className="fj-actions">
        <a className="btn btn-primary" href="#" onClick={(e) => { e.preventDefault(); onNext(); }}>
          <span>Assign roles &amp; responsibilities</span><span className="arrow">→</span>
        </a>
      </div>
    </div>
  );
}

// ============ STEP 1 · ROLES ============
function RolesStep({ approach, teamOptions, onSetHat, onBack, onNext }) {
  return (
    <div className="fj-wizard" style={{ maxWidth: 980 }}>
      <span className="eyebrow eyebrow-rule">Roles &amp; responsibilities</span>
      <h1 className="fj-h1">Who wears which <span className="hl">hat</span>?</h1>
      <p className="fj-help">
        Assign clear accountability across the core mandates — business, technology, and product —
        plus the customer voice. One person can wear more than one hat, and not every hat needs
        its own person; what matters is that each is owned.
      </p>

      <div className="fj-hats-grid">
        {HAT_META.map((h) => {
          const field = `${h.key}_member_id`;
          const value = approach[field] || "";
          return (
            <div className="card fj-hat-card" key={h.key} style={{ borderTopColor: h.accent }}>
              <div className="fj-hat-top">
                <div className="fj-hat-title-row">
                  <span className="fj-hat-title">{h.title} hat</span>
                  <span className="fj-hat-roles" style={{ color: h.accent }}>{h.roles}</span>
                </div>
                <p className="fj-hat-desc">{h.desc}</p>
              </div>
              <div className="fj-hat-owner">
                <span className="fj-hat-owner-label">Owned by</span>
                <select value={value} onChange={(e) => onSetHat(h.key, e.target.value)}>
                  <option value="">Unassigned</option>
                  {teamOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </div>
            </div>
          );
        })}
      </div>

      <div className="fj-actions">
        <a className="btn-ghost" href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>← Back</a>
        <a className="btn btn-primary" href="#" onClick={(e) => { e.preventDefault(); onNext(); }}>
          <span>Add BOM &amp; equipment</span><span className="arrow">→</span>
        </a>
      </div>
    </div>
  );
}

// ============ STEP 2 · BOM & EQUIPMENT ============
function BomStep({
  bom, equipment, onAddBom, onChangeBom, onRemoveBom,
  onAddEquip, onChangeEquip, onRemoveEquip, onBack, onSaveAndGo,
}) {
  const bomTotal = bom.reduce((a, b) => a + lineTotal(b), 0);
  const equipTotal = sum(equipment, "cost");
  const oneTimeTotal = bomTotal + equipTotal;

  return (
    <div className="fj-wizard" style={{ maxWidth: 980 }}>
      <span className="eyebrow eyebrow-rule">BOM &amp; equipment</span>
      <h1 className="fj-h1">Capital and <span className="hl">materials</span>.</h1>
      <p className="fj-help">
        Declare your bill of materials and the equipment you'll draw against the expense account.
        These one-time costs are tracked alongside payroll on your dashboard.
      </p>

      <div className="fj-org-subhead" style={{ marginTop: 30 }}>Bill of materials</div>
      <div className="fj-gt" style={{ "--gt-cols": "1fr 90px 150px 150px 44px" }}>
        <div className="fj-gt-head">
          <div>Item</div><div>Qty</div><div>Unit cost</div><div>Line total</div><div />
        </div>
        {bom.map((b) => (
          <div className="fj-gt-row" key={b.id}>
            <div>
              <input
                className="fj-gt-input bare"
                defaultValue={b.item}
                onBlur={(e) => onChangeBom(b.id, "item", e.target.value)}
                placeholder="Component"
              />
            </div>
            <div>
              <input
                type="number" min="0"
                className="fj-gt-input"
                defaultValue={b.qty}
                onBlur={(e) => onChangeBom(b.id, "qty", e.target.value)}
              />
            </div>
            <div className="fj-gt-money">
              <span className="fj-gt-rupee">₹</span>
              <input
                type="number" min="0" step="500"
                className="fj-gt-input"
                defaultValue={b.unit_cost}
                onBlur={(e) => onChangeBom(b.id, "unit_cost", e.target.value)}
              />
            </div>
            <div className="fj-gt-line">{fmtINR(lineTotal(b))}</div>
            <div className="fj-gt-remove">
              <a href="#" onClick={(e) => { e.preventDefault(); onRemoveBom(b.id); }}>×</a>
            </div>
          </div>
        ))}
        <div className="fj-gt-foot">
          <div>BOM subtotal</div><div /><div /><div>{fmtL(bomTotal)}</div><div />
        </div>
      </div>
      <a href="#" className="fj-add-row sm" onClick={(e) => { e.preventDefault(); onAddBom(); }}>+ Add BOM line</a>

      <div className="fj-org-subhead">Equipment</div>
      <div className="fj-gt" style={{ "--gt-cols": "1fr 200px 44px" }}>
        <div className="fj-gt-head">
          <div>Equipment</div><div>Cost</div><div />
        </div>
        {equipment.map((e) => (
          <div className="fj-gt-row" key={e.id}>
            <div>
              <input
                className="fj-gt-input bare"
                defaultValue={e.item}
                onBlur={(ev) => onChangeEquip(e.id, "item", ev.target.value)}
                placeholder="Equipment"
              />
            </div>
            <div className="fj-gt-money">
              <span className="fj-gt-rupee">₹</span>
              <input
                type="number" min="0" step="5000"
                className="fj-gt-input"
                defaultValue={e.cost}
                onBlur={(ev) => onChangeEquip(e.id, "cost", ev.target.value)}
              />
            </div>
            <div className="fj-gt-remove">
              <a href="#" onClick={(ev) => { ev.preventDefault(); onRemoveEquip(e.id); }}>×</a>
            </div>
          </div>
        ))}
        <div className="fj-gt-foot">
          <div>Equipment subtotal</div><div>{fmtL(equipTotal)}</div><div />
        </div>
      </div>
      <a href="#" className="fj-add-row sm" onClick={(e) => { e.preventDefault(); onAddEquip(); }}>+ Add equipment</a>

      <div className="card card-black fj-capital-total">
        <div className="fj-capital-total-label">
          <span className="fj-capital-total-eyebrow">One-time capital total</span>
          <span className="fj-capital-total-value">{fmtL(oneTimeTotal)}</span>
        </div>
        <span className="fj-capital-total-note">
          Tracked against your ₹25L non-dilutive expense account, alongside payroll.
        </span>
      </div>

      <div className="fj-actions">
        <a className="btn-ghost" href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>← Back</a>
        <a className="btn btn-primary" href="#" onClick={(e) => { e.preventDefault(); onSaveAndGo(); }}>
          <span>Save &amp; view dashboard</span><span className="arrow">→</span>
        </a>
      </div>
    </div>
  );
}
