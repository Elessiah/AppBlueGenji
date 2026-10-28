import { describe, expect, it } from "@jest/globals";
import { fieldsToSlots, slotsToFields } from "@/app/(secured)/tournois/[id]/_components/RoundMapsDialog";
import { formatMapRulesLog, formatRoundMapsLog } from "@/lib/shared/bot-logs";

/** Saisie de la fenêtre « Cartes et bans » et journal du staff (`docs/features/ROUND_MAPS.md`). */

describe("fieldsToSlots / slotsToFields", () => {
  it("un champ par carte, pool séparé par des virgules, champs vides écartés", () => {
    expect(fieldsToSlots(["Ilios", " Busan , Nepal ,", "", " , "])).toEqual([["Ilios"], ["Busan", "Nepal"]]);
  });

  it("une manche sans réglage ouvre un champ vide", () => {
    expect(slotsToFields([])).toEqual([""]);
    expect(slotsToFields([["Ilios"], ["Busan", "Nepal"]])).toEqual(["Ilios", "Busan, Nepal"]);
  });
});

describe("journal des cartes de manche", () => {
  const tournament = { id: 7, name: "Coupe" };

  it("compte cartes imposées et pools, staff anonyme", () => {
    const log = formatRoundMapsLog({ tournament, roundLabel: "Round 2", slots: 3, imposed: 2 });
    expect(log).toContain("Round 2 — 3 cartes (2 imposées, 1 pool), par le staff.");
  });

  it("un seul créneau, accords au singulier", () => {
    expect(formatRoundMapsLog({ tournament, roundLabel: "Round 1", slots: 1, imposed: 1 })).toContain(
      "1 carte (1 imposée, 0 pool)",
    );
  });

  it("zéro créneau : réglage retiré", () => {
    expect(formatRoundMapsLog({ tournament, roundLabel: "Round 1", slots: 0, imposed: 0 })).toContain(
      "Cartes de manche retirées",
    );
  });

  it("règles de ban modifiées, sans nommer personne", () => {
    expect(formatMapRulesLog({ tournament })).toContain("Règles de ban modifiées");
    expect(formatMapRulesLog({ tournament })).toContain("par le staff");
  });
});
