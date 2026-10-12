/**
 * BlueGenji Survie — gestes élémentaires du rejeu (`replay.ts`) : porter un
 * match clos au classement, puis, en fin de manche, les pénalités, les
 * abandons et la coupe sous plafond (`docs/features/BG_SURVIE_MODE.md`).
 *
 * Chaque geste modifie en place les lignes que le rejeu lui confie.
 *
 * Module pur : aucune dépendance base de données.
 */

import { forfeitMapCount, type MatchFormat } from "../match-format";
import type { EnduranceConfig } from "./config";
import { enduranceMatchMaps, type EnduranceMatchOutcome } from "./match-outcome";
import { enduranceEliminationCut } from "./qualification";
import type { EnduranceStanding } from "./standings";

/**
 * Applique le solde de maps d'une équipe sur son capital, et la sort du tournoi
 * si celui-ci tombe à 0.
 *
 * Le contrôle vaut pour les **deux** équipes du match, pas seulement la
 * perdante : sur un barème où la perte pèse plus que le gain, un 3-2 peut
 * coûter des points à son vainqueur.
 */
function applyMapDelta(
  standing: EnduranceStanding,
  mapsWon: number,
  mapsLost: number,
  config: EnduranceConfig,
  round: number,
): void {
  standing.points += config.winDelta * mapsWon - config.lossDelta * mapsLost;
  if (standing.points <= 0) {
    standing.points = 0;
    standing.status = "ELIMINATED";
    standing.eliminatedRound = round;
  }
}

/**
 * Retire les points d'une pénalité d'arbitrage, et sort l'équipe si son capital
 * tombe à 0.
 *
 * Une sanction qui vide le capital **élimine**, exactement comme une défaite qui
 * le viderait : la règle du mode est « élimination immédiate à 0 », et lui
 * ménager une exception laisserait au plateau une équipe à zéro point que plus
 * aucune manche ne pourrait départager.
 *
 * Une pénalité ne s'applique qu'à une équipe encore en lice : sur une équipe
 * déjà sortie, elle n'a rien à retirer et ne doit surtout pas réécrire la manche
 * de sa sortie. Le cas est atteignable après coup — une correction de score
 * peut faire tomber une équipe *avant* la manche où elle avait été sanctionnée.
 */
function applyPenalty(standing: EnduranceStanding, points: number, round: number): number {
  if (standing.status !== "ACTIVE") return 0;

  // Le retrait **rendu** est la baisse réelle du capital, pas la sanction
  // demandée : une pénalité de 5 sur une équipe à 2 points n'en retire que
  // deux, et annoncer « −5 » à côté d'un capital tombé de 2 ferait faux bond à
  // qui recoupe la ligne avec la manche précédente.
  const before = standing.points;

  standing.points -= points;
  if (standing.points <= 0) {
    standing.points = 0;
    standing.status = "ELIMINATED";
    standing.eliminatedRound = round;
  }
  return before - standing.points;
}

/** Porte au classement un match clos de la manche rejouée. */
export function applyEnduranceMatch(
  match: EnduranceMatchOutcome,
  standings: Map<number, EnduranceStanding>,
  config: EnduranceConfig,
  round: number,
  matchFormat: MatchFormat | null | undefined,
): void {
  // Match nul : ni vainqueur ni perdant, mais des maps de part et d'autre.
  // Le capital bouge quand même — le barème est map par map, pas match par
  // match : à ±1 un 2-2 ne déplace rien, à +2/−1 il rapporte deux points à
  // chacune. Le cas passe **avant** la lecture vainqueur/perdant, qui n'a
  // rien à lire ici.
  // Double forfait : deux perdantes, et pas de gagnante pour empocher les
  // maps. Chacune encaisse ce qu'encaisse la perdante d'un forfait
  // ordinaire — le score plein du format, jamais un match blanc.
  if (match.winnerTeamId === null && match.doubleForfeitTeamIds) {
    applyDoubleForfeitMatch(match.doubleForfeitTeamIds, standings, config, round, matchFormat);
    return;
  }

  if (match.winnerTeamId === null && match.drawTeamIds) {
    applyDrawMatch(match.drawTeamIds, match.drawMaps, standings, config, round);
    return;
  }

  applyDecisiveMatch(match, standings, config, round, matchFormat);
}

