import { describe, expect, it } from "@jest/globals";
import { memberPathForSpectatorPath } from "@/lib/shared/spectator-member-path";

describe("memberPathForSpectatorPath", () => {
  it("mène à la page du match de l'espace connecté pour une page de match", () => {
    expect(memberPathForSpectatorPath("/suivre/tournois/12/matchs/34", 12)).toBe("/tournois/12/matchs/34");
  });

  it("mène à la fiche du tournoi pour la fiche sans compte", () => {
    expect(memberPathForSpectatorPath("/suivre/tournois/12", 12)).toBe("/tournois/12");
  });

  it("mène à la fiche du tournoi quand le chemin est inconnu (mise en page préchargée)", () => {
    expect(memberPathForSpectatorPath(null, 12)).toBe("/tournois/12");
    expect(memberPathForSpectatorPath(undefined, 12)).toBe("/tournois/12");
  });

  it("ne mène jamais à la page d'un match d'un autre tournoi", () => {
    expect(memberPathForSpectatorPath("/suivre/tournois/99/matchs/34", 12)).toBe("/tournois/12");
  });
});
