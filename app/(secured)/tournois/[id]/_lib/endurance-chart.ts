import type { BracketMatch, EnduranceMeta, EnduranceStandingRow } from "@/lib/shared/types";
import { enduranceRecordAfterRound } from "@/lib/shared/bg-survie/replay";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";
import { isMatchPlayed } from "@/lib/shared/match-outcome";
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
 * clarté. Jamais d'ambre : il ne signale que les avertissements. Le sixième
 * est un jeton **propre au graphique** (`--chart-blue-deep`) : `--blue-700`
 * s'éclaircit en contraste élevé et se confondait alors avec le premier. Le
 * seuil des play-offs (`.cut`) prend un gris-bleu **hors palette**
 * (`--ink-mute`, en tirets) : le vert de la 3e courbe ne s'y confond plus.
 */
export const ENDURANCE_CHART_PALETTE = [
  { token: "--blue-500", hex: "#5ac8ff" },
  { token: "--violet-400", hex: "#a78bfa" },
  { token: "--accent-green", hex: "#4fe0a2" },
  { token: "--pink-400", hex: "#f78ad8" },
  { token: "--blue-100", hex: "#dff2ff" },
  { token: "--chart-blue-deep", hex: "#1b6a8f" },
  { token: "--violet-300", hex: "#c4b5fd" },
  { token: "--cyan-400", hex: "#3ee6ff" },
] as const;

/** « Ma sélection » : autant d'engagés que de couleurs, pas un de plus. */
export const ENDURANCE_CHART_PICK_MAX = ENDURANCE_CHART_PALETTE.length;

/** Durée d'animation d'une manche à la suivante. */
export const ENDURANCE_CHART_ROUND_MS = 650;

/** Durée totale d'une animation, quel que soit le nombre de manches parcourues. */
export const ENDURANCE_CHART_TOTAL_MS = 2400;

/**
 * Durée par manche d'une animation qui en parcourt `distance` : 650 ms, sans
 * dépasser 2,4 s au total (12 manches : 200 ms chacune, pas 7,8 s de rendus).
 */
export function chartRoundMs(distance: number): number {
  return Math.min(ENDURANCE_CHART_ROUND_MS, ENDURANCE_CHART_TOTAL_MS / Math.max(1, distance));
}

export type EnduranceChartMode = "TOP" | "PICK" | "ALL";

/**
 * État d'un engagé à une manche :
 * - `PLAYED` — manche jouée (ou exemptée), capital connu ;
 * - `PENDING` — manche en cours, son match n'est pas encore joué ;
 * - `FORFEIT` — retiré par forfait (cette manche et les suivantes) ;
 * - `OUT` — déjà sorti lors d'une manche antérieure.
 */
