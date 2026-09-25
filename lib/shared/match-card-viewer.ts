/**
 * Ce qu'une carte de match doit décider en fonction de **qui la regarde** —
 * le lecteur engagé dans ce tournoi, identifié par son `myTeamId`.
 *
 * Module pur, partagé par `MatchRow` (rendu) et `page.tsx` (message de
 * confirmation à l'envoi), pour que les deux s'accordent sur l'équipe
 * « mienne » sans dupliquer la comparaison d'identifiants.
 */

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
    myTeamId !== null &&
    (myTeamId === team1Id || myTeamId === team2Id)
  );
}

export interface ScoreFieldDescriptor {
  key: "myScore" | "opponentScore";
  value: string;
  label: string;
}

/**
 * Les deux champs du formulaire de score, dans l'ordre où les noms des
 * équipes apparaissent sur la carte (équipe 1 puis équipe 2) — jamais « Moi »
 * en premier par défaut, qui inversait l'ordre visuel des champs dès que le
 * lecteur était l'équipe 2 de la carte. Nommés par l'équipe plutôt que par
 * « Moi »/« Eux », pour rester justes quelle que soit la place du lecteur.
 */
export function orderedScoreFields(
  myTeamIsTeam1: boolean,
  myScore: string,
  opponentScore: string,
  team1Label: string,
  team2Label: string,
): ScoreFieldDescriptor[] {
  return myTeamIsTeam1
    ? [
        { key: "myScore", value: myScore, label: team1Label },
        { key: "opponentScore", value: opponentScore, label: team2Label },
      ]
    : [
        { key: "opponentScore", value: opponentScore, label: team1Label },
        { key: "myScore", value: myScore, label: team2Label },
      ];
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
