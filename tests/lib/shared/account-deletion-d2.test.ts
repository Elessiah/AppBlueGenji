import { describe, expect, it } from "@jest/globals";
import {
  ACCOUNT_REACTIVATION_DAYS,
  isReactivationWindowOpen,
  ownedTeamFate,
  pickTeamSuccessor,
  reactivationDeadline,
  successorRoles,
  type TeamSuccessorCandidate,
} from "@/lib/shared/account-deletion";
import { formatAccountDeletionLog, formatAccountReactivationLog, formatDeletionWithdrawalLog } from "@/lib/shared/bot-logs";

/*
 * ERASURE-D2 — règles pures de la suppression différée : fenêtre de trente
 * jours (E4), héritier d'une équipe et sort d'une équipe sans héritier (E3),
 * journaux Discord sans pseudo (E5, alerte de suppression).
 */

const REQUESTED = "2026-11-03T10:00:00.000Z";
const DEADLINE_MS = Date.parse("2026-12-03T10:00:00.000Z");

function candidate(overrides: Partial<TeamSuccessorCandidate> & { userId: number }): TeamSuccessorCandidate {
  return { roles: ["DPS"], joinedAt: "2026-01-01T00:00:00.000Z", membershipId: overrides.userId, ...overrides };
}

describe("reactivationDeadline", () => {
  it("reactivationDeadline_requestedAt_addsThirtyDays", () => {
    expect(ACCOUNT_REACTIVATION_DAYS).toBe(30);
    expect(reactivationDeadline(REQUESTED).toISOString()).toBe("2026-12-03T10:00:00.000Z");
  });
});

describe("isReactivationWindowOpen", () => {
  it("isReactivationWindowOpen_oneMsBeforeDeadline_true", () => {
    expect(isReactivationWindowOpen(REQUESTED, DEADLINE_MS - 1)).toBe(true);
  });

  it("isReactivationWindowOpen_atDeadline_false", () => {
    expect(isReactivationWindowOpen(REQUESTED, DEADLINE_MS)).toBe(false);
  });

  it("isReactivationWindowOpen_null_false", () => {
    expect(isReactivationWindowOpen(null, DEADLINE_MS - 1)).toBe(false);
  });

  it("isReactivationWindowOpen_unparsableDate_false", () => {
    expect(isReactivationWindowOpen("pas une date", 0)).toBe(false);
  });
});

