import { describe, expect, it } from "@jest/globals";

import {
  LAUNCH_BACKDATE_MS,
  advanceSuccessMessage,
  advanceTarget,
  canLaunchNow,
  launchBlockReason,
  shortenScheduleForAdvance,
  shortenScheduleForLaunch,
  willCloseWithoutMatches,
  type AdvanceTarget,
  type LaunchableTournament,
} from "@/lib/shared/tournament-launch";
import { MIN_ENTRANTS_FOR_MATCHES } from "@/lib/shared/constants";
import { computeTournamentState } from "@/lib/shared/tournament-state";
import { computeTournamentProgress } from "@/lib/shared/tournament-progress";
import type { TournamentState } from "@/lib/shared/types";

type DateField = "startVisibilityAt" | "registrationOpenAt" | "registrationCloseAt" | "startAt";

const NOW = Date.parse("2026-03-10T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

/**
 * Les quatre positions d'avant-course, décrites par leurs jalons relatifs à
 * `NOW`. Elles servent de table à presque tous les cas : la règle doit se
 * comporter de la même façon quel que soit le point de départ.
 */
const STAGES: Record<string, LaunchableTournament> = {
  // Rien n'est encore visible : les quatre jalons sont à venir.
  HIDDEN: {
    state: "UPCOMING",
    startVisibilityAt: iso(DAY),
    registrationOpenAt: iso(2 * DAY),
    registrationCloseAt: iso(3 * DAY),
    startAt: iso(4 * DAY),
  },
  // Publié, inscriptions pas encore ouvertes.
  ANNOUNCED: {
    state: "UPCOMING",
    startVisibilityAt: iso(-DAY),
    registrationOpenAt: iso(DAY),
    registrationCloseAt: iso(2 * DAY),
    startAt: iso(3 * DAY),
  },
  // Inscriptions ouvertes.
  REGISTRATION: {
    state: "REGISTRATION",
    startVisibilityAt: iso(-2 * DAY),
    registrationOpenAt: iso(-DAY),
    registrationCloseAt: iso(DAY),
    startAt: iso(2 * DAY),
  },
  // Inscriptions closes, coup d'envoi à venir — l'entre-deux `UPCOMING`.
  LOCKED: {
    state: "UPCOMING",
    startVisibilityAt: iso(-3 * DAY),
    registrationOpenAt: iso(-2 * DAY),
    registrationCloseAt: iso(-DAY),
    startAt: iso(DAY),
  },
};

const STAGE_NAMES = Object.keys(STAGES);

/** État calculé d'un tournoi dont les jalons viennent d'être abrégés. */
function stateAfterLaunch(tournament: LaunchableTournament): TournamentState {
  return computeTournamentState(
    { state: tournament.state, ...shortenScheduleForLaunch(tournament, NOW) },
    NOW,
  );
}

describe("launchBlockReason", () => {
  it.each(STAGE_NAMES)("laisse abréger depuis l'étape %s", (name) => {
    expect(launchBlockReason(STAGES[name], NOW)).toBeNull();
    expect(canLaunchNow(STAGES[name], NOW)).toBe(true);
  });

  it("refuse un tournoi dont le coup d'envoi est passé", () => {
    const started: LaunchableTournament = {
      state: "REGISTRATION",
      startVisibilityAt: iso(-3 * DAY),
      registrationOpenAt: iso(-2 * DAY),
      registrationCloseAt: iso(-DAY),
      startAt: iso(-HOUR),
    };

    // L'état *stocké* dit encore « inscriptions » : c'est le calculé qui tranche,
    // la synchronisation n'ayant simplement pas encore eu lieu.
    expect(launchBlockReason(started, NOW)).toBe("TOURNAMENT_ALREADY_STARTED");
  });

  it("refuse un tournoi terminé", () => {
    expect(launchBlockReason({ ...STAGES.REGISTRATION, state: "FINISHED" }, NOW)).toBe(
      "TOURNAMENT_ALREADY_FINISHED",
    );
  });

  it.each<[DateField]>([
    ["startVisibilityAt"],
    ["registrationOpenAt"],
    ["registrationCloseAt"],
    ["startAt"],
  ])("refuse un tournoi dont %s est illisible", (field) => {
    // Sans ce refus, `NaN` rendrait toutes les comparaisons fausses et le
    // tournoi passerait chaque contrôle sans qu'aucun n'ait rien vérifié.
    expect(launchBlockReason({ ...STAGES.REGISTRATION, [field]: "pas une date" }, NOW)).toBe(
      "INVALID_DATES",
    );
  });
});

describe("shortenScheduleForLaunch", () => {
  it.each(STAGE_NAMES)("rend le tournoi « en cours » à l'instant même — depuis %s", (name) => {
    expect(stateAfterLaunch(STAGES[name])).toBe("RUNNING");
  });

  it.each(STAGE_NAMES)("garde les quatre jalons dans l'ordre — depuis %s", (name) => {
    const s = shortenScheduleForLaunch(STAGES[name], NOW);

    expect(Date.parse(s.startVisibilityAt)).toBeLessThanOrEqual(Date.parse(s.registrationOpenAt));
    expect(Date.parse(s.registrationOpenAt)).toBeLessThanOrEqual(
      Date.parse(s.registrationCloseAt),
    );
    expect(Date.parse(s.registrationCloseAt)).toBeLessThanOrEqual(Date.parse(s.startAt));
  });

  it.each(STAGE_NAMES)("ne fait jamais avancer une date — depuis %s", (name) => {
    const before = STAGES[name];
    const after = shortenScheduleForLaunch(before, NOW);

    for (const field of [
      "startVisibilityAt",
      "registrationOpenAt",
      "registrationCloseAt",
      "startAt",
    ] as const) {
      expect(Date.parse(after[field])).toBeLessThanOrEqual(Date.parse(before[field]));
    }
  });

  it("ne rouvre pas rétroactivement des inscriptions déjà closes", () => {
    const after = shortenScheduleForLaunch(STAGES.LOCKED, NOW);

    // Seule la date de début bouge : la clôture reste à l'heure où elle a eu
    // lieu, sinon on prétendrait que les inscriptions étaient ouvertes hier soir.
    expect(after.registrationCloseAt).toBe(STAGES.LOCKED.registrationCloseAt);
    expect(after.registrationOpenAt).toBe(STAGES.LOCKED.registrationOpenAt);
    expect(after.startVisibilityAt).toBe(STAGES.LOCKED.startVisibilityAt);
    expect(Date.parse(after.startAt)).toBe(NOW - LAUNCH_BACKDATE_MS);
  });

  it("publie un tournoi encore masqué au lieu de le laisser en cours et invisible", () => {
    const after = shortenScheduleForLaunch(STAGES.HIDDEN, NOW);

    // L'invariant de `TOURNAMENT_VISIBILITY_ACCESS.md` : la visibilité précède
    // toujours l'ouverture des inscriptions, donc un tournoi caché est toujours
    // `UPCOMING`. Abréger depuis « masqué » doit publier, pas violer la règle.
    expect(Date.parse(after.startVisibilityAt)).toBeLessThanOrEqual(NOW);
    expect(stateAfterLaunch(STAGES.HIDDEN)).toBe("RUNNING");
  });

  it("recule les jalons d'une seconde pleine, jamais à l'instant exact", () => {
    // Poser la clôture à `now` laisserait le tournoi aux inscriptions :
    // `computeTournamentState` teste `now <= registrationCloseAt`, borne comprise.
    const after = shortenScheduleForLaunch(STAGES.REGISTRATION, NOW);

    expect(Date.parse(after.registrationCloseAt)).toBe(NOW - LAUNCH_BACKDATE_MS);
    expect(LAUNCH_BACKDATE_MS).toBeGreaterThanOrEqual(1000);
  });
});

describe("advanceTarget", () => {
  it.each<[string, AdvanceTarget]>([
    // Masqué comme annoncé mènent aux inscriptions : « annoncé » n'est pas une
    // étape où l'on s'arrête exprès.
    ["HIDDEN", "REGISTRATION"],
    ["ANNOUNCED", "REGISTRATION"],
    ["REGISTRATION", "LOCKED"],
    ["LOCKED", "RUNNING"],
  ])("depuis %s mène à %s", (name, expected) => {
    expect(advanceTarget(STAGES[name], NOW)).toBe(expected);
  });

  it("ne mène plus nulle part une fois le tournoi lancé", () => {
    const running: LaunchableTournament = { ...STAGES.LOCKED, state: "RUNNING" };

    expect(advanceTarget(running, NOW)).toBeNull();
    expect(launchBlockReason(running, NOW)).toBe("TOURNAMENT_ALREADY_STARTED");
  });

  it("ne mène plus nulle part sur un tournoi terminé", () => {
    expect(advanceTarget({ ...STAGES.REGISTRATION, state: "FINISHED" }, NOW)).toBeNull();
  });

  it.each<[DateField]>([
    ["startVisibilityAt"],
    ["registrationOpenAt"],
    ["registrationCloseAt"],
    ["startAt"],
  ])("ne mène nulle part quand %s est illisible", (field) => {
    // `computeTournamentProgress` tolère une date abîmée là où avancer s'y
    // refuse : sans l'alignement sur `launchBlockReason`, le bouton
    // s'afficherait sur une action que le serveur refuse en 400.
    const broken = { ...STAGES.REGISTRATION, [field]: "pas une date" };

    expect(advanceTarget(broken, NOW)).toBeNull();
    expect(launchBlockReason(broken, NOW)).toBe("INVALID_DATES");
  });

  it("suit l'état stocké quand il devance les dates", () => {
    // Inscriptions ouvertes à la main avant l'heure : l'étape suivante est la
    // clôture, pas une seconde ouverture.
    expect(advanceTarget({ ...STAGES.ANNOUNCED, state: "REGISTRATION" }, NOW)).toBe("LOCKED");
  });
});

describe("shortenScheduleForAdvance", () => {
  it.each(STAGE_NAMES)("place le tournoi exactement dans l'étape suivante — depuis %s", (name) => {
    const before = STAGES[name];
    const target = advanceTarget(before, NOW)!;
    const after = { state: before.state, ...shortenScheduleForAdvance(before, target, NOW) };

    // L'état que la synchronisation écrira, puis l'étape qu'on lira sur la
    // frise une fois cet état en base.
    const state = computeTournamentState(after, NOW);
    expect(state).toBe({ REGISTRATION: "REGISTRATION", LOCKED: "UPCOMING", RUNNING: "RUNNING" }[target]);
    expect(computeTournamentProgress({ ...after, state }, { now: NOW }).current).toBe(target);
  });

  it.each(STAGE_NAMES)("ne fait jamais avancer une date — depuis %s", (name) => {
    const before = STAGES[name];
    const after = shortenScheduleForAdvance(before, advanceTarget(before, NOW)!, NOW);

    for (const field of [
      "startVisibilityAt",
      "registrationOpenAt",
      "registrationCloseAt",
      "startAt",
    ] as const) {
      expect(Date.parse(after[field])).toBeLessThanOrEqual(Date.parse(before[field]));
    }
  });

  it("ouvre les inscriptions d'un tournoi masqué en le publiant, sans toucher la suite", () => {
    const after = shortenScheduleForAdvance(STAGES.HIDDEN, "REGISTRATION", NOW);

    expect(Date.parse(after.registrationOpenAt)).toBe(NOW - LAUNCH_BACKDATE_MS);
    // La visibilité précède toujours l'ouverture : un tournoi aux inscriptions
    // n'est jamais invisible.
    expect(Date.parse(after.startVisibilityAt)).toBeLessThanOrEqual(NOW - LAUNCH_BACKDATE_MS);
    expect(after.registrationCloseAt).toBe(STAGES.HIDDEN.registrationCloseAt);
    expect(after.startAt).toBe(STAGES.HIDDEN.startAt);
    expect(
      computeTournamentState({ state: "UPCOMING", ...after }, NOW),
    ).toBe("REGISTRATION");
  });

  it("clôt les inscriptions sans avancer le coup d'envoi", () => {
    const after = shortenScheduleForAdvance(STAGES.REGISTRATION, "LOCKED", NOW);

    expect(Date.parse(after.registrationCloseAt)).toBe(NOW - LAUNCH_BACKDATE_MS);
    expect(after.registrationOpenAt).toBe(STAGES.REGISTRATION.registrationOpenAt);
    expect(after.startAt).toBe(STAGES.REGISTRATION.startAt);
    expect(computeTournamentState({ state: "REGISTRATION", ...after }, NOW)).toBe("UPCOMING");
  });

  it("cible « en cours » : identique à shortenScheduleForLaunch", () => {
    for (const name of STAGE_NAMES) {
      expect(shortenScheduleForAdvance(STAGES[name], "RUNNING", NOW)).toEqual(
        shortenScheduleForLaunch(STAGES[name], NOW),
      );
    }
  });
});

describe("advanceSuccessMessage", () => {
  it("annonce l'ouverture des inscriptions", () => {
    expect(advanceSuccessMessage("REGISTRATION", "REGISTRATION", 0)).toBe("Inscriptions ouvertes.");
  });

  it("annonce la clôture avec l'effectif figé", () => {
    expect(advanceSuccessMessage("LOCKED", "UPCOMING", 12)).toBe(
      "Inscriptions closes avec 12 engagés.",
    );
  });

  it("annonce le lancement", () => {
    expect(advanceSuccessMessage("RUNNING", "RUNNING", 8)).toBe("Tournoi lancé avec 8 engagés.");
  });

  it("se règle sur l'état atteint, pas sur la cible", () => {
    // Plateau désert : le moteur clôt le tournoi au coup d'envoi.
    expect(advanceSuccessMessage("RUNNING", "FINISHED", 1)).toMatch(/^Tournoi clos/);
    // Clôture tombée à l'heure même du coup d'envoi : le tournoi est parti.
    expect(advanceSuccessMessage("LOCKED", "RUNNING", 6)).toBe("Tournoi lancé avec 6 engagés.");
  });
});

describe("willCloseWithoutMatches", () => {
  it.each([
    [0, true],
    [1, true],
    [2, false],
    [16, false],
  ])("à %i engagés → %s", (count, expected) => {
    expect(willCloseWithoutMatches(count as number)).toBe(expected);
  });

  it("suit le seuil du moteur plutôt qu'un 2 réécrit ici", () => {
    // `finalizeUnderfilledTournament` lit la même constante : la confirmation
    // ne peut pas promettre une clôture que le moteur ne prononcerait pas.
    expect(willCloseWithoutMatches(MIN_ENTRANTS_FOR_MATCHES)).toBe(false);
    expect(willCloseWithoutMatches(MIN_ENTRANTS_FOR_MATCHES - 1)).toBe(true);
  });
});
