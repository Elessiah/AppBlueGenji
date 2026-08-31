import { describe, expect, it } from "@jest/globals";

/**
 * Le harnais Jest tourne en environnement `node`, sans DOM ni bibliothèque de
 * rendu : un hook React n'y est pas montable. Ce qui compte se teste donc là où
 * il vit — dans les fonctions pures que le hook se contente de composer,
 * `resolveMatchLiveState` et `nextMatchLiveChangeAt`
 * (`tests/lib/shared/live-streams.test.ts`). Il reste à garantir que le module
 * s'importe : c'est un fichier `"use client"` qui tire React, et une erreur de
 * chemin y passerait autrement inaperçue jusqu'au build.
 */
describe("useMatchLiveState", () => {
  it("s'importe et expose un hook", () => {
    const module = require("@/lib/shared/hooks/useMatchLiveState");
    expect(typeof module.useMatchLiveState).toBe("function");
  });

  it("prend le match en unique argument", () => {
    const { useMatchLiveState } = require("@/lib/shared/hooks/useMatchLiveState");
    expect(useMatchLiveState.length).toBe(1);
  });
});