describe("pickTeamSuccessor", () => {
  it("pickTeamSuccessor_coOwnerPresent_picksCoOwnerOverManager", () => {
    const manager = candidate({ userId: 2, roles: ["MANAGER"], joinedAt: "2025-01-01T00:00:00.000Z" });
    const coOwner = candidate({ userId: 3, roles: ["OWNER", "DPS"], joinedAt: "2026-06-01T00:00:00.000Z" });

    expect(pickTeamSuccessor([manager, coOwner])?.userId).toBe(3);
  });

  it("pickTeamSuccessor_managerPresent_picksManagerOverOlderCaptain", () => {
    const captain = candidate({ userId: 2, roles: ["CAPITAINE"], joinedAt: "2025-01-01T00:00:00.000Z" });
    const manager = candidate({ userId: 3, roles: ["MANAGER"], joinedAt: "2026-06-01T00:00:00.000Z" });

    expect(pickTeamSuccessor([captain, manager])?.userId).toBe(3);
  });

  it("pickTeamSuccessor_captainNoManager_picksCaptainOverOlderMember", () => {
    const member = candidate({ userId: 2, roles: ["TANK"], joinedAt: "2025-01-01T00:00:00.000Z" });
    const captain = candidate({ userId: 3, roles: ["CAPITAINE"], joinedAt: "2026-06-01T00:00:00.000Z" });

    expect(pickTeamSuccessor([member, captain])?.userId).toBe(3);
  });

  it("pickTeamSuccessor_plainMembers_picksOldest", () => {
    const recent = candidate({ userId: 2, joinedAt: "2026-06-01T00:00:00.000Z" });
    const oldest = candidate({ userId: 3, joinedAt: "2025-01-01T00:00:00.000Z" });

    expect(pickTeamSuccessor([recent, oldest])?.userId).toBe(3);
  });

  it("pickTeamSuccessor_sameJoinDate_picksLowestMembershipId", () => {
    const later = candidate({ userId: 2, membershipId: 9 });
    const first = candidate({ userId: 3, membershipId: 4 });

    expect(pickTeamSuccessor([later, first])?.userId).toBe(3);
  });

  // Revue sécurité #546 (reprise, cycle 2) : un compte suspendu ne reçoit l'équipe qu'à défaut d'autre membre.
  it("pickTeamSuccessor_suspendedManager_picksActivePlainMember", () => {
    const manager = candidate({ userId: 2, roles: ["MANAGER"], joinedAt: "2025-01-01T00:00:00.000Z", suspended: true });
    const member = candidate({ userId: 3, roles: ["TANK"], joinedAt: "2026-06-01T00:00:00.000Z" });

    expect(pickTeamSuccessor([manager, member])?.userId).toBe(3);
  });

  // Revue de correction #571 : un copropriétaire suspendu garde l'équipe, rien ne change.
  // Revue sécurité #571 : l'équipe garde un propriétaire capable de se connecter.
  it("pickTeamSuccessor_suspendedCoOwner_picksActiveMember", () => {
    const member = candidate({ userId: 2, roles: ["TANK"] });
    const coOwner = candidate({ userId: 3, roles: ["OWNER"], suspended: true });

    expect(pickTeamSuccessor([member, coOwner])?.userId).toBe(2);
  });

  it("pickTeamSuccessor_activeCoOwnerAndManager_picksCoOwner", () => {
    const manager = candidate({ userId: 2, roles: ["MANAGER"] });
    const coOwner = candidate({ userId: 3, roles: ["OWNER"] });

    expect(pickTeamSuccessor([manager, coOwner])?.userId).toBe(3);
  });

  it("pickTeamSuccessor_onlySuspendedMembers_stillPicksBestOfThem", () => {
    const member = candidate({ userId: 2, roles: ["TANK"], suspended: true });
    const manager = candidate({ userId: 3, roles: ["MANAGER"], suspended: true });

    expect(pickTeamSuccessor([member, manager])?.userId).toBe(3);
  });

  it("pickTeamSuccessor_noCandidate_null", () => {
    expect(pickTeamSuccessor([])).toBeNull();
  });
});

describe("ownedTeamFate", () => {
  it("ownedTeamFate_successor_transfer", () => {
    expect(ownedTeamFate({ hasSuccessor: true, registeredInActiveTournament: true })).toBe("TRANSFER");
  });

  it("ownedTeamFate_soleOwnerInActiveTournament_ghost", () => {
    expect(ownedTeamFate({ hasSuccessor: false, registeredInActiveTournament: true })).toBe("GHOST");
  });

  it("ownedTeamFate_soleOwnerNoActiveTournament_dissolve", () => {
    expect(ownedTeamFate({ hasSuccessor: false, registeredInActiveTournament: false })).toBe("DISSOLVE");
  });
});

describe("successorRoles", () => {
  it("successorRoles_captain_prependsOwnerKeepsRoles", () => {
    expect(successorRoles(["CAPITAINE", "TANK"])).toEqual(["OWNER", "CAPITAINE", "TANK"]);
  });

  it("successorRoles_alreadyOwner_noDuplicate", () => {
    expect(successorRoles(["OWNER", "DPS"])).toEqual(["OWNER", "DPS"]);
  });
});

