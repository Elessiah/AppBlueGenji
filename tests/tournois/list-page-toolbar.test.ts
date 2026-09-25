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

  it("la recherche (coûteuse) ne s'exécute qu'une fois par rendu, le filtre de jeu par-dessus", () => {
    // `filteredBuckets` dérive de `queryFilteredBuckets` plutôt que de relire
    // la recherche une seconde fois avec `filterBuckets(..., gameFilter)` :
    // sur ~150 tournois, ça évite de repasser deux fois sur nom/description/
    // format à chaque frappe.
    expect(page).not.toMatch(/filterBuckets\(scheduledBuckets, query, gameFilter\)/);
    expect(page).toMatch(/gameFilter === "all"\s*\?\s*queryFilteredBuckets/);
  });
});

describe("page tournois — volume des sections", () => {
  it("chaque section bornée peut se déplier puis se replier", () => {
    for (const key of ["running", "registration", "upcoming", "finished"]) {
      expect(page).toContain(`expanded={expandedSections.has("${key}")}`);
      expect(page).toContain(`onToggle={() => toggleSection("${key}")}`);
    }
  });

  it("l'état déplié se remet à zéro à chaque changement de filtre", () => {
    expect(page).toMatch(/setExpandedSections\(new Set\(\)\);\s*\}, \[query, gameFilter\]\);/);
  });

  it("une section dépliée montre le total réel, jamais un compte figé au moment du clic", () => {
    // `displayLimits` capturait le total au clic : un rafraîchissement de fond
    // qui fait grossir la section le laissait périmé, cachant les arrivées
    // récentes derrière un « Voir plus » qui semblait pourtant déplié.
    expect(page).not.toContain("displayLimits");
    expect(page).toMatch(/expandedSections\.has\("running"\) \? totalRunning : SECTION_DISPLAY_LIMIT/);
  });

  it("chaque bouton « Voir plus »/« Voir moins » nomme sa section", () => {
    // Jusqu'à quatre boutons « Voir moins » identiques cohabitent sur la
    // page : sans le nom de la section, une navigation par liste de contrôles
    // (lecteur d'écran) ne peut pas les distinguer.
    const titles: Record<string, string> = {
      running: "EN COURS",
      registration: "INSCRIPTIONS OUVERTES",
      upcoming: "PROCHAINEMENT",
      finished: "TERMINÉS",
    };
    for (const [key, title] of Object.entries(titles)) {
      expect(page).toMatch(new RegExp(`sectionTitle="${title}"[\\s\\S]{0,80}total=\\{total${key[0].toUpperCase()}${key.slice(1)}\\}`));
    }
  });
});
