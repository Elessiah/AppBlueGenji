"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { BracketMatch, EnduranceMeta } from "@/lib/shared/types";
import { ScrollArea } from "@/components/cyber";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { useToast } from "@/components/ui/toast";
import { useTournamentViewText } from "@/components/i18n/tournament-page-text";
import type { TournamentPageKey } from "@/lib/shared/tournament-page-text";
import { visibleText } from "@/lib/shared/visible-text";
import { useEntrantParticipantType } from "../_lib/entrant-link";
import { enduranceCurrentRound, signedDelta } from "../_lib/endurance-ranking-views";
import {
  CHART_H,
  CHART_PAD,
  CHART_W,
  ENDURANCE_CHART_PALETTE,
  ENDURANCE_CHART_PICK_MAX,
  assignChartColors,
  chartColoredIds,
  chartGeometry,
  chartHitPath,
  chartOrderAt,
  chartRankAt,
  chartRecordAt,
  chartShownRound,
  chartTargetFor,
  chartThresholdOf,
  chartTopOf,
  chartValueAt,
  chartX,
  chartY,
  enduranceChartInputKey,
  enduranceChartRoundCount,
  enduranceChartSeries,
  togglePick,
  type EnduranceChartMode,
  type EnduranceChartRoundState,
  type EnduranceChartSeries,
} from "../_lib/endurance-chart";
import { useEnduranceChartAnimate } from "../_lib/use-endurance-chart-animate";
import { FR_VIEWS_TEXT } from "../_lib/views-text";
import { EnduranceChartLines, type ChartHoverEntry, type ChartLineEntry } from "./EnduranceChartLines";
import styles from "./EnduranceChart.module.css";

const PLOT_RIGHT = CHART_W - CHART_PAD.right;
const PLOT_BOTTOM = CHART_H - CHART_PAD.bottom;
const colorVar = (index: number) =>
  `var(${ENDURANCE_CHART_PALETTE[index].token}, ${ENDURANCE_CHART_PALETTE[index].hex})`;

type Translate = ReturnType<typeof useTournamentViewText>["t"];
type Kind = "Team" | "Solo";

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

/** Pénalité d'arbitrage prise dans la manche d'une case (0 sans sanction, ou case sans capital). */
function penaltyOf(state: EnduranceChartRoundState | undefined): number {
  return state !== undefined && (state.kind === "PLAYED" || state.kind === "PENDING") ? state.penalty : 0;
}

/**
 * Repère de pénalité d'arbitrage (comme celui des vues du classement) : le
 * visible se masque au lecteur d'écran, qui entend la phrase complète.
 */
function PenaltyMark({ points, t }: Readonly<{ points: number; t: Translate }>) {
  return (
    <span className={styles.penaltyMark} title={t("endurance.penaltyBadgeTitle", { points })}>
      <span aria-hidden="true">!</span>
      <span className="sr-only">{t("endurance.penaltyBadgeSr", { points })}</span>
    </span>
  );
}

/** État court d'un engagé dans la légende, à la manche affichée. */
function legendState(state: EnduranceChartRoundState | undefined, t: Translate, kind: Kind) {
  if (state === undefined) return { text: "", tone: styles.toneMute, isDelta: false };
  if (state.kind === "PLAYED") return { text: signedDelta(state.delta), tone: deltaTone(state.delta), isDelta: true };
  const tone = state.kind === "PENDING" ? styles.tonePending : styles.toneDown;
  return {
    text: absentText(state, t, kind, "endurance.chartStateForfeit"),
    tone: state.kind === "OUT" ? styles.toneMute : tone,
    isDelta: false,
  };
}

