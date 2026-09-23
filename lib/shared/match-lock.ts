import type { BracketMatch, PhaseFormat, TournamentFormat } from "./types";

/**
 * Verrouillage de l'édition d'un score.
 *
 * Règle : dès qu'un match dépendant (la « manche suivante ») porte la moindre
 * saisie de score, le match amont n'est plus modifiable — **y compris par un
 * admin**. Corriger un résultat amont réécrirait en effet les participants d'un
 * match déjà entamé, laissant des scores attribués aux mauvaises équipes.
 *
 * Le module est volontairement pur pour que le serveur (garde-fou réel, dans
 * `lib/server/tournaments/admin.ts`) et l'interface (masquage du bouton
 * « Éditer le score ») appliquent exactement la même règle.
 */

/** Vue minimale d'un match, commune aux lignes SQL et au type `BracketMatch`. */
export interface MatchScoreState {
  id: number;
  roundNumber: number;
  team1Id: number | null;
  team2Id: number | null;
  team1Score: number | null;
  team2Score: number | null;
  winnerTeamId: number | null;
  forfeitTeamId: number | null;
  /**
   * Double forfait (`lib/shared/double-forfeit.ts`) : une saisie à part entière,
   * qui ne laisse pourtant ni score, ni vainqueur, ni forfait nominatif.
   * Facultatif — une vue qui ne le porte pas se lit comme avant.
   */
  doubleForfeit?: boolean;
  /**
   * Le match est-il **tranché** ?
   *
   * Ce n'est pas « il a un vainqueur » : une rencontre peut se clore sans
   * vainqueur là où le format autorise l'égalité
   * (`lib/shared/match-format.ts`). C'était pourtant la lecture de
   * {@link isScoreEditLocked}, qui déclarait un match nul « pas encore joué » et
   * en rouvrait l'édition alors que le serveur, lui, la refusait en 409 : le
   * bouton menait à un mur.
   *
   * Ni « il porte un score » : l'arbitrage peut noter un 1-1 pendant que le
   * match se joue, et cette saisie-là n'a rien de définitif.
   */
  decided: boolean;
  /** Au moins une équipe a saisi un score en attente de confirmation. */
  hasPendingReport: boolean;
  nextWinnerMatchId: number | null;
  nextLoserMatchId: number | null;
  /**
   * Phase du match (0 = tournoi sans phases). Optionnel : les tournois à format
   * unique n'en ont pas, et tout le monde partage alors le même rang.
   */
  phaseId?: number;
  /** Position de la phase (1..n). Prioritaire sur `phaseId` pour l'ordre. */
  phasePosition?: number | null;
}

/**
 * Rang de la phase d'un match, utilisé pour ordonner les phases entre elles.
 *
 * On préfère `phasePosition` (l'ordre voulu par l'organisateur) et on retombe sur
 * `phaseId` : les phases étant insérées dans l'ordre des positions, leurs
 * identifiants auto-incrémentés croissent avec elles. Sans phase, tout le monde
 * vaut 0 — le tri devient neutre et le comportement historique est préservé.
 */
function phaseRank(match: MatchScoreState): number {
  return match.phasePosition ?? match.phaseId ?? 0;
}

/**
 * Adapte un match tel que servi à l'interface. Le détail public n'expose pas les
 * horodatages de report : le statut `AWAITING_CONFIRMATION` signale exactement la
 * même chose (au moins une équipe a saisi un score).
 */
export function fromBracketMatch(match: BracketMatch): MatchScoreState {
  return {
    id: match.id,
    roundNumber: match.roundNumber,
    team1Id: match.team1Id,
    team2Id: match.team2Id,
    team1Score: match.team1Score,
    team2Score: match.team2Score,
    winnerTeamId: match.winnerTeamId,
    forfeitTeamId: match.forfeitTeamId,
    doubleForfeit: match.doubleForfeit,
    decided: match.status === "COMPLETED",
    hasPendingReport: match.status === "AWAITING_CONFIRMATION",
    nextWinnerMatchId: match.nextWinnerMatchId,
    nextLoserMatchId: match.nextLoserMatchId,
    phaseId: match.phaseId,
    phasePosition: match.phasePosition,
  };
}

/**
 * Un match porte-t-il une saisie de score ? Compte comme saisie : un score (même
 * 0), un vainqueur, un forfait (simple ou double), ou un report en attente de
 * confirmation. Le double forfait doit être nommé : il ne laisse ni score ni
 * vainqueur, et passerait sinon pour une rencontre vierge — la manche amont se
 * rouvrirait alors sur un résultat que l'arbitrage vient de trancher.
 *
 * Les matchs à une seule équipe (bye) ou sans équipe (match fantôme) sont exclus :
 * leur score est posé automatiquement par le moteur (1-0, 0-0), personne ne l'a
 * saisi — les bloquer figerait tout un bracket à trous.
 */
