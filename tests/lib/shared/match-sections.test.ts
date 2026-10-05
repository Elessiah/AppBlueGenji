import { describe, expect, it } from "@jest/globals";
import {
  buildSeedMap,
  compareSectionMatches,
  matchSectionOf,
  MATCH_SECTION_ORDER,
  needsSectionClock,
  sectionCountLabel,
  sectionRoundMatches,
} from "@/lib/shared/match-sections";
import { bracketMatch } from "../../helpers/bracket-match";

const NOW = Date.parse("2026-10-05T20:00:00Z");
const PAST = "2026-10-05T19:00:00.000Z";
const FUTURE = "2026-10-05T21:00:00.000Z";
const LATER = "2026-10-05T22:00:00.000Z";

const ready = { status: "READY" as const, team1Id: 1, team2Id: 2 };

describe("matchSectionOf", () => {
  it("range un match terminé dans « Terminé »", () => {
    expect(matchSectionOf(bracketMatch({ ...ready, status: "COMPLETED" }), false, NOW)).toBe("DONE");
  });

  it("range un match lancé ou à confirmer dans « En cours »", () => {
    expect(matchSectionOf(bracketMatch({ ...ready, launchedAt: PAST }), false, NOW)).toBe("PLAYING");
    expect(
      matchSectionOf(bracketMatch({ ...ready, status: "AWAITING_CONFIRMATION" }), false, NOW),
    ).toBe("PLAYING");
  });

  it("range un match dont l'heure est venue dans « Lancement »", () => {
    expect(matchSectionOf(bracketMatch({ ...ready, startAt: PAST }), true, NOW)).toBe("LOBBY");
  });

  it("range un match sans date hors planification dans « Lancement »", () => {
    expect(matchSectionOf(bracketMatch(ready), false, NOW)).toBe("LOBBY");
  });

  it("range un match daté à venir dans « En attente de lancement »", () => {
    expect(matchSectionOf(bracketMatch({ ...ready, startAt: FUTURE }), false, NOW)).toBe("WAITING");
  });

  it("range un match sans date sous planification dans « À planifier »", () => {
    expect(matchSectionOf(bracketMatch(ready), true, NOW)).toBe("TO_PLAN");
  });

  it("garde en attente un match dont une engagée manque, même à son heure", () => {
    expect(matchSectionOf(bracketMatch({ team1Id: 1, startAt: PAST }), false, NOW)).toBe("WAITING");
    expect(matchSectionOf(bracketMatch({ team1Id: 1 }), false, NOW)).toBe("TO_PLAN");
  });

  it("bascule d'« En attente » à « Lancement » quand l'heure passe", () => {
    const match = bracketMatch({ ...ready, startAt: FUTURE });
    const start = Date.parse(FUTURE);
    expect(matchSectionOf(match, false, start - 1)).toBe("WAITING");
    expect(matchSectionOf(match, false, start)).toBe("LOBBY");
  });

  it("tient un match daté en attente avant le montage (horloge nulle)", () => {
    expect(matchSectionOf(bracketMatch({ ...ready, startAt: PAST }), false, null)).toBe("WAITING");
  });
});

describe("compareSectionMatches", () => {
  const seeds = { 1: 1, 2: 8, 3: 2, 4: 3, 5: 4 };

  it("trie par date croissante, sans date en dernier", () => {
    const later = bracketMatch({ id: 1, startAt: LATER });
    const sooner = bracketMatch({ id: 2, startAt: FUTURE });
    const none = bracketMatch({ id: 3 });
    const sorted = [none, later, sooner].sort((a, b) => compareSectionMatches(a, b, seeds));
    expect(sorted.map((m) => m.id)).toEqual([2, 1, 3]);
  });

  it("départage par meilleure tête de série, puis l'autre engagée, puis l'id", () => {
    const top = bracketMatch({ id: 9, team1Id: 2, team2Id: 1 }); // têtes 8 et 1
    const second = bracketMatch({ id: 8, team1Id: 3, team2Id: 4 }); // 2 et 3
    const third = bracketMatch({ id: 7, team1Id: 3, team2Id: 5 }); // 2 et 4
    const twin = bracketMatch({ id: 6, team1Id: 3, team2Id: 5 });
    const sorted = [third, second, twin, top].sort((a, b) => compareSectionMatches(a, b, seeds));
    expect(sorted.map((m) => m.id)).toEqual([9, 8, 6, 7]);
  });

  it("place une engagée sans tête de série après les autres", () => {
    const unseeded = bracketMatch({ id: 1, team1Id: 99, team2Id: null });
    const seeded = bracketMatch({ id: 2, team1Id: 2, team2Id: 99 });
    expect(compareSectionMatches(unseeded, seeded, seeds)).toBeGreaterThan(0);
  });

  it("traite une date illisible comme une absence de date", () => {
    const broken = bracketMatch({ id: 1, startAt: "pas une date" });
    const dated = bracketMatch({ id: 2, startAt: FUTURE });
    expect(compareSectionMatches(broken, dated, {})).toBeGreaterThan(0);
  });
});

