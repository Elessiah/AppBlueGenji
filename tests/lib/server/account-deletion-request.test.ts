import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/session-streams");
jest.mock("@/lib/server/ranking-cache");
jest.mock("@/lib/server/landing-cache");
jest.mock("@/lib/server/stats-cache");
jest.mock("@/lib/server/stored-upload-cleanup");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/registration");
jest.mock("@/lib/server/tournaments/match-casters");
jest.mock("@/lib/server/teams/access");
jest.mock("@/lib/server/teams/dissolution");
jest.mock("@/lib/server/teams/roster");
jest.mock("@/lib/server/team-invite-notifications");
jest.mock("@/lib/server/users/account-deletion", () => ({
  listSoloRegistrationTournamentIds: jest.fn(),
  loadAccountTrace: jest.fn(),
  loadSoloRegistrations: jest.fn(),
}));
jest.mock("@/lib/server/users/deleted-solo-entries", () => ({
  forfeitSoloEntriesAfterCommit: jest.fn(),
  listForfeitableSoloEntries: jest.fn(),
  logDeletionWithdrawal: jest.fn(),
  withdrawSoloRegistrationsOn: jest.fn(),
}));

import { getDatabase } from "@/lib/server/database";
import { sendBotLog } from "@/lib/server/bot-integration";
import { closeUserStreams } from "@/lib/server/session-streams";
import { deleteUnreferencedUpload } from "@/lib/server/stored-upload-cleanup";
import { withdrawUserCasts } from "@/lib/server/tournaments/match-casters";
import { lockTournamentRow } from "@/lib/server/tournaments/registration";
import { lockMemberRoles, writeActiveMembership } from "@/lib/server/teams/access";
import { dissolveTeamOn } from "@/lib/server/teams/dissolution";
import { teamStreamTournamentIds } from "@/lib/server/teams/roster";
import { notifyTeamInviteInBackground } from "@/lib/server/team-invite-notifications";
import { listSoloRegistrationTournamentIds, loadAccountTrace, loadSoloRegistrations } from "@/lib/server/users/account-deletion";
import {
  forfeitSoloEntriesAfterCommit,
  listForfeitableSoloEntries,
  logDeletionWithdrawal,
  withdrawSoloRegistrationsOn,
} from "@/lib/server/users/deleted-solo-entries";
import { getAccountDeletionRequestPlan, requestAccountDeletion } from "@/lib/server/users/account-deletion-request";
import { fakePool } from "../../helpers/sql-double";

/*
 * Demande de suppression (E1, E3, E4, E5, alerte) : le compte passe en attente,
 * et ce qui touche les autres — équipes, tournois organisés, inscriptions — se
 * fait tout de suite, dans une seule transaction.
 */

type Member = { id: number; user_id: number; roles_json: string; joined_at: string };

type Options = {
  alreadyDeleted?: boolean;
  teams?: number[];
  successors?: Member[];
  activeTournament?: boolean;
  organized?: number[];
  organizerSuccessor?: number | null;
  failOn?: string;
};

const NO_TRACE = { playedMatches: false, soloRegistrations: false, organizedTournaments: false, ownedTeams: false };

function fakeDb(options: Options) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    queries.push({ sql: q, params });
    if (options.failOn && q.startsWith(options.failOn)) throw new Error("DB_DOWN");
    if (q.startsWith("SELECT is_deleted FROM bg_users")) return [[{ is_deleted: options.alreadyDeleted ? 1 : 0 }]];
    if (q.startsWith("SELECT tm.team_id")) return [(options.teams ?? []).map((team_id) => ({ team_id }))];
    if (q.startsWith("SELECT logo_url, deleted_at FROM bg_teams")) return [[{ logo_url: "/api/uploads/teams/3.webp", deleted_at: null }]];
    if (q.startsWith("SELECT tm.id, tm.user_id, tm.roles_json, tm.joined_at")) return [options.successors ?? []];
    if (q.startsWith("SELECT 1 FROM bg_tournament_registrations r")) return [options.activeTournament ? [{ 1: 1 }] : []];
    if (q.startsWith("SELECT id FROM bg_tournaments WHERE organizer_user_id")) {
      return [(options.organized ?? []).map((id) => ({ id }))];
    }
    if (q.startsWith("SELECT u.id FROM bg_users u")) {
      return [options.organizerSuccessor ? [{ id: options.organizerSuccessor }] : []];
    }
    return [{ affectedRows: 1 }];
  });
  const connection = {
    execute,
    beginTransaction: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    release: jest.fn(() => {}),
  };
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute, getConnection: jest.fn(async () => connection) }));
  return { queries, connection };
}

