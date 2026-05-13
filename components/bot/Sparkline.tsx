interface SparklineProps {
  data: number[];
  color?: string;
}

export function Sparkline({ data, color = "var(--blue-500)" }: SparklineProps) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const w = 100;
  const h = 32;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * (h - 4) - 2;
    return [x, y];
  });
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${d} L${w},${h} L0,${h} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path className="area" d={area} style={{fill: "rgba(90,200,255,0.10)"}}/>
      <path className="line" d={d} style={{stroke: color}}/>
    </svg>
  );
}
