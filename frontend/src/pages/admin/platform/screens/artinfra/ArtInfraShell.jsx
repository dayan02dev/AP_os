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
import ArtInfraReviews from "./ArtInfraReviews.jsx";
import ArtInfraInsights from "./ArtInfraInsights.jsx";

const VIEWS = [
  { id: "catalog", label: "Catalog" },
  { id: "vendors", label: "Vendors" },
  { id: "categories", label: "Categories" },
  { id: "reviews", label: "Reviews" },
  { id: "insights", label: "Insights" },
];

export default function ArtInfraShell({ store = artInfraMock }) {
  const [view, setView] = useState("catalog");
  const [editingId, setEditingId] = useState(null);
  const [pending, setPending] = useState(0);

  // Silently ignored: a failed badge fetch should not surface a screen-level
  // error banner over sub-nav — the worst case is a stale/missing count,
  // which the next successful poll corrects.
  const refreshPending = () =>
    store.listReviews({ status: "pending" }).then((r) => setPending(r.length)).catch(() => {});
  useEffect(() => { refreshPending(); }, [store, view]);

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
      {view === "reviews" && <ArtInfraReviews store={store} onChange={refreshPending} />}
      {view === "insights" && <ArtInfraInsights store={store} />}
    </div>
  );
}
