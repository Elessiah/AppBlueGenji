import { describe, expect, it } from "@jest/globals";
import { messagesFor } from "@/lib/server/i18n-messages";
import type { GetiChip } from "@/lib/shared/geti/page";
import { getiChipLabel, getiDataText, getiRankLabel } from "@/lib/shared/geti/page-text";
import { getiRank } from "@/tests/helpers/geti";

const FR = getiDataText(messagesFor("fr").geti);
const EN = getiDataText(messagesFor("en").geti);
const D3 = getiRank("DIAMOND", 3);
const M2 = getiRank("MASTER", 2);

describe("getiDataText", () => {
  it("ne garde que les libellés de données", () => {
    expect(Object.keys(FR).sort((a, b) => a.localeCompare(b))).toEqual([
      "chips", "days", "languages", "levels", "platforms", "regions", "roles", "staffRoles", "subRoles", "tiers",
    ]);
  });
});

describe("getiRankLabel", () => {
  it("un rang se lit avec le nom officiel français du palier", () => {
    expect(getiRankLabel(M2, FR, "fr")).toBe("Maîtrise 2");
  });

  it("un rang se lit en anglais sur une page anglaise", () => {
    expect(getiRankLabel(getiRank("GRANDMASTER", 5), EN, "en")).toBe("Grandmaster 5");
  });
});

describe("getiChipLabel", () => {
  it("un rang unique s'écrit sans fourchette", () => {
    const chip: GetiChip = { kind: "rank", role: null, min: D3, max: D3 };

    expect(getiChipLabel(chip, FR, "fr")).toBe("Diamant 3");
  });

  it("une fourchette donne ses deux bornes", () => {
    const chip: GetiChip = { kind: "rank", role: null, min: D3, max: M2 };

    expect(getiChipLabel(chip, FR, "fr")).toBe("Diamant 3 – Maîtrise 2");
  });

  it("un rang par rôle est précédé du rôle", () => {
    const chip: GetiChip = { kind: "rank", role: "TANK", min: D3, max: D3 };

    expect(getiChipLabel(chip, EN, "en")).toBe("Tank: Diamond 3");
  });

  it("chaque donnée à liste prend son libellé", () => {
    expect(getiChipLabel({ kind: "role", value: "SUPPORT" }, FR, "fr")).toBe("Support");
    expect(getiChipLabel({ kind: "subRole", value: "HITSCAN" }, FR, "fr")).toBe("Hitscan");
    expect(getiChipLabel({ kind: "staffRole", value: "ANALYST" }, FR, "fr")).toBe("Analyste");
    expect(getiChipLabel({ kind: "level", value: "ADVANCED" }, FR, "fr")).toBe("Avancé");
    expect(getiChipLabel({ kind: "region", value: "NA" }, EN, "en")).toBe("North America");
    expect(getiChipLabel({ kind: "platform", value: "CONSOLE" }, FR, "fr")).toBe("Console");
    expect(getiChipLabel({ kind: "language", value: "DE" }, FR, "fr")).toBe("Allemand");
    expect(getiChipLabel({ kind: "day", value: "WED" }, EN, "en")).toBe("Wednesday");
  });

  it("un créneau donne ses deux heures", () => {
    const chip: GetiChip = { kind: "time", from: 1260, to: 1380, timezone: null };

    expect(getiChipLabel(chip, FR, "fr")).toBe("21h – 23h");
  });

  it("une heure seule se lit « dès »", () => {
    const chip: GetiChip = { kind: "time", from: 1230, to: null, timezone: null };

    expect(getiChipLabel(chip, FR, "fr")).toBe("dès 20h30");
  });

  it("le fuseau écrit dans l'annonce suit l'horaire", () => {
    const chip: GetiChip = { kind: "time", from: 1260, to: 1380, timezone: "CET" };

    expect(getiChipLabel(chip, EN, "en")).toBe("21:00 – 23:00 (CET)");
    expect(getiChipLabel(chip, FR, "fr")).toBe("21h – 23h (CET)");
  });

  it("une date se lit dans la langue de la page", () => {
    const chip: GetiChip = { kind: "date", iso: "2026-11-26" };

    expect(getiChipLabel(chip, FR, "fr")).toBe("jeu. 26 nov.");
    expect(getiChipLabel(chip, EN, "en")).toBe("Thu, Nov 26");
  });

  it("une date illisible reste telle quelle", () => {
    expect(getiChipLabel({ kind: "date", iso: "bientôt" }, FR, "fr")).toBe("bientôt");
  });

  it("l'équipe et l'âge minimal sont rédigés", () => {
    expect(getiChipLabel({ kind: "team", name: "Team Test" }, FR, "fr")).toBe("Équipe : Team Test");
    expect(getiChipLabel({ kind: "minAge", age: 18 }, EN, "en")).toBe("18+ years old");
  });
});
