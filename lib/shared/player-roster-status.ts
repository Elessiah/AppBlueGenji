/**
 * Statut d'appartenance d'un joueur, tel qu'il se lit sur l'annuaire.
 *
 * Trois cas et non deux : entre « il est dans un roster » et « il n'y est
 * pas », il reste à dire si ce joueur **veut** être démarché. Le filtre
 * « Free agents » de `/joueurs` le demandait déjà — un joueur qui décoche
 * « Ouvert aux propositions d'équipes » en sort —, mais la carte, elle,
 * n'affichait « FREE AGENT » que sur l'absence d'équipe : le même joueur
 * disparaissait du filtre tout en continuant de s'annoncer disponible partout
 * ailleurs. Deux lectures d'une même donnée, dont une fausse.
 *
 * Le statut est donc écrit **une fois** et partagé par les deux : la carte le
 * rend, le filtre et le compteur le comptent.
 */
export type PlayerRosterStatus = "ROSTER" | "FREE_AGENT" | "UNAFFILIATED";

/**
 * Ce que le statut demande d'un joueur — rien de plus, pour qu'il se calcule
 * aussi bien sur une fiche que sur une ligne d'annuaire.
 *
 * `openToRecruitment` absent vaut **ouvert** : c'est le défaut de la colonne
 * (`open_to_recruitment TINYINT(1) NOT NULL DEFAULT 1`), et une charge utile
 * qui ne porte pas le champ ne dit pas que le joueur s'est fermé.
 */
export type PlayerRosterInput = {
  team?: { id: number } | null;
  openToRecruitment?: boolean;
};

export function playerRosterStatus(player: PlayerRosterInput): PlayerRosterStatus {
  if (player.team) return "ROSTER";
  return player.openToRecruitment === false ? "UNAFFILIATED" : "FREE_AGENT";
}

/**
 * Free agent = **sans roster et ouvert au recrutement**. Unique implémentation
 * du prédicat qui porte le filtre, le compteur de l'en-tête et le libellé de la
 * carte.
 */
export function isFreeAgent(player: PlayerRosterInput): boolean {
  return playerRosterStatus(player) === "FREE_AGENT";
}

/** Libellés de carte d'annuaire (majuscules, comme le reste de la ligne). */
export const PLAYER_ROSTER_STATUS_LABEL: Record<PlayerRosterStatus, string> = {
  ROSTER: "ROSTER",
  FREE_AGENT: "FREE AGENT",
  UNAFFILIATED: "SANS ÉQUIPE",
};
