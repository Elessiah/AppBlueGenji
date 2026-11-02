import { describe, expect, it } from "@jest/globals";
import { readSource } from "../helpers/read-source";

/**
 * Câblage de la fenêtre « Arbitrage » (EF-31) : chargée à l'ouverture seulement,
 * et chaque désignation dit quel arbitre elle croit remplacer — le serveur
 * refuse (`REFEREE_CHANGED`) si un autre membre du staff a changé entre-temps.
 */
describe("fenêtre « Arbitrage »", () => {
  it("MatchCardActions_refereeDialog_loadedLazily", () => {
    const actions = readSource("app/(secured)/tournois/[id]/_components/MatchCardActions.tsx");

    expect(actions).toContain('const RefereeDialog = dynamic(() => orReload(import("./RefereeDialog")');
    expect(actions).not.toMatch(/^import \{ RefereeDialog \}/m);
  });

  it("RefereeDialog_assignAndRemove_sendExpectedReferee", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/RefereeDialog.tsx");

    expect(dialog).toContain('{ userId: Number(pick), expectedUserId: panel?.referee?.userId ?? null }');
    expect(dialog).toContain('{ userId: null, expectedUserId: panel?.referee?.userId ?? null }');
  });

  it("RefereeDialog_refereeChanged_reloadsThePanel", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/RefereeDialog.tsx");

    expect(dialog).toContain('if (code === "REFEREE_CHANGED") await load(false);');
  });
});
