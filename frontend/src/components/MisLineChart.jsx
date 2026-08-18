import { useEffect, useRef } from "react";
import {
  Chart, LineController, LineElement, PointElement, LinearScale,
  CategoryScale, Filler, Tooltip,
} from "chart.js";
import "../styles/mis-charts.css";

// A vertical line at the hovered index (spec: "index-mode crosshair on
// hover"). Chart.js's own tooltip already tracks the active element in
// `mode: 'index'`; this plugin just draws a guide line at that x, which
// Chart.js has no built-in for.
const misCrosshairPlugin = {
  id: "misCrosshair",
  afterDatasetsDraw(chart) {
    const active = chart.tooltip?.getActiveElements?.() || [];
    if (!active.length) return;
    const { ctx, chartArea } = chart;
    const x = active[0].element.x;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(148, 148, 158, 0.35)";
    ctx.stroke();
    ctx.restore();
  },
};

Chart.register(
  LineController, LineElement, PointElement, LinearScale, CategoryScale,
  Filler, Tooltip, misCrosshairPlugin,
);

// A <canvas> 2D context cannot consume var(--artblue) — resolve it once,
// to a real rgb() triple, with the same literal fallback every other
// var(--artblue, #3213b7) in this codebase already uses.
const FALLBACK_ARTBLUE_RGB = [50, 19, 183]; // #3213b7
function resolveArtblueRgb() {
  if (typeof window === "undefined") return FALLBACK_ARTBLUE_RGB;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--artblue").trim();
  if (!raw) return FALLBACK_ARTBLUE_RGB;
  const hex = raw.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const num = parseInt(full, 16);
  return Number.isNaN(num) ? FALLBACK_ARTBLUE_RGB : [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// revenue_month/net_burn_month are ALREADY stored in ₹ Lakh
// (mis_catalog.METRICS's own unit) — never route this through
// ui.jsx's fmtL(), which assumes a raw-rupee input and would divide by
// 100000 a second time. See this plan's Global Constraints.
function fmtChartValue(chartKey, v) {
  if (v == null) return "";
  return chartKey === "revenue" || chartKey === "burn" ? `₹${v}L` : String(v);
}

export default function MisLineChart({ series, chartKey, enlarged = false }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    const points = series || [];
    const [r, g, b] = resolveArtblueRgb();
    const lineColor = `rgb(${r}, ${g}, ${b})`;

    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels: points.map((p) => p.label),
        datasets: [{
          data: points.map((p) => p.value),
          borderColor: lineColor,
          borderWidth: 1.75,
          tension: 0.4,
          fill: true,
          backgroundColor: (ctx) => {
            const { chart } = ctx;
            if (!chart.chartArea) return null;
            const { top, bottom } = chart.chartArea;
            const gradient = chart.ctx.createLinearGradient(0, top, 0, bottom);
            gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.13)`);
            gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
            return gradient;
          },
          pointRadius: (ctx) => {
            const isLast = ctx.dataIndex === ctx.dataset.data.length - 1;
            if (!isLast) return 0;
            return enlarged ? 3 : 3.5;
          },
          pointHoverRadius: 6,
          pointBackgroundColor: lineColor,
          pointBorderColor: "#fff",
          pointBorderWidth: 1.5,
          spanGaps: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          tooltip: {
            backgroundColor: "#191922",
            cornerRadius: 8,
            displayColors: false,
            callbacks: { label: (item) => fmtChartValue(chartKey, item.parsed.y) },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: { ticks: { maxTicksLimit: 5 } },
        },
      },
      plugins: [misCrosshairPlugin],
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [series, chartKey, enlarged]);

  return (
    <div className={`mis-linechart-wrap${enlarged ? " is-enlarged" : ""}`}>
      <canvas ref={canvasRef} role="img" aria-label={`${chartKey} trend`} />
    </div>
  );
}
