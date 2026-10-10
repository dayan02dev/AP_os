// VipNavigatorMemo — the "VIP memo · Navigator" for the pilot VIP applications.
// Renders the v2 memo JSON (backend ai_screening.sections.vip_memo_v2; contract
// in the VIP memo schema): header, snapshot, then a section rail (01–10 +
// Questions) beside one panel at a time. Long text may be a string or a list of
// bullet points (an item may be [lead, ...sub-points]). Reading progress is kept
// per viewer in localStorage. For print, every section is stacked.
import React, { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import "./VipNavigatorMemo.css";

const TBC = "[To be confirmed]";
const ORDER = ["what", "why", "product", "tech", "competitors", "market", "team", "milestones", "funds", "risks"];
const SEQUENCE = [...ORDER, "questions"];
const TITLES = {
  what: "What the company does",
  why: "Why it matters",
  product: "The product",
  tech: "Technology edge",
  competitors: "Competitors",
  market: "Market",
  team: "Team and ownership",
  milestones: "12-month plan",
  funds: "Use of funds",
  risks: "Risks and how they're handled",
  questions: "Questions for the founders",
};
const SHADES = ["1", ".78", ".56", ".38", ".2"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n) => (n < 10 ? "0" : "") + n;
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const readKey = (appId) => `vipnav.read.${appId}`;

function loadRead(appId) {
  try {
    const parsed = JSON.parse(localStorage.getItem(readKey(appId)) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveRead(appId, read) {
  try {
    localStorage.setItem(readKey(appId), JSON.stringify(read));
  } catch {
    // Storage unavailable: progress simply isn't remembered.
  }
}

function formatDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!m) return value ? String(value) : "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}

export function Pending() {
  return (
    <span className="m3-pending" title="Not yet confirmed — needs checking with the founders">To confirm</span>
  );
}

/** Text with every "[To be confirmed]" replaced by the dashed chip. */
export function T({ children }) {
  if (children == null || children === "") return null;
  const text = String(children);
  if (!text.includes(TBC)) return text;
  const parts = text.split(TBC);
  return (
    <>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {part}
          {i < parts.length - 1 && <Pending />}
        </React.Fragment>
      ))}
    </>
  );
}

const blank = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

/** Long text: a string is a paragraph (bare text when className is null); a
 *  list is bullets, where an item may itself be [lead, ...sub-points]. */
function Points({ value, className = "m3-p", variant }) {
  if (blank(value)) return null;
  if (!Array.isArray(value)) return className ? <p className={className}><T>{value}</T></p> : <T>{value}</T>;
  return (
    <ul className={variant ? `m3-pts ${variant}` : "m3-pts"}>
      {value.filter((v) => !blank(v)).map((it, i) => (Array.isArray(it) ? (
        <li key={i}>
          <span className="lead"><T>{it[0]}</T></span>
          {it.length > 1 && (
            <ul className="m3-pts sub">{it.slice(1).map((x, j) => <li key={j}><T>{x}</T></li>)}</ul>
          )}
        </li>
      ) : <li key={i}><T>{it}</T></li>))}
    </ul>
  );
}

/** One labelled line inside a card. */
const Row = ({ k, v }) => (blank(v) ? null : (
  <div className="m3-card-row">
    <span className="k">{k}</span>
    <div className="v"><Points value={v} className={null} /></div>
  </div>
));

