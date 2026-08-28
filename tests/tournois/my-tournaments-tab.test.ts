import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

// La page est un composant client sans rendu testable ici (jsx: preserve, pas
// de DOM en test) : on vérifie le câblage au niveau source, comme pour les
// autres pages (cf. public-header.test.ts).
const page = read("app/(secured)/tournois/page.tsx");
const stateCard = read("app/(secured)/tournois/cards/StateCard.tsx");
const css = read("app/(secured)/tournois/tournois.module.css");

describe("page tournois — onglet « Mes tournois »", () => {
  it("charge la liste publique et celle de l'organisateur", () => {
    expect(page).toContain('fetchBuckets("/api/tournaments", signal)');
    expect(page).toContain('fetchBuckets("/api/tournaments?scope=mine", signal)');
  });

  it("règle les deux chargements séparément", () => {
    // L'échec de la liste personnelle ne doit pas vider la liste publique :
    // au pire l'onglet n'apparaît pas.
    expect(page).toContain("Promise.allSettled");
    expect(page).toMatch(/if \(all\.status === "fulfilled"\) setBuckets\(all\.value\)/);
    expect(page).toMatch(/if \(mine\.status === "fulfilled"\) setMyBuckets\(mine\.value\)/);
  });

  it("n'affiche l'onglet que si l'utilisateur a créé un tournoi", () => {
    expect(page).toMatch(/const hasOwnTournaments = ownedCount > 0/);
    expect(page).toMatch(/\{hasOwnTournaments && \(\s*<div\s+className=\{s\.tabs\}/);
  });

  it("ignore un onglet « mes tournois » qui n'aurait plus lieu d'être", () => {
    // Sans ce garde-fou, une liste repassée à vide laisserait la page bloquée
    // sur un onglet invisible.
    expect(page).toMatch(/const isMine = tab === "mine" && hasOwnTournaments/);
  });

  it("sort les tournois masqués des paniers d'état", () => {
    expect(page).toContain("splitHiddenTournaments");
    expect(page).toMatch(/const shownBuckets = isMine \? visible : filteredBuckets/);
    // Les sections d'état lisent la vue épurée : pas de doublon avec le tiroir.
    expect(page).toContain("shownBuckets.running.map");
    expect(page).toContain("shownBuckets.registration.map");
    expect(page).toContain("shownBuckets.upcoming.map");
    expect(page).toContain("shownBuckets.finished.slice");
  });

  it("réserve la section des masqués à l'onglet « Mes tournois »", () => {
    expect(page).toMatch(/\{isMine && \(\s*<Section[\s\S]*?PAS ENCORE VISIBLES/);
  });

  it("renumérote les sections quand le tiroir des masqués s'ajoute", () => {
    expect(page).toMatch(/String\(position \+ \(isMine \? 1 : 0\)\)\.padStart\(2, "0"\)/);
    expect(page).toMatch(/ix=\{ix\(1\)\}/);
    expect(page).toMatch(/ix=\{ix\(4\)\}/);
  });

  it("fait suivre l'onglet aux filtres et aux compteurs", () => {
    // Les deux listes passent par le reclassement local à l'heure du client
    // (`useScheduledBuckets`) avant d'être filtrées.
    expect(page).toMatch(/const sourceBuckets = isMine \? scheduledMyBuckets : scheduledBuckets/);
    expect(page).toContain("countByGame(sourceBuckets, key as GameFilter)");
    // La pagination des tournois terminés repart de zéro au changement d'onglet.
    expect(page).toMatch(/\[query, gameFilter, tab\]/);
  });

  it("garde le bandeau d'actualité sur la vue globale", () => {
    // Les paniers reclassés à l'heure du client, comme les sections.
    expect(page).toContain("buildTickerItems(scheduledBuckets)");
  });

  it("expose des onglets accessibles", () => {
    expect(page).toContain('role="tablist"');
    expect(page).toContain('role="tab"');
    expect(page).toContain("aria-selected={selected}");
    expect(page).toContain('aria-controls="tournaments-panel"');
    expect(page).toContain("tabIndex={selected ? 0 : -1}");
    // Navigation au clavier entre les onglets.
    expect(page).toMatch(/ArrowLeft|ArrowRight/);
  });

  it("style les onglets dans le module CSS de la page", () => {
    expect(css).toMatch(/^\.tabs \{/m);
    expect(css).toMatch(/^\.tab \{/m);
    expect(css).toMatch(/^\.tabOn \{/m);
  });
});

describe("StateCard", () => {
  it("aiguille vers la carte de chaque état", () => {
    expect(stateCard).toMatch(/state === "RUNNING"\) return <RunningCard/);
    expect(stateCard).toMatch(/state === "REGISTRATION"\) return <RegistrationCard/);
    expect(stateCard).toMatch(/state === "FINISHED"\) return <FinishedCard/);
    // Défaut : « à venir », l'état de l'immense majorité des tournois masqués.
    expect(stateCard).toMatch(/return <UpcomingCard t=\{t\} \/>;\s*\}/);
  });
});