const member = (userId: number, roles: string[], joinedAt: string): Member => ({
  id: userId * 10,
  user_id: userId,
  roles_json: JSON.stringify(roles),
  joined_at: joinedAt,
});

/** Les rôles écrits sur l'appartenance d'un membre (`writeActiveMembership(…, "roles_json = ?", …)`). */
const rolesWritten = () =>
  jest
    .mocked(writeActiveMembership)
    .mock.calls.filter(([, setSql]) => setSql === "roles_json = ?")
    .map(([, , params, teamId, userId]) => ({ teamId, userId, roles: JSON.parse(String(params[0])) }));

/** Les départs écrits (`left_at = NOW()`). */
const leftTeams = () =>
  jest
    .mocked(writeActiveMembership)
    .mock.calls.filter(([, setSql]) => setSql === "left_at = NOW()")
    .map(([, , , teamId, userId]) => ({ teamId, userId }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(listSoloRegistrationTournamentIds).mockResolvedValue([]);
  jest.mocked(loadSoloRegistrations).mockResolvedValue([]);
  jest.mocked(loadAccountTrace).mockResolvedValue(NO_TRACE);
  jest.mocked(withdrawSoloRegistrationsOn).mockResolvedValue([]);
  jest.mocked(listForfeitableSoloEntries).mockResolvedValue([]);
  jest.mocked(forfeitSoloEntriesAfterCommit).mockResolvedValue(undefined);
  jest.mocked(logDeletionWithdrawal).mockResolvedValue(undefined);
  jest.mocked(withdrawUserCasts).mockResolvedValue({ matchIds: [], tournamentIds: [] });
  jest.mocked(lockMemberRoles).mockResolvedValue(["OWNER", "DPS"]);
  jest.mocked(writeActiveMembership).mockResolvedValue(undefined);
  jest.mocked(dissolveTeamOn).mockResolvedValue({ detachedUserIds: [7], everRegistered: false });
  jest.mocked(teamStreamTournamentIds).mockResolvedValue(new Set());
  jest.mocked(sendBotLog).mockResolvedValue(undefined);
  jest.mocked(deleteUnreferencedUpload).mockResolvedValue(true);
});

describe("requestAccountDeletion — le compte", () => {
  it("requestAccountDeletion_alreadyDeleted_throwsUserNotFoundAndRollsBack", async () => {
    const { connection } = fakeDb({ alreadyDeleted: true });

    await expect(requestAccountDeletion(7)).rejects.toThrow("USER_NOT_FOUND");
    expect(connection.rollback).toHaveBeenCalled();
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("requestAccountDeletion_nominal_marksPendingAndDeletesSessionsInTransaction", async () => {
    const { queries, connection } = fakeDb({});

    await requestAccountDeletion(7);

    const mark = queries.find((q) => q.sql.startsWith("UPDATE bg_users SET is_deleted = 1, deletion_requested_at = ?"));
    expect(mark?.sql).toContain("AND is_deleted = 0");
    expect(mark?.params[0]).toBeInstanceOf(Date);
    expect(queries.some((q) => q.sql === "DELETE FROM bg_user_sessions WHERE user_id = ?")).toBe(true);
    expect(connection.commit).toHaveBeenCalled();
    expect(closeUserStreams).toHaveBeenCalledWith(7);
  });

  it("requestAccountDeletion_nominal_cancelsOwnPendingInvitations", async () => {
    const { queries } = fakeDb({});

    await requestAccountDeletion(7);

    expect(queries.some((q) => q.sql.startsWith("UPDATE bg_team_invitations SET status = 'CANCELLED'") && q.sql.includes("WHERE user_id = ?"))).toBe(true);
  });

  it("requestAccountDeletion_nominal_returnsFinalAtThirtyDaysLater", async () => {
    fakeDb({});
    const before = Date.now();

    const outcome = await requestAccountDeletion(7);

    const finalAt = Date.parse(outcome.finalAt);
    expect(finalAt).toBeGreaterThanOrEqual(before + 30 * 24 * 3600 * 1000);
    expect(finalAt).toBeLessThanOrEqual(Date.now() + 30 * 24 * 3600 * 1000);
  });

  it("requestAccountDeletion_soloTournaments_locksThemBeforeTheAccount", async () => {
    const order: string[] = [];
    jest.mocked(listSoloRegistrationTournamentIds).mockResolvedValue([3, 5]);
    jest.mocked(lockTournamentRow).mockImplementation(async (_c, id) => {
      order.push(`tournament ${id}`);
    });
    const { connection } = fakeDb({});
    const execute = connection.execute.getMockImplementation()!;
    connection.execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("SELECT is_deleted FROM bg_users")) order.push("account");
      return execute(sql, params);
    });

    await requestAccountDeletion(7);

    expect(order.slice(0, 3)).toEqual(["tournament 3", "tournament 5", "account"]);
  });

  it("requestAccountDeletion_failureMidway_rollsBackAndSendsNothing", async () => {
    const { connection } = fakeDb({ failOn: "UPDATE bg_users SET is_deleted = 1" });

    await expect(requestAccountDeletion(7)).rejects.toThrow("DB_DOWN");
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(closeUserStreams).not.toHaveBeenCalled();
    expect(forfeitSoloEntriesAfterCommit).not.toHaveBeenCalled();
  });
});