describe("formatAccountDeletionLog", () => {
  it("formatAccountDeletionLog_days_mentionsDelayWithoutPseudo", () => {
    const actual = formatAccountDeletionLog({ days: 30 });

    expect(actual).toBe("🗑️ Suppression de compte demandée — définitive sous 30 jours, sauf réactivation.");
  });

  // D56b : la ligne dit aux modérateurs quelles alertes AutoMod supprimer à la
  // main — chaque soirée #live où le compte a paru (tournoi, jour, heure de la
  // première annonce, Paris), jamais un pseudo.
  it("formatAccountDeletionLog_emptyAnnouncements_addsNothing", () => {
    const actual = formatAccountDeletionLog({ days: 30, liveAnnouncements: { announcements: [], truncated: false } });

    expect(actual).toBe("🗑️ Suppression de compte demandée — définitive sous 30 jours, sauf réactivation.");
  });

  it("formatAccountDeletionLog_oneAnnouncement_namesTournamentDayAndStartTime", () => {
    const actual = formatAccountDeletionLog({
      days: 30,
      liveAnnouncements: {
        announcements: [{ tournamentName: "Solo Cup", sentAt: "2026-11-13T20:04:00.000Z" }],
        truncated: false,
      },
    });

    expect(actual).toBe(
      "🗑️ Suppression de compte demandée — définitive sous 30 jours, sauf réactivation. Modération : ce compte a pu paraître dans #live en tournoi individuel (« Solo Cup » le 13/11/2026 vers 21:04) — supprimer à la main, dans le salon d'alertes AutoMod, les alertes des messages #live de ces soirées qui citent ses matchs, avant comme après l'heure citée : le message d'une soirée liste à l'avance les matchs programmés et reprend, à chaque nouveau match, ceux déjà annoncés.",
    );
  });

  it("formatAccountDeletionLog_sameTournamentSameDay_groupedAtEarliestTime", () => {
    const actual = formatAccountDeletionLog({
      days: 30,
      liveAnnouncements: {
        announcements: [
          { tournamentName: "Cup", sentAt: "2026-11-13T21:30:00.000Z" },
          { tournamentName: "Cup", sentAt: "2026-11-13T19:04:00.000Z" },
        ],
        truncated: false,
      },
    });

    expect(actual).toContain("(« Cup » le 13/11/2026 vers 20:04) —");
    expect(actual).not.toContain("22:30");
  });

  it("formatAccountDeletionLog_sameTournamentTwoDays_citesBothEvenings", () => {
    const actual = formatAccountDeletionLog({
      days: 30,
      liveAnnouncements: {
        announcements: [
          { tournamentName: "Cup", sentAt: "2026-11-14T19:00:00.000Z" },
          { tournamentName: "Cup", sentAt: "2026-11-13T19:00:00.000Z" },
        ],
        truncated: false,
      },
    });

    expect(actual).toContain("(« Cup » le 14/11/2026 vers 20:00 ; « Cup » le 13/11/2026 vers 20:00) —");
  });

  it("formatAccountDeletionLog_twoTournamentsSameDay_citesBoth", () => {
    const actual = formatAccountDeletionLog({
      days: 30,
      liveAnnouncements: {
        announcements: [
          { tournamentName: "B", sentAt: "2026-11-13T20:00:00.000Z" },
          { tournamentName: "A", sentAt: "2026-11-13T19:00:00.000Z" },
        ],
        truncated: false,
      },
    });

    expect(actual).toContain("(« B » le 13/11/2026 vers 21:00 ; « A » le 13/11/2026 vers 20:00) —");
  });

  it("formatAccountDeletionLog_afterParisMidnight_usesParisDay", () => {
    const actual = formatAccountDeletionLog({
      days: 30,
      liveAnnouncements: {
        announcements: [{ tournamentName: "Cup", sentAt: "2026-07-01T22:30:00.000Z" }],
        truncated: false,
      },
    });

    expect(actual).toContain("« Cup » le 02/07/2026 vers 00:30");
  });

  it("formatAccountDeletionLog_fiveEvenings_citesAllWithoutCount", () => {
    const actual = formatAccountDeletionLog({ days: 30, liveAnnouncements: evenings(5) });

    expect(actual).toContain("« Cup 5 » le 05/07/2026 vers 14:00) — supprimer à la main");
    expect(actual).not.toContain("autre");
  });

  it("formatAccountDeletionLog_sixEvenings_citesFiveAndCountsOneOther", () => {
    const actual = formatAccountDeletionLog({ days: 30, liveAnnouncements: evenings(6) });

    expect(actual).toContain("« Cup 5 » le 05/07/2026 vers 14:00 ; et 1 autre) — supprimer à la main");
    expect(actual).not.toContain("Cup 6");
  });

  it("formatAccountDeletionLog_sevenEvenings_countsOthersInPlural", () => {
    const actual = formatAccountDeletionLog({ days: 30, liveAnnouncements: evenings(7) });

    expect(actual).toContain("; et 2 autres) — supprimer à la main");
  });

  it("formatAccountDeletionLog_truncatedRead_saysOlderOnesExist", () => {
    const actual = formatAccountDeletionLog({
      days: 30,
      liveAnnouncements: {
        announcements: [{ tournamentName: "Cup", sentAt: "2026-07-01T12:00:00.000Z" }],
        truncated: true,
      },
    });

    expect(actual).toContain("(« Cup » le 01/07/2026 vers 14:00 ; et d'autres, plus anciennes) —");
  });

  it("formatAccountDeletionLog_truncatedWithOthers_countsOthersThenSaysOlderOnesExist", () => {
    const actual = formatAccountDeletionLog({ days: 30, liveAnnouncements: { ...evenings(6), truncated: true } });

    expect(actual).toContain("« Cup 5 » le 05/07/2026 vers 14:00 ; et 1 autre ; et d'autres, plus anciennes) —");
  });

  it("formatAccountDeletionLog_unreadableAnnouncements_tellsStaffToCheckTheAlertChannel", () => {
    const actual = formatAccountDeletionLog({ days: 30, liveAnnouncements: null });

    expect(actual).toBe(
      "🗑️ Suppression de compte demandée — définitive sous 30 jours, sauf réactivation. Modération : ses annonces #live n'ont pas pu être relues — vérifier le salon d'alertes AutoMod et y supprimer à la main les alertes qui portent le pseudo d'un compte supprimé.",
    );
  });

  it("formatAccountDeletionLog_tournamentNameWithMention_isNeutralised", () => {
    const actual = formatAccountDeletionLog({
      days: 30,
      liveAnnouncements: {
        announcements: [{ tournamentName: "@everyone **Cup**", sentAt: "2026-07-01T12:00:00.000Z" }],
        truncated: false,
      },
    });

    expect(actual).not.toContain("@everyone");
    expect(actual).not.toContain("**Cup**");
  });
});

