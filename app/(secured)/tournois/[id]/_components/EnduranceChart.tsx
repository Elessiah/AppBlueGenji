"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { BracketMatch, EnduranceMeta } from "@/lib/shared/types";
import { ScrollArea } from "@/components/cyber";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { useTournamentViewText } from "@/components/i18n/tournament-page-text";
import type { TournamentPageKey } from "@/lib/shared/tournament-page-text";
import { useClientPower, useClientPowerInput } from "@/lib/shared/hooks/useClientPower";
import { visibleText } from "@/lib/shared/visible-text";
import { useEntrantParticipantType } from "../_lib/entrant-link";
import { enduranceCurrentRound } from "../_lib/endurance-ranking-views";
import {
  CHART_H,
  CHART_PAD,
  CHART_W,
  ENDURANCE_CHART_PALETTE,
  ENDURANCE_CHART_PICK_MAX,
  chartAnimationFrame,
  chartColorIndex,
  chartGeometry,
  chartLine,
  chartOrderAt,
  chartRankAt,
  chartRecordAt,
  chartShownRound,
  chartTargetFor,
  chartThresholdAt,
  chartTopAt,
  chartValueAt,
  chartX,
  chartY,
  enduranceChartRoundCount,
  enduranceChartSeries,
  togglePick,
  type EnduranceChartMode,
  type EnduranceChartRoundState,
  type EnduranceChartSeries,
} from "../_lib/endurance-chart";
import { FR_VIEWS_TEXT } from "../_lib/views-text";
import styles from "./EnduranceChart.module.css";

const HOVER_STROKE = "var(--ink)";
const colorVar = (index: number | null) =>
  index === null ? null : `var(${ENDURANCE_CHART_PALETTE[index].token}, ${ENDURANCE_CHART_PALETTE[index].hex})`;

type Translate = ReturnType<typeof useTournamentViewText>["t"];
type Kind = "Team" | "Solo";

function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return "0";
}

function deltaTone(delta: number): string {
  if (delta > 0) return styles.toneUp;
  if (delta < 0) return styles.toneDown;
  return styles.toneMute;
}

/** Contenu d'une case hors capital : à jouer, forfait, sorti. */
function absentText(state: Exclude<EnduranceChartRoundState, { kind: "PLAYED" }>, t: Translate, kind: Kind, forfeitKey: TournamentPageKey) {
  if (state.kind === "PENDING") return t("endurance.chartStatePending");
  if (state.kind === "FORFEIT") return t(forfeitKey);
  return t(`endurance.chartStateOut${kind}`);
}

/** Valeur d'une case (encart, tableau pour lecteurs d'écran). */
function cellText(state: EnduranceChartRoundState, t: Translate, kind: Kind, forfeitKey: TournamentPageKey): string {
  return state.kind === "PLAYED" ? String(state.points) : absentText(state, t, kind, forfeitKey);
}

/** État court d'un engagé dans la légende, à la manche affichée. */
function legendState(state: EnduranceChartRoundState | undefined, t: Translate, kind: Kind) {
  if (state === undefined) return { text: "", tone: styles.toneMute };
  if (state.kind === "PLAYED") return { text: signed(state.delta), tone: deltaTone(state.delta) };
  const tone = state.kind === "PENDING" ? styles.tonePending : styles.toneDown;
  return {
    text: absentText(state, t, kind, "endurance.chartStateForfeit"),
    tone: state.kind === "OUT" ? styles.toneMute : tone,
  };
}

function modeHintText(mode: EnduranceChartMode, picked: number, size: number, t: Translate, kind: Kind): string {
  if (mode === "TOP") return t(`endurance.chartHintTop${kind}`, { size });
  if (mode === "ALL") return t(`endurance.chartHintAll${kind}`);
  if (picked === 0) return t(`endurance.chartHintPickEmpty${kind}`, { max: ENDURANCE_CHART_PICK_MAX });
  return t(`endurance.chartHintPick${kind}`, { count: picked, max: ENDURANCE_CHART_PICK_MAX });
}

