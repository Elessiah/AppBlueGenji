import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const PANEL = "app/(secured)/tournois/[id]/_components/RegistrationsPanel.tsx";
const PANEL_CSS = "app/(secured)/tournois/[id]/_components/RegistrationsPanel.module.css";
const HOOK = "app/(secured)/tournois/[id]/_hooks/useSeedingDrag.ts";

/**
 * Poignée de glissement du seeding — ce que le rendu doit garantir.
 *
 * Le geste lui-même (où la ligne atterrit, quand la page défile) est de
 * l'arithmétique pure, gardée par `tests/lib/shared/drag-reorder.test.ts`. Ce
 * qui se joue ici est le câblage, et il porte quatre pannes possibles, toutes
 * muettes :
 *
 * 1. une poignée rendue **hors de la fenêtre d'édition** — on tirerait une
 *    ligne d'un tournoi dont l'ordre est figé, pour un refus en 409 ;
 * 2. les flèches **retirées** au profit du seul glissement — le clavier n'a
 *    alors plus aucun moyen de réordonner ;
 * 3. une poignée faite d'un `<button>` — un contrôle qui prend le focus et ne
 *    répond ni à Entrée ni à l'espace est un piège, pas une commande ;
 * 4. un `touch-action` oublié — le navigateur prend le premier mouvement du
 *    doigt pour un défilement et confisque la suite : le geste ne marcherait
 *    qu'à la souris, ce qu'aucun test de logique ne peut voir.
 *
 * On garde donc la structure au niveau source, comme `entity-links.test.ts` et
 * `phase-card.test.ts` : ces composants sont clients, leur JSX est
 * présentationnel, et c'est l'invariant qui compte, pas l'apparence.
 */

/** Retire commentaires de bloc et de ligne : ils citent les balises en prose. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Corps d'une règle CSS, commentaires retirés. */
function ruleBody(css: string, selector: string): string {
  const match = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(stripComments(css));
  expect(match).not.toBeNull();
  return match![1];
}

describe("Poignée de glissement du seeding", () => {
  const panel = stripComments(read(PANEL));

  it("n'est rendue que sous la même condition que les flèches", () => {
    // `reorderable` = staff + ordre non figé + au moins deux lignes. La poignée
    // et les flèches doivent vivre et mourir ensemble : une poignée qui
    // survivrait au verrou offrirait un geste que le serveur refuse.
    expect(panel).toMatch(/\{reorderable && \(\s*<span[\s\S]*?className=\{styles\.grip\}/);
    expect(panel).toMatch(/\{reorderable && \(\s*<span className=\{styles\.actions\}>/);
  });

  it("laisse les flèches en place : le clavier garde son chemin", () => {
    expect(panel).toContain("d'un rang`");
    expect(panel).toMatch(/move\(reg\.teamId, "up"\)/);
    expect(panel).toMatch(/move\(reg\.teamId, "down"\)/);
  });

  it("n'est pas un contrôle focusable, et se retire de l'arbre d'accessibilité", () => {
    const grip = /<span\s+aria-hidden="true"\s+className=\{styles\.grip\}[\s\S]*?>/.exec(panel);
    expect(grip).not.toBeNull();
    expect(panel).not.toMatch(/<button[^>]*className=\{styles\.grip\}/);
    expect(panel).not.toMatch(/tabIndex[^\n]*styles\.grip/);
  });

  it("écrit par la même route que les flèches, et une seule fois par geste", () => {
    // Un seul `fetch` dans le composant : les deux chemins passent par
    // `applyOrder`, donc par le même aperçu optimiste et le même refus.
    expect(panel.match(/fetch\(/g)).toHaveLength(1);
    expect(panel).toMatch(/onDrop[\s\S]*?applyOrder\(next, teamId\)/);
  });

  it("affiche l'aperçu du geste par-dessus celui de l'écriture", () => {
    expect(panel).toContain("drag.previewOrder ?? order");
  });
});

describe("Feuille de la liste des inscrites", () => {
  const css = read(PANEL_CSS);

  it("neutralise le geste de défilement sur la poignée", () => {
    expect(ruleBody(css, ".grip")).toMatch(/touch-action:\s*none/);
  });

  it("compte autant de colonnes que l'en-tête a de cellules quand on réordonne", () => {
    const columns = /grid-template-columns:([^;]*);/
      .exec(ruleBody(css, ".reorderable"))![1]
      .trim()
      // `minmax(0, 1.6fr)` est une seule colonne : la virgule interne ne compte pas.
      .replace(/\([^)]*\)/g, "()")
      .split(/\s+/);
    // poignée, rang, engagé, inscription, classement final, flèches
    expect(columns).toHaveLength(6);
  });
});

describe("Hook du geste", () => {
  const hook = stripComments(read(HOOK));

  it("n'écrit rien pendant le glissement : le rappel ne part qu'au relâchement", () => {
    expect(hook).not.toContain("fetch(");
    expect(hook.match(/onDropRef\.current\(/g)).toHaveLength(1);
  });

  it("ne réimplémente aucune des règles du module pur", () => {
    expect(hook).toMatch(/from "@\/lib\/shared\/drag-reorder"/);
    for (const helper of ["dropIndexAt", "moveToIndex", "autoScrollVelocity"]) {
      expect(hook).toContain(helper);
      expect(hook).not.toMatch(new RegExp(`function ${helper}\\b`));
    }
  });

  it("laisse une échappatoire au geste engagé", () => {
    // Un glissement sans annulation oblige à relâcher quelque part, donc à
    // écrire un ordre dont on ne veut pas.
    expect(hook).toMatch(/"Escape"/);
    expect(hook).toContain("pointercancel");
  });
});
