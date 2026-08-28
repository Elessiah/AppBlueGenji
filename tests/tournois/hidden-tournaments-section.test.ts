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
const route = read("app/api/tournaments/route.ts");

describe("page tournois — section « Tournois invisibles »", () => {
  it("ne demande les invisibles qu'au staff tournois", () => {
    expect(page).toContain('fetchBuckets("/api/tournaments?scope=hidden", signal)');
    // Un joueur ne déclenche même pas la requête : elle lui serait refusée.
    expect(page).toMatch(/if \(!isAdmin\) \{\s*setHiddenTournaments\(\[\]\);\s*return;\s*\}/);
    // La permission commande le chargement : elle est dans ses dépendances.
    expect(page).toMatch(/\[isAdmin, showError\],\s*\);/);
  });

  it("charge les invisibles à part de la liste publique", () => {
    // Deux chargements distincts : l'échec de l'un ne vide pas l'autre. La
    // lecture publique est devenue un `useCallback` (elle sert aussi au
    // rafraîchissement de fond), mais elle reste étrangère aux invisibles.
    const start = page.indexOf("const load = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const publicLoad = page.slice(start, page.indexOf("[showError],", start));

    expect(publicLoad).toContain('fetchBuckets("/api/tournaments", signal)');
    expect(publicLoad).not.toContain("scope=hidden");
  });

  it("réserve la section au staff et la masque quand il n'y a rien", () => {
    expect(page).toMatch(
      /const showHidden = isAdmin && hiddenTournaments\.length > 0/,
    );
    expect(page).toMatch(/\{showHidden && \(\s*<Section[\s\S]*?TOURNOIS INVISIBLES/);
  });

  it("aplatit les paniers reçus pour la section", () => {
    // La réponse est aplatie avant d'être comparée à la précédente : la section
    // suit désormais la même cadence de rafraîchissement que la liste publique.
    expect(page).toContain("flattenBuckets(await fetchBuckets(");
    expect(page).toContain("sameTournaments(previous, hidden) ? previous : hidden");
  });

  it("applique la recherche et le filtre de jeu aux invisibles", () => {
    expect(page).toMatch(
      /filterTournamentsByGame\(\s*filterTournamentsByQuery\(hiddenTournaments, query\),\s*gameFilter,\s*\)/,
    );
  });

  it("compte les invisibles dans les pastilles de jeu du staff", () => {
    expect(page).toMatch(
      /countByGame\(buckets, key\) \+\s*\(showHidden \? filterTournamentsByGame\(hiddenTournaments, key\)\.length : 0\)/,
    );
  });

  it("renumérote les sections quand celle des invisibles s'ajoute", () => {
    expect(page).toMatch(/String\(position \+ \(showHidden \? 1 : 0\)\)\.padStart\(2, "0"\)/);
    expect(page).toMatch(/ix=\{ix\(1\)\}/);
    expect(page).toMatch(/ix=\{ix\(4\)\}/);
  });

  it("ne laisse plus d'onglet sur la page", () => {
    expect(page).not.toContain('role="tablist"');
    expect(page).not.toContain("scope=mine");
    expect(page).not.toContain("myBuckets");
  });
});

describe("route /api/tournaments — garde de la portée invisible", () => {
  it("exige la permission tournois avant toute lecture", () => {
    expect(route).toMatch(
      /const hiddenOnly = url\.searchParams\.get\("scope"\) === "hidden";\s*\n\s*if \(hiddenOnly && !can\(user, "tournaments"\)\) return fail\("FORBIDDEN", 403\)/,
    );
  });
});

describe("StateCard", () => {
  it("aiguille vers la carte de chaque état", () => {
    expect(stateCard).toMatch(/state === "RUNNING"\) return <RunningCard/);
    expect(stateCard).toMatch(/state === "REGISTRATION"\) return <RegistrationCard/);
    expect(stateCard).toMatch(/state === "FINISHED"\) return <FinishedCard/);
    // Défaut : « à venir », l'état de l'immense majorité des tournois invisibles.
    expect(stateCard).toMatch(/return <UpcomingCard t=\{t\} \/>;\s*\}/);
  });
});
