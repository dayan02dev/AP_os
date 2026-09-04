// Vendor portal shell. The editor is not in the sub-nav: it is reached by
// opening a row from the catalog, the same way AdminDetail is reached from
// AdminPipeline.
//
// The view-as picker stands in for vendor authentication, which does not exist
// in this phase. It is the ONLY place the acting vendor id is decided --
// every screen takes it as a prop so that swapping in a real session later
// touches one file.

import "../../styles/vendor-portal.css";

import { useEffect, useState } from "react";
import { artInfraMock } from "../../lib/artInfraMock.js";
import VendorProfile from "./VendorProfile.jsx";
import VendorCatalog from "./VendorCatalog.jsx";
import VendorProductEditor from "./VendorProductEditor.jsx";

const VIEWS = [
  { id: "profile", label: "Profile" },
  { id: "catalog", label: "My catalog" },
];

export default function VendorPortal({ store = artInfraMock }) {
  const [vendors, setVendors] = useState([]);
  const [vendorId, setVendorId] = useState("");
  const [view, setView] = useState("profile");
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    let live = true;
    store.adminListVendors().then((rows) => {
      if (!live) return;
      setVendors(rows);
      setVendorId((cur) => cur || rows[0]?.id || "");
    }).catch(() => { if (live) setVendors([]); });
    return () => { live = false; };
  }, [store]);

  const goEditor = (productId) => { setEditingId(productId); setView("editor"); };
  const backToCatalog = () => { setEditingId(null); setView("catalog"); };

  if (!vendorId) {
    return (
      <div className="vendor-portal">
        <div className="vp-loading">Loading…</div>
      </div>
    );
  }

  return (
    <div className="vendor-portal">
      <nav className="vp-subnav" aria-label="Vendor sections">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`vp-subnav-btn${view === v.id ? " is-on" : ""}`}
            aria-current={view === v.id ? "page" : undefined}
            onClick={() => { setEditingId(null); setView(v.id); }}
          >
            {v.label}
          </button>
        ))}
        <div className="vp-subnav-spacer" />
        <label className="vp-viewas">
          <span>Viewing as</span>
          <select
            className="os-input"
            aria-label="Viewing as vendor"
            value={vendorId}
            onChange={(e) => { setEditingId(null); setVendorId(e.target.value); }}
          >
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.display_name || v.name}</option>
            ))}
          </select>
        </label>
        <button type="button" className="os-btn" onClick={() => goEditor(null)}>
          + New product
        </button>
      </nav>

      {view === "profile" && <VendorProfile store={store} vendorId={vendorId} />}
      {view === "catalog" && <VendorCatalog store={store} vendorId={vendorId} goEditor={goEditor} />}
      {view === "editor" && (
        <VendorProductEditor store={store} vendorId={vendorId}
          productId={editingId} onDone={backToCatalog} />
      )}
    </div>
  );
}
