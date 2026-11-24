import { describe, expect, it } from "@jest/globals";
import { randomDrawHintKey, seedingLockKey } from "@/app/(secured)/tournois/[id]/_lib/registrations-list";
import { preLaunchRandomKey } from "@/app/(secured)/tournois/[id]/_lib/random-draw-text";
import frPage from "@/messages/fr/tournament.json";
import enPage from "@/messages/en/tournament.json";

/* Textes du tirage au sort dans la liste des inscrites (`RANDOM_SEEDING.md`). */

describe("randomDrawHintKey", () => {
  it("explique le tirage à venir ou fait", () => {
    expect(randomDrawHintKey("PENDING", 3)).toBe("registrations.randomPending");
    expect(randomDrawHintKey("DRAWN", 3)).toBe("registrations.randomDrawn");
  });

  it("se tait une fois le tournoi lancé : le verrou dit déjà pourquoi l'ordre est figé", () => {
    expect(randomDrawHintKey("DRAWN", 3, "STARTED")).toBeNull();
    expect(randomDrawHintKey("DRAWN", 3, "SCORES_ENTERED")).toBeNull();
    expect(randomDrawHintKey("DRAWN", 3, "FINISHED")).toBeNull();
    expect(randomDrawHintKey("DRAWN", 3, "RANDOM_DRAW")).toBe("registrations.randomDrawn");
  });

  it("ne dit rien option éteinte ou liste vide", () => {
    expect(randomDrawHintKey("OFF", 3)).toBeNull();
    expect(randomDrawHintKey("PENDING", 0)).toBeNull();
    expect(randomDrawHintKey("DRAWN", 0)).toBeNull();
  });
});

describe("seedingLockKey", () => {
  it("dit « à la clôture » avant le tirage et « tiré » après", () => {
    expect(seedingLockKey("RANDOM_DRAW", "PENDING")).toBe("registrations.lock.RANDOM_DRAW");
    expect(seedingLockKey("RANDOM_DRAW", "DRAWN")).toBe("registrations.lock.RANDOM_DRAWN");
  });

  it("garde la phrase des autres verrous, tirage fait ou non", () => {
    expect(seedingLockKey("STARTED", "DRAWN")).toBe("registrations.lock.STARTED");
    expect(seedingLockKey("FINISHED", "OFF")).toBe("registrations.lock.FINISHED");
    expect(seedingLockKey("SCORES_ENTERED", "PENDING")).toBe("registrations.lock.SCORES_ENTERED");
  });
});

describe("preLaunchRandomKey", () => {
  it("dit le tirage à venir, puis le tirage fait", () => {
    expect(preLaunchRandomKey("RANDOM", "PENDING")).toBe("page.preLaunch.random");
    expect(preLaunchRandomKey("RANDOM", "DRAWN")).toBe("page.preLaunch.randomDrawn");
  });

  it("laisse le texte du format hors tirage au sort", () => {
    expect(preLaunchRandomKey("REGISTRATION", "OFF")).toBeNull();
    expect(preLaunchRandomKey("RANKING", "OFF")).toBeNull();
  });

  it("a ses deux textes en français et en anglais", () => {
    for (const page of [frPage.page, enPage.page]) {
      expect(page.preLaunch.random.length).toBeGreaterThan(0);
      expect(page.preLaunch.randomDrawn.length).toBeGreaterThan(0);
    }
  });
});
