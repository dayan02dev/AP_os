import { useEffect, useState } from "react";
import { founderApi } from "../../lib/founderApi.js";
import { fmtINR, Tile, Loading, ErrorState } from "./ui.jsx";

const PROC_STATUS = ["estimate", "quoted", "po", "received"];

export default function FounderExpense() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [bom, setBom] = useState({ item: "", qty: 0, unit_cost: 0 });
  const [equip, setEquip] = useState({ item: "", cost: 0 });

  const load = () => founderApi.getExpense().then(setData).catch(setError);
  useEffect(() => { load(); }, []);

  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading />;
  const t = data.totals;

  const addBom = async () => { if (!bom.item.trim()) return; await founderApi.addBom({ ...bom, qty: Number(bom.qty) || 0, unit_cost: Number(bom.unit_cost) || 0 }); setBom({ item: "", qty: 0, unit_cost: 0 }); load(); };
  const addEquip = async () => { if (!equip.item.trim()) return; await founderApi.addEquipment({ ...equip, cost: Number(equip.cost) || 0 }); setEquip({ item: "", cost: 0 }); load(); };

  return (
    <div>
      <span className="eyebrow eyebrow-rule">Cohort management · Expense management</span>
      <div className="tiles mt16">
        <Tile k="Estimated total" v={fmtINR(t.proc_estimate)} s="from BOM & equipment" />
        <Tile k="Quoted total" v={fmtINR(t.proc_quoted)} s={`${fmtINR(t.proc_quoted - t.proc_estimate)} vs estimate`} />
        <Tile k="Budget drawn" v={fmtINR(data.budget_drawn)}>
          <div className="bar"><i style={{ width: `${data.budget_pct}%` }} /></div>
          <div className="s">{data.budget_pct}% of {fmtINR(data.grant_amount)} non-dilutive</div>
        </Tile>
      </div>

      {/* BOM */}
      <div className="panel mt28"><div className="panel-h">Bill of materials</div>
        <table className="tbl"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th><th></th></tr></thead>
          <tbody>
            {data.bom.map((b) => (
              <tr key={b.id}><td>{b.item}</td><td>{b.qty}</td><td>{fmtINR(b.unit_cost)}</td><td>{fmtINR(b.qty * b.unit_cost)}</td>
                <td><button className="btn-icon" onClick={async () => { await founderApi.delBom(b.id); load(); }}>✕</button></td></tr>
            ))}
            <tr className="draft-row">
              <td><input className="cell" placeholder="Item" value={bom.item} onChange={(e) => setBom({ ...bom, item: e.target.value })} /></td>
              <td><input className="cell" type="number" value={bom.qty} onChange={(e) => setBom({ ...bom, qty: e.target.value })} /></td>
              <td><input className="cell" type="number" value={bom.unit_cost} onChange={(e) => setBom({ ...bom, unit_cost: e.target.value })} /></td>
              <td></td><td><button className="btn" onClick={addBom}>Add</button></td>
            </tr>
          </tbody>
          <tfoot><tr className="tfoot"><td>BOM total</td><td></td><td></td><td>{fmtINR(t.bom_total)}</td><td></td></tr></tfoot>
        </table>
      </div>

      {/* Equipment */}
      <div className="panel mt28"><div className="panel-h">Equipment</div>
        <table className="tbl"><thead><tr><th>Item</th><th>Cost</th><th></th></tr></thead>
          <tbody>
            {data.equipment.map((e) => (
              <tr key={e.id}><td>{e.item}</td><td>{fmtINR(e.cost)}</td>
                <td><button className="btn-icon" onClick={async () => { await founderApi.delEquipment(e.id); load(); }}>✕</button></td></tr>
            ))}
            <tr className="draft-row">
              <td><input className="cell" placeholder="Item" value={equip.item} onChange={(e) => setEquip({ ...equip, item: e.target.value })} /></td>
              <td><input className="cell" type="number" value={equip.cost} onChange={(e) => setEquip({ ...equip, cost: e.target.value })} /></td>
              <td><button className="btn" onClick={addEquip}>Add</button></td>
            </tr>
          </tbody>
          <tfoot><tr className="tfoot"><td>Equipment total</td><td>{fmtINR(t.equipment_total)}</td><td></td></tr></tfoot>
        </table>
      </div>

      {/* Procurement tracking */}
      <div className="panel mt28"><div className="panel-h">Procurement tracking</div>
        <table className="tbl"><thead><tr><th>Item</th><th>Vendor</th><th>Est.</th><th>Quote</th><th>Lead</th><th>Status</th></tr></thead>
          <tbody>
            {data.procurement.map((p) => (
              <tr key={p.id}>
                <td>{p.item}</td>
                <td><input className="cell" defaultValue={p.vendor || ""} onBlur={async (e) => { await founderApi.editProcurement(p.id, { vendor: e.target.value }); load(); }} /></td>
                <td>{fmtINR(p.estimate)}</td>
                <td><input className="cell" type="number" defaultValue={p.quote} onBlur={async (e) => { await founderApi.editProcurement(p.id, { quote: Number(e.target.value) || 0 }); load(); }} /></td>
                <td>{p.lead_weeks}w</td>
                <td>
                  <select className="cell" defaultValue={p.status} onChange={async (e) => { await founderApi.editProcurement(p.id, { status: e.target.value }); load(); }}>
                    {PROC_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="muted mt16">Committed {fmtINR(t.proc_committed)} · Quoted {fmtINR(t.proc_quoted)} · {data.procurement.length} items</div>
      </div>
    </div>
  );
}
