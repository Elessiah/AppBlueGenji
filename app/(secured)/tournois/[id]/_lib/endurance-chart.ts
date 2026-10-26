import type { BracketMatch, EnduranceMeta, EnduranceStandingRow } from "@/lib/shared/types";
import { enduranceRoundColumnCell, pointsAfterRound, rankAfterRound } from "./endurance-ranking-views";

/**
 * Graphique « Évolution de l'endurance » (`docs/features/ENDURANCE_RANKING_VIEWS.md`,
 * § Graphique) : la courbe du capital de chaque engagé, du départ à la manche
 * affichée.
 *
 * Module **pur** : séries, géométrie du SVG, Top N d'une manche, seuil des
 * play-offs, couleurs, plafond de la sélection et pas de l'animation. Rien n'y
 * est recalculé du moteur — capitaux et rangs viennent du rejeu
 * (`standings[].rounds`), l'état « pas encore joué » des matchs, déjà publics.
 */

/**
 * Palette des courbes : huit néons froids **du site** (jetons de
 * `app/globals.css`), chacun ≥ 3:1 sur le fond du graphique, et deux couleurs
 * voisines (rangs qui se suivent dans la légende) séparées aussi par leur
 * clarté. Jamais d'ambre : il ne signale que les avertissements.
 */
export const ENDURANCE_CHART_PALETTE = [
  { token: "--blue-500", hex: "#5ac8ff" },
  { token: "--violet-400", hex: "#a78bfa" },
  { token: "--accent-green", hex: "#4fe0a2" },
  { token: "--pink-400", hex: "#f78ad8" },
  { token: "--blue-100", hex: "#dff2ff" },
  { token: "--blue-700", hex: "#1b6a8f" },
  { token: "--violet-300", hex: "#c4b5fd" },
  { token: "--cyan-400", hex: "#3ee6ff" },
] as const;

/** « Ma sélection » : autant d'engagés que de couleurs, pas un de plus. */
export const ENDURANCE_CHART_PICK_MAX = ENDURANCE_CHART_PALETTE.length;

/** Durée d'animation d'une manche à la suivante. */
export const ENDURANCE_CHART_ROUND_MS = 650;

export type EnduranceChartMode = "TOP" | "PICK" | "ALL";

/**
 * État d'un engagé à une manche :
 * - `PLAYED` — manche jouée (ou exemptée), capital connu ;
 * - `PENDING` — manche en cours, son match n'est pas encore joué ;
 * - `FORFEIT` — retiré par forfait (cette manche et les suivantes) ;
 * - `OUT` — déjà sorti lors d'une manche antérieure.
 */
export type EnduranceChartRoundState =
  | { kind: "PLAYED"; points: number; delta: number }
  | { kind: "PENDING" }
  | { kind: "FORFEIT" }
  | { kind: "OUT" };

export type EnduranceChartSeries = {
  teamId: number;
  teamName: string;
  seed: number;
  /** `states[r - 1]` : état à la manche `r`, de 1 à la dernière manche tirée. */
  states: EnduranceChartRoundState[];
  /**
   * Points tracés : index 0 = capital de départ, index `r` = capital après la
   * manche `r`. La suite s'arrête à la première manche non jouée — une courbe
   * ne se prolonge jamais par une valeur supposée.
   */
  values: number[];
  standing: EnduranceStandingRow;
};

/** Séries de tous les engagés, dans l'ordre du classement général. */
export function enduranceChartSeries(endurance: EnduranceMeta, matches: BracketMatch[]): EnduranceChartSeries[] {
  const lastRound = endurance.currentRound;
  // Les matchs rangés par manche, une fois : `enduranceRoundColumnCell` ne lit
  // que ceux de la manche demandée, et reparcourir tous les matchs pour chaque
  // case (64 engagés × 12 manches) coûterait ~600 000 comparaisons par poussée.
  const byRound = new Map<number, BracketMatch[]>();
  for (const match of matches) {
    const list = byRound.get(match.roundNumber);
    if (list === undefined) byRound.set(match.roundNumber, [match]);
    else list.push(match);
  }
  return [...endurance.standings]
    .sort((a, b) => a.rank - b.rank)
    .map((standing) => {
      const states: EnduranceChartRoundState[] = [];
      const values = [endurance.startPoints];
      let open = true;
      let previous = endurance.startPoints;
      for (let round = 1; round <= lastRound; round += 1) {
        const cell = enduranceRoundColumnCell(standing, round, byRound.get(round) ?? [], endurance.startPoints);
        let state: EnduranceChartRoundState;
        if (cell.kind === "PLAYED" || cell.kind === "BYE") {
          const points = pointsAfterRound(standing, round, endurance.startPoints);
          state = { kind: "PLAYED", points, delta: points - previous };
          previous = points;
        } else {
          state = { kind: cell.kind };
        }
        states.push(state);
        if (open && state.kind === "PLAYED") values.push(state.points);
        else open = false;
      }
      return { teamId: standing.teamId, teamName: standing.teamName, seed: standing.seed, states, values, standing };
    });
}

