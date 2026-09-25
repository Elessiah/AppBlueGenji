/**
 * Ce qu'une carte de match doit décider en fonction de **qui la regarde** —
 * le lecteur engagé dans ce tournoi, identifié par son `myTeamId` — et le nom
 * qu'elle donne à chaque équipe.
 *
 * Module pur, partagé par `MatchRow` (rendu) et `page.tsx` (message de
 * confirmation à l'envoi), pour que les deux s'accordent sur l'équipe
 * « mienne » et sur le nom de chaque équipe sans dupliquer ni la comparaison
 * d'identifiants ni le repli d'affichage.
 */

/** Le lecteur est-il l'équipe 1 de la carte, plutôt que l'équipe 2 ? */
export function isMyTeamTeam1(myTeamId: number | null, team1Id: number | null): boolean {
  return myTeamId !== null && myTeamId === team1Id;
}

/**
 * Le bouton « Signaler un problème » d'une carte ne doit s'afficher que sur
 * le match du **lecteur** : le bouton de l'en-tête couvre déjà tout le reste
 * du plateau, et répéter le bouton sur chaque carte alourdit celles qui ne
 * concernent pas le lecteur — jusqu'à cent vingt-sept boutons identiques sur
 * un plateau à cent vingt-huit.
 */
export function canReportOwnMatch(
  canReport: boolean,
  myTeamId: number | null,
  team1Id: number | null,
  team2Id: number | null,
): boolean {
  return (
    canReport &&
    team1Id !== null &&
    team2Id !== null &&
    (isMyTeamTeam1(myTeamId, team1Id) || isMyTeamTeam1(myTeamId, team2Id))
  );
}

/**
 * Nom d'une équipe pour l'affichage, dans l'ordre où une carte le résout —
 * nom saisi, puis emplacement réservé (« Vainqueur QF1 »), puis un repli
 * propre à l'appelant. Partagé pour que la carte et le message qui suit une
 * saisie de score ne nomment pas différemment la même équipe.
 */
export function teamLabel(name: string | null, placeholder: string | null, fallback: string): string {
  return name || placeholder || fallback;
}

/**
 * Message de confirmation à l'envoi d'un score, nommant les deux équipes
 * dans l'ordre de la carte plutôt que l'identifiant interne du match — celui
 * qui vient de saisir un score veut savoir ce qui est parti, pas retrouver
 * quelle ligne du plateau porte le numéro #4521.
 */
export function scoreSubmittedMessage(
  myTeamIsTeam1: boolean,
  myScore: number,
  opponentScore: number,
  team1Label: string,
  team2Label: string,
): string {
  const team1Score = myTeamIsTeam1 ? myScore : opponentScore;
  const team2Score = myTeamIsTeam1 ? opponentScore : myScore;
  return `Score transmis : ${team1Label} ${team1Score} – ${team2Score} ${team2Label}`;
}
