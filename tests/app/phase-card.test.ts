import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const source = readFileSync(
  join(ROOT, "app/(secured)/tournois/creer/PhaseCard.tsx"),
  "utf8",
);

/**
 * Le composant est un client component au JSX purement présentationnel : on
 * vérifie sa structure au niveau source, comme pour les autres pages
 * (cf. `public-header.test.ts`). Ce que ces tests gardent est un invariant de
 * **structure HTML**, pas d'apparence : un `<button>` ne peut pas en contenir un
 * autre, sous peine d'erreur d'hydratation React et de commandes indistinctes au
 * clavier comme au lecteur d'écran.
 */

/** Retire commentaires de bloc et de ligne : ils citent des balises en prose. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Profondeur maximale d'imbrication des `<button>` dans le JSX. */
function maxButtonDepth(code: string): number {
  let depth = 0;
  let max = 0;
  for (const token of code.match(/<button\b|<\/button>/g) ?? []) {
    if (token === "</button>") depth -= 1;
    else max = Math.max(max, (depth += 1));
  }
  expect(depth).toBe(0); // balises appariées : sans quoi la mesure ne veut rien dire
  return max;
}

describe("PhaseCard — en-tête d'une phase", () => {
  const code = stripComments(source);

  it("n'imbrique jamais un bouton dans un autre", () => {
    expect(maxButtonDepth(code)).toBe(1);
  });

  it("détecterait l'imbrication qu'elle interdit", () => {
    // Garde-fou du garde-fou : la mesure doit voir l'ancienne structure comme
    // fautive, sans quoi le test précédent passerait sur n'importe quoi.
    expect(maxButtonDepth("<button><button></button></button>")).toBe(2);
  });

  it("porte le repli/dépli sur un bouton, pas sur le conteneur de la ligne", () => {
    const toggle = code.slice(code.indexOf("onClick={onToggleExpand}"));
    // L'ouverture de balise qui précède immédiatement le gestionnaire.
    const opening = code.slice(0, code.indexOf("onClick={onToggleExpand}"));
    expect(opening.slice(opening.lastIndexOf("<"))).toContain("<button");
    expect(toggle).toContain("aria-expanded={isExpanded}");
    expect(toggle).toContain("aria-controls={bodyId}");
  });

  it("laisse les flèches et la suppression hors du bouton de repli", () => {
    const toggleStart = code.lastIndexOf("<button", code.indexOf("onClick={onToggleExpand}"));
    const toggleEnd = code.indexOf("</button>", toggleStart);
    const toggleMarkup = code.slice(toggleStart, toggleEnd);

    expect(toggleMarkup).toContain("phaseFormatLabel(phase.format)");
    // La pastille est un `<span>` : elle tient dans le bouton, et y reste donc
    // cliquable comme lorsque tout le bandeau en était un. Muette, en revanche :
    // `phaseSummary` dit déjà « — phase finale ».
    expect(toggleMarkup).toContain("Phase finale");
    expect(toggleMarkup).toMatch(/<Pill[^>]*aria-hidden="true"/);
    for (const action of ["Monter la phase", "Descendre la phase", "Supprimer la phase"]) {
      expect(toggleMarkup).not.toContain(action);
      expect(code).toContain(`aria-label={\`${action} \${phase.position}\`}`);
    }
  });

  it("garde le chevron cliquable sans le dédoubler pour clavier et assistance", () => {
    const chevronStart = code.lastIndexOf("<button", code.indexOf("▼"));
    const chevron = code.slice(chevronStart, code.indexOf("▼"));

    // Cliquable : c'est l'affordance conventionnelle du repli, et son
    // orientation annonce déjà l'état.
    expect(chevron).toContain("onClick={onToggleExpand}");
    // Mais redondant avec l'intitulé : ni annoncé, ni sur le parcours clavier.
    expect(chevron).toContain('aria-hidden="true"');
    expect(chevron).toContain("tabIndex={-1}");
    // `tabIndex={-1}` ne retire que du parcours clavier : sans neutraliser le
    // `mousedown`, un clic poserait le focus dans ce sous-arbre `aria-hidden`.
    expect(chevron).toContain("onMouseDown={(e) => e.preventDefault()}");
    // Et sans nom accessible ni `aria-expanded` qui doubleraient le bouton.
    expect(chevron).not.toContain("aria-label");
    expect(chevron).not.toContain("aria-expanded");
  });

  it("désigne par `aria-controls` un corps de carte réellement présent", () => {
    expect(code).toContain("const bodyId = `phase-body-${phase.position}`");
    // La région reste dans le document une fois repliée (`hidden`), pour que la
    // référence ne pointe pas dans le vide.
    const body = code.slice(code.indexOf("id={bodyId}"));
    expect(body).toContain("hidden={!isExpanded}");
    expect(body.indexOf("hidden={!isExpanded}")).toBeLessThan(
      body.indexOf("{isExpanded && ("),
    );
  });

  it("nomme le corps par son bouton et tait le chevron décoratif", () => {
    expect(code).toContain("const toggleId = `phase-toggle-${phase.position}`");
    expect(code).toContain("aria-labelledby={toggleId}");
    // Le chevron redit `aria-expanded` : il n'a rien à annoncer de plus.
    const chevron = code.slice(code.lastIndexOf("aria-hidden=\"true\""));
    expect(chevron).toContain("▼");
  });

  it("garde les commandes d'ordre et de suppression étiquetées et bornées", () => {
    expect(code).toContain("const canMoveUp = !disabled && phase.position > 1;");
    expect(code).toContain(
      "const canMoveDown = !disabled && phase.position < totalPhases;",
    );
    expect(code).toContain(
      "const canRemove = !disabled && totalPhases > MIN_PHASES;",
    );
  });
});
