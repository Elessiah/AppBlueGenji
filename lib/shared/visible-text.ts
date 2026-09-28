/**
 * Ce qu'un nom affiché a le droit de contenir : des caractères qu'on **voit**.
 *
 * Pseudos et noms d'équipe acceptaient les caractères invisibles (U+200B,
 * U+2060, U+FEFF…) et les commandes de direction (U+202E…). `Adm\u200Bin` — un
 * espace de largeur nulle au milieu — passait l'unicité (la collation ignore
 * casse et accents, pas ces caractères) et s'affichait à l'identique d'un
 * membre du staff dans les rosters, les feuilles de match et les journaux
 * Discord ; U+202E retournait l'affichage de tout ce qui suit.
 *
 * La saisie est **nettoyée**, pas refusée : un pseudo naît aussi d'une
 * connexion OAuth (nom Google, pseudo Discord), où refuser empêcherait de se
 * connecter. Et le nettoyage s'applique aussi aux **recherches** par pseudo, si
 * bien qu'une saisie piégée désigne le compte qu'elle imite à l'œil — jamais un
 * compte distinct qui lui ressemble.
 *
 * Module pur : importable côté serveur comme côté client.
 */

/**
 * Invisibles qui ne sont pas des caractères de format (`\p{Cf}`) mais des
 * lettres sans dessin : les remplissages hangul, qu'aucune police n'affiche.
 */
const INVISIBLE_LETTERS = /[\u115F\u1160\u3164\uFFA0]/gu;

/** Contrôles (`\p{Cc}`, sauts de ligne compris) : un nom tient sur une ligne. */
const CONTROL = /\p{Cc}/gu;

/**
 * Caractères de format (`\p{Cf}`) : espaces de largeur nulle, marques et
 * commandes de direction, césure conditionnelle, étiquettes Unicode…
 *
 * Seule exception, le **liant sans chasse** (U+200D) entre deux pictogrammes :
 * c'est lui qui compose une famille ou un métier en un seul emoji. Hors de ce
 * rôle, il est invisible comme les autres.
 */
const FORMAT = /\p{Cf}/gu;
const EMOJI_JOINER = /(?<=\p{Extended_Pictographic}\uFE0F?)\u200D(?=\p{Extended_Pictographic})/gu;

/**
 * Marqueur provisoire du liant d'emoji pendant le retrait des `\p{Cf}` : un
 * contrôle, donc absent du texte à ce stade (`CONTROL` les a déjà remplacés).
 */
const JOINER_PLACEHOLDER = "\u0000";
const ZERO_WIDTH_JOINER = "\u200D";

/**
 * Forme affichable d'un nom : NFKC (qui ramène les lettres « de fantaisie »,
 * pleine chasse ou mathématiques, à leur forme courante), sans contrôle ni
 * caractère invisible, espaces réduits à un seul et bordures retirées.
 *
 * @param raw Saisie brute.
 * @returns Le nom nettoyé, éventuellement vide.
 */
export function visibleText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(CONTROL, " ")
    .replace(EMOJI_JOINER, JOINER_PLACEHOLDER)
    .replace(FORMAT, "")
    .replace(INVISIBLE_LETTERS, "")
    .replaceAll(JOINER_PLACEHOLDER, ZERO_WIDTH_JOINER)
    .replace(/\s+/gu, " ")
    .trim();
}
