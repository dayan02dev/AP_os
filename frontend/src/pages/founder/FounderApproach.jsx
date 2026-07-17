import { useEffect, useState } from "react";
import { founderApi } from "../../lib/founderApi.js";
import { Loading, ErrorState } from "./ui.jsx";

const HATS = [
  { key: "business_member_id", label: "Business" },
  { key: "technology_member_id", label: "Technology" },
  { key: "product_member_id", label: "Product" },
  { key: "customer_member_id", label: "Customer" },
];

export default function FounderApproach() {
  const [team, setTeam] = useState([]);
  const [hats, setHats] = useState({});
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([founderApi.listTeam(), founderApi.getApproach()])
      .then(([t, a]) => { setTeam(t || []); setHats(a || {}); })
      .catch(setError);
  }, []);

  const setHat = async (key, value) => {
    const next = { ...hats, [key]: value || null };
    setHats(next); setSaved(false);
    await founderApi.putApproach({
      business_member_id: next.business_member_id || null,
      technology_member_id: next.technology_member_id || null,
      product_member_id: next.product_member_id || null,
      customer_member_id: next.customer_member_id || null,
      notes: next.notes || null,
    });
    setSaved(true);
  };

  if (error) return <ErrorState error={error} />;
  if (!team) return <Loading />;

  return (
    <div>
      <span className="eyebrow eyebrow-rule">Cohort management · Approach</span>
      <h1 className="big" style={{ fontFamily: "var(--font-display)" }}>Who wears which hat.</h1>
      <p className="lead">Assign an owner for each of the four founder responsibilities. Add people in Organization first.</p>
      <div className="grid2 mt28">
        {HATS.map((h) => (
          <div key={h.key} className="panel">
            <div className="panel-h">{h.label}</div>
            <select className="inp" value={hats[h.key] || ""} onChange={(e) => setHat(h.key, e.target.value)}>
              <option value="">— unassigned —</option>
              {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        ))}
      </div>
      {saved && <div className="saved" style={{ marginTop: 12 }}>SAVED ✓</div>}
    </div>
  );
}
