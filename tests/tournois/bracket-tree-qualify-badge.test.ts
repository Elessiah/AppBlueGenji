import { describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import frTournament from "@/messages/fr/tournament.json";
import enTournament from "@/messages/en/tournament.json";

jest.mock("@/components/cyber", () => ({ ScrollArea: () => null }));
jest.mock("@/components/i18n/tournament-page-text", () => ({ useTournamentPageText: () => ({ t: (key: string) => key }) }));

import { ARRIVAL_HALO_MS, qualifyBadgeLabelKey } from "@/app/(secured)/tournois/[id]/_components/BracketTree";

/**
 * Badge « Qualifié en X » de l'arbre : il peut mener à une case **à pourvoir**
 * (identifiant négatif), sans match posé. Son nom accessible le dit, et la case
 * atteinte porte un halo un court instant — sans quoi, parmi des cartes vides
 * identiques, le geste paraissait sans effet. Le harnais Jest tourne sans DOM :
 * le halo se tient par ses points de passage.
 */
const TREE = readFileSync(join(__dirname, "..", "..", "app", "(secured)", "tournois", "[id]", "_components", "BracketTree.tsx"), "utf8");

describe("qualifyBadgeLabelKey", () => {
  it("qualifyBadgeLabelKey_slotToFill_namesSlotNotMatch", () => {
    expect(qualifyBadgeLabelKey(-3)).toBe("bracket.goToSlotLabel");
  });

  it("qualifyBadgeLabelKey_placedMatch_namesNextMatch", () => {
    expect(qualifyBadgeLabelKey(42)).toBe("bracket.goToMatchLabel");
  });

  it("le badge lit son nom accessible par cette règle", () => {
    expect(TREE).toContain("aria-label={t(qualifyBadgeLabelKey(dest), { label: qualifyLabel ?? \"\" })}");
  });

  it("la clé de la case à pourvoir existe en français et en anglais", () => {
    expect(frTournament.bracket.goToSlotLabel).toBe("{label} — aller à la case d'arrivée, pas encore pourvue");
    expect(enTournament.bracket.goToSlotLabel).toBe("{label} — go to the next slot, not filled yet");
  });
});

describe("halo d'arrivée", () => {
  it("la case atteinte par un défilement à la demande porte le halo, retiré après ARRIVAL_HALO_MS", () => {
    expect(ARRIVAL_HALO_MS).toBeGreaterThan(0);
    expect(TREE).toContain("setArrivedId(scrollRequest.matchId);");
    expect(TREE).toContain("window.setTimeout(() => setArrivedId(null), ARRIVAL_HALO_MS)");
    expect(TREE).toContain("window.clearTimeout(timer);");
  });

  it("pas de halo quand la cible n'est pas rendue dans cette section", () => {
    expect(TREE).toMatch(/const cancelScroll = scrollToMatch\(scrollRequest\.matchId\);\s+if \(!cancelScroll\) return;\s+setArrivedId/);
  });

  it("le halo est un contour, distinct de la marque « ★ Votre match »", () => {
    expect(TREE).toContain("...(arrived ? { outline: `2px solid ${accentColor}`, outlineOffset: 3 } : {}),");
  });
});