describe("requestAccountDeletion — équipes (E3)", () => {
  it("requestAccountDeletion_ownerWithManager_transfersToManagerAndNotifies", async () => {
    fakeDb({
      teams: [3],
      successors: [member(8, ["CAPITAINE"], "2025-01-01 00:00:00"), member(9, ["MANAGER"], "2026-06-01 00:00:00")],
    });

    await requestAccountDeletion(7);

    expect(rolesWritten()).toEqual([{ teamId: 3, userId: 9, roles: ["OWNER", "MANAGER"] }]);
    expect(notifyTeamInviteInBackground).toHaveBeenCalledWith("OWNERSHIP", 3, 9, 7);
    expect(leftTeams()).toEqual([{ teamId: 3, userId: 7 }]);
  });

  it("requestAccountDeletion_ownerWithCaptainOnly_transfersToCaptain", async () => {
    fakeDb({
      teams: [3],
      successors: [member(8, ["TANK"], "2025-01-01 00:00:00"), member(9, ["CAPITAINE"], "2026-06-01 00:00:00")],
    });

    await requestAccountDeletion(7);

    expect(rolesWritten()).toEqual([{ teamId: 3, userId: 9, roles: ["OWNER", "CAPITAINE"] }]);
  });

  it("requestAccountDeletion_ownerWithPlainMembers_transfersToOldest", async () => {
    fakeDb({
      teams: [3],
      successors: [member(8, ["DPS"], "2026-06-01 00:00:00"), member(9, ["HEAL"], "2025-01-01 00:00:00")],
    });

    await requestAccountDeletion(7);

    expect(rolesWritten()).toEqual([{ teamId: 3, userId: 9, roles: ["OWNER", "HEAL"] }]);
  });

  it("requestAccountDeletion_soleOwnerInActiveTournament_ghostsTeam", async () => {
    const { queries } = fakeDb({ teams: [3], successors: [], activeTournament: true });

    await requestAccountDeletion(7);

    expect(queries.some((q) => q.sql === "UPDATE bg_teams SET is_ghost = 1 WHERE id = ?")).toBe(true);
    expect(dissolveTeamOn).not.toHaveBeenCalled();
    expect(notifyTeamInviteInBackground).not.toHaveBeenCalled();
  });

  it("requestAccountDeletion_soleOwnerNoActiveTournament_dissolves", async () => {
    const { queries } = fakeDb({ teams: [3], successors: [], activeTournament: false });

    await requestAccountDeletion(7);

    expect(dissolveTeamOn).toHaveBeenCalledWith(expect.anything(), 3);
    expect(deleteUnreferencedUpload).toHaveBeenCalledWith("/api/uploads/teams/3.webp", "teams");
    expect(queries.some((q) => q.sql.startsWith("UPDATE bg_teams SET is_ghost = 1"))).toBe(false);
  });

  it("requestAccountDeletion_plainMember_leavesOnly", async () => {
    jest.mocked(lockMemberRoles).mockResolvedValue(["DPS"]);
    fakeDb({ teams: [3] });

    await requestAccountDeletion(7);

    expect(rolesWritten()).toEqual([]);
    expect(dissolveTeamOn).not.toHaveBeenCalled();
    expect(leftTeams()).toEqual([{ teamId: 3, userId: 7 }]);
  });
});

