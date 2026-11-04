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
});

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