function modeHintText(mode: EnduranceChartMode, picked: number, size: number, count: number, t: Translate, kind: Kind): string {
  const wrap = (shown: number) =>
    shown > ENDURANCE_CHART_PALETTE.length ? t(`endurance.chartHintWrap${kind}`, { max: ENDURANCE_CHART_PALETTE.length }) : "";
  if (mode === "TOP") return t(`endurance.chartHintTop${kind}`, { size }) + wrap(size);
  if (mode === "ALL") return t(`endurance.chartHintAll${kind}`) + wrap(count);
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

/** Puce « manche par manche » de l'encart : la manche affichée est soulignée, les suivantes grisées. */
function stepClass(state: EnduranceChartRoundState, round: number, shown: number): string {
  let base = styles.step;
  if (state.kind === "PENDING") base = `${styles.step} ${styles.stepPending}`;
  else if (state.kind === "FORFEIT") base = `${styles.step} ${styles.toneDown}`;
  if (round === shown) return `${base} ${styles.stepShown}`;
  return round > shown ? `${base} ${styles.stepAfter}` : base;
}

type LegendRowProps = Readonly<{
  item: EnduranceChartSeries;
  shown: number;
  lastRound: number;
  color: string | null;
  pickMode: boolean;
  isPicked: boolean;
  isHover: boolean;
  kind: Kind;
  t: Translate;
  onToggle: (teamId: number) => void;
  onHover: (teamId: number) => void;
  onLeave: () => void;
  onFocusItem: (teamId: number) => void;
  onBlurItem: () => void;
}>;

/**
 * Une ligne de la légende : mémoïsée, pour qu'un survol ne reconstruise que
 * les deux lignes dont l'état change, pas les 64. Les libellés « place »,
 * « points », « écart » et « courbe tracée / masquée » ne sont lus que par les
 * lecteurs d'écran ; `aria-pressed` reste réservé à « Ma sélection ».
 */
const LegendRow = memo(function LegendRow({
  item,
  shown,
  lastRound,
  color,
  pickMode,
  isPicked,
  isHover,
  kind,
  t,
  onToggle,
  onHover,
  onLeave,
  onFocusItem,
  onBlurItem,
}: LegendRowProps) {
  const roundState = item.states[shown - 1];
  const state = legendState(roundState, t, kind);
  const penalty = penaltyOf(roundState);
  return (
    <li>
      <button
        type="button"
        data-legend-item=""
        aria-pressed={pickMode ? isPicked : undefined}
        onClick={() => onToggle(item.teamId)}
        onMouseEnter={() => onHover(item.teamId)}
        onMouseLeave={onLeave}
        onFocus={() => onFocusItem(item.teamId)}
        onBlur={onBlurItem}
        className={`${styles.legendItem} ${isHover ? styles.legendHover : ""}`}
      >
        <span
          aria-hidden
          className={`${color === null ? styles.swatchEmpty : styles.swatch} ${styles.legendSwatch}`}
          style={color === null ? undefined : { background: color }}
        />
        <span className={styles.legendRank}>
          <span className="sr-only">{t("endurance.chartLegendRankLabel")} </span>
          {chartRankAt(item, shown, lastRound)}
        </span>
        <span className={styles.legendName}>{visibleText(item.teamName)}</span>
        <span className={styles.legendValue}>
          <span className="sr-only">{t("endurance.chartLegendPointsLabel")} </span>
          {chartValueAt(item, shown, lastRound)}
        </span>
        <span className={`${styles.legendState} ${state.tone}`}>
          {state.isDelta && <span className="sr-only">{t("endurance.chartLegendDeltaLabel")} </span>}
          {state.text}
          {penalty > 0 && <PenaltyMark points={penalty} t={t} />}
        </span>
        {!pickMode && (
          <span className="sr-only">{t(color === null ? "endurance.chartLegendHidden" : "endurance.chartLegendDrawn")}</span>
        )}
      </button>
    </li>
  );
});

/**
 * Graphique « Évolution de l'endurance » (`docs/features/ENDURANCE_RANKING_VIEWS.md`,
 * § Graphique). Monté **seulement** volet ouvert (`EnduranceChartPanel`) : le
 * replier le démonte, ce qui annule toute image d'animation en attente.
 *
 * Lecture seule pour tous. La sélection « Ma sélection » vit dans l'état du
 * composant et nulle part ailleurs — ni stockage local, ni serveur.
 */
export function EnduranceChart({
  endurance: pushedEndurance,
  matches: pushedMatches,
}: Readonly<{ endurance: EnduranceMeta; matches: BracketMatch[] }>) {
  const { t } = useTournamentViewText(FR_VIEWS_TEXT);
  const { showError } = useToast();
  const hintId = useId();
  const solo = useEntrantParticipantType() === "SOLO";
  const kind = solo ? "Solo" : "Team";
  const animate = useEnduranceChartAnimate();

  // Chaque poussée du flux apporte de nouveaux objets, même quand rien de ce
  // que lit le graphique n'a bougé : sans changement de contenu, on garde les
  // précédents (séries, ordre, légende et tableau ne se refont pas).
  const inputKey = enduranceChartInputKey(pushedEndurance, pushedMatches);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- la clé de contenu remplace les objets poussés.
  const { endurance, matches } = useMemo(() => ({ endurance: pushedEndurance, matches: pushedMatches }), [inputKey]);

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
  const [replayKey, setReplayKey] = useState(0);
  // Engagé qui a le focus clavier dans la légende : un `mouseleave` y revient
  // au lieu d'effacer l'encart.
  const focusedRef = useRef<number | null>(null);
  const pickRef = useRef({ mode, picked });
  pickRef.current = { mode, picked };

  const shown = chartShownRound(target, lastRound);

  const showRound = (round: number) => {
    if (round > lastRound || round === shown) return;
    setTarget(chartTargetFor(round, lastRound));
  };
  const replay = () => setReplayKey((value) => value + 1);
  const toggle = useCallback(
    (teamId: number) => {
      const next = togglePick(pickRef.current.mode, pickRef.current.picked, teamId);
      setMode(next.mode);
      setPicked(next.picked);
      if (next.full) showError(t(`endurance.chartPickMax${kind}`, { max: ENDURANCE_CHART_PICK_MAX }));
    },
    [showError, t, kind],
  );
  const enter = useCallback((teamId: number) => setHover(teamId), []);
  const leave = useCallback(() => setHover(focusedRef.current), []);
  const focusItem = useCallback((teamId: number) => {
    focusedRef.current = teamId;
    setHover(teamId);
  }, []);
  const blurItem = useCallback(() => {
    focusedRef.current = null;
    setHover(null);
  }, []);

  // Tout ce qui ne dépend ni de l'avancement de l'animation (qui vit dans
  // `EnduranceChartLines`) ni du survol est mémoïsé.
  const order = useMemo(() => chartOrderAt(series, shown, lastRound), [series, shown, lastRound]);
  const top = useMemo(() => chartTopOf(order, endurance.playoffSize), [order, endurance.playoffSize]);
  const threshold = useMemo(
    () => chartThresholdOf(order, shown, lastRound, endurance.playoffSize),
    [order, shown, lastRound, endurance.playoffSize],
  );
  // Couleur attribuée **une fois** à chaque engagé tracé, puis gardée : un
  // échange de places ou un résultat poussé ne recolore pas les courbes.
  const assigned = useRef<Map<number, number>>(new Map());
  const colors = useMemo(() => {
    const ids = chartColoredIds(mode, { top, picked, series });
    assigned.current = assignChartColors(assigned.current, ids);
    return new Map(ids.map((id) => [id, colorVar(assigned.current.get(id) ?? 0)]));
  }, [mode, top, picked, series]);
  // Courbes tracées, dans l'ordre stable du classement général ; leur zone de
  // survol ne dépend ni de l'animation ni du survol.
  const entries = useMemo<ChartLineEntry[]>(
    () =>
      series.flatMap((item) => {
        const color = colors.get(item.teamId);
        return color === undefined ? [] : [{ item, color, hit: chartHitPath(item, shown, geometry) }];
      }),
    [series, colors, shown, geometry],
  );
  const hovered = useMemo(
    () => (hover === null ? null : (series.find((item) => item.teamId === hover) ?? null)),
    [series, hover],
  );
  const hoverEntry = useMemo<ChartHoverEntry | null>(
    () => (hovered === null ? null : { item: hovered, color: colors.get(hovered.teamId) ?? null }),
    [hovered, colors],
  );

  // Un résultat poussé retrie la légende : l'engagé sous un pointeur immobile
  // n'est plus celui du survol (on revient au focus clavier), et le bouton
  // focalisé reste dans la partie visible de la zone défilante.
  useEffect(() => {
    setHover(focusedRef.current);
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.dataset.legendItem !== undefined && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [order]);

  const roundState = (round: number): RoundState => {
    if (round > lastRound) return "UPCOMING";
    if (progressRound !== null && progressRound.round === round) return "CURRENT";
    return "DONE";
  };

  const svgLabel =
    (entries.length === 0
      ? t("endurance.chartSvgEmpty", { round: shown })
      : t(`endurance.chartSvg${kind}`, { count: entries.length, round: shown })) +
    (threshold === null ? "" : t("endurance.chartSvgThreshold", { size: endurance.playoffSize, value: threshold }));

  const hasDraws = endurance.standings.some((standing) => standing.draws > 0);

  const modeHint = modeHintText(mode, picked.length, endurance.playoffSize, series.length, t, kind);

  const modes: { id: EnduranceChartMode; label: string }[] = [
    { id: "TOP", label: t("endurance.chartModeTop", { size: endurance.playoffSize }) },
    { id: "PICK", label: t("endurance.chartModePick") },
    { id: "ALL", label: t(`endurance.chartModeAll${kind}`) },
  ];

  const rounds = useMemo(() => Array.from({ length: roundCount }, (_, i) => i + 1), [roundCount]);
  const playedRounds = useMemo(() => Array.from({ length: lastRound }, (_, i) => i + 1), [lastRound]);

  // Fond du tracé (zone future, bande, graduations, axes, seuil) : ne bouge
  // qu'avec la manche affichée, jamais pendant l'animation.
  const backdrop = useMemo(() => {
    const yTicks: number[] = [];
    for (let v = 0; v <= geometry.maxY; v += geometry.tick) yTicks.push(v);
    const bandX = chartX(geometry, shown) - geometry.step / 2;
    const futureX = chartX(geometry, lastRound) + geometry.step / 2;
    return (
      <>
        {futureX < PLOT_RIGHT && (
          <rect x={futureX} y={CHART_PAD.top} width={PLOT_RIGHT - futureX} height={PLOT_BOTTOM - CHART_PAD.top} className={styles.future} />
        )}
        <rect x={bandX} y={CHART_PAD.top} width={geometry.step} height={PLOT_BOTTOM - CHART_PAD.top} className={styles.band} />
        {yTicks.map((value) => (
          <g key={value}>
            <line
              x1={CHART_PAD.left}
              x2={PLOT_RIGHT}
              y1={chartY(geometry, value)}
              y2={chartY(geometry, value)}
              className={value === endurance.startPoints ? styles.gridStart : styles.grid}
            />
            <text x={CHART_PAD.left - 8} y={chartY(geometry, value) + 4} className={styles.axisY}>
              {value}
            </text>
          </g>
        ))}
        <text x={chartX(geometry, 0)} y={CHART_H - 30} className={`${styles.axisX} ${styles.axisStart}`}>
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
              x2={PLOT_RIGHT}
              y1={chartY(geometry, threshold)}
              y2={chartY(geometry, threshold)}
              className={styles.cut}
            />
            <text x={PLOT_RIGHT - 4} y={chartY(geometry, threshold) - 6} className={styles.cutLabel}>
              {t("endurance.chartThreshold", { size: endurance.playoffSize, round: shown, value: threshold })}
            </text>
          </>
        )}
      </>
    );
  }, [geometry, shown, lastRound, threshold, rounds, endurance.startPoints, endurance.playoffSize, t]);

  // Légende : suit la manche, le mode, la sélection et les couleurs. Le survol
  // ne reconstruit que les deux lignes concernées (lignes mémoïsées).
  const legend = useMemo(
    () => (
      <ScrollArea orientation="y" ariaLabel={t(`endurance.chartLegend${kind}`)} className={styles.legend}>
        <ul className={styles.legendList}>
          {order.map((item) => (
            <LegendRow
              key={item.teamId}
              item={item}
              shown={shown}
              lastRound={lastRound}
              color={colors.get(item.teamId) ?? null}
              pickMode={mode === "PICK"}
              isPicked={picked.includes(item.teamId)}
              isHover={hover === item.teamId}
              kind={kind}
              t={t}
              onToggle={toggle}
              onHover={enter}
              onLeave={leave}
              onFocusItem={focusItem}
              onBlurItem={blurItem}
            />
          ))}
        </ul>
      </ScrollArea>
    ),
    [order, colors, shown, lastRound, mode, picked, hover, toggle, enter, leave, focusItem, blurItem, t, kind],
  );

  // Le tableau « manche par manche » retiré de l'écran, pour les lecteurs
  // d'écran : tous les engagés, toutes les manches tirées. Ne dépend que des
  // résultats : ni l'animation ni le survol ne le refont.
  const srTable = useMemo(
    () => (
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
                <td key={index}>
                  {cellText(state, t, kind, "endurance.chartTableForfeit")}
                  {penaltyOf(state) > 0 && t("endurance.penaltyBadgeSr", { points: penaltyOf(state) })}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    ),
    [series, playedRounds, endurance.startPoints, t, kind],
  );

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
          {/* Mouvement réduit ou régime économe : la courbe est déjà arrivée,
              rejouer ne montrerait rien — le bouton n'est pas proposé. */}
          {animate && (
            <button type="button" onClick={replay} className={styles.replayButton}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <path d="M3 4v5h5" />
              </svg>
              {t("endurance.chartReplay")}
            </button>
          )}
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

          <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" aria-label={svgLabel} className={styles.svg}>
            {backdrop}
            <EnduranceChartLines
              entries={entries}
              hover={hoverEntry}
              shown={shown}
              geometry={geometry}
              animate={animate}
              replayKey={replayKey}
              forfeitLabel={t("endurance.chartStateForfeit")}
              onHover={enter}
              onLeave={leave}
              onToggle={toggle}
            />
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
                    className={hoverEntry?.color ? styles.swatch : styles.swatchHover}
                    style={hoverEntry?.color ? { background: hoverEntry.color } : undefined}
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
                    <span
                      key={index}
                      className={stepClass(state, index + 1, shown)}
                      aria-current={index + 1 === shown ? "step" : undefined}
                    >
                      {t("endurance.chartAxisRound", { round: index + 1 })}{" "}
                      <strong>{cellText(state, t, kind, `endurance.chartStepForfeit${kind}`)}</strong>
                      {penaltyOf(state) > 0 && <PenaltyMark points={penaltyOf(state)} t={t} />}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {legend}
      </div>

      {srTable}
    </div>
  );
}
