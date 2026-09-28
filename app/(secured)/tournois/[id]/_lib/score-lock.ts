import { fromBracketMatch, lockedScoreMatchIds } from "@/lib/shared/match-lock";
import type { BracketMatch, TournamentFormat } from "@/lib/shared/types";

/**
 * Verrous de score d'un plateau, calculés **une fois par instantané**.
 *
 * Chaque `MatchRow` demande si son score est verrouillé, et toutes lui passent
 * la même liste — `detail.matches`, remplacée par un tableau neuf à chaque
 * instantané du flux. La liste sert donc de clé : la première carte rendue
 * paie la passe (`lockedScoreMatchIds`, linéaire), les suivantes lisent un
 * ensemble. La `WeakMap` laisse partir les verrous d'un instantané périmé avec
 * lui, sans ménage à faire.
 *
 * Le format fait partie de la clé : une même liste peut être lue sous deux
 * formats (la vue d'une phase de multi-phases lit le plateau entier sous le
 * format de sa phase).
 */
const cache = new WeakMap<readonly BracketMatch[], Map<TournamentFormat, Set<number>>>();

export function isMatchScoreLocked(
  matchId: number,
  allMatches: readonly BracketMatch[],
  format: TournamentFormat,
): boolean {
  let byFormat = cache.get(allMatches);
  if (!byFormat) {
    byFormat = new Map();
    cache.set(allMatches, byFormat);
  }
  let locked = byFormat.get(format);
  if (!locked) {
    locked = lockedScoreMatchIds(allMatches.map(fromBracketMatch), format);
    byFormat.set(format, locked);
  }
  return locked.has(matchId);
}
