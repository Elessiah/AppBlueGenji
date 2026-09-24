import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * `aria-label` interdit sur un élément sans rôle (tâche 9 d'`ACCESSIBILITE.md`).
 *
 * Un `<span>` ou un `<div>` a le rôle `generic`, sur lequel ARIA 1.2 **interdit**
 * `aria-label` et `aria-labelledby` : une partie des lecteurs d'écran les
 * ignore, et le nom qu'on croyait donner n'existe pas (axe :
 * `aria-prohibited-attr`). L'audit en relevait sur la fiche d'un tournoi — le
 * repère des faits de l'en-tête, le « VS » de la modale de lancement. Un nom
 * s'y écrit en texte hors écran (`.sr-only`), ou l'élément reçoit un rôle qui
 * admet un nom.
 *
 * L'audit ne visait que la fiche du tournoi ; le balayage couvre tout le site
 * — la fiche d'un joueur et les contacts d'une annonce de recrutement avaient
 * le même défaut. Un élément natif qui porte déjà un rôle nommable (`<ul>`,
 * `<ol>`, `<section>`, `<nav>`…) n'est pas visé.
 */

const ROOT = join(__dirname, "..", "..");
const SCOPES = [join(ROOT, "app"), join(ROOT, "components")];

/** Éléments au rôle `generic` (ou sans rôle nommable) les plus courants du JSX. */
const GENERIC_TAGS = ["div", "span", "p", "b", "i", "strong", "em", "small"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/**
 * Balises ouvrantes d'un élément générique, attributs compris. Les accolades
 * d'un niveau (`style={{ … }}` en comptant comme deux) et les flèches (`=>`)
 * sont admises à l'intérieur : sans elles, un `>` d'expression couperait la
 * balise.
 */
function genericOpeningTags(source: string): { tag: string; line: number }[] {
  const pattern = new RegExp(
    `<(?:${GENERIC_TAGS.join("|")})\\b(?:[^<>{}]|=>|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*?>`,
    "gs",
  );
  const found: { tag: string; line: number }[] = [];
  for (const match of source.matchAll(pattern)) {
    found.push({ tag: match[0], line: source.slice(0, match.index).split("\n").length });
  }
  return found;
}

describe("aucun aria-label sur un élément sans rôle", () => {
  const files = SCOPES.flatMap((dir) => walk(dir));

  it("balaie bien des fichiers", () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it("le repère balayé trouve un défaut quand il y en a un", () => {
    const [found] = genericOpeningTags('<span className="x" aria-label="contre">VS</span>');
    expect(found.tag).toMatch(/aria-label=/);
    const [nested] = genericOpeningTags('<div style={{ width: a > b ? 1 : 2 }} aria-label="x">');
    expect(nested.tag).toContain('aria-label="x"');
  });

  it.each(files.map((file) => [relative(ROOT, file), file] as [string, string]))("%s", (_name, file) => {
    const offenders = genericOpeningTags(readFileSync(file, "utf8"))
      .filter(({ tag }) => /\saria-(?:label|labelledby)=/.test(tag) && !/\srole=/.test(tag))
      .map(({ tag, line }) => `ligne ${line} : ${tag.replace(/\s+/g, " ").slice(0, 120)}`);
    expect(offenders).toEqual([]);
  });
});
