/**
 * Sigle d'équipe (le « trigramme »).
 *
 * Un sigle est le nom court d'une équipe : 2 à 4 caractères alphanumériques,
 * en majuscules, **unique sur tout le site**. Il n'a jamais été qu'un affichage
 * dérivé — les cartes d'annuaire montraient les trois premières lettres du nom
 * (`name.slice(0, 3)`), ce qui n'appartenait à personne : deux équipes dont le
 * nom commence pareil portaient le même. Il devient ici une donnée saisie
 * (`bg_teams.tag`), avec un espace de noms partagé par toutes les équipes.
 *
 * Trois décisions, tenues dans ce module et documentées dans
 * `docs/features/TEAM_TAG.md` :
 *
 * 1. **Facultatif.** `null` est une valeur valide : les équipes créées avant
 *    cette fonctionnalité n'en ont pas, et l'affichage retombe alors sur les
 *    initiales dérivées du nom, exactement comme avant (`displayTeamTag`).
 *    Exiger un sigle rendrait inéditables toutes les fiches existantes.
 * 2. **Borne basse à 2.** Un sigle d'un seul caractère ne distingue plus rien
 *    (36 valeurs pour tout le site) et se confond avec l'initiale que montre
 *    déjà l'emblème. Le nom d'équipe, lui, commence à 3 caractères : le sigle
 *    est plus court par nature, d'où 2 et non 3.
 * 3. **Casse indifférente.** La saisie est normalisée en majuscules avant
 *    d'être stockée : « bg », « Bg » et « BG » sont le même sigle, et se
 *    heurtent donc à l'unicité. La normalisation est faite ici, pas en base —
 *    même règle pour le client et le serveur.
 *
 * Hors de l'espace de noms : les **entrées solo** (`bg_teams.solo_user_id`),
 * qui sont un joueur et non une équipe — leur identité publique est le profil,
 * elles ne portent jamais de sigle. Les **équipes fantômes**, elles, y entrent :
 * elles s'inscrivent aux tournois et s'affichent dans les plateaux au même
 * titre qu'une équipe réelle, où deux sigles identiques se confondraient.
 *
 * Module pur : importable côté serveur comme côté client.
 */

/** Longueur minimale d'un sigle saisi. */
export const TEAM_TAG_MIN_LENGTH = 2;

/** Longueur maximale d'un sigle saisi. */
export const TEAM_TAG_MAX_LENGTH = 4;

/** Nombre de caractères des initiales de repli, quand l'équipe n'a pas de sigle. */
const FALLBACK_LENGTH = 3;

/**
 * Motifs de refus d'un sigle. Ce sont les codes d'erreur transportés tels quels
 * par l'API (400), pour que le message rendu à l'utilisateur dise *quoi*
 * corriger et pas seulement « sigle invalide ».
 */
export type TeamTagRejection =
  | "TEAM_TAG_TOO_SHORT"
  | "TEAM_TAG_TOO_LONG"
  | "TEAM_TAG_NOT_ALPHANUMERIC";

/** Code de refus de l'unicité (409). Distinct des refus de forme. */
export const TEAM_TAG_ALREADY_USED = "TEAM_TAG_ALREADY_USED";

export type TeamTagCheck =
  | { ok: true; tag: string | null }
  | { ok: false; reason: TeamTagRejection };

/**
 * Forme canonique d'une saisie : sans espaces de bordure, en majuscules.
 * Une saisie vide (ou absente) devient la chaîne vide — c'est `checkTeamTag`
 * qui la traduit en « pas de sigle » (`null`).
 */
export function normalizeTeamTag(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase();
}

/**
 * Valide une saisie de sigle et rend sa forme canonique.
 *
 * Une saisie vide n'est pas une erreur : elle vaut « pas de sigle » (`null`),
 * ce qui permet aussi d'en **retirer** un depuis le formulaire d'édition.
 *
 * L'ordre des contrôles n'est pas indifférent : le jeu de caractères passe en
 * premier, parce qu'une saisie comme « BG ESPORT » est d'abord fautive par son
 * espace — annoncer « trop long » enverrait corriger la mauvaise chose.
 */
export function checkTeamTag(raw: string | null | undefined): TeamTagCheck {
  const tag = normalizeTeamTag(raw);
  if (tag.length === 0) return { ok: true, tag: null };

  if (!/^[A-Z0-9]+$/.test(tag)) {
    return { ok: false, reason: "TEAM_TAG_NOT_ALPHANUMERIC" };
  }
  if (tag.length < TEAM_TAG_MIN_LENGTH) {
    return { ok: false, reason: "TEAM_TAG_TOO_SHORT" };
  }
  if (tag.length > TEAM_TAG_MAX_LENGTH) {
    return { ok: false, reason: "TEAM_TAG_TOO_LONG" };
  }

  return { ok: true, tag };
}

/** Vrai si le code d'erreur donné concerne la **forme** du sigle (donc un 400). */
export function isTeamTagRejection(code: string): code is TeamTagRejection {
  return (
    code === "TEAM_TAG_TOO_SHORT"
    || code === "TEAM_TAG_TOO_LONG"
    || code === "TEAM_TAG_NOT_ALPHANUMERIC"
  );
}

const MESSAGES: Record<TeamTagRejection | typeof TEAM_TAG_ALREADY_USED, string> = {
  TEAM_TAG_TOO_SHORT: `Le sigle doit faire au moins ${TEAM_TAG_MIN_LENGTH} caractères.`,
  TEAM_TAG_TOO_LONG: `Le sigle ne peut pas dépasser ${TEAM_TAG_MAX_LENGTH} caractères.`,
  TEAM_TAG_NOT_ALPHANUMERIC:
    "Le sigle ne peut contenir que des lettres et des chiffres, sans espace ni ponctuation.",
  TEAM_TAG_ALREADY_USED: "Ce sigle est déjà utilisé par une autre équipe.",
};

/**
 * Message français d'un code d'erreur de sigle, ou `null` si le code n'en est
 * pas un — l'appelant retombe alors sur son message par défaut. Les deux
 * formulaires (création, édition) et les deux voies (équipe réelle, équipe
 * fantôme) passent par ici : un seul texte par refus.
 */
export function teamTagErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  // `code in MESSAGES` remonterait la chaîne de prototypes : « constructor » ou
  // « toString » y passeraient le test et rendraient une **fonction** au lieu
  // d'une chaîne, que l'appelant afficherait telle quelle en toast.
  if (!Object.prototype.hasOwnProperty.call(MESSAGES, code)) return null;
  return MESSAGES[code as keyof typeof MESSAGES];
}

/**
 * Ce qu'il faut afficher à la place du sigle : le sigle s'il y en a un, sinon
 * les initiales du nom — le repli décoratif d'avant la fonctionnalité, qui
 * n'est jamais stocké et n'a donc pas à respecter les bornes ci-dessus. Seuls
 * les caractères qui ne sont ni lettre ni chiffre sont écartés, pour ne pas
 * afficher « L'É » là où « LÉQ » se lit.
 */
export function displayTeamTag(tag: string | null | undefined, teamName: string): string {
  const normalized = normalizeTeamTag(tag);
  if (normalized.length > 0) return normalized;

  const letters = teamName.replace(/[^0-9A-Za-zÀ-ÖØ-öø-ÿ]/g, "");
  return letters.slice(0, FALLBACK_LENGTH).toUpperCase() || "?";
}
