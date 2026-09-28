import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, blockFor } from "./_lib/style-sweep";

/**
 * Un contrôle qu'on touche ne se sélectionne pas.
 *
 * Sur mobile, taper plusieurs fois « + » dans la modale de score était lu comme
 * un double appui : le navigateur sélectionnait le mot sous le doigt et
 * étendait la sélection à chaque appui, jusqu'au nom des équipes. La règle est
 * posée sur l'élément dans `globals.css`, et les zones d'appuis répétés portent
 * `data-tap-zone` pour que la sélection ne se reporte pas sur le texte voisin.
 */
describe("sélection de texte sur les contrôles", () => {
  const controls = blockFor(/button,\s*\[role="button"\],\s*\[role="tab"\][^{]*summary\s*\{/);

  it.each([
    ["bloque la sélection (standard)", /(^|[^-])user-select:\s*none/],
    ["bloque la sélection (WebKit)", /-webkit-user-select:\s*none/],
    ["retire le zoom au double appui", /touch-action:\s*manipulation/],
  ])("%s", (_label, pattern) => {
    expect(controls).toMatch(pattern);
  });

  it("rétablit la sélection dans les champs de saisie", () => {
    const fields = blockFor(/input,\s*textarea,\s*\[contenteditable="true"\]\s*\{/);
    expect(fields).toMatch(/(^|[^-])user-select:\s*text/);
    expect(fields).toMatch(/-webkit-user-select:\s*text/);
  });

  it("définit la zone d'appuis répétés", () => {
    const zone = blockFor(/\[data-tap-zone\]\s*\{/);
    expect(zone).toMatch(/(^|[^-])user-select:\s*none/);
    expect(zone).toMatch(/touch-action:\s*manipulation/);
  });

  it.each([
    "app/(secured)/tournois/[id]/_components/ScoreStepper.tsx",
    "app/(secured)/tournois/[id]/_components/RegistrationsPanel.tsx",
    "app/(secured)/tournois/creer/PhaseCard.tsx",
    "app/association/BureauSection.tsx",
    "app/benevoles/BenevolesSection.tsx",
    "app/recrutement/RecruitmentSection.tsx",
    "components/cyber/landing/SponsorsGrid.tsx",
    "components/recruitment-highlight.tsx",
  ])("%s marque sa zone d'appuis répétés", (file) => {
    expect(readFileSync(join(ROOT, file), "utf8")).toMatch(/\bdata-tap-zone\b/);
  });
});
