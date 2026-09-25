import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

// La page est un composant client sans rendu testable ici (mêmes contraintes
// que la section « Tournois invisibles », cf. hidden-tournaments-section.test.ts) :
// on vérifie le câblage au niveau source.
const page = read("app/(secured)/tournois/page.tsx");

describe("page tournois — barre de recherche et filtres", () => {
  it("le champ de recherche a un nom accessible, indépendant du placeholder", () => {
    expect(page).toContain('aria-label="Rechercher un tournoi"');
  });

  it("le placeholder ne promet plus une recherche par équipe, non filtrable", () => {
    expect(page).toContain('placeholder="Rechercher un tournoi, un format…"');
    expect(page).not.toContain("une équipe");
  });

  it("le raccourci affiché suit la plateforme, plus un « ⌘K » figé", () => {
    expect(page).toContain("searchShortcutLabel(navigator.platform || navigator.userAgent)");
    expect(page).toContain("<span className={s.searchKbd}>{shortcutLabel}</span>");
    expect(page).not.toContain(">⌘K<");
  });

  it("les pastilles de jeu annoncent leur état et leur compte au lecteur d'écran", () => {
    expect(page).toContain("aria-pressed={gameFilter === key}");
    expect(page).toContain("aria-label={`${label} (${count})`}");
    // Le nombre visible ne double pas ce que l'aria-label dit déjà.
    expect(page).toMatch(/<span className=\{s\.num\} aria-hidden="true">/);
  });

  it("les pastilles comptent selon la recherche en cours, pas seulement le jeu", () => {
    expect(page).toContain('filterBuckets(scheduledBuckets, query, "all")');
    expect(page).toContain("countByGame(queryFilteredBuckets, key)");
  });

  it("une section vidée par un filtre le dit, distinctement d'une section réellement vide", () => {
    expect(page).toContain("sectionEmptyMessage(whenUnfiltered, query, gameFilter)");
  });

  it("« Créer un tournoi » est un seul contrôle interactif, pas un bouton dans un lien", () => {
    expect(page).toMatch(/<CyberButton asChild variant="primary">\s*<Link href="\/tournois\/creer">/);
    expect(page).not.toMatch(/<Link href="\/tournois\/creer">\s*<button/);
  });
});

describe("page tournois — volume des sections", () => {
  it("chaque section bornée peut se déplier puis se replier", () => {
    for (const key of ["running", "registration", "upcoming", "finished"]) {
      expect(page).toContain(`onExpand={() => expandSection("${key}", total${key[0].toUpperCase()}${key.slice(1)})}`);
      expect(page).toContain(`onCollapse={() => collapseSection("${key}")}`);
    }
  });

  it("la limite se remet à sa valeur de départ à chaque changement de filtre", () => {
    expect(page).toMatch(/setDisplayLimits\(initialDisplayLimits\);\s*\}, \[query, gameFilter\]\);/);
  });
});