type RoundState = "UPCOMING" | "CURRENT" | "DONE";

function roundSubText(state: RoundState, progress: { played: number; total: number } | null, t: Translate): string {
  if (state === "UPCOMING") return t("endurance.chartRoundUpcoming");
  if (state === "CURRENT" && progress !== null) {
    return t("endurance.chartRoundCurrent", { played: progress.played, total: progress.total });
  }
  return t("endurance.chartRoundDone");
}

function axisClass(round: number, shown: number, lastRound: number): string {
  if (round === shown) return `${styles.axisX} ${styles.axisXShown}`;
  if (round > lastRound) return `${styles.axisX} ${styles.axisXFuture}`;
  return styles.axisX;
}

function stepClass(state: EnduranceChartRoundState): string {
  if (state.kind === "PENDING") return `${styles.step} ${styles.stepPending}`;
  if (state.kind === "FORFEIT") return `${styles.step} ${styles.toneDown}`;
  return styles.step;
}

/**
 * Graphique « Évolution de l'endurance » (`docs/features/ENDURANCE_RANKING_VIEWS.md`,
 * § Graphique). Monté **seulement** volet ouvert (`EnduranceChartPanel`) : le
 * replier le démonte, ce qui annule toute image d'animation en attente.
 *
 * Lecture seule pour tous. La sélection « Ma sélection » vit dans l'état du
 * composant et nulle part ailleurs — ni stockage local, ni serveur.
 */
