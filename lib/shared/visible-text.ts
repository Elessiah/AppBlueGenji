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
 * c'est lui qui compose une famille ou un métier en un seul emoji, teinte de
 * peau comprise (le modificateur se place avant le liant). Hors de ce rôle, il
 * est invisible comme les autres.
 */
const FORMAT = /\p{Cf}/gu;
const EMOJI_JOINER = /(?<=\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)\u200D(?=\p{Extended_Pictographic})/gu;

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
  return withoutInvisibles(raw.normalize("NFKC"))
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Texte d'une ligne débarrassé de ce qui ne se **voit** pas — contrôles
 * (→ espace), invisibles, commandes de direction — mais pas normalisé : ni NFKC
 * ni réduction des espaces. Pour une saisie du staff dont la typographie est le
 * propos (« 4 200 € » à espace fine insécable, « 50 m² », « ½ ») : NFKC la
 * réécrirait (« 4 200 € », « 50 m2 », « 1⁄2 »).
 *
 * @param raw Saisie brute.
 * @returns Le texte nettoyé et rogné, éventuellement vide.
 */
export function withoutInvisibles(raw: string): string {
  return raw
    .replace(CONTROL, " ")
    .replace(EMOJI_JOINER, JOINER_PLACEHOLDER)
    .replace(FORMAT, "")
    .replace(INVISIBLE_LETTERS, "")
    .replaceAll(JOINER_PLACEHOLDER, ZERO_WIDTH_JOINER)
    .trim();
}

/**
 * Nom d'engagé (équipe, entrée solo) tel qu'un écran lu sans compte le montre :
 * sans invisibles ({@link withoutInvisibles}, `UNTRUSTED_NAMES.md`), `null`
 * quand il ne garde rien de visible — un nom resté en base peut en porter
 * encore (sosie refusé par `UNIQUE`). Sans NFKC : le nom se lit comme sur sa
 * fiche. Chaque appelant choisit son repli. Règle unique de la vitrine :
 * direct, bandeau et mini-arbre de l'accueil.
 *
 * @param name Nom lu en base, `null` quand la ligne a disparu.
 * @returns Le nom affichable, ou `null`.
 */
export function shownEntrantName(name: string | null): string | null {
  if (name === null) return null;
  return withoutInvisibles(name) || null;
}