function Table({ head, rows, numeric = [] }) {
  return (
    <div className="m3-tblwrap">
      <table className="m3-tbl">
        <thead>
          <tr>{head.map((h, i) => <th key={i} className={numeric.includes(i) ? "n" : undefined}><T>{h}</T></th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {head.map((_, j) => (
                <td key={j} className={j === 0 ? "b" : numeric.includes(j) ? "n" : undefined}>
                  {blank(r[j]) ? <span className="s">—</span> : <Points value={r[j]} className={null} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Def({ rows }) {
  return (
    <dl className="m3-def">
      {arr(rows).map((r, i) => (
        <div key={i}><dt><T>{arr(r)[0]}</T></dt><dd><Points value={arr(r)[1]} className={null} /></dd></div>
      ))}
    </dl>
  );
}

const Short = ({ label, children }) => {
  if (blank(children)) return null;
  if (!Array.isArray(children)) return <p className="m3-short"><b>{label}</b> <T>{children}</T></p>;
  return <div className="m3-short"><b>{label}</b><Points value={children} /></div>;
};
const Note = ({ children }) => {
  if (blank(children)) return null;
  if (!Array.isArray(children)) return <p className="m3-note"><T>{children}</T></p>;
  return <div className="m3-note"><Points value={children} /></div>;
};

const BODY = {
  what: (m, s) => (
    <>
      <Points value={arr(s.paragraphs)} />
      {Array.isArray(s.analogy) ? (
        <div className="m3-block"><b className="m3-lbl">Think of it like this:</b><Points value={s.analogy} /></div>
      ) : s.analogy && <p className="m3-p"><b>Think of it like this:</b> <T>{s.analogy}</T></p>}
      <Short label="In short:">{s.in_short || m.in_short}</Short>
    </>
  ),
  why: (m, s) => <Def rows={s.rows} />,
  product: (m, s) => {
    const head = arr(s.columns).length ? s.columns : ["Offer", "What the buyer gets", "Indicative price"];
    return (
      <>
        <div className="m3-cards">
          {arr(s.offers).map(arr).map((o, i) => (
            <article className="m3-card" key={i}>
              <h5 className="m3-card-h"><T>{o[0]}</T></h5>
              <Row k={<T>{head[1]}</T>} v={o[1]} />
              <Row k={<T>{head[2]}</T>} v={o[2]} />
            </article>
          ))}
        </div>
        <Note>{s.note}</Note>
      </>
    );
  },
  tech: (m, s) => <Def rows={s.rows} />,
  competitors: (m, s) => (
    <>
      {arr(s.groups).map(obj).map((g, gi) => (
        <div className="m3-group" key={gi}>
          <span className="m3-subh"><T>{g.segment}</T></span>
          <div className="m3-cards">
            {arr(g.rows).map(arr).map((r, i) => (
              <article className="m3-card" key={i}>
                <h5 className="m3-card-h"><T>{r[0]}</T></h5>
                <Row k="What they do" v={r[1]} />
                <Row k="Key limitation" v={r[2]} />
                <Row k={`${m.name} advantage`} v={r[3]} />
                <Row k="Stage" v={r[4]} />
              </article>
            ))}
          </div>
        </div>
      ))}
      <Note>{s.note}</Note>
    </>
  ),
  market: (m, s) => {
    const rows = arr(s.rows).map(obj);
    const max = Math.max(0, ...rows.map((r) => Number(r.slice_high_cr) || 0)) || 1;
    const pct = (v) => `${Math.max(0, Math.min(100, ((Number(v) || 0) / max) * 100))}%`;
    return (
      <>
        <div className="m3-mkt">
          {rows.map((r, i) => (
            <div className="m3-mrow" key={i}>
              <span className="l">
                <T>{r.segment}</T>
                {(r.global_size || r.rationale) && (
                  <small>
                    {r.global_size && <><T>{r.global_size}</T> globally</>}
                    {r.global_size && r.rationale && " · "}
                    <T>{r.rationale}</T>
                  </small>
                )}
              </span>
              <span className="t">
                <span className="hi" style={{ width: pct(r.slice_high_cr) }} />
                <span className="lo" style={{ width: pct(r.slice_low_cr) }} />
              </span>
              <span className="v"><T>{r.slice_label}</T></span>
              {r.source && <span className="src">Source · <T>{r.source}</T></span>}
            </div>
          ))}
        </div>
        <div className="m3-key">
          <span><i />Conservative estimate</span>
          <span><i className="pale" />Up to the upper estimate</span>
        </div>
        <div className="m3-total">
          <span className="k">Realistic opportunity, per year</span>
          <span className="n"><T>{s.total}</T></span>
        </div>
        <Short label="Start here:">{s.beachhead}</Short>
        <Note>{s.tam_note}</Note>
      </>
    );
  },
  team: (m, s) => (
    <>
      {arr(s.members).length > 0 && (
        <Table head={["Name", "Role", "Background"]}
          rows={arr(s.members).map((p) => [obj(p).name, obj(p).role, obj(p).background])} />
      )}
      {arr(s.holders).length > 0 && (
        <div className="m3-tblwrap">
          <table className="m3-tbl">
            <thead><tr><th>Holder</th><th>Type</th><th className="n">Equity</th></tr></thead>
            <tbody>
              {arr(s.holders).map((h, i) => (
                <tr key={i}>
                  <td className={arr(h)[3] ? "b" : undefined}><T>{arr(h)[0]}</T></td>
                  <td className="s"><T>{arr(h)[1]}</T></td>
                  <td className="n">{arr(h)[2] == null ? "—" : `${arr(h)[2]}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Note>{s.notes}</Note>
      {arr(s.confirm).length > 0 && (
        <>
          <span className="m3-subh">To check with the founders</span>
          <ul className="m3-confirm">
            {arr(s.confirm).map((c, i) => <li key={i}><Pending /><span><T>{c}</T></span></li>)}
          </ul>
        </>
      )}
    </>
  ),
  milestones: (m, s) => (
    <>
      <Table head={["When", "Milestone", "Target"]} rows={arr(s.rows).map(arr)} numeric={[2]} />
      <Short label="Asks ARTPARK for:">{s.infra}</Short>
      <Note>{s.note}</Note>
    </>
  ),
  funds: (m, s) => {
    const rows = arr(s.rows).map(arr);
    return (
      <>
        <div className="m3-stack" role="img" aria-label="Use of funds split">
          {rows.map((r, i) => (
            <i key={i} title={String(r[0] ?? "")}
              style={{ width: `${Number(r[2]) || 0}%`, background: `rgba(50,19,183,${SHADES[i % 5]})` }} />
          ))}
        </div>
        <div className="m3-legend">
          {rows.map((r, i) => (
            <div key={i}>
              <span className="sw" style={{ background: `rgba(50,19,183,${SHADES[i % 5]})` }} />
              <span className="c"><T>{r[0]}</T>{r[1] && <small><T>{r[1]}</T></small>}</span>
              <span className="p">{r[2] == null ? "—" : `${r[2]}%`}</span>
              <span className="a"><T>{r[3]}</T></span>
            </div>
          ))}
        </div>
        <div className="m3-total">
          <span className="k">Total</span>
          <span className="n"><T>{s.total}</T></span>
        </div>
        <Note>{s.note}</Note>
      </>
    );
  },
  risks: (m, s) => (
    <div className="m3-cards one">
      {arr(s.rows).map((r, i) => {
        const o = Array.isArray(r) ? { risk: r[0], handled: r[1] } : obj(r);
        return (
          <article className="m3-card" key={i}>
            {o.title && <h5 className="m3-card-h"><T>{o.title}</T></h5>}
            <Row k="Risk" v={o.risk} />
            <Row k="How it is handled" v={o.handled} />
          </article>
        );
      })}
    </div>
  ),
  questions: (m) => (
    <>
      <p className="m3-p">Every open point in this memo, written as a question to send to the founders or ask in the interview.</p>
      <ol className="mc-qs">{arr(m.questions).map((q, i) => <li key={i}><T>{q}</T></li>)}</ol>
    </>
  ),
};

function sectionLabel(k) {
  return k === "questions" ? `Next step · ${TITLES.questions}` : `${pad(ORDER.indexOf(k) + 1)} of ${ORDER.length} · ${TITLES[k]}`;
}

function SectionContent({ memo, k }) {
  const say = k === "questions" ? "What to ask before deciding." : obj(memo.takeaways)[k];
  const src = k === "questions" ? null : obj(memo.sources)[k];
  return (
    <>
      <span className="m3-eyebrow">{sectionLabel(k)}</span>
      {say && <h4 className="mc-say"><T>{say}</T></h4>}
      {src && <span className="m3-src">Sources · {src}</span>}
      {BODY[k](memo, obj(obj(memo.sections)[k]))}
    </>
  );
}

function Snapshot({ memo }) {
  const s = obj(memo.snapshot);
  const v = (key) => obj(s[key]).value;
  const n = (key) => obj(s[key]).note;
  const cells = [
    ["Ask", <dd className="ask" key="v"><T>{v("ask")}</T></dd>,
      <dd className="note" key="n">
        {n("ask") && <T>{n("ask")}</T>}
        {n("ask") && v("instrument") != null && " · "}
        {v("instrument") != null && <>instrument <T>{v("instrument")}</T></>}
      </dd>],
    ["Sector", <dd key="v"><T>{v("sector")}</T></dd>, <dd className="note" key="n"><T>{n("sector")}</T></dd>],
    ["Stage", <dd key="v"><T>{v("stage")}</T></dd>, <dd className="note" key="n"><T>{n("stage")}</T></dd>],
    ["Location", <dd key="v"><T>{v("location")}</T></dd>, <dd className="note" key="n"><T>{n("location")}</T></dd>],
    ["Team", <dd key="v"><T>{v("team")}</T></dd>, <dd className="note" key="n"><T>{n("team")}</T></dd>],
  ];
  return (
    <dl className="m3-snap" data-testid="vipnav-snapshot">
      {cells.map(([label, value, note]) => (
        <div key={label}><dt>{label}</dt>{value}{note}</div>
      ))}
    </dl>
  );
}

export default function VipNavigatorMemo({ memo, appId, onDownload }) {
  const [cur, setCur] = useState("what");
  const [read, setRead] = useState(() => {
    const r = loadRead(appId);
    if (!r.what) { r.what = 1; saveRead(appId, r); }
    return r;
  });
  const [printing, setPrinting] = useState(false);

  const go = useCallback((k) => {
    setCur(k);
    if (ORDER.includes(k)) {
      setRead((prev) => {
        if (prev[k]) return prev;
        const next = { ...prev, [k]: 1 };
        saveRead(appId, next);
        return next;
      });
    }
  }, [appId]);

  useEffect(() => {
    const on = () => flushSync(() => setPrinting(true));
    const off = () => setPrinting(false);
    window.addEventListener("beforeprint", on);
    window.addEventListener("afterprint", off);
    return () => {
      window.removeEventListener("beforeprint", on);
      window.removeEventListener("afterprint", off);
    };
  }, []);

  if (!memo) return null;
  const name = memo.name || "This company";
  const files = arr(memo.source_files).length;
  const done = ORDER.filter((k) => read[k]).length;
  const i = SEQUENCE.indexOf(cur);
  const prev = i > 0 ? SEQUENCE[i - 1] : null;
  const next = i < SEQUENCE.length - 1 ? SEQUENCE[i + 1] : null;

  const onKeyDown = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || "")) return;
    e.preventDefault();
    e.stopPropagation();
    const j = e.key === "ArrowRight" ? Math.min(SEQUENCE.length - 1, i + 1) : Math.max(0, i - 1);
    if (j !== i) go(SEQUENCE[j]);
  };

  return (
    <div className="vipnav m3 mc" tabIndex={-1} onKeyDown={onKeyDown}>
      <span className="m3-eyebrow rule">VIP memo · {name}</span>
      {memo.headline && <h3 className="m3-headline"><T>{memo.headline}</T></h3>}
      <Points value={memo.plain} className="m3-plain" variant="lg" />
      <div className="m3-headrow">
        <p className="m3-meta" data-testid="vipnav-meta">
          Prepared by {memo.prepared_by || "the ARTPARK venture team"} from the <b>application</b>,{" "}
          <b>{files} uploaded file{files === 1 ? "" : "s"}</b> and <b>independent research</b>
          {memo.generated_at ? ` · ${formatDate(memo.generated_at)}` : ""}. <Pending /> marks facts to check with the founders.
        </p>
        {onDownload && (
          <div className="m3-actions">
            <button type="button" className="m3-btn" onClick={() => onDownload("pdf")}>Download PDF</button>
            <button type="button" className="m3-btn" onClick={() => onDownload("docx")}>Download DOCX</button>
          </div>
        )}
      </div>
      <Snapshot memo={memo} />

      {printing ? (
        <div className="vipnav-print" data-testid="vipnav-print">
          {SEQUENCE.map((k) => (
            <section className="mc-panel vipnav-print-section" key={k}>
              <SectionContent memo={memo} k={k} />
            </section>
          ))}
        </div>
      ) : (
        <div className="mc-pane">
          <nav className="mc-nav" aria-label="Memo sections">
            <div className="mc-progress">
              <span>{done} of {ORDER.length} sections read</span>
              <span className="bar"><i style={{ width: `${(done / ORDER.length) * 100}%` }} /></span>
            </div>
            {SEQUENCE.map((k) => (
              <button type="button" key={k} className="mc-navbtn"
                aria-current={k === cur ? "true" : undefined} onClick={() => go(k)}>
                <span className="n">{k === "questions" ? "" : pad(ORDER.indexOf(k) + 1)}</span>
                <span>{TITLES[k]}</span>
                {read[k] && <span className="meta" aria-label="read">✓</span>}
              </button>
            ))}
          </nav>
          <div className="mc-panel" data-testid="vipnav-panel">
            <SectionContent memo={memo} k={cur} />
            <div className="mc-foot">
              {prev ? (
                <button type="button" className="m3-btn" onClick={() => go(prev)}>← {TITLES[prev]}</button>
              ) : <span />}
              {next && (
                <button type="button" className="m3-btn primary" onClick={() => go(next)}>
                  {TITLES[next]} <span className="arrow">→</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
