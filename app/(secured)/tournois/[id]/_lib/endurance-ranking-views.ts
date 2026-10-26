import type { BracketMatch, EnduranceMeta, EnduranceStandingRow } from "@/lib/shared/types";
import type { EnduranceRoundCell } from "@/lib/shared/bg-survie/replay";
import type { EnduranceStatus } from "@/lib/shared/bg-survie/standings";
import { isMatchPlayed } from "@/lib/shared/match-outcome";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie/rounds";

/**
 * Vues du classement d'endurance (`docs/features/ENDURANCE_RANKING_VIEWS.md`) :
 * « Classement après la manche n » pour chaque manche close, « Manche N —
 * matchs déjà joués » pour la manche en cours, puis le « Général ».
 *
 * Module **pur**. Le rang et le bilan de chaque manche viennent du **rejeu**
 * (`EnduranceRoundCell.rank` / `wins` / `losses` / `draws`) : rien n'est
 * redépartagé ici, le moteur reste la seule vérité. Le détail d'une rencontre
 * (score, adversaire, date) se lit sur les matchs, déjà publics.
 */

export type EnduranceRankingView =
  | { kind: "ROUND"; round: number }
  | { kind: "CURRENT"; round: number }
  | { kind: "GENERAL" };

/** Clé stable d'une vue (onglet, `aria-controls`). */
export function enduranceViewKey(view: EnduranceRankingView): string {
  return view.kind === "GENERAL" ? "general" : `${view.kind.toLowerCase()}-${view.round}`;
}

/**
 * Index de la vue suivie. Quand la manche en cours se clôt, sa vue
 * « current-n » devient « round-n » : le lecteur reste sur **sa** manche au
 * lieu d'être renvoyé sans bruit au « Général ». Une autre clé disparue
 * retombe sur la dernière vue (« Général »).
 */
export function resolveEnduranceViewIndex(views: EnduranceRankingView[], selectedKey: string): number {
  const found = views.findIndex((view) => enduranceViewKey(view) === selectedKey);
  if (found !== -1) return found;
  if (selectedKey.startsWith("current-")) {
    const closedKey = `round-${selectedKey.slice("current-".length)}`;
    const closed = views.findIndex((view) => enduranceViewKey(view) === closedKey);
    if (closed !== -1) return closed;
  }
  return views.length - 1;
}

/**
 * Clé React d'un onglet : la **manche**, pas son état — l'onglet « M3 en
 * cours » qui devient « Manche 3 » reste le même bouton et garde le focus.
 */
export function enduranceTabKey(view: EnduranceRankingView): string {
  return view.kind === "GENERAL" ? "general" : `tab-${view.round}`;
}

type RoundProgress = { total: number; played: number };

function qualificationMatches(matches: BracketMatch[]): BracketMatch[] {
  return matches.filter((match) => match.roundNumber < PLAYOFF_ROUND_OFFSET);
}

function progressByRound(matches: BracketMatch[]): Map<number, RoundProgress> {
  const progress = new Map<number, RoundProgress>();
  for (const match of qualificationMatches(matches)) {
    const entry = progress.get(match.roundNumber) ?? { total: 0, played: 0 };
    entry.total += 1;
    if (isMatchPlayed(match)) entry.played += 1;
    progress.set(match.roundNumber, entry);
  }
  return progress;
}

/**
 * Manche en cours : la première manche qualificative inachevée, `null` quand
 * tout est joué (play-offs, tournoi fini, ou manche suivante pas encore tirée).
 */
export function enduranceCurrentRound(matches: BracketMatch[]): { round: number; total: number; played: number } | null {
  const progress = progressByRound(matches);
  const rounds = [...progress.keys()].sort((a, b) => a - b);
  for (const round of rounds) {
    const entry = progress.get(round)!;
    if (entry.played < entry.total) return { round, ...entry };
  }
  return null;
}

