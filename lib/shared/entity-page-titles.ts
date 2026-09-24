/**
 * Titres d'onglet des fiches d'équipe et de joueur (WCAG 2.4.2 · RGAA 8.6).
 *
 * Les deux fiches héritaient du titre de leur annuaire : deux onglets ouverts
 * sur deux équipes s'intitulaient tous deux « Équipes », et rien ne permettait
 * de revenir à la bonne sans les ouvrir une à une. Chaque fiche porte désormais
 * le nom de ce qu'elle montre, suivi de sa nature — le gabarit du site ajoute
 * ensuite « · BlueGenji Esport ».
 *
 * Module pur : la lecture en base vit dans `teams-service` / `users-service`,
 * et la décision de ce qui peut être nommé est prise ici, une fois, pour que
 * les deux mises en page ne la réécrivent pas chacune à sa façon.
 */

/** Titre d'une fiche d'équipe qu'on ne peut pas nommer. */
export const TEAM_PAGE_FALLBACK_TITLE = "Équipe";

/** Titre d'une fiche de joueur qu'on ne peut pas nommer. */
export const PLAYER_PAGE_FALLBACK_TITLE = "Joueur";

/**
 * Ce qui remplace le pseudo d'un compte anonymisé. Son pseudo d'emprunt se lit
 * comme un pseudo ordinaire : l'écrire dans l'onglet ferait passer la fiche
 * d'un compte supprimé pour celle d'un joueur, là où la page l'annonce.
 */
export const DELETED_PLAYER_PAGE_TITLE = "Compte supprimé";

export type TeamPageIdentity = { name: string };
export type PlayerPageIdentity = { pseudo: string; isDeleted: boolean };

/**
 * Titre de `/equipes/[id]`. `null` — équipe introuvable, entrée solo (qui n'a
 * pas de fiche d'équipe : la page mène au profil du joueur) ou lecteur non
 * connecté — retombe sur le titre générique, qui ne nomme personne.
 */
export function teamPageTitle(team: TeamPageIdentity | null): string {
  const name = team?.name.trim();
  return name ? `${name} · ${TEAM_PAGE_FALLBACK_TITLE}` : TEAM_PAGE_FALLBACK_TITLE;
}

/**
 * Titre de `/joueurs/[id]`. Le pseudo n'a pas de réglage de visibilité — la
 * fiche l'affiche à tout lecteur connecté —, seul un compte anonymisé est tu.
 */
export function playerPageTitle(player: PlayerPageIdentity | null): string {
  if (!player) return PLAYER_PAGE_FALLBACK_TITLE;
  if (player.isDeleted) return `${DELETED_PLAYER_PAGE_TITLE} · ${PLAYER_PAGE_FALLBACK_TITLE}`;
  const pseudo = player.pseudo.trim();
  return pseudo ? `${pseudo} · ${PLAYER_PAGE_FALLBACK_TITLE}` : PLAYER_PAGE_FALLBACK_TITLE;
}

/**
 * Identifiant de fiche lu dans l'URL : un entier strictement positif en base
 * 10, sans rien autour. Tout le reste ne désigne aucune fiche.
 */
export function parseEntityPageId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}
