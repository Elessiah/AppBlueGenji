import { describe, expect, it } from "@jest/globals";

import {
  LAUNCH_BACKDATE_MS,
  abridgedStagesForLaunch,
  canLaunchNow,
  launchBlockReason,
  shortenScheduleForLaunch,
  willCloseWithoutMatches,
  type LaunchableTournament,
} from "@/lib/shared/tournament-launch";
import { computeTournamentState } from "@/lib/shared/tournament-state";
import type { TournamentState } from "@/lib/shared/types";

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

  it.each([
    ["startVisibilityAt"],
    ["registrationOpenAt"],
    ["registrationCloseAt"],
    ["startAt"],
  ] as const)("refuse un tournoi dont %s est illisible", (field) => {
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

describe("abridgedStagesForLaunch", () => {
  it.each([
    ["HIDDEN", ["HIDDEN", "ANNOUNCED", "REGISTRATION", "LOCKED"]],
    ["ANNOUNCED", ["ANNOUNCED", "REGISTRATION", "LOCKED"]],
    ["REGISTRATION", ["REGISTRATION", "LOCKED"]],
    ["LOCKED", ["LOCKED"]],
  ])("énumère ce qui saute depuis %s", (name, expected) => {
    expect(abridgedStagesForLaunch(STAGES[name as string], NOW)).toEqual(expected);
  });

  it("n'énumère plus rien une fois le tournoi lancé", () => {
    // Exactement les cas où `launchBlockReason` refuse : les deux fonctions
    // s'accordent, l'interface ne peut pas proposer d'abréger le vide.
    const running: LaunchableTournament = { ...STAGES.LOCKED, state: "RUNNING" };

    expect(abridgedStagesForLaunch(running, NOW)).toEqual([]);
    expect(launchBlockReason(running, NOW)).toBe("TOURNAMENT_ALREADY_STARTED");
  });

  it("n'énumère plus rien sur un tournoi terminé", () => {
    expect(abridgedStagesForLaunch({ ...STAGES.REGISTRATION, state: "FINISHED" }, NOW)).toEqual([]);
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
});
