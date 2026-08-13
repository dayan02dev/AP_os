import { useEffect, useState } from "react";
import { founderApi } from "../../lib/founderApi.js";
import { Loading, ErrorState } from "./ui.jsx";

export default function FounderFundraising() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = () => founderApi.getFundraising().then(setData).catch(setError);
  useEffect(() => { load(); }, []);

  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading label="Loading fundraising resources…" />;

  const requestedCount = data.investors.filter((i) => i.intro_requested).length;

  const toggle = async (id) => {
    setBusyId(id);
    try {
      await founderApi.toggleIntro(id);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <span className="eyebrow eyebrow-rule">Founders resources</span>
      <h1 className="big">Fundraising support &amp; <span className="hl">connects</span>.</h1>
      <p className="lead">
        Warm intros to investors who back deep-tech at your stage, plus the templates and
        data-room scaffolding to be ready when you meet them.
      </p>

      <div className="stats-row">
        <div>Matched: <strong>{data.investors.length}</strong></div>
        <div>Intros requested: <strong>{requestedCount}</strong></div>
      </div>

      <div className="section-title mt28">Your matched investors</div>
      <div className="icards mt16">
        {data.investors.map((i) => (
          <div className="icard" key={i.id}>
            <div className="ih">
              <div><span className="inm">{i.name}</span> <span className="isub">· {i.firm}</span></div>
              <span className="thesis">{i.thesis}</span>
            </div>
            <div className="isub">{i.focus} · cheque {i.cheque}</div>
            <div className="foot">
              <span className={`st ${i.intro_requested ? "amber" : ""}`}>
                <span className="d" />
                {i.intro_requested ? "Intro requested" : "Suggested match"}
              </span>
              <button
                type="button"
                className={`mini ${i.intro_requested ? "ghost" : ""}`}
                disabled={busyId === i.id}
                onClick={() => toggle(i.id)}
              >
                {i.intro_requested ? "Cancel request" : "Request intro"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="section-title mt28">Fundraising toolkit</div>
      <div className="tiles c4 mt16">
        {data.tools.map((t) => (
          <a className="tool" href="#" key={t.name} onClick={(e) => e.preventDefault()}>
            <span className="tn">{t.name}</span>
            <span className="td">{t.desc}</span>
            <span className="topen">Open →</span>
          </a>
        ))}
      </div>
    </div>
  );
}