/**
 * Liste des vues, de la plus ancienne au « Général » (vue par défaut, en
 * dernier). La vue « matchs déjà joués » n'existe que si la manche en cours a
 * au moins une rencontre jouée : vide, elle n'aurait rien à montrer.
 */
export function enduranceRankingViews(endurance: EnduranceMeta, matches: BracketMatch[]): EnduranceRankingView[] {
  const progress = progressByRound(matches);
  const views: EnduranceRankingView[] = [];
  for (const round of endurance.rounds) {
    const entry = progress.get(round);
    if (entry === undefined || entry.played < entry.total) continue;
    views.push({ kind: "ROUND", round });
  }
  const current = enduranceCurrentRound(matches);
  if (current !== null && current.played > 0) views.push({ kind: "CURRENT", round: current.round });
  views.push({ kind: "GENERAL" });
  return views;
}

/** Case d'une équipe pour une manche, `undefined` si l'instantané n'en porte pas. */
function cellAt(standing: EnduranceStandingRow, round: number): EnduranceRoundCell | undefined {
  return standing.rounds.find((cell) => cell.round === round);
}

/** Rang après une manche ; la manche 0 est l'ordre de départ (seed). */
export function rankAfterRound(standing: EnduranceStandingRow, round: number): number | null {
  if (round <= 0) return standing.seed;
  return cellAt(standing, round)?.rank ?? null;
}

/**
 * Déplacement depuis la manche précédente, en places : positif = remonte.
 * `null` quand l'instantané ne porte pas le rang d'avant (ancien format).
 */
export function rankMove(previousRank: number | null, rank: number): number | null {
  if (previousRank === null) return null;
  return previousRank - rank;
}

/** Statut d'une équipe **à l'issue** d'une manche passée. */
export function statusAfterRound(standing: EnduranceStandingRow, round: number): EnduranceStatus {
  const cell = cellAt(standing, round);
  if (cell?.kind === "FORFEIT") return "FORFEIT";
  if (standing.status !== "ACTIVE" && standing.eliminatedRound !== null && standing.eliminatedRound <= round) {
    return standing.status;
  }
  return "ACTIVE";
}

/** Une ligne d'une vue du classement. */
export type EnduranceRankingRow = {
  standing: EnduranceStandingRow;
  rank: number;
  /** ▲▼ depuis la manche précédente (positif = remonte), `null` = inconnu. */
  move: number | null;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  status: EnduranceStatus;
  /** Manche de la sortie, si la ligne est sortie à la date de la vue. */
  eliminatedRound: number | null;
  /** Points retirés par pénalité jusqu'à la date de la vue. */
  penaltyPoints: number;
};

/** Les équipes ayant joué une rencontre close de cette manche. */
function playedTeamIds(matches: BracketMatch[], round: number): Set<number> {
  const ids = new Set<number>();
  for (const match of qualificationMatches(matches)) {
    if (match.roundNumber !== round || !isMatchPlayed(match)) continue;
    if (match.team1Id !== null) ids.add(match.team1Id);
    if (match.team2Id !== null) ids.add(match.team2Id);
  }
  return ids;
}

/** Manche de référence des ▲▼ d'une vue « en direct » (Général, manche en cours). */
function liveBaseRound(endurance: EnduranceMeta, matches: BracketMatch[]): number {
  const current = enduranceCurrentRound(matches);
  if (current !== null) return current.round - 1;
  return Math.max(0, (endurance.rounds.at(-1) ?? 0) - 1);
}

/**
 * Manche à laquelle se comparent les ▲▼ d'une vue : la précédente pour une
 * manche close, la dernière close pour une vue en direct. `0` = ordre de départ.
 */
export function enduranceViewBaseRound(
  view: EnduranceRankingView,
  endurance: EnduranceMeta,
  matches: BracketMatch[],
): number {
  return view.kind === "ROUND" ? view.round - 1 : liveBaseRound(endurance, matches);
}