/** `count` soirées : « Cup 1 » le 1er juillet 2026 à 14 h de Paris, « Cup 2 » le 2… */
function evenings(count: number): { announcements: { tournamentName: string; sentAt: string }[]; truncated: boolean } {
  return {
    announcements: Array.from({ length: count }, (_, index) => ({
      tournamentName: `Cup ${index + 1}`,
      sentAt: `2026-07-0${index + 1}T12:00:00.000Z`,
    })),
    truncated: false,
  };
}

describe("formatAccountReactivationLog", () => {
  it("formatAccountReactivationLog_always_saysReactivatedWithoutPseudo", () => {
    const actual = formatAccountReactivationLog();

    expect(actual).toBe("↩️ Compte réactivé — suppression demandée annulée.");
  });
});

describe("formatDeletionWithdrawalLog", () => {
  const tournament = { id: 12, name: "Coupe d'hiver" };
  const entrant = { name: "Nova", participantType: "SOLO" as const };

  it("formatDeletionWithdrawalLog_withdrawn_saysInscriptionRetireeAndUnJoueur", () => {
    const actual = formatDeletionWithdrawalLog({ tournament, entrant, registeredTeams: 7, maxTeams: 16, forfeited: false });

    expect(actual).toContain("Inscription retirée");
    expect(actual).toContain("un joueur supprime son compte");
    expect(actual).toContain("7/16");
  });

  it("formatDeletionWithdrawalLog_forfeited_saysForfait", () => {
    const actual = formatDeletionWithdrawalLog({ tournament, entrant, registeredTeams: 7, maxTeams: 16, forfeited: true });

    expect(actual).toContain("Forfait (compte supprimé)");
    expect(actual).toContain("perdus par forfait");
  });

  it("formatDeletionWithdrawalLog_soloEntrant_neverContainsPseudo", () => {
    const withdrawn = formatDeletionWithdrawalLog({ tournament, entrant, registeredTeams: 1, maxTeams: 2, forfeited: false });
    const forfeited = formatDeletionWithdrawalLog({ tournament, entrant, registeredTeams: 1, maxTeams: 2, forfeited: true });

    expect(withdrawn).not.toContain("Nova");
    expect(forfeited).not.toContain("Nova");
  });
});
