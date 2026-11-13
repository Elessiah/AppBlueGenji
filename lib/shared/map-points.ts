/**
 * Format Duel / Arcade (`docs/features/DUEL_ARCADE.md`) : chaque carte se gagne
 * au **premier à N points** (Widowmaker 1v1 : premier à 5).
 *
 * Module **pur**, partagé par l'interface et le serveur. Le format de match
 * (BO / FT) compte toujours des **cartes** ; ce réglage ne dit que ce qu'est
 * une carte valable : le vainqueur marque exactement N points, l'autre de 0 à
 * N − 1 — jamais d'égalité. Le score du match se dérive comme toujours (une
 * carte gagnée = un point, `deriveMatchScore`), si bien que moteurs et
 * classements ne voient rien de neuf.
 *
 * Réglé sur le tournoi (`bg_tournaments.map_point_target`, `NULL` = format
 * éteint), remplaçable par tour (`bg_tournament_round_maps.map_point_target`)
 * tant que le format est allumé sur le tournoi.
 */
import { roundKeyId, type RoundKey } from "./round-maps";
import { matchWinsRequired, type MatchFormat } from "./match-format";
import type { PhaseFormat, TournamentFormat } from "./types";

/** Bornes de N, partagées par le formulaire et le garde-fou serveur. */
export const MAP_POINT_TARGET_MIN = 1;
/** Une carte ne porte pas plus de 99 points (`MAP_SCORE_MAX`). */
export const MAP_POINT_TARGET_MAX = 99;

/** N proposé quand on coche « Format Duel / Arcade ». */
export const DEFAULT_MAP_POINT_TARGET = 5;

/** Points par carte propres à un tour. */
export type RoundPointTarget = RoundKey & { target: number };

/** N valable : un entier entre les bornes. */
export function isValidMapPointTarget(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MAP_POINT_TARGET_MIN &&
    value <= MAP_POINT_TARGET_MAX
  );
}

/** Lecture tolérante d'une colonne : `null` pour tout ce qui n'est pas un N valable. */
export function parseStoredMapPointTarget(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return isValidMapPointTarget(value) ? value : null;
}

/**
 * N qui s'applique à un tour : celui du tour s'il en a un, sinon celui du
 * tournoi — et rien du tout quand le format est éteint sur le tournoi (un
 * réglage de tour resté d'avant ne rallume rien).
 */
export function effectiveMapPointTarget(
  tournamentTarget: number | null | undefined,
  roundTargets: ReadonlyArray<RoundPointTarget> | null | undefined,
  round: RoundKey,
): number | null {
  if (tournamentTarget === null || tournamentTarget === undefined) return null;
  return roundPointTargetOf(roundTargets, round) ?? tournamentTarget;
}

/**
 * Tableau (`bracket`) qu'un format peut jouer : `UPPER` partout, `LOWER` et
 * `GRAND` en double élimination seulement, la petite finale (`THIRD_PLACE`) en
 * élimination simple qui la joue (`hasThirdPlaceMatch`) et dans l'arbre final de BlueGenji Survie. Garde-fou de la
 * pose des points d'un tour : une clé que le format ne jouera jamais n'est
 * pas écrite (ligne orpheline portée par chaque instantané).
 */
export function bracketFitsFormat(
  format: TournamentFormat | PhaseFormat,
  bracket: string,
  hasThirdPlaceMatch = false,
): boolean {
  if (bracket === "UPPER") return true;
  if (bracket === "LOWER" || bracket === "GRAND") return format === "DOUBLE";
  if (bracket === "THIRD_PLACE") return (format === "SINGLE" && hasThirdPlaceMatch) || format === "BG_SURVIE";
  return false;
}

/** N réglé sur un tour (`null` = il suit le tournoi). */
export function roundPointTargetOf(
  roundTargets: ReadonlyArray<RoundPointTarget> | null | undefined,
  round: RoundKey,
): number | null {
  const id = roundKeyId(round);
  return roundTargets?.find((item) => roundKeyId(item) === id)?.target ?? null;
}

/**
 * Score de carte valable au premier à `target` : un camp à exactement
 * `target`, l'autre en dessous. Rend le champ fautif à désigner, `null` si la
 * carte est valable.
 */
