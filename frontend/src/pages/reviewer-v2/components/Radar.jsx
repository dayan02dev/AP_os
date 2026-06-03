// Ported from os/shell.jsx → Radar chart for 5-6 score dimensions
export default function Radar({
  data,
  color = "#3213b7",
  fill = "rgba(8,145,178,0.18)",
  labels = true,
  size = 280,
}) {
  const keys = Object.keys(data);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 36;
  const angleAt = (i) => -Math.PI / 2 + (2 * Math.PI * i) / keys.length;
  const point = (val, i) => {
    const rr = (val / 10) * r;
    return [cx + rr * Math.cos(angleAt(i)), cy + rr * Math.sin(angleAt(i))];
  };
  const grid = [2, 4, 6, 8, 10].map((n) =>
    keys.map((_, i) => point(n, i).join(",")).join(" "),
  );
  const poly = keys.map((k, i) => point(data[k], i).join(",")).join(" ");

  return (
    <svg className="os-radar" viewBox={"0 0 " + size + " " + size}>
      {grid.map((g, i) => (
        <polygon key={i} points={g} className="grid" />
      ))}
      {keys.map((_, i) => {
        const [x, y] = point(10, i);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="#e3e3e8"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        );
      })}
      <polygon points={poly} className="fill" style={{ fill, stroke: color }} />
      {keys.map((k, i) => {
        const [x, y] = point(data[k], i);
        return <circle key={"p" + i} cx={x} cy={y} r="3" style={{ fill: color }} />;
      })}
      {labels &&
        keys.map((k, i) => {
          const [x, y] = point(11.5, i);
          return (
            <text key={"t" + i} x={x} y={y} textAnchor="middle" dy="4">
              {k}
            </text>
          );
        })}
    </svg>
  );
}
