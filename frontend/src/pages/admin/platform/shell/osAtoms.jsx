import React, { useState, useRef } from "react";

export function Topbar({ portal, user, role, cohort='TIR Cohort 2026', onBell }) {
  return (
    <div className="os-topbar">
      <div className="os-brand">
        <div className="os-brand-mark">A</div>
        <span><b>ARTPARK</b></span>
        <span className="os-brand-sep">/</span>
        <span>OS</span>
      </div>
      <span className="os-portal-tag">{portal}</span>
      <div className="os-spacer" />
      <div className="os-cohort">
        <span>{cohort}</span>
        <span className="caret">▾</span>
      </div>
      <div className="os-bell" onClick={onBell} title="Notifications">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        <span className="dot" />
      </div>
      <div className="os-user">
        <div className="os-avatar">{user.split(' ').map(s=>s[0]).slice(0,2).join('')}</div>
        <div>
          <div className="os-user-name">{user}</div>
          <div className="os-user-role">{role}</div>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({ items, active, onSelect }) {
  return (
    <aside className="os-sidebar">
      {items.map((g, i) => (
        <div key={i}>
          {g.label && <div className="os-nav-section">{g.label}</div>}
          {g.entries.map(e => (
            <div key={e.id}
              className={'os-nav-item ' + (e.id === active ? 'active' : '')}
              onClick={() => onSelect && onSelect(e.id)}
            >
              <span className="num">{e.num}</span>
              <span>{e.label}</span>
              {e.badge && <span className="badge">{e.badge}</span>}
            </div>
          ))}
        </div>
      ))}
    </aside>
  );
}

export function PageHead({ eyebrow, title, sub, actions, breadcrumb }) {
  return (
    <div>
      {breadcrumb && (
        <div className="os-breadcrumb">
          {breadcrumb.map((b, i) => (
            <span key={i}>
              {i > 0 && <span className="sep">/</span>}
              {b.onClick ? <a href={b.href || '#'} onClick={(e) => { e.preventDefault(); b.onClick(); }}>{b.label}</a>
                : b.href ? <a href={b.href}>{b.label}</a> : b.label}
            </span>
          ))}
        </div>
      )}
      <div className="os-page-head">
        <div>
          {eyebrow && <div className="os-eyebrow">{String(eyebrow).replace(/^A-\d+[A-Za-z]?\s*·\s*/, '')}</div>}
          <h1 className="os-h1" dangerouslySetInnerHTML={{__html: title}} />
          {sub && <div className="os-sub">{sub}</div>}
        </div>
        {actions && <div className="os-row gap-sm">{actions}</div>}
      </div>
    </div>
  );
}

// Score bar atom
export function ScoreBar({ label, value, max=10, kind='', ticks=true }) {
  const pct = Math.max(0, Math.min(1, value/max)) * 100;
  return (
    <div className={'os-scorebar ' + kind}>
      <div className="os-scorebar-label">{label}</div>
      <div className="os-scorebar-track">
        <div className="os-scorebar-fill" style={{ width: pct + '%' }} />
        {ticks && [2,4,6,8].map(t => (
          <div key={t} className="os-scorebar-tick" style={{ left: (t/max*100)+'%' }} />
        ))}
      </div>
      <div className="os-scorebar-val">{value.toFixed(1)}</div>
    </div>
  );
}

export function Slider({ label, value, onChange, kind='', min=0, max=10, step=0.5 }) {
  const trackRef = useRef(null);
  const pct = ((value-min)/(max-min))*100;
  const handle = (clientX) => {
    const r = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - r.left)/r.width));
    let v = min + x*(max-min);
    v = Math.round(v/step)*step;
    onChange(v);
  };
  return (
    <div className={'os-slider-row ' + kind}>
      <div className="os-slider-label">{label}</div>
      <div ref={trackRef} className="os-slider-track"
        onMouseDown={(e) => {
          handle(e.clientX);
          const move = (ev) => handle(ev.clientX);
          const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        }}
      >
        <div className="os-slider-fill" style={{ width: pct+'%' }} />
        {[1,2,3,4,5,6,7,8,9].map(t => (
          <div key={t} className="os-slider-tick" style={{ left: ((t-min)/(max-min)*100)+'%' }} />
        ))}
        <div className="os-slider-thumb" style={{ left: pct+'%' }} />
      </div>
      <div className="os-slider-val">{value.toFixed(1)}</div>
    </div>
  );
}

export function Chip({ children, tone='', solid=false }) {
  return <span className={'os-chip ' + tone + (solid ? ' solid' : '')}>{children}</span>;
}

