/**
 * Titres d'onglet des fiches d'équipe et de joueur (WCAG 2.4.2 · RGAA 8.6).
 *
 * Les deux fiches héritaient du titre de leur annuaire : deux onglets ouverts
 * sur deux équipes s'intitulaient tous deux « Équipes », et rien ne permettait
 * de revenir à la bonne sans les ouvrir une à une. Chaque fiche porte désormais
 * le nom de ce qu'elle montre, suivi de sa nature — le gabarit du site ajoute
 * ensuite « · BlueGenji Esport ».
 *
 * Module pur : la lecture en base vit dans `teams/detail` / `users/full-profile`,
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

/**
 * Les mots du titre dans la langue de la page (lot 9 : `team.meta`,
 * `players.meta`) ; par défaut, le français ci-dessus.
 */
export type EntityTitleWords = { fallback: string };
/** Le titre d'un compte supprimé est requis : un repli français sous `/en` mêlerait les langues. */
export type PlayerTitleWords = EntityTitleWords & { deleted: string };
export type PlayerPageIdentity = { pseudo: string; isDeleted: boolean };

const FR_TEAM_TITLE_WORDS: Readonly<EntityTitleWords> = { fallback: TEAM_PAGE_FALLBACK_TITLE };
const FR_PLAYER_TITLE_WORDS: Readonly<PlayerTitleWords> = {
  fallback: PLAYER_PAGE_FALLBACK_TITLE,
  deleted: DELETED_PLAYER_PAGE_TITLE,
};

/**
 * Titre de `/equipes/[id]`. `null` — équipe introuvable, entrée solo (qui n'a
 * pas de fiche d'équipe : la page mène au profil du joueur) ou lecteur non
 * connecté — retombe sur le titre générique, qui ne nomme personne.
 */
export function teamPageTitle(
  team: TeamPageIdentity | null,
  words: Readonly<EntityTitleWords> = FR_TEAM_TITLE_WORDS,
): string {
  const name = team?.name.trim();
  return name ? `${name} · ${words.fallback}` : words.fallback;
}

/**
 * Titre de `/joueurs/[id]`. Le pseudo n'a pas de réglage de visibilité — la
 * fiche l'affiche à tout lecteur connecté —, seul un compte anonymisé est tu.
 */
export function playerPageTitle(
  player: PlayerPageIdentity | null,
  words: Readonly<PlayerTitleWords> = FR_PLAYER_TITLE_WORDS,
): string {
  if (!player) return words.fallback;
  if (player.isDeleted) return `${words.deleted} · ${words.fallback}`;
  const pseudo = player.pseudo.trim();
  return pseudo ? `${pseudo} · ${words.fallback}` : words.fallback;
}

/**
 * Identifiant de fiche lu dans l'URL, **par la même règle que la page** : la
 * fiche le passe tel quel à son API, qui le lit par `Number` (`/equipes/012`
 * affiche l'équipe 12). Une règle plus stricte ici donnerait un titre générique
 * à une page qui, elle, nomme bien l'équipe.
 */
export function parseEntityPageId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
