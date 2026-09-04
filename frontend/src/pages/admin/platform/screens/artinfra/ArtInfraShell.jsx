// Sub-navigation for the six Art Infra admin views. The editor is not in the
// sub-nav: it is reached by opening a row from the catalog, the same way
// AdminDetail is reached from AdminPipeline.

import "../../../../../styles/art-infra-admin.css";

import { useEffect, useState } from "react";
import { artInfraMock } from "../../../../../lib/artInfraMock.js";
import ArtInfraCatalog from "./ArtInfraCatalog.jsx";
import ArtInfraProductEditor from "./ArtInfraProductEditor.jsx";
import ArtInfraVendors from "./ArtInfraVendors.jsx";
import ArtInfraCategories from "./ArtInfraCategories.jsx";
import ArtInfraRequests from "./ArtInfraRequests.jsx";
import ArtInfraReviews from "./ArtInfraReviews.jsx";
import ArtInfraInsights from "./ArtInfraInsights.jsx";

const VIEWS = [
  { id: "catalog", label: "Catalog" },
  { id: "vendors", label: "Vendors" },
  { id: "categories", label: "Categories" },
  { id: "requests", label: "Requests" },
  { id: "reviews", label: "Reviews" },
  { id: "insights", label: "Insights" },
];

export default function ArtInfraShell({ store = artInfraMock }) {
  const [view, setView] = useState("catalog");
  const [editingId, setEditingId] = useState(null);
  const [pending, setPending] = useState(0);
  const [pendingReqs, setPendingReqs] = useState(0);

  // Silently ignored: a failed badge fetch should not surface a screen-level
  // error banner over sub-nav — the worst case is a stale/missing count,
  // which the next successful poll corrects.
  const refreshBadges = () => {
    // listVendorReviews, not Phase 1's listReviews -- Task 4 already replaced
    // the store, so the old name resolves to undefined and `.then` would throw.
    store.listVendorReviews({ status: "pending" })
      .then((r) => setPending(r.length)).catch(() => {});
    store.listRequests({ status: "pending" })
      .then((r) => setPendingReqs(r.length)).catch(() => {});
  };
  useEffect(() => { refreshBadges(); }, [store, view]);

  const goEditor = (productId) => { setEditingId(productId); setView("editor"); };
  const backToCatalog = () => { setEditingId(null); setView("catalog"); };

  return (
    <div className="ai-admin">
      <nav className="ai-subnav" aria-label="Art Infra sections">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`ai-subnav-btn${view === v.id ? " is-on" : ""}`}
            aria-current={view === v.id ? "page" : undefined}
            onClick={() => { setEditingId(null); setView(v.id); }}
          >
            {v.label}
            {v.id === "requests" && pendingReqs > 0 && (
              <span className="ai-badge" data-testid="artinfra-requests-badge">{pendingReqs}</span>
            )}
            {v.id === "reviews" && pending > 0 && (
              <span className="ai-badge" data-testid="artinfra-pending-badge">{pending}</span>
            )}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button type="button" className="os-btn" onClick={() => goEditor(null)}>
          + New product
        </button>
      </nav>

      {view === "catalog" && <ArtInfraCatalog store={store} goEditor={goEditor} />}
      {view === "editor" && (
        <ArtInfraProductEditor store={store} productId={editingId} onDone={backToCatalog} />
      )}
      {view === "vendors" && <ArtInfraVendors store={store} />}
      {view === "categories" && <ArtInfraCategories store={store} />}
      {view === "requests" && <ArtInfraRequests store={store} onChange={refreshBadges} />}
      {view === "reviews" && <ArtInfraReviews store={store} onChange={refreshBadges} />}
      {view === "insights" && <ArtInfraInsights store={store} />}
    </div>
  );
}
