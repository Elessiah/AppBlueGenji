/**
 * Lot SonarQube d'accessibilité : régions nommées en `<section>` (S6819) et
 * intitulés de champ sans contrôle (S6853).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "@jest/globals";
import { BoardPanel } from "@/app/(secured)/tournois/[id]/_components/BoardPanel";

const root = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("BoardPanel — corps du volet", () => {
  const render = (open: boolean, ariaLabel?: string) =>
    renderToStaticMarkup(
      <BoardPanel accent="#5ac8ff" title="Manche 3" open={open} onToggle={() => {}} panelId="p3" ariaLabel={ariaLabel}>
        <p>contenu</p>
      </BoardPanel>,
    );

  it("est une `<section>` nommée — donc une région — sans rôle redit", () => {
    const html = render(true, "Manche 3, 4 matchs");
    expect(html).toMatch(/<section id="p3" aria-label="Manche 3, 4 matchs" class="[^"]*">/);
    expect(html).not.toContain('role="region"');
  });

  it("prend le titre pour nom à défaut d'intitulé", () => {
    expect(render(true)).toContain('<section id="p3" aria-label="Manche 3"');
  });

  it("n'est pas rendu replié", () => {
    expect(render(false)).not.toContain("<section");
  });
});

describe("Régions nommées des panneaux flottants", () => {
  it.each<[string]>([["components/client-power-badge.tsx"], ["components/accessibility/AccessibilityMenu.tsx"]])(
    "%s nomme son panneau par un `<section>`, sans `role=\"region\"`",
    (path) => {
      const source = read(path);
      expect(source).toMatch(/<section id=\{[a-zA-Z]+\} className=\{styles\.panel\}/);
      expect(source).not.toContain('role="region"');
    },
  );
});

describe("Intitulé d'un `.field` sans contrôle", () => {
  it("`.field-label` reprend le style d'un `<label>` de champ", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/\.field label,\s*\.field \.field-label\s*\{\s*font-size: 13px;\s*color: var\(--text-1\);/);
  });

  it.each<[string, string]>([
    ["app/(secured)/equipes/creer/page.tsx", "Logo (optionnel)"],
    ["app/(secured)/joueurs/[id]/page.tsx", "Discord"],
  ])("%s n'emploie plus de `<label>` orphelin pour « %s »", (path, text) => {
    const source = read(path);
    expect(source).toContain(`<span className="field-label">${text}</span>`);
    expect(source).not.toContain(`<label>${text}</label>`);
  });

  it("la fiche joueur relie chaque intitulé à son champ en lecture seule", () => {
    const source = read("app/(secured)/joueurs/[id]/page.tsx");
    for (const id of ["player-battletag", "player-marvel-rivals-tag", "player-adult"]) {
      expect(source).toContain(`htmlFor="${id}"`);
      expect(source).toContain(`id="${id}"`);
    }
    expect(source).not.toMatch(/<label>[^<]*<\/label>/);
  });
});
