import { describe, expect, it } from "@jest/globals";
import {
  canReportOwnMatch,
  isMyTeamTeam1,
  scoreSubmittedMessage,
  teamLabel,
} from "@/lib/shared/match-card-viewer";

describe("isMyTeamTeam1", () => {
  it("dit vrai quand le lecteur est l'équipe 1", () => {
    expect(isMyTeamTeam1(10, 10)).toBe(true);
  });

  it("dit faux quand le lecteur est l'équipe 2, ou n'est engagé nulle part", () => {
    expect(isMyTeamTeam1(20, 10)).toBe(false);
    expect(isMyTeamTeam1(null, 10)).toBe(false);
  });

  it("ne confond jamais deux absences pour une correspondance", () => {
    // Un lecteur non engagé (`null`) sur une case encore vide (`team1Id`
    // aussi `null`) ne doit jamais se lire comme « je suis l'équipe 1 ».
    expect(isMyTeamTeam1(null, null)).toBe(false);
  });
});

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

describe("teamLabel", () => {
  it("préfère le nom saisi", () => {
    expect(teamLabel("Les Foudres", "Vainqueur QF1", "TBD")).toBe("Les Foudres");
  });

  it("retombe sur l'emplacement réservé si aucun nom n'est encore connu", () => {
    expect(teamLabel(null, "Vainqueur QF1", "TBD")).toBe("Vainqueur QF1");
  });

  it("retombe sur le repli de l'appelant en dernier recours", () => {
    expect(teamLabel(null, null, "TBD")).toBe("TBD");
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