describe("requestAccountDeletion — tournois organisés", () => {
  it("requestAccountDeletion_organizerWithSuccessor_handsTournamentsOver", async () => {
    const { queries } = fakeDb({ organized: [11, 12], organizerSuccessor: 21 });

    await requestAccountDeletion(7);

    const handover = queries.find((q) => q.sql.startsWith("UPDATE bg_tournaments SET organizer_user_id = ?"));
    expect(handover?.params).toEqual([21, 7]);
  });

  it("requestAccountDeletion_organizerWithoutSuccessor_leavesTournamentsUnchanged", async () => {
    const { queries } = fakeDb({ organized: [11], organizerSuccessor: null });

    await requestAccountDeletion(7);

    expect(queries.some((q) => q.sql.startsWith("UPDATE bg_tournaments SET organizer_user_id"))).toBe(false);
  });

  it("findOrganizerSuccessor_query_prefersRoleHoldersThenOldest", async () => {
    const { queries } = fakeDb({ organized: [11], organizerSuccessor: 21 });

    await requestAccountDeletion(7);

    const lookup = queries.find((q) => q.sql.startsWith("SELECT u.id FROM bg_users u"));
    expect(lookup?.sql).toContain("u.is_deleted = 0");
    expect(lookup?.sql).toContain("u.is_admin = 1");
    expect(lookup?.sql).toMatch(/ORDER BY \(.+\) DESC, u\.created_at, u\.id/);
  });
});

describe("requestAccountDeletion — journal et forfaits (E1, E5)", () => {
  it("requestAccountDeletion_nominal_logsAlertWithoutPseudoOnSignups", async () => {
    fakeDb({});

    await requestAccountDeletion(7);

    const [message, options] = jest.mocked(sendBotLog).mock.calls[0];
    expect(message).toContain("Compte supprimé");
    expect(message).not.toMatch(/#7\b|7\)/);
    expect(options).toEqual({ category: "signups" });
  });

  it("requestAccountDeletion_withdrawnRegistration_logsEachWithdrawal", async () => {
    jest.mocked(withdrawSoloRegistrationsOn).mockResolvedValue([{ tournamentId: 4, teamId: 40 }]);
    fakeDb({});

    await requestAccountDeletion(7);

    expect(logDeletionWithdrawal).toHaveBeenCalledWith(4, false);
  });

  it("requestAccountDeletion_unplayedRunningEntry_forfeitsAfterCommit", async () => {
    const order: string[] = [];
    jest.mocked(listForfeitableSoloEntries).mockResolvedValue([{ tournamentId: 5, teamId: 50 }]);
    jest.mocked(forfeitSoloEntriesAfterCommit).mockImplementation(async () => {
      order.push("forfeit");
    });
    const { connection } = fakeDb({});
    connection.commit.mockImplementation(async () => {
      order.push("commit");
    });

    await requestAccountDeletion(7);

    expect(forfeitSoloEntriesAfterCommit).toHaveBeenCalledWith([{ tournamentId: 5, teamId: 50 }]);
    expect(order).toEqual(["commit", "forfeit"]);
  });

  it("requestAccountDeletion_botUnreachable_stillSucceeds", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(sendBotLog).mockRejectedValue(new Error("BOT_DOWN"));
    fakeDb({});

    await expect(requestAccountDeletion(7)).resolves.toHaveProperty("finalAt");
    log.mockRestore();
  });
});

describe("getAccountDeletionRequestPlan", () => {
  it("getAccountDeletionRequestPlan_ownedTeam_notAReasonToKeepTheRow", async () => {
    jest.mocked(loadAccountTrace).mockResolvedValue({ ...NO_TRACE, ownedTeams: true });
    fakeDb({});

    expect(await getAccountDeletionRequestPlan(7)).toEqual({ mode: "ERASE", reason: null });
  });

  it("getAccountDeletionRequestPlan_organizerWithoutSuccessor_anonymizes", async () => {
    jest.mocked(loadAccountTrace).mockResolvedValue({ ...NO_TRACE, organizedTournaments: true });
    fakeDb({ organizerSuccessor: null });

    expect(await getAccountDeletionRequestPlan(7)).toEqual({ mode: "ANONYMIZE", reason: "ORGANIZED_TOURNAMENTS" });
  });

  it("getAccountDeletionRequestPlan_organizerWithSuccessor_erases", async () => {
    jest.mocked(loadAccountTrace).mockResolvedValue({ ...NO_TRACE, organizedTournaments: true });
    fakeDb({ organizerSuccessor: 21 });

    expect(await getAccountDeletionRequestPlan(7)).toEqual({ mode: "ERASE", reason: null });
  });
});
