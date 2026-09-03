import { describe, expect, it } from "@jest/globals";
import {
  batchCapacity,
  batchCounterLabel,
  GHOST_BATCH_MAX,
  guestBatchSuccessMessage,
  matchesTeamSearch,
  parseGhostBatch,
  registrationErrorTeamId,
  remainingSlots,
} from "@/lib/shared/ghost-registration";
import { PARTICIPANT_WORDING } from "@/lib/shared/participants";

describe("parseGhostBatch", () => {
  it("accepte une liste d'identifiants entiers positifs", () => {
    expect(parseGhostBatch([3, 7, 12])).toEqual({ ok: true, teamIds: [3, 7, 12] });
  });

  it("conserve l'ordre de la sélection", () => {
    expect(parseGhostBatch([12, 3, 7])).toEqual({ ok: true, teamIds: [12, 3, 7] });
  });

  it("écarte les doublons en silence, à leur première apparition", () => {
    // Deux fois le même identifiant dit la même intention : refuser tout le lot
    // pour une maladresse du client serait disproportionné.
    expect(parseGhostBatch([3, 7, 3, 7, 3])).toEqual({ ok: true, teamIds: [3, 7] });
  });

  it("refuse un lot vide", () => {
    expect(parseGhostBatch([])).toEqual({ ok: false, error: "EMPTY_TEAM_SELECTION" });
  });

  it.each([
    [undefined],
    [null],
    [42],
    ["3,7"],
    [{ teamIds: [3] }],
  ])("refuse un corps qui n'est pas une liste (%p)", (raw) => {
    expect(parseGhostBatch(raw)).toEqual({ ok: false, error: "INVALID_TEAM_IDS" });
  });

  it.each([
    [["3"]],
    [[3, "7"]],
    [[3, null]],
    [[3, 0]],
    [[3, -1]],
    [[3, 1.5]],
    [[3, Number.NaN]],
    [[3, Number.POSITIVE_INFINITY]],
  ])("refuse une valeur qui n'est pas un identifiant (%p)", (raw) => {
    expect(parseGhostBatch(raw)).toEqual({ ok: false, error: "INVALID_TEAM_IDS" });
  });

  it("accepte exactement le plafond de forme", () => {
    const teamIds = Array.from({ length: GHOST_BATCH_MAX }, (_, index) => index + 1);
    expect(parseGhostBatch(teamIds)).toEqual({ ok: true, teamIds });
  });

  it("refuse un lot au-delà du plafond de forme", () => {
    const teamIds = Array.from({ length: GHOST_BATCH_MAX + 1 }, (_, index) => index + 1);
    expect(parseGhostBatch(teamIds)).toEqual({ ok: false, error: "TOO_MANY_TEAMS" });
  });

  it("plafonne ce qui est envoyé, pas ce qu'il en reste", () => {
    // Un corps trop long est refusé sans être parcouru : compter d'abord et
    // plafonner ensuite laissait 100 000 entiers occuper la boucle d'évènements
    // avant le refus. Une liste de mille identifiants n'est de toute façon pas
    // une sélection valable, dût-elle se réduire à un seul.
    const teamIds = Array.from({ length: GHOST_BATCH_MAX + 10 }, () => 4);
    expect(parseGhostBatch(teamIds)).toEqual({ ok: false, error: "TOO_MANY_TEAMS" });
  });

  it("refuse un corps démesuré sans le parcourir", () => {
    const huge = Array.from({ length: 100_000 }, (_, index) => index + 1);
    const started = Date.now();
    expect(parseGhostBatch(huge)).toEqual({ ok: false, error: "TOO_MANY_TEAMS" });
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe("remainingSlots", () => {
  it("rend les places encore libres", () => {
    expect(remainingSlots(16, 5)).toBe(11);
  });

  it("rend zéro sur un tournoi complet", () => {
    expect(remainingSlots(16, 16)).toBe(0);
  });

  it("ne descend jamais sous zéro", () => {
    // L'effectif maximal peut être réduit après coup : « -3 places restantes »
    // n'a aucun sens à l'écran.
    expect(remainingSlots(8, 12)).toBe(0);
  });
});

describe("batchCapacity", () => {
  it("s'arrête aux places libres quand elles manquent", () => {
    expect(batchCapacity(5)).toBe(5);
  });

  it("s'arrête au plafond de forme quand les places abondent", () => {
    expect(batchCapacity(200)).toBe(GHOST_BATCH_MAX);
  });

  it("vaut zéro sur un tournoi complet", () => {
    expect(batchCapacity(0)).toBe(0);
  });
});

describe("batchCounterLabel", () => {
  it("compte en places quand c'est le tournoi qui borne", () => {
    expect(batchCounterLabel(3, 14)).toBe("3 / 14 places");
  });

  it("accorde le singulier sur une seule place", () => {
    expect(batchCounterLabel(0, 1)).toBe("0 / 1 place");
  });

  it("dit « par lot » quand c'est la requête qui borne", () => {
    // « 3 / 32 places » devant un tournoi qui en a cent de libres ferait croire
    // le plateau presque plein.
    expect(batchCounterLabel(3, 100)).toBe(`3 / ${GHOST_BATCH_MAX} par lot`);
  });

  it("bascule pile au plafond", () => {
    expect(batchCounterLabel(0, GHOST_BATCH_MAX)).toBe(`0 / ${GHOST_BATCH_MAX} places`);
    expect(batchCounterLabel(0, GHOST_BATCH_MAX + 1)).toBe(`0 / ${GHOST_BATCH_MAX} par lot`);
  });
});

describe("matchesTeamSearch", () => {
  it("laisse tout passer sur une recherche vide", () => {
    expect(matchesTeamSearch("Les Fantômes", "")).toBe(true);
    expect(matchesTeamSearch("Les Fantômes", "   ")).toBe(true);
  });

  it("ignore la casse", () => {
    expect(matchesTeamSearch("Les Fantômes", "LES")).toBe(true);
  });

  it("ignore les accents, dans les deux sens", () => {
    expect(matchesTeamSearch("Équipe Alpha", "equipe")).toBe(true);
    expect(matchesTeamSearch("Equipe Alpha", "équipe")).toBe(true);
  });

  it("cherche n'importe où dans le nom", () => {
    expect(matchesTeamSearch("Test_Remplissage 042", "042")).toBe(true);
  });

  it("refuse ce qui ne correspond pas", () => {
    expect(matchesTeamSearch("Les Fantômes", "alpha")).toBe(false);
  });
});

describe("guestBatchSuccessMessage", () => {
  it("reste au singulier pour une seule inscription", () => {
    expect(guestBatchSuccessMessage(1, PARTICIPANT_WORDING.TEAM)).toBe("Équipe fantôme inscrite.");
    expect(guestBatchSuccessMessage(1, PARTICIPANT_WORDING.SOLO)).toBe("Joueur invité inscrit.");
  });

  it("compte et accorde au pluriel, selon le type de participant", () => {
    expect(guestBatchSuccessMessage(7, PARTICIPANT_WORDING.TEAM)).toBe(
      "7 équipes fantômes inscrites.",
    );
    expect(guestBatchSuccessMessage(7, PARTICIPANT_WORDING.SOLO)).toBe(
      "7 joueurs invités inscrits.",
    );
  });
});

describe("registrationErrorTeamId", () => {
  it("lit l'engagé nommé par un refus du moteur", () => {
    expect(registrationErrorTeamId(Object.assign(new Error("ALREADY_REGISTERED"), { teamId: 7 })))
      .toBe(7);
  });

  it("rend undefined quand le refus ne nomme personne", () => {
    expect(registrationErrorTeamId(new Error("TOURNAMENT_FULL"))).toBeUndefined();
    expect(registrationErrorTeamId(null)).toBeUndefined();
    expect(registrationErrorTeamId(undefined)).toBeUndefined();
  });

  it.each([["7"], [0], [-1], [1.5]])("ignore un teamId douteux (%p)", (teamId) => {
    expect(registrationErrorTeamId(Object.assign(new Error("X"), { teamId }))).toBeUndefined();
  });
});