export function EnduranceChart({ endurance, matches }: Readonly<{ endurance: EnduranceMeta; matches: BracketMatch[] }>) {
  const { t } = useTournamentViewText(FR_VIEWS_TEXT);
  const hintId = useId();
  const solo = useEntrantParticipantType() === "SOLO";
  const kind = solo ? "Solo" : "Team";
  // Mouvement réduit demandé, ou régime économe (machine à la peine, page en
  // arrière-plan) : une seule image, la courbe déjà arrivée.
  const { decorativeMotion } = useClientPower();
  const { reducedMotion } = useClientPowerInput();
  const animate = decorativeMotion && !reducedMotion;

  const lastRound = endurance.currentRound;
  const roundCount = enduranceChartRoundCount(endurance);
  const series = useMemo(() => enduranceChartSeries(endurance, matches), [endurance, matches]);
  const geometry = useMemo(
    () => chartGeometry(series, roundCount, endurance.startPoints),
    [series, roundCount, endurance.startPoints],
  );
  const progressRound = useMemo(() => enduranceCurrentRound(matches), [matches]);

  const [mode, setMode] = useState<EnduranceChartMode>("TOP");
  const [picked, setPicked] = useState<number[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  // `null` : suit la dernière manche tirée (y compris celles poussées ensuite).
  const [target, setTarget] = useState<number | null>(null);
  const [progress, setProgress] = useState(animate ? 0 : lastRound);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const frame = useRef<number | null>(null);

  const shown = chartShownRound(target, lastRound);
  const lastSeen = useRef(lastRound);

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  const runTo = useCallback(
    (to: number, from: number) => {
      stop();
      if (!animate || from === to) {
        setProgress(to);
        return;
      }
      const started = performance.now();
      const step = (now: number) => {
        const next = chartAnimationFrame(from, to, now - started);
        setProgress(next.progress);
        frame.current = next.done ? null : requestAnimationFrame(step);
      };
      setProgress(from);
      frame.current = requestAnimationFrame(step);
    },
    [animate, stop],
  );

  // Au dépliage : la courbe se dessine du départ à la dernière manche. Le
  // repli démonte le composant, et ce nettoyage annule l'image en attente.
  useEffect(() => {
    runTo(lastRound, 0);
    return stop;
    // Une seule fois par dépliage : les manches poussées ensuite par le flux
    // s'affichent sans rejouer l'animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Le régime passe en économe en cours de route : on saute à l'arrivée.
  useEffect(() => {
    if (!animate && frame.current !== null) {
      stop();
      setProgress(shown);
    }
  }, [animate, shown, stop]);

  // Le flux tire une nouvelle manche volet ouvert : si le lecteur suit la
  // dernière, la courbe avance jusqu'à elle (sans rejouer depuis le départ).
  useEffect(() => {
    const previous = lastSeen.current;
    lastSeen.current = lastRound;
    if (previous === lastRound || target !== null) return;
    runTo(lastRound, Math.min(progressRef.current, previous));
  }, [lastRound, target, runTo]);

  const showRound = (round: number) => {
    if (round > lastRound || round === shown) return;
    setTarget(chartTargetFor(round, lastRound));
    runTo(round, Math.min(progressRef.current, shown));
  };
  const replay = () => runTo(shown, 0);
  const toggle = (teamId: number) => {
    const next = togglePick(mode, picked, teamId);
    setMode(next.mode);
    setPicked(next.picked);
  };

  const order = chartOrderAt(series, shown, lastRound);
  const top = chartTopAt(series, shown, lastRound, endurance.playoffSize);
  const threshold = chartThresholdAt(series, shown, lastRound, endurance.playoffSize);
  const colorOf = (item: EnduranceChartSeries) =>
    chartColorIndex(mode, item.teamId, { top, picked, generalIndex: series.indexOf(item) });
  // Progression jamais au-delà de la manche affichée (retour en arrière).
  const drawn = Math.min(progress, shown);

  const lines = series
    .map((item) => {
      const color = colorVar(colorOf(item));
      const isHover = hover === item.teamId;
      return { item, color, isHover, line: chartLine(item, shown, drawn, geometry) };
    })
    .filter((entry) => entry.color !== null || entry.isHover)
    // La courbe survolée se dessine en dernier, au-dessus des autres.
    .sort((a, b) => Number(a.isHover) - Number(b.isHover) || Number(a.color !== null) - Number(b.color !== null));

  const yTicks: number[] = [];
  for (let v = 0; v <= geometry.maxY; v += geometry.tick) yTicks.push(v);
  const bandX = chartX(geometry, shown) - geometry.step / 2;
  const futureX = chartX(geometry, lastRound) + geometry.step / 2;
  const plotRight = CHART_W - CHART_PAD.right;
  const plotBottom = CHART_H - CHART_PAD.bottom;

  const roundState = (round: number): RoundState => {
    if (round > lastRound) return "UPCOMING";
    if (progressRound !== null && progressRound.round === round) return "CURRENT";
    return "DONE";
  };

  const svgLabel =
    t(`endurance.chartSvg${kind}`, { count: series.length, round: shown }) +
    (threshold === null ? "" : t("endurance.chartSvgThreshold", { size: endurance.playoffSize, value: threshold }));

  const hovered = hover === null ? null : (series.find((item) => item.teamId === hover) ?? null);
  const hasDraws = endurance.standings.some((standing) => standing.draws > 0);

  const modeHint = modeHintText(mode, picked.length, endurance.playoffSize, t, kind);

  const modes: { id: EnduranceChartMode; label: string }[] = [
    { id: "TOP", label: t("endurance.chartModeTop", { size: endurance.playoffSize }) },
    { id: "PICK", label: t("endurance.chartModePick") },
    { id: "ALL", label: t(`endurance.chartModeAll${kind}`) },
  ];

  const rounds = Array.from({ length: roundCount }, (_, i) => i + 1);
  const playedRounds = Array.from({ length: lastRound }, (_, i) => i + 1);

  return (
    <div className={styles.chart}>
      <div className={styles.toolbar}>
        <InfoHintRow>
          <fieldset aria-label={t(`endurance.chartModes${kind}`)} className={`native-group ${styles.segment}`}>
            {modes.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={mode === entry.id}
                onClick={() => setMode(entry.id)}
                className={`${styles.segmentButton} ${mode === entry.id ? styles.selected : ""}`}
              >
                {entry.label}
              </button>
            ))}
          </fieldset>
          {/* L'aide du mode, derrière le bouton « i » (INFO_HINTS.md). */}
          <InfoHint id={`${hintId}-mode`} subject={t(`endurance.chartModes${kind}`)}>
            {modeHint}
          </InfoHint>
        </InfoHintRow>
        <div className={styles.actions}>
          {/* Reste monté en « Ma sélection » : vider la liste ne retire pas le
              bouton qui a le focus (aria-disabled, jamais disabled natif). */}
          {mode === "PICK" && (
            <button
              type="button"
              aria-disabled={picked.length === 0}
              onClick={() => {
                if (picked.length > 0) setPicked([]);
              }}
              className={styles.ghostButton}
            >
              {t("endurance.chartClear")}
            </button>
          )}
          <button type="button" onClick={replay} className={styles.replayButton}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
            {t("endurance.chartReplay")}
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.plot}>
          <fieldset aria-label={t("endurance.chartRoundsLabel")} className={`native-group ${styles.rounds}`}>
            {rounds.map((round) => {
              const state = roundState(round);
              const selected = round === shown;
              return (
                <button
                  key={round}
                  type="button"
                  disabled={state === "UPCOMING"}
                  aria-pressed={selected}
                  onClick={() => showRound(round)}
                  className={`${styles.roundButton} ${selected ? styles.selected : ""}`}
                >
                  <span className={styles.roundLabel}>{t("endurance.chartRoundButton", { round })}</span>
                  <span className={styles.roundSub}>{roundSubText(state, progressRound, t)}</span>
                </button>
              );
            })}
          </fieldset>

          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            role="img"
            aria-label={svgLabel}
            className={styles.svg}
            onMouseLeave={() => setHover(null)}
          >
            {futureX < plotRight && (
              <rect x={futureX} y={CHART_PAD.top} width={plotRight - futureX} height={plotBottom - CHART_PAD.top} className={styles.future} />
            )}
            <rect x={bandX} y={CHART_PAD.top} width={geometry.step} height={plotBottom - CHART_PAD.top} className={styles.band} />
            {yTicks.map((value) => (
              <g key={value}>
                <line
                  x1={CHART_PAD.left}
                  x2={plotRight}
                  y1={chartY(geometry, value)}
                  y2={chartY(geometry, value)}
                  className={value === endurance.startPoints ? styles.gridStart : styles.grid}
                />
                <text x={CHART_PAD.left - 8} y={chartY(geometry, value) + 4} className={styles.axisY}>
                  {value}
                </text>
              </g>
            ))}
            <text x={chartX(geometry, 0)} y={CHART_H - 30} className={styles.axisX}>
              {t("endurance.chartStart")}
            </text>
            {rounds.map((round) => (
              <text
                key={round}
                x={chartX(geometry, round)}
                y={CHART_H - 30}
                className={axisClass(round, shown, lastRound)}
              >
                {t("endurance.chartAxisRound", { round })}
              </text>
            ))}
            {threshold !== null && (
              <>
                <line
                  x1={CHART_PAD.left}
                  x2={plotRight}
                  y1={chartY(geometry, threshold)}
                  y2={chartY(geometry, threshold)}
                  className={styles.cut}
                />
                <text x={plotRight - 4} y={chartY(geometry, threshold) - 6} className={styles.cutLabel}>
                  {t("endurance.chartThreshold", { size: endurance.playoffSize, round: shown, value: threshold })}
                </text>
              </>
            )}
            {lines.map(({ item, color, isHover, line }) => {
              const stroke = color ?? HOVER_STROKE;
              const dimmed = hover !== null && !isHover;
              return (
                <g key={item.teamId} className={dimmed ? styles.dimmed : undefined}>
                  <path d={line.d} className={styles.line} style={{ stroke, strokeWidth: isHover ? 3.5 : 2.25 }} />
                  <circle
                    cx={line.head.x}
                    cy={line.head.y}
                    r={line.hollow ? 4.5 : 3}
                    className={styles.head}
                    style={{ stroke, fill: line.hollow ? "var(--cyber-bg-1)" : stroke }}
                  />
                  {line.forfeit && (
                    <text x={line.head.x + 9} y={line.head.y + 4} className={styles.forfeit}>
                      {t("endurance.chartStateForfeit")}
                    </text>
                  )}
                  <path
                    d={line.hit}
                    className={styles.hit}
                    onMouseEnter={() => setHover(item.teamId)}
                    onClick={() => toggle(item.teamId)}
                  />
                </g>
              );
            })}
          </svg>

          <div className={styles.info}>
            {hovered === null ? (
              // « Ma sélection » vide : rien n'est tracé, l'état vide dit comment
              // ajouter un engagé (visible, pas seulement derrière le « i »).
              <span className={styles.hint}>
                {mode === "PICK" && picked.length === 0
                  ? t(`endurance.chartHintPickEmpty${kind}`, { max: ENDURANCE_CHART_PICK_MAX })
                  : t(`endurance.chartInfoEmpty${kind}`)}
              </span>
            ) : (
              <>
                <div className={styles.infoHead}>
                  <span
                    aria-hidden
                    className={styles.swatch}
                    style={{ background: colorVar(colorOf(hovered)) ?? HOVER_STROKE }}
                  />
                  <strong className={styles.infoName}>{visibleText(hovered.teamName)}</strong>
                  <span className={styles.infoMeta}>
                    {t(hasDraws ? "endurance.chartInfoMetaDraws" : "endurance.chartInfoMeta", {
                      rank: chartRankAt(hovered, shown, lastRound),
                      seed: hovered.seed,
                      ...chartRecordAt(hovered, shown, lastRound),
                    })}
                  </span>
                </div>
                <div className={styles.steps}>
                  <span className={styles.step}>
                    {t("endurance.chartStart")} <strong>{endurance.startPoints}</strong>
                  </span>
                  {hovered.states.map((state, index) => (
                    <span key={index} className={stepClass(state)}>
                      {t("endurance.chartAxisRound", { round: index + 1 })}{" "}
                      <strong>{cellText(state, t, kind, `endurance.chartStepForfeit${kind}`)}</strong>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <ScrollArea orientation="y" ariaLabel={t(`endurance.chartLegend${kind}`)} className={styles.legend}>
          <ul aria-label={t(`endurance.chartLegend${kind}`)} className={styles.legendList}>
            {order.map((item) => {
              const color = colorVar(colorOf(item));
              const state = legendState(item.states[shown - 1], t, kind);
              return (
                <li key={item.teamId}>
                  <button
                    type="button"
                    aria-pressed={mode === "PICK" && picked.includes(item.teamId)}
                    onClick={() => toggle(item.teamId)}
                    onMouseEnter={() => setHover(item.teamId)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(item.teamId)}
                    onBlur={() => setHover(null)}
                    className={`${styles.legendItem} ${hover === item.teamId ? styles.legendHover : ""}`}
                  >
                    <span
                      aria-hidden
                      className={color === null ? styles.swatchEmpty : styles.swatch}
                      style={color === null ? undefined : { background: color }}
                    />
                    <span className={styles.legendRank}>{chartRankAt(item, shown, lastRound)}</span>
                    <span className={styles.legendName}>{visibleText(item.teamName)}</span>
                    <span className={styles.legendValue}>{chartValueAt(item, shown, lastRound)}</span>
                    <span className={`${styles.legendState} ${state.tone}`}>{state.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </div>

      {/*
        Le tableau « manche par manche » retiré de l'écran, pour les lecteurs
        d'écran : tous les engagés, toutes les manches tirées.
      */}
      <table className="sr-only">
        <caption>{t(`endurance.chartTableCaption${kind}`)}</caption>
        <thead>
          <tr>
            <th scope="col">{t(`endurance.chartTableEntrant${kind}`)}</th>
            <th scope="col">{t("endurance.chartStart")}</th>
            {playedRounds.map((round) => (
              <th key={round} scope="col">
                {t("endurance.chartRoundButton", { round })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {series.map((item) => (
            <tr key={item.teamId}>
              <th scope="row">{visibleText(item.teamName)}</th>
              <td>{endurance.startPoints}</td>
              {item.states.map((state, index) => (
                <td key={index}>{cellText(state, t, kind, "endurance.chartTableForfeit")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
