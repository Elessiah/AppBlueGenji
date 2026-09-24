import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { ScrollArea } from "@/components/cyber/ScrollArea";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const GLOBALS = read("app/globals.css");
const COMPONENT = read("components/cyber/ScrollArea.tsx");

describe("barres de défilement — style global", () => {
  it("définit les tokens de la barre", () => {
    for (const token of [
      "--scrollbar-size",
      "--scrollbar-thumb",
      "--scrollbar-thumb-hover",
      "--scrollbar-track",
    ]) {
      expect(GLOBALS).toContain(token);
    }
  });

  it("s'applique à tout le document, pas seulement à une classe", () => {
    // Sélecteurs nus : aucune barre blanche par défaut ne subsiste.
    expect(GLOBALS).toMatch(/\n\s*::-webkit-scrollbar\s*\{/);
    expect(GLOBALS).toMatch(/\n\s*::-webkit-scrollbar-thumb\s*\{/);
  });

  it("réserve les propriétés standard aux moteurs sans ::-webkit-scrollbar", () => {
    // Chromium 121+ ignore les pseudo-éléments dès que `scrollbar-color` est
    // posé : la déclaration Firefox doit être neutralisée dans le bloc @supports,
    // sinon le pouce arrondi ne s'applique jamais.
    expect(GLOBALS).toContain("@supports selector(::-webkit-scrollbar)");
    const supportsBlock = GLOBALS.slice(GLOBALS.indexOf("@supports selector(::-webkit-scrollbar)"));
    expect(supportsBlock).toContain("scrollbar-width: auto");
    expect(supportsBlock).toContain("scrollbar-color: auto");
  });

  it("garde la barre visible sur écran tactile, où il n'y a pas de survol", () => {
    expect(GLOBALS).toContain("@media (hover: none)");
    expect(GLOBALS).toContain(".scroll-subtle");
  });

  it("n'a plus l'ancienne classe .bracket-scroll", () => {
    expect(GLOBALS).not.toContain(".bracket-scroll");
  });
});

describe("ScrollArea — contrat du composant", () => {
  it("est exporté depuis le barrel des composants cyber", () => {
    expect(read("components/cyber/index.ts")).toContain(
      'export { ScrollArea } from "./ScrollArea";',
    );
  });

  it("porte le défilement, pas seulement le style", () => {
    expect(COMPONENT).toContain("overflowX");
    expect(COMPONENT).toContain("overflowY");
    expect(COMPONENT).toContain('orientation = "x"');
  });

  it("ne pose l'arrêt de tabulation et la région que selon le débordement mesuré", () => {
    // Plus aucun attribut inconditionnel : ils passent tous par la règle pure.
    expect(COMPONENT).not.toMatch(/^\s*tabIndex=\{0\}\s*$/m);
    expect(COMPONENT).not.toMatch(/role=\{ariaLabel/);
    expect(COMPONENT).toContain("scrollAreaAccessibility({ overflowing, focused, ariaLabel })");
    expect(COMPONENT).toContain("watchScrollOverflow(");
  });

  it("est focalisable et nommée au rendu serveur, avant toute mesure", () => {
    const html = renderToStaticMarkup(<ScrollArea ariaLabel="Rondes du tournoi">contenu</ScrollArea>);
    expect(html).toMatch(/^<div class="scroll-area scroll-subtle" tabindex="0" role="region" aria-label="Rondes du tournoi"/);
  });

  it("reste focalisable sans nom, mais n'est alors pas une région", () => {
    const html = renderToStaticMarkup(<ScrollArea>contenu</ScrollArea>);
    expect(html).toContain('tabindex="0"');
    expect(html).not.toContain("role=");
    expect(html).not.toContain("aria-label=");
  });

  it("ne compte que le focus posé sur la zone elle-même", () => {
    // Le focus d'un bouton contenu bouillonne jusqu'à la zone.
    expect(COMPONENT.match(/event\.target === event\.currentTarget/g)).toHaveLength(2);
  });

  it("reste focalisable quand seule la fenêtre perd le focus", () => {
    // La zone reste alors l'élément actif : `blur` seul ne suffit pas.
    expect(COMPONENT).toContain("document.activeElement !== event.currentTarget");
  });

  it("applique la variante discrète par défaut", () => {
    expect(COMPONENT).toContain("subtle = true");
    expect(COMPONENT).toContain("scroll-subtle");
  });
});

describe("ScrollArea — adoption", () => {
  const consumers = [
    "app/(secured)/tournois/[id]/_components/BracketTree.tsx",
    "app/(secured)/tournois/[id]/_components/SurvivalView.tsx",
    "components/rules/RuleDiagram.tsx",
  ];

  it("est utilisé par les zones défilantes existantes", () => {
    for (const path of consumers) {
      const source = read(path);
      expect(source).toContain("<ScrollArea");
      expect(source).toContain('from "@/components/cyber"');
    }
  });

  it("laisse ces composants sans overflow posé à la main", () => {
    for (const path of consumers) {
      expect(read(path)).not.toMatch(/overflowX:\s*"auto"/);
    }
  });

  it("nomme chaque zone pour les lecteurs d'écran", () => {
    for (const path of consumers) {
      expect(read(path)).toContain("ariaLabel");
    }
  });
});
