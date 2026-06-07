// Ported from os/shell.jsx → Slider (mouse-driven score input, 0-10)
import { useRef } from "react";

export default function Slider({ label, value, onChange, kind = "", min = 0, max = 10, step = 0.5 }) {
  const trackRef = useRef(null);
  const pct = ((value - min) / (max - min)) * 100;

  const handle = (clientX) => {
    const r = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    let v = min + x * (max - min);
    v = Math.round(v / step) * step;
    onChange(v);
  };

  return (
    <div className={"os-slider-row " + kind}>
      <div className="os-slider-label">{label}</div>
      <div
        ref={trackRef}
        className="os-slider-track"
        onMouseDown={(e) => {
          handle(e.clientX);
          const move = (ev) => handle(ev.clientX);
          const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
          };
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        }}
      >
        <div className="os-slider-fill" style={{ width: pct + "%" }} />
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => (
          <div
            key={t}
            className="os-slider-tick"
            style={{ left: ((t - min) / (max - min)) * 100 + "%" }}
          />
        ))}
        <div className="os-slider-thumb" style={{ left: pct + "%" }} />
      </div>
      <div className="os-slider-val">{value.toFixed(1)}</div>
    </div>
  );
}
