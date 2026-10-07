import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

// La page est un composant client sans rendu testable ici (jsx: preserve, pas
// de DOM en test) : on vérifie le câblage au niveau source, comme pour les
// autres pages (cf. public-header.test.ts).
const page = read("app/(secured)/tournois/TournamentsList.tsx");
const stateCard = read("app/(secured)/tournois/cards/StateCard.tsx");
const route = read("app/api/tournaments/route.ts");

describe("page tournois — section « Tournois invisibles »", () => {
  it("ne demande les invisibles qu'au staff tournois", () => {
    expect(page).toContain('fetchBuckets("/api/tournaments?scope=hidden", signal)');
    // Un joueur ne déclenche même pas la requête : elle lui serait refusée.
    // Sans permission : la section est vidée et la requête n'est pas envoyée.
    // Le tableau vide n'est réécrit que s'il ne l'est pas déjà, pour ne pas
    // redessiner la page à chaque rafraîchissement de fond.
    expect(page).toMatch(/if \(!isAdmin\) \{[\s\S]{0,400}?setHiddenTournaments\([\s\S]{0,120}?return;\s*\}/);
    // La permission commande le chargement : elle est dans ses dépendances.
    expect(page).toMatch(/\[isAdmin, showError\],\s*\);/);
  });

  it("charge les invisibles à part de la liste publique", () => {
    // Deux chargements distincts : l'échec de l'un ne vide pas l'autre. La
    // lecture publique est devenue un `useCallback` (elle sert aussi au
    // rafraîchissement de fond), mais elle reste étrangère aux invisibles.
    const start = page.indexOf("const load = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const end = page.indexOf("[showError, wantFinishedArchive],", start);
    expect(end).toBeGreaterThan(start);
    const publicLoad = page.slice(start, end);

    // La liste courante, ou l'archive entière des terminés une fois demandée.
    expect(publicLoad).toContain(
      'wantFinishedArchive ? "/api/tournaments?finished=all" : "/api/tournaments"',
    );
    expect(publicLoad).not.toContain("scope=hidden");
    // Une relecture de fond partie avant la demande d'archive ne doit pas
    // remettre la liste tronquée par-dessus l'archive arrivée entre-temps.
    expect(publicLoad).toContain("if (wantFinishedArchive !== wantFinishedArchiveRef.current) return;");
  });

  it("réserve la section au staff et la masque quand il n'y a rien", () => {
    expect(page).toMatch(
      /const showHidden = isAdmin && hiddenTournaments\.length > 0/,
    );
    expect(page).toMatch(/\{showHidden && totalHidden > 0 && \(\s*<Section[\s\S]*?sectionTitle\("hidden"\)/);
  });

  it("aplatit les paniers reçus pour la section", () => {
    // La réponse est aplatie avant d'être comparée à la précédente : la section
    // suit désormais la même cadence de rafraîchissement que la liste publique.
    expect(page).toContain("flattenBuckets(await fetchBuckets(");
    expect(page).toContain("sameTournaments(previous, hidden) ? previous : hidden");
  });

  it("applique la recherche et le filtre de jeu aux invisibles", () => {
    // La recherche (coûteuse) n'est faite qu'une fois, dans `queryFilteredHidden` ;
    // le filtre de jeu (une comparaison de chaîne) s'applique ensuite par-dessus.
    expect(page).toContain("filterTournamentsByQuery(hiddenTournaments, query)");
    expect(page).toContain("filterTournamentsByGame(queryFilteredHidden, gameFilter)");
  });

  it("compte les invisibles dans les pastilles de jeu du staff, filtrés par la recherche en cours", () => {
    expect(page).toMatch(
      /countByGame\(queryFilteredBuckets, key\) \+\s*finishedBeyond\(key\) \+\s*\(showHidden \? filterTournamentsByGame\(queryFilteredHidden, key\)\.length : 0\)/,
    );
  });

  it("numérote les seules sections affichées, invisibles comprises", () => {
    // La numérotation suit la liste des sections rendues : celle des
    // invisibles, en tête, décale les suivantes sans laisser de trou.
    expect(page).toContain("const shownSections = sections.filter((entry) => entry.count > 0);");
    expect(page).toMatch(/shownSections\.findIndex\(\(entry\) => entry\.key === key\) \+ 1\)\.padStart\(2, "0"\)/);
    expect(page).toContain('ix={ix("hidden")}');
    expect(page).toContain('ix={ix("finished")}');
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
    expect(stateCard).toMatch(/return <UpcomingCard t=\{t\}( priority=\{priority\})? \/>;\s*\}/);
  });
});
