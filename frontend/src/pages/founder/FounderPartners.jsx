import { useEffect, useState } from "react";
import { founderApi } from "../../lib/founderApi.js";
import { Loading, ErrorState } from "./ui.jsx";

export default function FounderPartners() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = () => founderApi.getPartners().then(setData).catch(setError);
  useEffect(() => { load(); }, []);

  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading label="Loading corporate partners…" />;

  const toggle = async (id) => {
    setBusyId(id);
    try {
      await founderApi.togglePartner(id);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <span className="eyebrow eyebrow-rule">Founders resources</span>
      <h1 className="big">Corporate partner <span className="hl">connections</span>.</h1>
      <p className="lead">
        ARTPARK's corporate network — for pilots, distribution, and co-development. Request an
        intro and we'll broker the conversation.
      </p>

      <div className="icards mt28">
        {data.partners.map((p) => (
          <div className="icard" key={p.id}>
            <div className="ih">
              <span className="inm">{p.name}</span>
              <span className="sector">{p.sector}</span>
            </div>
            <div className="isub">{p.offer}</div>
            <div className="mt8">
              <button
                type="button"
                className={`mini ${p.requested ? "done" : ""}`}
                disabled={busyId === p.id}
                onClick={() => toggle(p.id)}
              >
                {p.requested ? "Request sent ✓" : "Request connection"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
