import { describe, expect, it } from "@jest/globals";
import { randomDrawHintKey, seedingLockKey } from "@/app/(secured)/tournois/[id]/_lib/registrations-list";

/* Textes du tirage au sort dans la liste des inscrites (`RANDOM_SEEDING.md`). */

describe("randomDrawHintKey", () => {
  it("explique le tirage à venir ou fait", () => {
    expect(randomDrawHintKey("PENDING", 3)).toBe("registrations.randomPending");
    expect(randomDrawHintKey("DRAWN", 3)).toBe("registrations.randomDrawn");
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
