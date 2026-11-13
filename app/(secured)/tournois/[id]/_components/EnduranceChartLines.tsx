"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  chartAnimationFrame,
  chartLine,
  chartLineAt,
  chartLinePath,
  chartRoundMs,
  type ChartGeometry,
  type EnduranceChartSeries,
} from "../_lib/endurance-chart";
import styles from "./EnduranceChart.module.css";

/** Trait de la courbe survolée d'un engagé hors Top N (tirets : jamais pris pour une courbe de la palette). */
export const HOVER_STROKE = "var(--ink)";
const HOVER_DASH = "7 5";

/** Une courbe tracée : l'engagé, sa couleur, sa zone de survol (calculée une fois). */
export type ChartLineEntry = { item: EnduranceChartSeries; color: string; hit: string };

/** L'engagé survolé : sa couleur, `null` hors Top N / sélection. */
export type ChartHoverEntry = { item: EnduranceChartSeries; color: string | null };

type Props = Readonly<{
  entries: readonly ChartLineEntry[];
  hover: ChartHoverEntry | null;
  shown: number;
  geometry: ChartGeometry;
  /** Faux : mouvement réduit ou régime économe — une seule image, la courbe arrivée. */
  animate: boolean;
  /** Incrémenté par « Rejouer l'animation » : la courbe repart du départ. */
  replayKey: number;
  forfeitLabel: string;
  onHover: (teamId: number) => void;
  onLeave: () => void;
  onToggle: (teamId: number) => void;
}>;

/** Ce que la tête lit d'une courbe : sa position et son état (`chartLine` ou `chartLineAt`). */
type HeadLine = { head: { x: number; y: number }; hollow: boolean; forfeit: boolean };

/** L'engagé d'une zone de survol (`data-team-id`), `null` hors d'une zone. */
function hitTeamId(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  const id = target.closest("[data-team-id]")?.getAttribute("data-team-id");
  return id ? Number(id) : null;
}

function Head({ line, stroke, forfeitLabel }: Readonly<{ line: HeadLine; stroke: string; forfeitLabel: string }>) {
  return (
    <>
      <circle
        cx={line.head.x}
        cy={line.head.y}
        r={line.hollow ? 4.5 : 3}
        className={styles.head}
        style={{ stroke, fill: line.hollow ? "var(--cyber-bg-1)" : stroke }}
      />
      {line.forfeit && (
        <text x={line.head.x + 9} y={line.head.y + 4} className={styles.forfeit}>
          {forfeitLabel}
        </text>
      )}
    </>
  );
}

/** Courbe survolée, redessinée au-dessus des autres (tirets hors Top N / sélection). */
function HoverOverlay({
  hover,
  shown,
  drawn,
  geometry,
  forfeitLabel,
}: Readonly<{ hover: ChartHoverEntry; shown: number; drawn: number; geometry: ChartGeometry; forfeitLabel: string }>) {
  const line = chartLine(hover.item, shown, drawn, geometry);
  const stroke = hover.color ?? HOVER_STROKE;
  return (
    <g className={styles.overlay}>
      <path
        d={line.d}
        className={styles.line}
        style={{ stroke, strokeWidth: 3.5, strokeDasharray: hover.color === null ? HOVER_DASH : undefined }}
      />
      <Head line={line} stroke={stroke} forfeitLabel={forfeitLabel} />
    </g>
  );
}

/**
 * Les courbes du graphique d'endurance, **seul** composant que l'animation
 * re-rend à chaque image (`docs/features/ENDURANCE_RANKING_VIEWS.md`,
 * § Graphique) : l'avancement vit ici, ni la barre d'outils, ni la légende, ni
 * l'encart, ni le tableau pour lecteurs d'écran ne le voient passer.
 *
 * Ordre des courbes **stable** (celui du classement général) : un survol ne
 * déplace aucun nœud. La courbe survolée est redessinée dans un calque
 * supérieur, sans événements (la zone de survol reste dessous), et les autres
 * s'atténuent par un attribut du groupe, pas par une classe par courbe.
 */
