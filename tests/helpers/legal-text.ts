/**
 * Le texte d'une page légale rendue, tel que le lit le visiteur : un bloc par
 * ligne (paragraphe, titre, élément de liste, cellule), balisage retiré,
 * entités décodées. Sert de référence au français, qui ne doit pas bouger
 * d'un caractère (lot 7b, `tests/fixtures/legal-fr/`).
 */
const BLOCK = /<(p|li|h1|h2|h3|h4|div|section|header|dd|dt|td|th|tr|ul|ol|nav|br)\b[^>]*\/?>/g;

export function legalPageText(html: string): string {
  return html
    .replace(BLOCK, "\n")
    .replace(/<[^<>]*>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/** Le même texte, privé des passages annoncés en français (`lang="fr"`) : noms, adresses, titres officiels. */
export function withoutFrenchPassages(html: string): string {
  return html.replace(/<(span|a|p|li)\b[^>]*\blang="fr"[^>]*>[\s\S]*?<\/\1>/g, "");
}