function liveRow(standing: EnduranceStandingRow, baseRound: number): EnduranceRankingRow {
  return {
    standing,
    rank: standing.rank,
    move: rankMove(rankAfterRound(standing, baseRound), standing.rank),
    points: standing.points,
    wins: standing.wins,
    losses: standing.losses,
    draws: standing.draws,
    status: standing.status,
    eliminatedRound: standing.eliminatedRound,
    penaltyPoints: standing.penaltyPoints,
  };
}

/**
 * Capital à l'issue d'une manche. Une case « sortie » ou « forfait » ne porte
 * pas de capital (`points: null`, c'est la case grisée du rejeu) : on lit alors
 * le dernier capital connu — une équipe « Hors course » garde le sien, elle ne
 * retombe pas à 0 dans les vues des manches suivantes.
 */
export function pointsAfterRound(standing: EnduranceStandingRow, round: number, startPoints: number): number {
  let best: { round: number; points: number } | null = null;
  for (const cell of standing.rounds) {
    if (cell.round > round || cell.points === null) continue;
    if (best === null || cell.round > best.round) best = { round: cell.round, points: cell.points };
  }
  return best?.points ?? startPoints;
}

function pastRow(
  standing: EnduranceStandingRow,
  round: number,
  fallbackRank: number,
  startPoints: number,
): EnduranceRankingRow {
  const cell = cellAt(standing, round);
  const rank = cell?.rank ?? fallbackRank;
  const status = statusAfterRound(standing, round);
  const penaltyPoints = standing.rounds
    .filter((c) => c.round <= round)
    .reduce((sum, c) => sum + (c.penalty ?? 0), 0);
  return {
    standing,
    rank,
    move: rankMove(rankAfterRound(standing, round - 1), rank),
    points: pointsAfterRound(standing, round, startPoints),
    wins: cell?.wins ?? 0,
    losses: cell?.losses ?? 0,
    draws: cell?.draws ?? 0,
    status,
    eliminatedRound: status === "ACTIVE" ? null : standing.eliminatedRound,
    penaltyPoints,
  };
}

/**
 * Lignes d'une vue, rangées par rang.
 *
 * - « Général » : le classement tel que le flux le pousse.
 * - « Manche n » close : rang, capital et bilan **à l'issue** de la manche.
 * - « Manche N — matchs déjà joués » : les seules équipes ayant joué ; le rang
 *   reste celui du général (c'est ce que dit l'en-tête de la vue).
 */
export function enduranceRankingRows(
  view: EnduranceRankingView,
  endurance: EnduranceMeta,
  matches: BracketMatch[],
): EnduranceRankingRow[] {
  const base = enduranceViewBaseRound(view, endurance, matches);
  if (view.kind === "GENERAL") return endurance.standings.map((standing) => liveRow(standing, base));
  if (view.kind === "CURRENT") {
    const played = playedTeamIds(matches, view.round);
    return endurance.standings
      .filter((standing) => played.has(standing.teamId))
      .map((standing) => liveRow(standing, base));
  }
  // Repli d'un instantané sans rang par manche : capital décroissant, puis
  // l'ordre du général — jamais une ligne sans rang.
  const fallback = [...endurance.standings].sort(
    (a, b) =>
      pointsAfterRound(b, view.round, endurance.startPoints) - pointsAfterRound(a, view.round, endurance.startPoints) ||
      a.rank - b.rank,
  );
  const fallbackRank = new Map(fallback.map((standing, index) => [standing.teamId, index + 1]));
  return endurance.standings
    .map((standing) =>
      pastRow(standing, view.round, fallbackRank.get(standing.teamId) ?? standing.rank, endurance.startPoints),
    )
    .sort((a, b) => a.rank - b.rank);
}

/**
 * Index de la ligne **après** laquelle passe la ligne « Zone play-offs », `-1`
 * si elle ne sépare rien (toutes dedans, ou toutes dehors).
 */
export function playoffCutIndex(rows: EnduranceRankingRow[], playoffSize: number): number {
  for (let index = 0; index < rows.length - 1; index += 1) {
    if (rows[index].rank <= playoffSize && rows[index + 1].rank > playoffSize) return index;
  }
  return -1;
}

