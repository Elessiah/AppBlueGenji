/**
 * BlueGenji Survie — lecture d'un match en résultat rejouable, et maps à porter
 * au compte de chaque équipe (`docs/features/BG_SURVIE_MODE.md`).
 *
 * Module pur : aucune dépendance base de données.
 */

import { forfeitMapCount, type MatchFormat } from "../match-format";

/** Résultat d'un match tel que rejoué. */
export type EnduranceMatchOutcome = {
  round: number;
  completed: boolean;
  winnerTeamId: number | null;
  loserTeamId: number | null;
  /** Maps gagnées par le vainqueur (`null` = non saisi). */
  winnerMaps?: number | null;
  /** Maps gagnées par le perdant (`null` = non saisi). */
  loserMaps?: number | null;
  /**
   * Match clos par forfait. Il compte comme une rencontre **pleine** : le
   * règlement traite le forfait comme le score maximal du format du tournoi
   * (FT3 → 3-0), donc trois points d'endurance au perdant et trois au
   * vainqueur. Les scores en base sont `NULL` sur un forfait déclaré par
   * l'arbitrage : le barème se dérive alors du format, jamais des colonnes.
   */
  isForfeit?: boolean;
  /**
   * Match clos **sans vainqueur** : les deux engagés, dans l'ordre des sides.
   *
   * Une map nulle peut arrêter la rencontre avant l'objectif (2-2 en BO5) quand
   * le format l'autorise — `winner_team_id` reste alors `NULL` en base, et
   * l'outcome n'a plus de vainqueur d'où tirer les deux camps. Le champ ne vaut
   * que pour ce cas : ailleurs, les identifiants se lisent sur
   * `winnerTeamId` / `loserTeamId`.
   */
  drawTeamIds?: readonly [number, number] | null;
  /**
   * Maps gagnées par **chacune** des deux engagées d'un match nul. Une seule
   * valeur : elles sont égales par définition, c'est ce qui fait le nul.
   */
  drawMaps?: number | null;
  /**
   * Double forfait : les deux engagées, dans l'ordre des sides. Chacune perd la
   * rencontre **au score plein du format**, comme la perdante d'un forfait
   * ordinaire (FT3 → −3) — `lib/shared/double-forfeit.ts`.
   */
  doubleForfeitTeamIds?: readonly [number, number] | null;
};

/**
 * Maps à porter au compte de chaque équipe pour un match rejoué.
 *
 * Trois sources, dans l'ordre : le **format** pour un forfait (aucune map n'a
 * été jouée, mais le règlement en compte l'équivalent d'un score plein), les
 * **scores saisis** pour une rencontre disputée, et un 1-0 de repli pour un
 * match tranché sans score — un tournoi en saisie libre, ou un historique
 * antérieur au format de match. Le repli ne peut pas être 0-0 : le match a un
 * vainqueur, il doit coûter quelque chose au perdant.
 */
export function enduranceMatchMaps(
  outcome: EnduranceMatchOutcome,
  format: MatchFormat | null | undefined,
): { winnerMaps: number; loserMaps: number } {
  if (outcome.isForfeit) return { winnerMaps: forfeitMapCount(format), loserMaps: 0 };

  const winnerMaps = Number(outcome.winnerMaps);
  const loserMaps = Number(outcome.loserMaps);

  if (!Number.isFinite(winnerMaps) || !Number.isFinite(loserMaps)) {
    return { winnerMaps: 1, loserMaps: 0 };
  }
  if (winnerMaps <= 0 || loserMaps < 0) return { winnerMaps: 1, loserMaps: 0 };

  return { winnerMaps: Math.floor(winnerMaps), loserMaps: Math.floor(loserMaps) };
}

/**
 * Un match tel que le décrivent ses colonnes — la base côté serveur,
 * l'instantané (`BracketMatch`) côté interface. Les scores sont rangés par
 * **side**, comme en base.
 */
export type EnduranceMatchRecord = {
  round: number;
  status: string;
  team1Id: number | null;
  team2Id: number | null;
  team1Score: number | null;
  team2Score: number | null;
  winnerTeamId: number | null;
  loserTeamId: number | null;
  forfeitTeamId: number | null;
  doubleForfeit: boolean;
};

/**
 * Lecture d'un match en résultat rejouable.
 *
 * **Unique implémentation** : le moteur la joue sur les lignes de la base, et
 * l'aperçu de la manche suivante (`lib/shared/endurance-next-round/`) sur les
 * matchs de l'instantané. Deux lectures d'un même match — un nul, un double
 * forfait — auraient fini par ne pas compter la même chose.
 */
export function enduranceMatchOutcome(match: EnduranceMatchRecord): EnduranceMatchOutcome {
  const { winnerTeamId } = match;
  const completed = match.status === "COMPLETED";

  // Les scores sont rangés par side (team1/team2) : les réordonner par
  // vainqueur/perdant est ce qui permet au barème de se compter map par map.
  const winnerIsTeam1 = winnerTeamId !== null && winnerTeamId === match.team1Id;
  const winnerScore = winnerIsTeam1 ? match.team1Score : match.team2Score;
  const loserScore = winnerIsTeam1 ? match.team2Score : match.team1Score;

  // Match **nul** : clos, sans vainqueur, pas par forfait, et portant deux
  // scores égaux. Les deux camps ne se lisent alors plus sur
  // `winner_team_id` / `loser_team_id`, vides tous les deux — ils se lisent
  // sur les sides, comme les scores.
  //
  // Les scores font partie du critère, et ce n'est pas de la ceinture-et-
  // bretelles : c'est **exactement** la définition qu'applique
  // `playedMatchSql` au classement du site. Sans eux, une ligne close sans
  // vainqueur *ni* score — reprise de données, écriture à la main — comptait
  // ici pour un nul 0-0 alors que les fiches l'ignoraient, et la même
  // rencontre était jouée d'un côté, inexistante de l'autre.
  const drawn =
    completed &&
    winnerTeamId === null &&
    match.forfeitTeamId == null &&
    match.team1Id !== null &&
    match.team2Id !== null &&
    match.team1Score !== null &&
    match.team2Score !== null &&
    match.team1Score === match.team2Score;

  return {
    round: match.round,
    completed,
    winnerTeamId,
    loserTeamId: match.loserTeamId,
    winnerMaps: winnerScore,
    loserMaps: loserScore,
    // `!= null` couvre aussi un champ absent (instantané d'une version
    // antérieure, appelant partiel) : un forfait doit être une information
    // positive, jamais un défaut.
    isForfeit: match.forfeitTeamId != null,
    drawTeamIds: drawn ? ([match.team1Id as number, match.team2Id as number] as const) : null,
    // Les deux scores sont égaux sur un nul — le critère ci-dessus l'exige —
    // donc un seul chiffre suffit.
    drawMaps: drawn ? match.team1Score : 0,
    // Double forfait : deux perdantes, lues sur les sides faute de colonnes
    // vainqueur/perdant. Le statut est exigé comme pour le nul — un drapeau
    // resté sur une ligne rouverte ne doit rien retirer à personne.
    doubleForfeitTeamIds:
      completed && match.doubleForfeit && match.team1Id !== null && match.team2Id !== null
        ? ([match.team1Id, match.team2Id] as const)
        : null,
  };
}