export type EnduranceChartRoundState =
  | {
      kind: "PLAYED";
      points: number;
      delta: number;
      /** Points retirés par pénalité d'arbitrage **dans cette manche** (0 sans sanction). */
      penalty: number;
    }
  | { kind: "PENDING"; penalty: number }
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
          state = { kind: "PLAYED", points, delta: points - previous, penalty: cell.penalty };
          previous = points;
        } else if (cell.kind === "PENDING") {
          state = { kind: "PENDING", penalty: cell.penalty };
        } else {
          state = { kind: cell.kind };
        }
        states.push(state);
        if (open && state.kind === "PLAYED") values.push(state.points);
        else {
          // Sanction posée avant que le match de la **dernière** manche soit
          // joué : la courbe va jusqu'au capital que lisent déjà la légende,
          // l'ordre du Top N et le seuil (pénalité déduite), au lieu de
          // s'arrêter au capital précédent — sinon le seuil tombe sous toutes
          // les courbes.
          if (open && state.kind === "PENDING" && state.penalty > 0 && round === lastRound) {
            values.push(standing.points);
          }
          open = false;
        }
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
  return enduranceRecordAfterRound(standing.rounds, round);
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
 * Bascule d'un engagé dans « Ma sélection ». Le geste mène toujours à ce
 * mode : hors de lui, une sélection déjà construite est **gardée** et
 * l'engagé s'y ajoute (sélection vide : elle s'ouvre sur lui seul) ; un
 * engagé déjà choisi se retire, sauf hors du mode, où le geste ne fait que l'y
 * ramener. Au plafond, un ajout est refusé (`full`, pour que l'écran le dise) ;
 * le retrait, lui, reste possible.
 */
export function togglePick(
  mode: EnduranceChartMode,
  picked: readonly number[],
  teamId: number,
): { mode: EnduranceChartMode; picked: number[]; full: boolean } {
  if (picked.includes(teamId)) {
    return { mode: "PICK", picked: mode === "PICK" ? picked.filter((id) => id !== teamId) : [...picked], full: false };
  }
  if (picked.length >= ENDURANCE_CHART_PICK_MAX) return { mode: "PICK", picked: [...picked], full: true };
  return { mode: "PICK", picked: [...picked, teamId], full: false };
}

/** Engagés mis en couleur (et donc tracés), dans l'ordre où ils prennent une couleur. */
export function chartColoredIds(
  mode: EnduranceChartMode,
  ctx: { top: readonly number[]; picked: readonly number[]; series: readonly EnduranceChartSeries[] },
): number[] {
  if (mode === "ALL") return ctx.series.map((item) => item.teamId);
  return mode === "TOP" ? [...ctx.top] : [...ctx.picked];
}

/**
 * Couleurs des engagés, **attribuées une fois** puis gardées : un échange de
 * places, un résultat poussé par le flux ou le retrait d'un premier choix ne
 * recolorent plus les courbes. `previous` (les attributions déjà faites, même
 * pour des engagés aujourd'hui masqués) est repris ; un engagé sans couleur —
 * ou dont la couleur est déjà prise par un engagé tracé avant lui — reçoit la
 * première couleur libre. Au-delà de huit tracés les couleurs se répètent
 * (l'aide le dit, la légende et l'encart départagent).
 */
export function assignChartColors(previous: ReadonlyMap<number, number>, ids: readonly number[]): Map<number, number> {
  const size = ENDURANCE_CHART_PALETTE.length;
  const next = new Map(previous);
  const taken = new Set<number>();
  const waiting: number[] = [];
  for (const id of ids) {
    const index = previous.get(id);
    if (index !== undefined && !taken.has(index)) taken.add(index);
    else waiting.push(id);
  }
  let wrapped = 0;
  for (const id of waiting) {
    let index = 0;
    while (index < size && taken.has(index)) index += 1;
    if (index === size) {
      index = wrapped % size;
      wrapped += 1;
    } else {
      taken.add(index);
    }
    next.set(id, index);
  }
  return next;
}

/**
 * Clé de **contenu** de ce que lit le graphique : une poussée du flux apporte
 * de nouveaux objets `endurance` / `matches` même quand rien de visible n'a
 * bougé (score de play-off, autre champ du tournoi). Deux entrées de même clé
 * donnent les mêmes séries : le graphique garde alors les précédentes — ni
 * séries, ni ordre, ni légende, ni tableau pour lecteurs d'écran recalculés.
 */
export function enduranceChartInputKey(endurance: EnduranceMeta, matches: readonly BracketMatch[]): string {
  const sep = "\u0001";
  const parts: string[] = [
    [endurance.currentRound, endurance.maxRounds ?? "", endurance.startPoints, endurance.playoffSize].join(","),
  ];
  for (const s of endurance.standings) {
    parts.push(
      [s.teamId, s.teamName, s.seed, s.rank, s.points, s.wins, s.draws, s.losses, s.status, s.eliminatedRound ?? "", s.penaltyPoints].join(sep),
    );
    for (const c of s.rounds) {
      parts.push([c.round, c.kind, c.points ?? "", c.penalty ?? "", c.rank ?? "", c.wins ?? "", c.losses ?? "", c.draws ?? ""].join(","));
    }
  }
  for (const match of matches) {
    // Les play-offs ne changent ni les séries ni l'avancement des manches.
    if (match.roundNumber >= PLAYOFF_ROUND_OFFSET) continue;
    parts.push(`${match.roundNumber}:${match.team1Id ?? ""}:${match.team2Id ?? ""}:${isMatchPlayed(match) ? 1 : 0}`);
  }
  return parts.join(sep);
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
 * Zone de survol d'un engagé : la courbe **entière** jusqu'à la manche `target`.
 * Ne dépend ni de l'avancement de l'animation ni du survol : à calculer une
 * fois par série, manche et géométrie, pas à chaque image.
 */
export function chartHitPath(series: EnduranceChartSeries, target: number, geometry: ChartGeometry): string {
  const values = series.values.slice(0, target + 1);
  let hit = `M${fmt(chartX(geometry, 0))} ${fmt(chartY(geometry, values[0]))}`;
  for (let k = 1; k < values.length; k += 1) {
    hit += ` L${fmt(chartX(geometry, k))} ${fmt(chartY(geometry, values[k]))}`;
  }
  return hit;
}

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
  let d = `M${fmt(chartX(geometry, 0))} ${fmt(chartY(geometry, values[0]))}`;
  let head = { x: chartX(geometry, 0), y: chartY(geometry, values[0]) };
  for (let k = 0; k < lastIdx; k += 1) {
    if (progress <= k) continue;
    const f = Math.min(1, progress - k);
    const value = values[k] + (values[k + 1] - values[k]) * f;
    head = { x: chartX(geometry, k + f), y: chartY(geometry, value) };
    d += ` L${fmt(head.x)} ${fmt(head.y)}`;
  }
  const shownState = series.states[target - 1];
  // Tête creuse : l'engagé n'a pas joué la manche affichée — y compris une
  // sanction prise avant son match, qui a déjà avancé la courbe jusqu'à elle.
  const hollow = shownState !== undefined && shownState.kind !== "PLAYED" && progress >= lastIdx;
  return { d, head, hollow, forfeit: hollow && shownState.kind === "FORFEIT" };
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
  perRoundMs: number = chartRoundMs(Math.abs(to - from)),
): { progress: number; done: boolean } {
  const distance = Math.abs(to - from);
  const u = Math.max(0, elapsedMs) / perRoundMs;
  if (distance === 0 || u >= distance) return { progress: to, done: true };
  const whole = Math.floor(u);
  const direction = to > from ? 1 : -1;
  return { progress: from + direction * (whole + easeInOutQuad(u - whole)), done: false };
}
