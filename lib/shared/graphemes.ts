/**
 * Découpe d'un texte en **graphèmes** (ce que l'œil compte pour un caractère :
 * un drapeau, un emoji à teinte, une lettre et son signe combinant) et largeur
 * d'affichage approchée. Module **pur**, importable partout.
 *
 * Couper sur les points de code (`Array.from`) peut séparer les deux moitiés
 * d'un drapeau ou laisser un signe combinant orphelin ; couper sur les graphèmes
 * ne le peut pas.
 */

let segmenter: Intl.Segmenter | null | undefined;

/** Les graphèmes d'un texte ; à défaut de `Intl.Segmenter`, ses points de code. */
export function graphemesOf(text: string): string[] {
  segmenter ??=
    typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  if (segmenter === null) return Array.from(text);
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/**
 * Graphèmes qui occupent deux colonnes dans une police proportionnelle
 * courante : idéogrammes, kana, hangul, formes pleine chasse, emoji et
 * drapeaux.
 */
const WIDE_GRAPHEME =
  /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303F\uFF01-\uFF60\uFFE0-\uFFE6]/u;

/** Largeur d'un graphème : 2 s'il est large ({@link WIDE_GRAPHEME}), 1 sinon. */
export function graphemeWidth(grapheme: string): number {
  return WIDE_GRAPHEME.test(grapheme) ? 2 : 1;
}

/** Largeur d'affichage approchée d'un texte, en colonnes latines. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const grapheme of graphemesOf(text)) width += graphemeWidth(grapheme);
  return width;
}

/**
 * `text` borné à `max` colonnes ({@link displayWidth}), ellipse comprise,
 * coupé entre deux graphèmes ; intact s'il tient.
 */
export function cutToWidth(text: string, max: number): string {
  if (displayWidth(text) <= max) return text;
  let kept = "";
  let width = 0;
  for (const grapheme of graphemesOf(text)) {
    const size = graphemeWidth(grapheme);
    if (width + size > max - 1) break;
    kept += grapheme;
    width += size;
  }
  return `${kept.trimEnd()}…`;
}

/** Lettres des écritures de droite à gauche (hébreu, arabe, syriaque, thâna, n'ko…). */
const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EEFF}]/u;

/**
 * Un nom saisi isolé de son voisinage (FSI … PDI, U+2068 / U+2069) **s'il
 * contient une lettre de droite à gauche** : sans cela, un nom arabe ou hébreu
 * retournait l'ordre du score voisin (« B 3–0 A » pour « A 0–3 B »). Un nom sans
 * telle lettre reste tel quel. Le nom a déjà perdu ses propres contrôles de
 * direction (`visibleText`) : la paire posée ici est toujours équilibrée.
 */
export function isolateDirection(name: string): string {
  return RTL_LETTER.test(name) ? `\u2068${name}\u2069` : name;
}