/** Nombre de manches de l'axe : le plafond s'il y en a un, sinon la dernière tirée. */
export function enduranceChartRoundCount(endurance: EnduranceMeta): number {
  return Math.max(endurance.maxRounds ?? 0, endurance.currentRound);
}

/** Rang d'un engagé **à l'issue** de la manche affichée (la dernière = le général). */
export function chartRankAt(series: EnduranceChartSeries, round: number, lastRound: number): number {
  if (round >= lastRound) return series.standing.rank;
  return rankAfterRound(series.standing, round) ?? series.standing.rank;
}

/**
 * Bilan (V / N / D) cumulé **à l'issue** de la manche affichée, comme le rang
 * de l'encart — la dernière lit le général. Même lecture que la vue « après la
 * manche n » (`pastRow`) : 0 si l'instantané ne porte pas le bilan.
 */
export function chartRecordAt(
  series: EnduranceChartSeries,
  round: number,
  lastRound: number,
): { wins: number; draws: number; losses: number } {
  const { standing } = series;
  if (round >= lastRound) return { wins: standing.wins, draws: standing.draws, losses: standing.losses };
  const cell = standing.rounds.find((entry) => entry.round === round);
  return { wins: cell?.wins ?? 0, draws: cell?.draws ?? 0, losses: cell?.losses ?? 0 };
}

/** Capital d'un engagé à la manche affichée (dernier capital connu au-delà). */
export function chartValueAt(series: EnduranceChartSeries, round: number, lastRound: number): number {
  if (round >= lastRound) return series.standing.points;
  return series.values[Math.min(round, series.values.length - 1)];
}

/** Engagés rangés par leur place à la manche affichée. */
export function chartOrderAt(all: EnduranceChartSeries[], round: number, lastRound: number): EnduranceChartSeries[] {
  return [...all].sort(
    (a, b) => chartRankAt(a, round, lastRound) - chartRankAt(b, round, lastRound) || a.standing.rank - b.standing.rank,
  );
}

/** Les `size` premiers à la manche affichée — le Top N des play-offs. */
export function chartTopAt(all: EnduranceChartSeries[], round: number, lastRound: number, size: number): number[] {
  return chartTopOf(chartOrderAt(all, round, lastRound), size);
}

/** Top N tiré d'un ordre déjà calculé (`chartOrderAt`), sans retrier. */
export function chartTopOf(order: readonly EnduranceChartSeries[], size: number): number[] {
  return order.slice(0, Math.max(0, size)).map((series) => series.teamId);
}

/**
 * Seuil des play-offs à la manche affichée : le capital du `size`-ième.
 * `null` quand le plateau compte moins d'engagés que de places.
 */
export function chartThresholdAt(
  all: EnduranceChartSeries[],
  round: number,
  lastRound: number,
  size: number,
): number | null {
  return chartThresholdOf(chartOrderAt(all, round, lastRound), round, lastRound, size);
}

/** Seuil tiré d'un ordre déjà calculé (`chartOrderAt`), sans retrier. */
export function chartThresholdOf(
  order: readonly EnduranceChartSeries[],
  round: number,
  lastRound: number,
  size: number,
): number | null {
  if (size <= 0 || order.length < size) return null;
  return chartValueAt(order[size - 1], round, lastRound);
}

/**
 * Bascule d'un engagé dans « Ma sélection ». Hors de ce mode, le geste ouvre
 * une sélection réduite à lui ; au plafond, un ajout est ignoré (le retrait,
 * lui, reste possible).
 */
export function togglePick(
  mode: EnduranceChartMode,
  picked: readonly number[],
  teamId: number,
): { mode: EnduranceChartMode; picked: number[] } {
  if (mode !== "PICK") return { mode: "PICK", picked: [teamId] };
  if (picked.includes(teamId)) return { mode, picked: picked.filter((id) => id !== teamId) };
  if (picked.length >= ENDURANCE_CHART_PICK_MAX) return { mode, picked: [...picked] };
  return { mode, picked: [...picked, teamId] };
}

/**
 * Indice de couleur d'un engagé, `null` s'il n'est pas mis en couleur (et donc
 * pas tracé, sauf au survol). « Toutes » reprend la palette en boucle : au-delà
 * de huit, la légende et l'encart départagent.
 */
export function chartColorIndex(
  mode: EnduranceChartMode,
  teamId: number,
  ctx: { top: readonly number[]; picked: readonly number[]; generalIndex: number },
): number | null {
  const size = ENDURANCE_CHART_PALETTE.length;
  if (mode === "ALL") return ctx.generalIndex % size;
  const index = mode === "TOP" ? ctx.top.indexOf(teamId) : ctx.picked.indexOf(teamId);
  return index === -1 ? null : index % size;
}

