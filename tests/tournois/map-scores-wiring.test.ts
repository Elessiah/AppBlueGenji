import { describe, expect, it } from "@jest/globals";
import { readSource } from "../helpers/read-source";

/**
 * Câblage du détail map par map (`docs/features/MAP_SCORES.md`) aux endroits
 * que les tests de comportement n'atteignent pas sans monter tout un moteur.
 */
describe("détail map par map — effacé avec ce qu'il documente", () => {
  it.each([
    "lib/server/tournaments/bg-survie/forfeit.ts",
    "lib/server/tournaments/survival.ts",
    "lib/server/tournaments/swiss.ts",
    "lib/server/tournaments/rollback.ts",
  ])("%s efface tout le détail d'un match défait ou abandonné", (path) => {
    expect(readSource(path)).toMatch(/clearMapSets\(.*ALL_MAP_SOURCES\)/);
  });

  it("la clôture efface les propositions, après promotion de celle qui fait foi", () => {
    const scoring = readSource("lib/server/tournaments/scoring.ts");
    expect(scoring).toMatch(/clearMapSets\(connection, \[Number\(match\.id\)\], REPORTED_MAP_SOURCES\)/);
    expect(scoring.indexOf("await promoteReportedMaps(")).toBeLessThan(scoring.lastIndexOf("await finalizeMatch(connection, tournamentId, updated"));
  });
});

describe("détail map par map — entretien de l'instantané", () => {
  it("un interblocage de l'entretien rend l'instantané sur l'état d'avant, sans 500", () => {
    const snapshot = readSource("lib/server/tournaments/snapshot.ts");
    expect(snapshot).toMatch(/if \(isTransactionAborted\(error\)\) return tournamentRow;/);
  });
});

describe("détail map par map — affichage", () => {
  it("la carte ouvre le détail dans une modale, jamais dans un volet qui grandit le créneau", () => {
    const details = readSource("app/(secured)/tournois/[id]/_components/MatchMapDetails.tsx");
    expect(details).not.toContain("<details");
    expect(details).toContain("createPortal(");
    expect(details).toContain("useDialogBehavior({ open: true, onClose })");
  });

  it("l'arbitrage voit le détail des deux propositions en désaccord", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    expect(dialog).toMatch(/match\.team1Report && match\.team2Report[\s\S]{0,600}<MapResultList maps=\{report\.maps\}/);
  });
});

describe("détail map par map — focus et interblocages", () => {
  it("retirer une map rend le focus à la ligne suivante ou à « Ajouter une map »", () => {
    const list = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");
    expect(list).toContain("focusAfterRemove.current = index;");
    expect(list).toContain("id={`${idPrefix}-map-add`}");
    expect(list).toContain("id={`${idPrefix}-map-${index}-remove`}");
  });

  it("ajouter une map porte le focus sur le code de la nouvelle ligne", () => {
    const list = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");
    expect(list).toContain("focusNewRow.current = true;");
    expect(list).toMatch(/mapFieldId\(idPrefix, maps\.length - 1, "replayCode"\)/);
  });

  it("la modale de détail reste lisible si le détail disparaît, et rend le focus à la carte", () => {
    const details = readSource("app/(secured)/tournois/[id]/_components/MatchMapDetails.tsx");
    expect(details).toContain("if (!hasMaps && !open) return null;");
    expect(details).toContain("document.getElementById(matchAnchorId(match.id))?.focus()");
    expect(details).toMatch(/aria-label=\{`Détail des maps \(\$\{match\.maps\.length\}\) : \$\{team1\} contre \$\{team2\}`\}/);
  });

  it("en désaccord, l'engagé voit le détail adverse", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog).toMatch(/view\?\.phase === "CONFLICT" && view\.theirs[\s\S]{0,300}<MapResultList/);
  });

  it("une ligne vierge qu'on vient d'ajouter n'affiche pas de reproche", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog).toMatch(/const showBlocker = blocker !== null && \(unchangedMine \|\| touched\);/);
  });

  it("le forfait déclaré par une engagée est rejoué sur interblocage", () => {
    const index = readSource("lib/server/tournaments/index.ts");
    expect(index).toMatch(/await retryOnDeadlock\(\(\) =>\s*runPlayerMatchWrite\(tournamentId, matchId, \(connection\) =>\s*forfeitOwnMatch\(/);
  });
});

describe("détail map par map — champs vides", () => {
  it("quitter un score vide sans saisie ne lève pas son refus, et pas de 0 – 0 sans map", () => {
    const list = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");
    expect(list).toContain("if (Object.is(maps[index]?.[field], patch[field])) return;");
    expect(list).toMatch(/\{maps\.length > 0 && \(\s*<output className=\{styles\.summary\}>/);
  });
});

describe("détail map par map — arbitrage et relecture", () => {
  it("le refus d'une map passe avant « score incomplet », et le bouton reste actionnable pour le désigner", () => {
    const hook = readSource("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts");
    expect(hook.indexOf("if (sendMaps && refuseMaps(decisive)) return false;")).toBeLessThan(
      hook.indexOf("const blocker = action === \"save\" ? decision.saveBlocker : decision.resolveBlocker;"),
    );
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    expect(dialog).toContain("disabled={(!form.decision.canResolve && !form.mapsRefused.resolve) || form.submitting}");
  });

  it("la relecture du détail adverse se retente tant qu'il manque, au plus trois fois", () => {
    const hook = readSource("app/(secured)/tournois/[id]/_hooks/useProposalMaps.ts");
    expect(hook).toContain("const PROPOSAL_REFRESH_ATTEMPTS = 3;");
    expect(hook).toMatch(/if \(tries < PROPOSAL_REFRESH_ATTEMPTS\) timer = setTimeout\(attempt, PROPOSAL_REFRESH_DELAY_MS\);/);
    expect(hook).toContain("if (timer !== null) clearTimeout(timer);");
  });
});

describe("détail map par map — noms accessibles", () => {
  it("chaque champ nomme sa map, et la phrase d'erreur reste hors du label", () => {
    const list = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");
    expect(list.match(/<span className="sr-only">Map \{index \+ 1\}, /g)).toHaveLength(3);
    expect(list).not.toMatch(/<FieldErrorText[^>]*\/>\s*<\/label>/);
  });
});

describe("détail map par map — refus rattachés au champ", () => {
  it("le dialogue d'arbitrage rattache un refus de map à son champ", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    expect(dialog).toMatch(/onMapRefusal: \(field, message\) => mapFieldErrors\.flag\(mapFieldKey\(field\.index, field\.field\), message\)/);
    expect(dialog).toContain("fieldErrors={mapFieldErrors}");
  });

  it("le désaccord à score égal dit que ce sont les maps qui diffèrent", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog).toContain("mais le détail des maps diffère");
  });
});