export function duelMapScoreFault(
  map: { team1Score: number; team2Score: number },
  target: number,
): "team1Score" | "team2Score" | null {
  const { team1Score: a, team2Score: b } = map;
  if (a === target && b >= 0 && b < target) return null;
  if (b === target && a >= 0 && a < target) return null;
  // Le champ à reprendre : celui qui dépasse N, sinon le second sur une
  // égalité à N, sinon le plus bas (personne n'a N).
  if (a > target) return "team1Score";
  if (b > target) return "team2Score";
  if (a === target) return "team2Score";
  return a <= b ? "team1Score" : "team2Score";
}

/**
 * Points d'une liste de cartes, en texte compact (« 5–3 · 2–5 ») : la ligne
 * qu'affichent les cartes de match et le journal Discord. Vide sans carte.
 */
export function mapPointsLine(maps: ReadonlyArray<{ team1Score: number; team2Score: number }>): string {
  return maps.map((map) => `${map.team1Score}\u2013${map.team2Score}`).join(" \u00b7 ");
}

/** Score d'une carte, tel qu'un arbre ou une carte de match l'affiche. */
export type DisplayScore = { team1: number; team2: number };

/**
 * Score **affiché** d'un match joué sur une seule carte (BO1 / FT1, Duel ou
 * non) : celui de la carte (5–3), plutôt que le score du match (1–0), qui ne
 * dit rien de plus que le vainqueur (`docs/features/MAP_SCORES.md`).
 *
 * `null` — on garde le score du match — hors format à une carte, sans score
 * posé, sur un forfait, ou quand le détail ne tient pas en une seule carte
 * (aucune saisie, ou une carte nulle rejouée). Affichage seul : classements et
 * départages comptent toujours les cartes gagnées.
 */
export function singleMapDisplayScore(
  match: {
    team1Score: number | null;
    team2Score: number | null;
    forfeitTeamId: number | null;
    maps: ReadonlyArray<{ team1Score: number; team2Score: number }>;
  },
  format: MatchFormat | null,
): DisplayScore | null {
  if (format === null || matchWinsRequired(format) !== 1) return null;
  if (match.team1Score === null || match.team2Score === null || match.forfeitTeamId !== null) return null;
  if (match.maps.length !== 1) return null;
  const [map] = match.maps;
  return { team1: map.team1Score, team2: map.team2Score };
}

/**
 * Score d'un match **tel qu'un écran le cite** : celui de la carte sur un match
 * à une seule carte (`displayScore` de l'instantané, 5–3), sinon celui du match.
 * Écrit une fois pour l'arbre, la modale d'arbitrage et le retour en arrière :
 * le même match ne se lit pas 5–3 ici et 1–0 là.
 */
export function shownMatchScore(match: {
  team1Score: number | null;
  team2Score: number | null;
  displayScore?: DisplayScore | null;
}): { team1: number | null; team2: number | null } {
  const shown = match.displayScore ?? null;
  return shown ? { team1: shown.team1, team2: shown.team2 } : { team1: match.team1Score, team2: match.team2Score };
}

/**
 * Un match du tour porte-t-il déjà un score (retenu, proposé ou en cartes) ?
 * Lecture **de l'écran** du verrou `MAP_POINTS_LOCKED` du serveur
 * (`assertMapPointsUnlocked`) : elle grise le champ avant l'envoi, le serveur
 * reste seul juge.
 */
export function roundPointsLocked(
  matches: ReadonlyArray<{
    phaseId: number;
    bracket: string;
    roundNumber: number;
    team1Score: number | null;
    team2Score: number | null;
    team1Report: unknown;
    team2Report: unknown;
    maps: ReadonlyArray<unknown>;
  }>,
  round: RoundKey,
): boolean {
  return matches.some(
    (match) =>
      match.phaseId === round.phaseId &&
      match.bracket === round.bracket &&
      match.roundNumber === round.roundNumber &&
      (match.team1Score !== null ||
        match.team2Score !== null ||
        Boolean(match.team1Report) ||
        Boolean(match.team2Report) ||
        match.maps.length > 0),
  );
}