describe("sectionRoundMatches", () => {
  it("rend les sections non vides dans l'ordre fixe, triées", () => {
    const matches = [
      bracketMatch({ id: 1, ...ready, status: "COMPLETED" }),
      bracketMatch({ id: 6, ...ready, startAt: LATER }),
      bracketMatch({ id: 2, ...ready, startAt: FUTURE }),
      bracketMatch({ id: 3, ...ready }),
      bracketMatch({ id: 4, ...ready, startAt: PAST }),
      bracketMatch({ id: 5, ...ready, launchedAt: PAST }),
    ];
    const sections = sectionRoundMatches(matches, { refereeScheduling: true, now: NOW, seeds: {} });
    expect(sections.map((s) => [s.key, s.label, s.matches.map((m) => m.id)])).toEqual([
      ["TO_PLAN", "À planifier", [3]],
      ["WAITING", "En attente de lancement", [2, 6]],
      ["LOBBY", "Lancement", [4]],
      ["PLAYING", "En cours", [5]],
      ["DONE", "Terminé", [1]],
    ]);
    expect(sections.map((s) => s.key)).toEqual(MATCH_SECTION_ORDER);
  });

  it("omet les sections vides, et ne rend rien sans match", () => {
    expect(sectionRoundMatches([], { refereeScheduling: false, now: NOW, seeds: {} })).toEqual([]);
    const only = sectionRoundMatches([bracketMatch({ ...ready, status: "COMPLETED" })], {
      refereeScheduling: false,
      now: NOW,
      seeds: {},
    });
    expect(only.map((s) => s.key)).toEqual(["DONE"]);
  });
});

describe("needsSectionClock", () => {
  it("ne fait tourner l'horloge que pour un match daté non lancé", () => {
    expect(needsSectionClock([bracketMatch({ ...ready, startAt: FUTURE })], false)).toBe(true);
    expect(
      needsSectionClock([bracketMatch({ ...ready, startAt: FUTURE, launchedAt: PAST })], false),
    ).toBe(false);
    expect(
      needsSectionClock([bracketMatch({ ...ready, status: "COMPLETED", startAt: FUTURE })], false),
    ).toBe(false);
    expect(needsSectionClock([bracketMatch(ready)], true)).toBe(false);
  });

  it("s'arrête une fois l'heure passée, ou si une engagée manque", () => {
    expect(needsSectionClock([bracketMatch({ ...ready, startAt: PAST })], false, NOW)).toBe(false);
    expect(needsSectionClock([bracketMatch({ ...ready, startAt: FUTURE })], false, NOW)).toBe(true);
    expect(needsSectionClock([bracketMatch({ team1Id: 1, startAt: FUTURE })], false, NOW)).toBe(false);
  });
});

describe("buildSeedMap et sectionCountLabel", () => {
  it("garde les têtes de série connues", () => {
    expect(buildSeedMap([{ teamId: 1, seed: 3 }, { teamId: 2, seed: null }])).toEqual({ 1: 3 });
  });

  it("accorde le nombre", () => {
    expect(sectionCountLabel(1)).toBe("1 match");
    expect(sectionCountLabel(4)).toBe("4 matchs");
  });
});