/**
 * Prochaine rencontre programmée de la manche : la plus proche date **à venir**
 * parmi ses matchs non joués. `null` sans date à venir.
 */
export function nextScheduledMatch(matches: BracketMatch[], round: number, now: number): BracketMatch | null {
  let best: BracketMatch | null = null;
  let bestAt = Infinity;
  for (const match of qualificationMatches(matches)) {
    if (match.roundNumber !== round || isMatchPlayed(match) || match.startAt === null) continue;
    const at = Date.parse(match.startAt);
    if (Number.isNaN(at) || at < now || at >= bestAt) continue;
    best = match;
    bestAt = at;
  }
  return best;
}

/** Engagés de la manche en cours qui n'ont pas encore joué leur rencontre. */
export function pendingEntrantCount(matches: BracketMatch[], round: number): number {
  const ids = new Set<number>();
  for (const match of qualificationMatches(matches)) {
    if (match.roundNumber !== round || isMatchPlayed(match)) continue;
    if (match.team1Id !== null) ids.add(match.team1Id);
    if (match.team2Id !== null) ids.add(match.team2Id);
  }
  return ids.size;
}

/** Case « MANCHE n » de la variante A. */
export type EnduranceRoundColumnCell =
  | {
      kind: "PLAYED";
      /** Variation du capital sur la manche (pénalité comprise). */
      delta: number;
      ownScore: number | null;
      opponentScore: number | null;
      opponentId: number | null;
      opponentName: string | null;
      startAt: string | null;
    }
  | { kind: "PENDING"; opponentId: number | null; opponentName: string | null; startAt: string | null }
  | { kind: "FORFEIT" }
  | { kind: "OUT" }
  | { kind: "BYE" };

function capitalBefore(standing: EnduranceStandingRow, round: number, startPoints: number): number {
  for (let r = round - 1; r >= 1; r -= 1) {
    const cell = cellAt(standing, r);
    if (cell?.kind === "POINTS" && cell.points !== null) return cell.points;
  }
  return startPoints;
}

/** Contenu de la colonne « MANCHE n » pour une équipe. */
export function enduranceRoundColumnCell(
  standing: EnduranceStandingRow,
  round: number,
  matches: BracketMatch[],
  startPoints: number,
): EnduranceRoundColumnCell {
  const cell = cellAt(standing, round);
  if (cell?.kind === "FORFEIT" || statusAfterRound(standing, round) === "FORFEIT") return { kind: "FORFEIT" };
  if (cell?.kind === "OUT") return { kind: "OUT" };

  const match = qualificationMatches(matches).find(
    (m) => m.roundNumber === round && (m.team1Id === standing.teamId || m.team2Id === standing.teamId),
  );
  if (match === undefined) {
    return standing.eliminatedRound !== null && standing.eliminatedRound < round ? { kind: "OUT" } : { kind: "BYE" };
  }
  const isTeam1 = match.team1Id === standing.teamId;
  const opponentId = isTeam1 ? match.team2Id : match.team1Id;
  const opponentName = isTeam1 ? match.team2Name : match.team1Name;
  if (!isMatchPlayed(match)) return { kind: "PENDING", opponentId, opponentName, startAt: match.startAt };

  const after = cell?.kind === "POINTS" && cell.points !== null ? cell.points : standing.points;
  return {
    kind: "PLAYED",
    delta: after - capitalBefore(standing, round, startPoints),
    ownScore: isTeam1 ? match.team1Score : match.team2Score,
    opponentScore: isTeam1 ? match.team2Score : match.team1Score,
    opponentId,
    opponentName,
    startAt: match.startAt,
  };
}

/** Manche montrée par la colonne « MANCHE n » d'une vue. */
export function enduranceViewColumnRound(view: EnduranceRankingView, endurance: EnduranceMeta): number | null {
  if (view.kind !== "GENERAL") return view.round;
  return endurance.rounds.at(-1) ?? null;
}