function applyDoubleForfeitMatch(
  teamIds: readonly [number, number],
  standings: Map<number, EnduranceStanding>,
  config: EnduranceConfig,
  round: number,
  matchFormat: MatchFormat | null | undefined,
): void {
  const lostMaps = forfeitMapCount(matchFormat);
  for (const teamId of teamIds) {
    const team = standings.get(teamId);
    if (team?.status !== "ACTIVE") continue;
    team.losses += 1;
    applyMapDelta(team, 0, lostMaps, config, round);
  }
}

function applyDrawMatch(
  [aId, bId]: readonly [number, number],
  drawMaps: number | null | undefined,
  standings: Map<number, EnduranceStanding>,
  config: EnduranceConfig,
  round: number,
): void {
  const a = standings.get(aId);
  const b = standings.get(bId);
  if (!a || !b || a.status !== "ACTIVE" || b.status !== "ACTIVE") return;

  const maps = Math.max(0, Math.floor(Number(drawMaps ?? 0)));
  a.draws += 1;
  b.draws += 1;
  applyMapDelta(a, maps, maps, config, round);
  applyMapDelta(b, maps, maps, config, round);
}

function applyDecisiveMatch(
  match: EnduranceMatchOutcome,
  standings: Map<number, EnduranceStanding>,
  config: EnduranceConfig,
  round: number,
  matchFormat: MatchFormat | null | undefined,
): void {
  const winner = match.winnerTeamId === null ? null : standings.get(match.winnerTeamId);
  const loser = match.loserTeamId === null ? null : standings.get(match.loserTeamId);

  // Un match impliquant une équipe déjà sortie ne compte pour personne : ni
  // résurrection de l'éliminée, ni point retiré à son adversaire. Le cas ne
  // devrait pas se produire (le moteur n'apparie que des équipes actives),
  // mais un score corrigé après coup peut le faire apparaître.
  if (!winner || !loser || winner.status !== "ACTIVE" || loser.status !== "ACTIVE") return;

  const { winnerMaps, loserMaps } = enduranceMatchMaps(match, matchFormat);

  winner.wins += 1;
  loser.losses += 1;

  // Barème map par map, dans les deux sens : le vainqueur d'un 3-2 ne
  // gagne qu'un point net, celui d'un 3-0 en gagne trois.
  applyMapDelta(winner, winnerMaps, loserMaps, config, round);
  applyMapDelta(loser, loserMaps, winnerMaps, config, round);
}

/**
 * Applique les pénalités d'une manche et rend, par équipe, les points
 * **effectivement retirés** : une sanction visant une équipe déjà sortie
 * n'ampute rien, et une sanction plus lourde que le capital n'en retire que ce
 * qu'il restait. Annoncer autre chose ferait douter du tableau.
 */
export function applyRoundPenalties(
  standings: Map<number, EnduranceStanding>,
  byTeam: Map<number, number> | undefined,
  round: number,
): Map<number, number> {
  const applied = new Map<number, number>();
  for (const [teamId, points] of byTeam ?? []) {
    const standing = standings.get(teamId);
    if (!standing) continue;
    const removed = applyPenalty(standing, points, round);
    if (removed > 0) applied.set(teamId, removed);
  }
  return applied;
}

export function applyRoundForfeits(
  standings: Map<number, EnduranceStanding>,
  teamIds: number[] | undefined,
  round: number,
): void {
  for (const teamId of teamIds ?? []) {
    const standing = standings.get(teamId);
    if (!standing) continue;
    // L'abandon prime sur l'élimination que son propre match de forfait vient
    // peut-être de provoquer dans cette même manche (le score plein peut vider
    // le capital) : c'est la décision humaine qui est écrite au classement.
    const eliminatedThisRound =
      standing.status === "ELIMINATED" && standing.eliminatedRound === round;
    if (standing.status === "ACTIVE" || eliminatedThisRound) {
      standing.status = "FORFEIT";
      standing.eliminatedRound = round;
      standing.points = 0;
    }
  }
}

export function applyRoundCut(
  standings: Map<number, EnduranceStanding>,
  config: EnduranceConfig,
  remainingRounds: number,
  round: number,
  matchFormat: MatchFormat | null | undefined,
): void {
  const cut = enduranceEliminationCut([...standings.values()], config, remainingRounds, matchFormat);
  for (const teamId of cut) {
    const standing = standings.get(teamId);
    if (!standing) continue;
    standing.status = "OUT_OF_CONTENTION";
    standing.eliminatedRound = round;
  }
}
