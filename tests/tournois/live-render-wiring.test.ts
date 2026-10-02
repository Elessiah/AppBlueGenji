import { describe, expect, it } from "@jest/globals";
import { readSource } from "../helpers/read-source";

/**
 * Câblage des deux corrections de rendu de la fiche d'un tournoi : invariants
 * de source qu'aucun test de comportement ne tient ici (composants clients,
 * pas de DOM en test). La logique elle-même est couverte ailleurs —
 * `live-state.test.ts` (partage structurel) et `viewer-alerts.test.ts`
 * (`viewerLaunchChanged`).
 */
const page = readSource("app/(secured)/tournois/[id]/page.tsx");
const hook = readSource("app/(secured)/tournois/[id]/_hooks/useTournamentLive.ts");
const formatContext = readSource("app/(secured)/tournois/[id]/_lib/match-format-context.tsx");
const launchCenter = readSource("components/match-launch/MatchLaunchCenter.tsx");

describe("cartes de match mémorisées — ce qui descend jusqu'à elles reste stable", () => {
  it("mémorise les droits de saisie qui passent par le contexte des cartes", () => {
    // Deux flèches neuves à chaque rendu changeraient la valeur du contexte à
    // chaque instantané, et toutes les cartes se redessineraient malgré `memo`.
    expect(page).toMatch(/const canReportScore = useCallback\(/);
    expect(page).toMatch(/const canOpenPlayerScore = useCallback\(/);
    // Déclarées avant les retours anticipés : sinon, l'ordre des hooks varie.
    expect(page.indexOf("const canOpenPlayerScore = useCallback(")).toBeLessThan(
      page.indexOf("if (fatal && !detail)"),
    );
  });

  it("donne au contexte du format une valeur stable tant que son contenu ne change pas", () => {
    expect(formatContext).toMatch(/const value = useMemo\(/);
    expect(formatContext).toContain("<MatchFormatContext.Provider value={value}>");
  });

  it("partage aussi ce que relit la lecture REST de secours", () => {
    expect(hook).toContain("shareUnchanged(current, payload)");
  });
});

describe("modale de lancement — alimentée par le flux de la fiche", () => {
  it("signale à la modale chaque changement d'une rencontre du lecteur", () => {
    // L'annonce elle-même : `live-alerts.test.ts`. Elle part de tout état reçu.
    expect(hook).toContain("if (next.detail) announceViewerChanges(previous.detail, next.detail);");
  });

  it("regroupe les signaux en une seule lecture", () => {
    expect(launchCenter).toMatch(/if \(refreshTimer !== null\) return;/);
    expect(launchCenter).toContain("REFRESH_EVENT_COALESCE_MS");
    // Le minuteur en attente ne survit pas au démontage.
    expect(launchCenter).toMatch(/if \(refreshTimer !== null\) clearTimeout\(refreshTimer\);/);
  });

  it("ne relance pas de lecture à chaque changement de cadence", () => {
    // L'effet de relève dépend de `pollMs` : y lire aussi relançait une lecture
    // en double de celle qui venait de révéler le changement de phase.
    const relayEffect = launchCenter.match(
      /useEffect\(\(\) => \{\s*if \(!clocks\) return;\s*const timer = setInterval[\s\S]*?\}, \[clocks, pollMs, refresh\]\);/,
    );
    expect(relayEffect).not.toBeNull();
    expect(relayEffect![0]).not.toContain("void refresh();\n    const timer");
    expect(launchCenter).toMatch(/useEffect\(\(\) => \{\s*if \(clocks\) void refresh\(\);\s*\}, \[clocks, refresh\]\);/);
  });

  it("n'applique jamais une réponse plus ancienne que celle déjà affichée", () => {
    expect(launchCenter).toContain("const seq = ++requestSeqRef.current;");
    expect(launchCenter).toMatch(/if \(seq < appliedSeqRef\.current\) return;\s*appliedSeqRef\.current = seq;/);
  });
});