export function hasScoreInput(match: MatchScoreState): boolean {
  if (match.team1Id === null || match.team2Id === null) return false;
  return (
    match.team1Score !== null ||
    match.team2Score !== null ||
    match.winnerTeamId !== null ||
    match.forfeitTeamId !== null ||
    match.doubleForfeit === true ||
    match.hasPendingReport
  );
}

/**
 * Matchs dont le contenu dépend du résultat de `match`.
 *
 * · Élimination simple / double : les matchs cibles du vainqueur et du perdant.
 * · Survie / ronde suisse / BlueGenji Survie : pas de liens de bracket — les
 *   appariements du round suivant sont recalculés à partir du classement, donc
 *   tout round ultérieur dépend du résultat.
 */
export function dependentMatches(
  match: MatchScoreState,
  allMatches: MatchScoreState[],
  format: TournamentFormat,
  phaseFormat?: PhaseFormat,
): MatchScoreState[] {
  const ownRank = phaseRank(match);

  // Toute phase ultérieure dépend de celle-ci : son plateau est constitué des
  // qualifiées d'ici. Corriger un score en amont réécrirait donc qui y joue.
  // Sur un tournoi sans phases, tous les matchs partagent le rang 0 et cette
  // liste est toujours vide — le comportement historique est intact.
  const laterPhases = allMatches.filter((m) => phaseRank(m) > ownRank);

  const samePhase = allMatches.filter((m) => phaseRank(m) === ownRank);

  // Dans un tournoi multi-phases, la règle interne est celle du format de LA
  // PHASE, pas celle du tournoi (qui vaut « MULTI » et ne décrit aucun bracket).
  const effective: TournamentFormat | PhaseFormat =
    format === "MULTI" ? (phaseFormat ?? "SINGLE") : format;

  let intraPhase: MatchScoreState[];
  if (effective === "SURVIVAL" || effective === "SWISS" || effective === "BG_SURVIE") {
    intraPhase = samePhase.filter((m) => m.roundNumber > match.roundNumber);
  } else {
    intraPhase = bracketDependents(match, samePhase);
  }

  return [...intraPhase, ...laterPhases];
}

/**
 * Les cibles de bracket d'un match, **à travers les rencontres que le moteur a
 * résolues seul**.
 *
 * Une cible directe suffisait tant qu'un résultat ne pouvait qu'y poser une
 * équipe. Le double forfait y pose un **vide** : le match suivant devient une
 * exemption (bye) résolue par le moteur, qui fait avancer l'adversaire un tour
 * plus loin — et deux doubles forfaits voisins font un match fantôme, dont la
 * cible devient à son tour un bye. Corriger le résultat amont défait toute
 * cette chaîne (`lib/server/tournaments/bracket-cascade.ts`) : ce qui compte
 * n'est donc pas la cible directe, qui n'a jamais été jouée, mais la première
 * rencontre **réellement disputée** au bout de la chaîne.
 *
 * Une rencontre résolue par le moteur se reconnaît à ce qu'elle est tranchée
 * sans porter de saisie ({@link hasScoreInput} écarte byes et matchs
 * fantômes) : on la traverse. Toute autre rencontre arrête le parcours — si
 * elle porte une saisie, le verrou tombe ; sinon rien n'a été propagé plus loin.
 */
function bracketDependents(
  match: MatchScoreState,
  samePhase: MatchScoreState[],
): MatchScoreState[] {
  const byId = new Map(samePhase.map((m) => [m.id, m]));
  const found: MatchScoreState[] = [];
  const seen = new Set<number>([match.id]);
  const queue: MatchScoreState[] = [match];

  while (queue.length > 0) {
    const current = queue.shift() as MatchScoreState;
    for (const id of [current.nextWinnerMatchId, current.nextLoserMatchId]) {
      if (id === null || seen.has(id)) continue;
      seen.add(id);
      const target = byId.get(id);
      if (!target) continue;
      found.push(target);
      if (target.decided && !hasScoreInput(target)) queue.push(target);
    }
  }

  return found;
}

/**
 * Le score de ce match est-il verrouillé ? Un match encore indécis reste
 * toujours modifiable : rien n'a été propagé, c'est la première saisie.
 */
export function isScoreEditLocked(
  match: MatchScoreState,
  allMatches: MatchScoreState[],
  format: TournamentFormat,
  phaseFormat?: PhaseFormat,
): boolean {
  // Rien à protéger tant que la rencontre n'est pas tranchée — et « tranchée »
  // n'est pas « a un vainqueur » : un match nul en est un.
  if (!match.decided) return false;
  return dependentMatches(match, allMatches, format, phaseFormat).some(hasScoreInput);
}
