import { describe, expect, it } from "@jest/globals";
import { generateSeedOrder, nextPowerOfTwo, seedSlots } from "@/lib/shared/bracket-seeds";
import * as serialization from "@/lib/server/serialization";

describe("seedSlots", () => {
  it("place chaque tête de série à sa position de plateau", () => {
    const entrants = ["A", "B", "C", "D"];

    // generateSeedOrder(4) = [1, 4, 2, 3] : A ouvre contre D, B contre C.
    expect(seedSlots(entrants, 4)).toEqual(["A", "D", "B", "C"]);
  });

  it("laisse vides les emplacements sans engagé", () => {
    expect(seedSlots(["A", "B", "C"], 4)).toEqual(["A", null, "B", "C"]);
    expect(seedSlots(["A", "B"], 8)).toEqual(["A", null, null, null, "B", null, null, null]);
  });

  it("ignore les engagés au-delà de la taille du plateau", () => {
    // Sécurité : un plateau trop petit ne doit pas déborder silencieusement.
    expect(seedSlots(["A", "B", "C"], 2)).toEqual(["A", "B"]);
  });

  it("respecte l'ordre du moteur pour toute taille de plateau", () => {
    for (const size of [2, 4, 8, 16, 32]) {
      const entrants = Array.from({ length: size }, (_, index) => index + 1);
      const slots = seedSlots(entrants, size);

      expect(slots).toEqual(generateSeedOrder(size));
    }
  });

  it("ne renvoie que des emplacements vides sans engagé", () => {
    expect(seedSlots([], 4)).toEqual([null, null, null, null]);
  });
});

describe("réexport serveur", () => {
  it("expose la même implémentation que `lib/server/serialization`", () => {
    // Les brackets du moteur passent par la réexportation : un aperçu qui
    // divergerait de cette implémentation mentirait sur le tirage réel.
    expect(serialization.generateSeedOrder).toBe(generateSeedOrder);
    expect(serialization.nextPowerOfTwo).toBe(nextPowerOfTwo);
  });
});
