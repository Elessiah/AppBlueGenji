/**
 * L'issue d'une rencontre, vue depuis n'importe quel écran.
 *
 * Une seule question, posée partout de la même façon : **cette rencontre est-elle
 * jouée ?** La réponse était partout la même expression — `winnerTeamId !== null`
 * — et elle était juste tant qu'un match tranché avait forcément un vainqueur.
 * Depuis qu'une map nulle peut clore une rencontre là où le format l'autorise
 * (`lib/shared/match-format.ts`), elle est fausse : un 2-2 se lisait « pas
 * encore joué », ce qui faisait annoncer « 5/6 jouées » à une manche complète,
 * gardait la manche « en cours » pour toujours, rouvrait un formulaire de report
 * sur une rencontre finie et laissait le volet s'ouvrir sur une manche close.
 *
 * D'où ce module minuscule : la question se pose à cinq endroits qui ne
 * partagent rien d'autre, et cinq copies auraient divergé au premier ajustement.
 *
 * Module pur, importable des deux côtés.
 */

/** Ce dont ces prédicats ont besoin — satisfait par `BracketMatch`. */
export type MatchOutcomeShape = {
  status: "PENDING" | "READY" | "AWAITING_CONFIRMATION" | "COMPLETED";
  winnerTeamId: number | null;
  forfeitTeamId: number | null;
  team1Id: number | null;
  team2Id: number | null;
};

/**
 * La rencontre est-elle jouée ?
 *
 * C'est le **statut** qui le dit, pas la présence d'un vainqueur : un match nul
 * n'en a pas, et il est pourtant terminé.
 */
export function isMatchPlayed(match: Pick<MatchOutcomeShape, "status">): boolean {
  return match.status === "COMPLETED";
}

/**
 * La rencontre s'est-elle close **sans vainqueur** ?
 *
 * Trois traits conjoints, et pas un de moins : terminée, sans vainqueur, et pas
 * par forfait — un forfait n'a pas de vainqueur au sens des colonnes de report
 * mais en désigne bien un. Les matchs à une seule équipe (bye) ou sans équipe
 * (match fantôme) sont écartés : leur score est posé par le moteur.
 */
export function isMatchDrawn(match: MatchOutcomeShape): boolean {
  return (
    isMatchPlayed(match) &&
    match.winnerTeamId === null &&
    match.forfeitTeamId === null &&
    match.team1Id !== null &&
    match.team2Id !== null
  );
}
