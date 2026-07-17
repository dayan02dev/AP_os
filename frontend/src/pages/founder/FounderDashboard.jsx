import { useEffect, useState } from "react";
import { founderApi } from "../../lib/founderApi.js";
import { fmtINR, Tile, Loading, ErrorState } from "./ui.jsx";

export default function FounderDashboard() {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { founderApi.getDashboard().then(setD).catch(setError); }, []);
  if (error) return <ErrorState error={error} />;
  if (!d) return <Loading />;
  return (
    <div>
      <span className="eyebrow eyebrow-rule">Dashboard reporting · Process dashboard</span>
      <h1 className="big" style={{ fontFamily: "var(--font-display)" }}>Where things stand.</h1>
      <div className="tiles mt16">
        <Tile k="Onboarding" v={`${d.onboarding_pct}%`} s={d.mou_signed ? "MOU signed" : "MOU pending"}>
          <div className="bar"><i style={{ width: `${d.onboarding_pct}%` }} /></div>
        </Tile>
        <Tile k="Headcount" v={d.headcount} s="team members" />
        <Tile k="Monthly payroll" v={fmtINR(d.payroll_monthly)} s={`${fmtINR(d.payroll_annual)} annualised`} />
        <Tile k="Capital (BOM + equip)" v={fmtINR(d.capital_total)} s="one-time" />
        <Tile k="Budget drawn" v={fmtINR(d.budget_drawn)}>
          <div className="bar"><i style={{ width: `${d.budget_pct}%` }} /></div>
          <div className="s">{d.budget_pct}% of {fmtINR(d.grant_amount)}</div>
        </Tile>
        <Tile k="Procurement" v={`${d.proc_count} items`} s={`${fmtINR(d.proc_committed)} committed`} />
      </div>
    </div>
  );
}
