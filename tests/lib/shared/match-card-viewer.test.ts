import { describe, expect, it } from "@jest/globals";
import {
  canReportOwnMatch,
  orderedScoreFields,
  scoreSubmittedMessage,
} from "@/lib/shared/match-card-viewer";

describe("canReportOwnMatch", () => {
  it("refuse quand le lecteur n'est pas engagé du tout", () => {
    expect(canReportOwnMatch(true, null, 10, 20)).toBe(false);
  });

  it("refuse quand le contexte général interdit déjà le signalement", () => {
    expect(canReportOwnMatch(false, 10, 10, 20)).toBe(false);
  });

  it("refuse sur une case encore vide (bye, TBD)", () => {
    expect(canReportOwnMatch(true, 10, null, 20)).toBe(false);
    expect(canReportOwnMatch(true, 10, 10, null)).toBe(false);
  });

  it("refuse un match qui n'est pas celui du lecteur", () => {
    // Le point de la fonction : engagé dans le tournoi ne veut pas dire engagé
    // dans CETTE rencontre — sans quoi les 127 autres cartes du plateau
    // porteraient toutes le bouton.
    expect(canReportOwnMatch(true, 30, 10, 20)).toBe(false);
  });

  it("accepte quand le lecteur est l'une des deux équipes de la carte", () => {
    expect(canReportOwnMatch(true, 10, 10, 20)).toBe(true);
    expect(canReportOwnMatch(true, 20, 10, 20)).toBe(true);
  });
});

describe("orderedScoreFields", () => {
  it("place le champ de l'équipe 1 en premier, celui de l'équipe 2 en second", () => {
    // Quelle que soit la place du lecteur : l'ordre suit la carte, pas « Moi »
    // en premier par défaut.
    const asTeam1 = orderedScoreFields(true, "3", "1", "Les Foudres", "Team Nova");
    expect(asTeam1).toEqual([
      { key: "myScore", value: "3", label: "Les Foudres" },
      { key: "opponentScore", value: "1", label: "Team Nova" },
    ]);

    const asTeam2 = orderedScoreFields(false, "3", "1", "Les Foudres", "Team Nova");
    expect(asTeam2).toEqual([
      { key: "opponentScore", value: "1", label: "Les Foudres" },
      { key: "myScore", value: "3", label: "Team Nova" },
    ]);
  });

  it("garde toujours deux champs, sous les deux clés de soumission", () => {
    for (const myTeamIsTeam1 of [true, false]) {
      const fields = orderedScoreFields(myTeamIsTeam1, "0", "0", "A", "B");
      expect(fields.map((f) => f.key).sort()).toEqual(["myScore", "opponentScore"]);
    }
  });
});

describe("scoreSubmittedMessage", () => {
  it("nomme les deux équipes dans l'ordre de la carte, jamais l'identifiant du match", () => {
    // Reproduit l'exemple noté dans ERREUR.txt : « Score transmis : A 2 – 1 B ».
    expect(scoreSubmittedMessage(true, 2, 1, "A", "B")).toBe("Score transmis : A 2 – 1 B");
  });

  it("replace les scores dans l'ordre de la carte quand le lecteur est l'équipe 2", () => {
    // Le lecteur a saisi « 2 » pour lui (équipe 2) et « 1 » pour l'adversaire
    // (équipe 1) : le message doit annoncer équipe 1 = 1, équipe 2 = 2.
    expect(scoreSubmittedMessage(false, 2, 1, "A", "B")).toBe("Score transmis : A 1 – 2 B");
  });
});
