import { botPayloadNumber } from "@/lib/shared/bot-payload";

interface SparklineProps {
  data: number[];
  color?: string;
}

/**
 * Le nombre de points tracés. La courbe fait 100 unités de large : au-delà,
 * deux points tombent sur la même abscisse. Surtout, la série vient d'un
 * `as BotKpis` sur du JSON reçu et n'a donc aucune borne.
 */
const MAX_POINTS = 120;

export function Sparkline({ data, color = "var(--blue-500)" }: SparklineProps) {
  // Même prémisse que le reste de `/bot` : la charge arrive par un `as` sur du
  // JSON reçu par le réseau. Un point non numérique empoisonnait `Math.max`, et
  // toute la courbe sortait en « MNaN,NaN » — un cadre vide, sans une erreur.
  const points = (Array.isArray(data) ? data : [])
    .map(botPayloadNumber)
    .filter((v): v is number => v !== null)
    .slice(-MAX_POINTS);

  // Deux points au minimum. Avec un seul, `i / (n - 1)` vaut `0 / 0` : le
  // chemin est `NaN` de bout en bout. Avec zéro, `Math.max` rend `-Infinity` et
  // l'aire commence par un `L`, un `d` que le navigateur refuse. Dans les deux
  // cas il n'y a pas de courbe à tracer — on n'en dessine donc aucune.
  if (points.length < 2) return null;

  // `reduce` et non `Math.max(...points)` : le second passe la série entière en
  // arguments d'appel, ce qui est un `RangeError` au-delà de ~100 000 points.
  const max = points.reduce((m, v) => Math.max(m, v), points[0]);
  const min = points.reduce((m, v) => Math.min(m, v), points[0]);
  const w = 100;
  const h = 32;
  const pts = points.map((v, i) => {
    const x = (i / (points.length - 1)) * w;
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