export function FlagDot({ tone='darkgreen', title }) {
  return <span className={'os-flag-dot ' + tone} title={title}/>;
}

export function Stat({ tone='l1', num, label, meta, action, onClick }) {
  return (
    <div className={'os-stat ' + tone} onClick={onClick}>
      <div className="os-stat-num">{num}</div>
      <div className="os-stat-label">{label}</div>
      {meta && <div className="os-stat-meta">{meta}</div>}
      {action && <div className="os-stat-action">{action}</div>}
    </div>
  );
}

export function Histogram({ bars, cutoffIdx=null }) {
  // bars is array of {h, dim}
  return (
    <div className="os-histogram">
      {bars.map((b, i) => (
        <div key={i} className={'bar ' + (i===cutoffIdx ? 'cutoff ' : '') + (b.dim ? 'lowscore' : '')} style={{ height: (b.h*100)+'%' }} />
      ))}
    </div>
  );
}

// Radar chart for 6 categories
export function Radar({ data, color='#6B5CFF', fill='rgba(107,92,255,0.18)', labels=true, size=280 }) {
  // data: { Problem: 8.6, Solution: 8.2, Tech: 9, Founders: 7.8, Commit: 8.4, Integrity: 8.4 }
  const keys = Object.keys(data);
  const cx = size/2, cy = size/2, r = size/2 - 36;
  const angleAt = (i) => -Math.PI/2 + (2*Math.PI*i)/keys.length;
  const point = (val, i) => {
    const rr = (val/10) * r;
    return [cx + rr*Math.cos(angleAt(i)), cy + rr*Math.sin(angleAt(i))];
  };
  const grid = [2,4,6,8,10].map(n => keys.map((_,i) => point(n, i).join(',')).join(' '));
  const poly = keys.map((k,i) => point(data[k], i).join(',')).join(' ');
  return (
    <svg className="os-radar" viewBox={'0 0 ' + size + ' ' + size}>
      {grid.map((g,i) => <polygon key={i} points={g} className="grid"/>) }
      {keys.map((_,i) => {
        const [x,y] = point(10, i);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#c8c8d0" strokeWidth="1" strokeDasharray="2 3" />;
      })}
      <polygon points={poly} className="fill" style={{ fill, stroke: color }} />
      {keys.map((k,i) => {
        const [x,y] = point(data[k], i);
        return <circle key={'p'+i} cx={x} cy={y} r="3" style={{fill:color}}/>;
      })}
      {labels && keys.map((k,i) => {
        const [x,y] = point(11.5, i);
        return <text key={'t'+i} x={x} y={y} textAnchor="middle" dy="4">{k}</text>;
      })}
    </svg>
  );
}

export function Variance({ value }) {
  const tone = value < 0.5 ? 'low' : value < 1 ? 'med' : 'high';
  return <span className={'os-variance ' + tone}>Δ {value.toFixed(1)}</span>;
}

export function RadarOverlay({ aiData, revData }) {
  const keys = Object.keys(aiData);
  const size = 280, cx = size/2, cy = size/2, r = size/2 - 38;
  const angleAt = (i) => -Math.PI/2 + (2*Math.PI*i)/keys.length;
  const point = (val, i) => {
    const rr = (val/10) * r;
    return [cx + rr*Math.cos(angleAt(i)), cy + rr*Math.sin(angleAt(i))];
  };
  const grid = [2,4,6,8,10].map(n => keys.map((_,i) => point(n, i).join(',')).join(' '));
  const polyAi = keys.map((k,i) => point(aiData[k], i).join(',')).join(' ');
  const polyRev = keys.map((k,i) => point(revData[k], i).join(',')).join(' ');
  return (
    <svg className="os-radar" viewBox={'0 0 ' + size + ' ' + size}>
      {grid.map((g,i) => <polygon key={i} points={g} className="grid"/>) }
      {keys.map((_,i) => {
        const [x,y] = point(10, i);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#c8c8d0" strokeWidth="1" strokeDasharray="2 3" />;
      })}
      <polygon points={polyAi}  fill="rgba(107,92,255,0.18)"  stroke="var(--l2-cyan)"  strokeWidth="1.5"/>
      <polygon points={polyRev} fill="rgba(47,111,98,0.15)"   stroke="var(--ok)"       strokeWidth="1.5" strokeDasharray="4 3"/>
      {keys.map((k,i) => {
        const [x,y] = point(11.5, i);
        return <text key={'t'+i} x={x} y={y} textAnchor="middle" dy="4">{k}</text>;
      })}
    </svg>
  );
}
