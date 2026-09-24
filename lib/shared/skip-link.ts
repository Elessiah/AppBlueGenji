/**
 * Où le lien d'évitement « Aller au contenu » pose le focus (WCAG 2.4.1).
 *
 * La cible est le `<main>` de la page, trouvé au clic plutôt que désigné par
 * un identifiant : quinze fichiers rendent chacun le leur, et une page ajoutée
 * demain est couverte sans qu'on ait à y penser.
 *
 * Mais `<main>` ne suffit pas. Les pages de la vitrine y rendent **leur
 * en-tête** (`PublicHeader`, précédé du JSON-LD) : poser le focus sur `<main>`
 * ferait repartir la tabulation du menu et de la marque — exactement ce que le
 * lien promet d'éviter. On descend donc sur le premier enfant qui n'est ni un
 * script, ni un en-tête, ni une navigation, ni un élément masqué aux
 * technologies d'assistance. Sans lui, `<main>` lui-même.
 *
 * Module pur : il ne connaît de l'élément que ce qu'il lit, ce qui le rend
 * testable hors navigateur.
 */

/** Ce que la résolution lit d'un élément du DOM. */
export type SkipLinkNode = {
  readonly tagName: string;
  readonly children: ArrayLike<SkipLinkNode>;
  getAttribute(name: string): string | null;
};

/** Balises qui précèdent le contenu sans en faire partie. */
const LEADING_CHROME = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "HEADER", "NAV"]);

function isLeadingChrome(node: SkipLinkNode): boolean {
  return LEADING_CHROME.has(node.tagName.toUpperCase()) || node.getAttribute("aria-hidden") === "true";
}

/**
 * Le premier élément de contenu de `main`, en sautant ce qui le précède sans
 * en faire partie. Ne saute que **en tête** : un en-tête de section placé plus
 * bas fait partie du contenu.
 */
export function skipLinkTarget<T extends SkipLinkNode>(main: T): T {
  for (let i = 0; i < main.children.length; i += 1) {
    const child = main.children[i] as T;
    if (!isLeadingChrome(child)) return child;
  }
  return main;
}
