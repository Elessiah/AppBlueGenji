/**
 * Découpage d'un texte en segments **gras** / normal.
 *
 * Les conditions d'utilisation (`lib/shared/terms-of-use.ts`) sont rédigées avec
 * la mise en gras Markdown ; la page les rend par `EmphasisText`. Le registre
 * des règles l'employait aussi, jusqu'à sa traduction : ses textes sont devenus
 * des messages ICU, gras en `<b>…</b>` (`components/rules/RuleText.tsx`).
 *
 * Volontairement minimal : `**gras**`, et rien d'autre. Ce n'est pas un moteur
 * Markdown (`lib/server/bot-docs.ts` en tient un, pour de vrais fichiers `.md`)
 * mais la seule marque que ces textes emploient. Le module rend des **segments**,
 * jamais du HTML : la page les monte en `<strong>`, donc rien n'est injecté.
 */

export type EmphasisSegment = {
  text: string;
  bold: boolean;
};

/**
 * Segments d'un texte. Une marque non refermée reste littérale — mieux vaut
 * afficher l'astérisque d'une faute de frappe que d'avaler la fin du paragraphe.
 */
export function parseEmphasis(text: string): EmphasisSegment[] {
  const segments: EmphasisSegment[] = [];
  let rest = text;

  while (rest.length > 0) {
    const open = rest.indexOf("**");
    if (open === -1) break;

    // `**` collé à son propre `**` (`****`) : aucun contenu à mettre en gras,
    // on laisse la marque telle quelle plutôt que d'émettre un segment vide.
    const close = rest.indexOf("**", open + 2);
    if (close === -1 || close === open + 2) break;

    if (open > 0) segments.push({ text: rest.slice(0, open), bold: false });
    segments.push({ text: rest.slice(open + 2, close), bold: true });
    rest = rest.slice(close + 2);
  }

  if (rest.length > 0) segments.push({ text: rest, bold: false });
  return segments;
}

/** Le texte sans ses marques — pour un `title`, un `alt` ou une méta-donnée. */
export function stripEmphasis(text: string): string {
  return parseEmphasis(text)
    .map((segment) => segment.text)
    .join("");
}