/**
 * Manche affichée. `null` = suivre la dernière manche tirée : quand le flux en
 * pousse une nouvelle, volet ouvert, le graphique s'y place de lui-même. Un
 * choix explicite d'une manche passée reste, borné à [1, dernière manche].
 */
export function chartShownRound(target: number | null, lastRound: number): number {
  return Math.min(Math.max(1, target ?? lastRound), lastRound);
}

/** Choix d'une manche : la dernière tirée redevient « suivre la dernière ». */
export function chartTargetFor(round: number, lastRound: number): number | null {
  return round >= lastRound ? null : round;
}

// ---------- Géométrie du SVG (unités utilisateur, mises à l'échelle) ----------

export const CHART_W = 760;
export const CHART_H = 400;
export const CHART_PAD = { left: 48, right: 20, top: 20, bottom: 56 } as const;

export type ChartGeometry = { rounds: number; maxY: number; step: number; tick: number };

/** Pas des graduations : au plus sept lignes horizontales. */
export function chartTickStep(maxValue: number): number {
  for (const step of [1, 2, 3, 5, 10, 20, 25, 50, 100]) {
    if (Math.ceil(maxValue / step) <= 6) return step;
  }
  return Math.ceil(maxValue / 6);
}

export function chartGeometry(all: EnduranceChartSeries[], rounds: number, startPoints: number): ChartGeometry {
  const highest = Math.max(startPoints, 1, ...all.flatMap((series) => series.values));
  const tick = chartTickStep(highest);
  const maxY = Math.ceil(highest / tick) * tick;
  const step = (CHART_W - CHART_PAD.left - CHART_PAD.right) / Math.max(1, rounds);
  return { rounds: Math.max(1, rounds), maxY, step, tick };
}

export function chartX(geometry: ChartGeometry, index: number): number {
  return CHART_PAD.left + index * geometry.step;
}

export function chartY(geometry: ChartGeometry, value: number): number {
  const plot = CHART_H - CHART_PAD.top - CHART_PAD.bottom;
  return CHART_PAD.top + (1 - value / geometry.maxY) * plot;
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);

export type ChartLine = {
  /** Tracé visible, coupé à l'avancement de l'animation. */
  d: string;
  /** Zone de survol : la courbe entière jusqu'à la manche affichée. */
  hit: string;
  head: { x: number; y: number };
  /**
   * Tête creuse : l'engagé n'a pas joué la manche affichée (match à jouer,
   * forfait ou déjà sorti). Posée seulement une fois l'animation arrivée.
   */
  hollow: boolean;
  /** « FF » à côté de la tête : retiré par forfait à la manche affichée. */
  forfeit: boolean;
};

/**
 * Courbe d'un engagé jusqu'à la manche `target`, l'animation étant arrivée à
 * `progress` (0 = départ, `target` = terminée ; fractionnaire entre deux).
 */
export function chartLine(
  series: EnduranceChartSeries,
  target: number,
  progress: number,
  geometry: ChartGeometry,
): ChartLine {
  const values = series.values.slice(0, target + 1);
  const lastIdx = values.length - 1;
  const point = (index: number, value: number) => `${fmt(chartX(geometry, index))} ${fmt(chartY(geometry, value))}`;
  let d = `M${point(0, values[0])}`;
  let hit = d;
  let head = { x: chartX(geometry, 0), y: chartY(geometry, values[0]) };
  for (let k = 0; k < lastIdx; k += 1) {
    hit += ` L${point(k + 1, values[k + 1])}`;
    if (progress <= k) continue;
    const f = Math.min(1, progress - k);
    const value = values[k] + (values[k + 1] - values[k]) * f;
    head = { x: chartX(geometry, k + f), y: chartY(geometry, value) };
    d += ` L${fmt(head.x)} ${fmt(head.y)}`;
  }
  const hollow = lastIdx < target && progress >= lastIdx;
  const shownState = series.states[target - 1];
  return { d, hit, head, hollow, forfeit: hollow && shownState?.kind === "FORFEIT" };
}

// ---------- Animation ----------

/** Accélération puis freinage, sur [0, 1]. */
export function easeInOutQuad(f: number): number {
  return f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
}

/**
 * Avancement de l'animation `from` → `to` après `elapsedMs`, manche par
 * manche ; `done` une fois la cible atteinte.
 */
export function chartAnimationFrame(
  from: number,
  to: number,
  elapsedMs: number,
  perRoundMs: number = ENDURANCE_CHART_ROUND_MS,
): { progress: number; done: boolean } {
  const distance = Math.abs(to - from);
  const u = Math.max(0, elapsedMs) / perRoundMs;
  if (distance === 0 || u >= distance) return { progress: to, done: true };
  const whole = Math.floor(u);
  const direction = to > from ? 1 : -1;
  return { progress: from + direction * (whole + easeInOutQuad(u - whole)), done: false };
}
