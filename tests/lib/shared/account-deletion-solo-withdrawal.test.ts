import { describe, expect, it } from "@jest/globals";
import {
  accountDeletionConfirmation,
  accountDeletionOutcome,
  type SoloRegistrationFact,
  withdrawableSoloRegistrations,
} from "@/lib/shared/account-deletion";

/**
 * D12 : l'inscription solo jamais jouée à un tournoi pas encore commencé ne
 * retient plus la ligne — elle part avec le compte. Tout le reste la retient.
 */
const NOW = Date.parse("2026-11-05T12:00:00Z");
const DAY = 86_400_000;

function registration(overrides: Partial<SoloRegistrationFact> = {}): SoloRegistrationFact {
  return {
    tournamentId: 40,
    teamId: 900,
    state: "REGISTRATION",
    finishedAt: null,
    registrationOpenAt: new Date(NOW - DAY),
    registrationCloseAt: new Date(NOW + 9 * DAY),
    startAt: new Date(NOW + 10 * DAY),
    hasMatch: false,
    ...overrides,
  };
}

const LOCKED_40 = new Set([40]);

describe("withdrawableSoloRegistrations", () => {
  it("withdrawableSoloRegistrations_noRegistrations_returnsEmptyList", () => {
    expect(withdrawableSoloRegistrations([], LOCKED_40, NOW)).toEqual([]);
  });

  it("withdrawableSoloRegistrations_registrationOpenNoMatchLocked_returnsRegistrations", () => {
    const open = registration();

    expect(withdrawableSoloRegistrations([open], LOCKED_40, NOW)).toEqual([open]);
  });

  it("withdrawableSoloRegistrations_closedButNotStarted_returnsRegistrations", () => {
    const closed = registration({ state: "UPCOMING", registrationCloseAt: new Date(NOW - 1000) });

    expect(withdrawableSoloRegistrations([closed], LOCKED_40, NOW)).toEqual([closed]);
  });

  it("withdrawableSoloRegistrations_startTimePassedStateStale_returnsNull", () => {
    const stale = registration({ registrationCloseAt: new Date(NOW - 2 * DAY), startAt: new Date(NOW - 1000) });

    expect(withdrawableSoloRegistrations([stale], LOCKED_40, NOW)).toBeNull();
  });

  it("withdrawableSoloRegistrations_runningTournament_returnsNull", () => {
    expect(withdrawableSoloRegistrations([registration({ state: "RUNNING" })], LOCKED_40, NOW)).toBeNull();
  });

  it("withdrawableSoloRegistrations_finishedTournament_returnsNull", () => {
    const finished = registration({ state: "FINISHED", finishedAt: new Date(NOW - DAY) });

    expect(withdrawableSoloRegistrations([finished], LOCKED_40, NOW)).toBeNull();
  });

  it("withdrawableSoloRegistrations_entryOnAMatch_returnsNull", () => {
    expect(withdrawableSoloRegistrations([registration({ hasMatch: true })], LOCKED_40, NOW)).toBeNull();
  });

  it("withdrawableSoloRegistrations_tournamentNotLocked_returnsNull", () => {
    expect(withdrawableSoloRegistrations([registration()], new Set([41]), NOW)).toBeNull();
  });

  it("withdrawableSoloRegistrations_previewWithoutLocks_returnsRegistrations", () => {
    const open = registration();

    expect(withdrawableSoloRegistrations([open], null, NOW)).toEqual([open]);
  });

  it("withdrawableSoloRegistrations_oneOfTwoStarted_returnsNull", () => {
    const open = registration();
    const started = registration({ tournamentId: 41, state: "RUNNING" });

    expect(withdrawableSoloRegistrations([open, started], new Set([40, 41]), NOW)).toBeNull();
  });
});

describe("textes de l'effacement complet — D12", () => {
  it("accountDeletionConfirmation_null_mentionsWithdrawnSoloRegistrations", () => {
    expect(accountDeletionConfirmation(null)).toContain(
      "tes éventuelles inscriptions à des tournois individuels pas encore commencés seront retirées",
    );
  });

  it("accountDeletionOutcome_null_mentionsUpcomingSoloRegistrations", () => {
    expect(accountDeletionOutcome(null)).toContain("tes éventuelles inscriptions à venir en tournoi individuel");
  });

  it("accountDeletionConfirmation_soloRegistrations_saysStartedTournament", () => {
    expect(accountDeletionConfirmation("SOLO_REGISTRATIONS")).toContain(
      "tournoi individuel déjà commencé ou terminé",
    );
  });
});