export const EnduranceChartLines = memo(function EnduranceChartLines({
  entries,
  hover,
  shown,
  geometry,
  animate,
  replayKey,
  forfeitLabel,
  onHover,
  onLeave,
  onToggle,
}: Props) {
  // Animée : la courbe part du départ dès la première image (sinon elle serait
  // peinte entière une image avant que l'effet de montage ne la redessine).
  const [progress, setProgress] = useState(animate ? 0 : shown);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const frame = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  const runTo = useCallback(
    (to: number, from: number) => {
      stop();
      // Retour vers une manche antérieure : la courbe est déjà coupée à la
      // manche affichée (`drawn`), une animation descendante ne se verrait pas.
      if (!animate || to <= from) {
        setProgress(to);
        return;
      }
      const started = performance.now();
      const perRoundMs = chartRoundMs(to - from);
      const step = (now: number) => {
        const next = chartAnimationFrame(from, to, now - started, perRoundMs);
        setProgress(next.progress);
        frame.current = next.done ? null : requestAnimationFrame(step);
      };
      setProgress(from);
      frame.current = requestAnimationFrame(step);
    },
    [animate, stop],
  );

  // Au dépliage : la courbe se dessine du départ à la manche affichée. Le
  // repli démonte le composant, et ce nettoyage annule l'image en attente.
  useEffect(() => {
    runTo(shown, 0);
    return stop;
    // Une seule fois par dépliage : les manches poussées ensuite par le flux
    // s'affichent par l'effet suivant, sans rejouer depuis le départ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Manche affichée changée — choix du lecteur, ou manche tirée que le lecteur
  // suit : la courbe avance (ou saute) de l'ancienne à la nouvelle.
  const previousShown = useRef(shown);
  useEffect(() => {
    const previous = previousShown.current;
    previousShown.current = shown;
    if (previous === shown) return;
    runTo(shown, Math.min(progressRef.current, previous));
  }, [shown, runTo]);

  // « Rejouer l'animation ».
  const lastReplay = useRef(replayKey);
  useEffect(() => {
    if (lastReplay.current === replayKey) return;
    lastReplay.current = replayKey;
    runTo(shown, 0);
  }, [replayKey, shown, runTo]);

  // Le régime passe en économe en cours de route : on saute à l'arrivée.
  useEffect(() => {
    if (!animate && frame.current !== null) {
      stop();
      setProgress(shown);
    }
  }, [animate, shown, stop]);

  // Progression jamais au-delà de la manche affichée (retour en arrière).
  const drawn = Math.min(progress, shown);

  // Tracés entiers et longueurs cumulées, une fois par courbe et par manche
  // affichée : chaque image ne fait plus que dévoiler une longueur
  // (`stroke-dasharray`) et placer la tête — aucun tracé reconstruit.
  const paths = useMemo(
    () => entries.map((entry) => ({ entry, path: chartLinePath(entry.item, shown, geometry) })),
    [entries, shown, geometry],
  );

  // Survol et clic délégués au groupe (`data-team-id` des zones de survol) :
  // aucun gestionnaire recréé par courbe à chaque image.
  const handleOver = useCallback(
    (event: MouseEvent<SVGGElement>) => {
      const teamId = hitTeamId(event.target);
      if (teamId !== null) onHover(teamId);
    },
    [onHover],
  );
  const handleOut = useCallback(
    (event: MouseEvent<SVGGElement>) => {
      if (hitTeamId(event.target) !== null && hitTeamId(event.relatedTarget) === null) onLeave();
    },
    [onLeave],
  );
  const handleClick = useCallback(
    (event: MouseEvent<SVGGElement>) => {
      const teamId = hitTeamId(event.target);
      if (teamId !== null) onToggle(teamId);
    },
    [onToggle],
  );

  return (
    <>
      <g
        className={styles.lines}
        data-hovering={hover === null ? undefined : ""}
        onMouseOver={handleOver}
        onMouseOut={handleOut}
        onClick={handleClick}
      >
        {paths.map(({ entry: { item, color, hit }, path }) => {
          const frame = chartLineAt(path, drawn);
          return (
            <g key={item.teamId} className={styles.curve}>
              <path
                d={path.d}
                className={styles.line}
                style={{
                  stroke: color,
                  strokeWidth: 2.25,
                  strokeDasharray: frame.visible === null ? undefined : `${frame.visible} ${frame.total + 1}`,
                }}
              />
              <Head line={frame} stroke={color} forfeitLabel={forfeitLabel} />
              <path d={hit} className={styles.hit} data-team-id={item.teamId} />
            </g>
          );
        })}
      </g>
      {hover !== null && (
        <HoverOverlay hover={hover} shown={shown} drawn={drawn} geometry={geometry} forfeitLabel={forfeitLabel} />
      )}
    </>
  );
});
