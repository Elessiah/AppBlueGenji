import { relaunchAfterRefereeWithdrawal } from "@/lib/server/tournaments/match-launch";
import { discardBotLogs, flushBotLogs } from "@/lib/server/tournaments/bot-logs";
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
jest.mock("@/lib/server/tournaments/match-launch", () => ({ relaunchAfterRefereeWithdrawal: jest.fn() }));
jest.mock("@/lib/server/tournaments/bot-logs", () => ({ flushBotLogs: jest.fn(), discardBotLogs: jest.fn() }));
jest.mock("@/lib/server/teams/access");
jest.mock("@/lib/server/teams/dissolution");
jest.mock("@/lib/server/teams/roster");
jest.mock("@/lib/server/team-invite-notifications");
jest.mock("@/lib/server/users/account-deletion", () => ({
  listCastTournamentIds: jest.fn(),
  listSoloRegistrationTournamentIds: jest.fn(),
  loadAccountTrace: jest.fn(),
  loadSoloRegistrations: jest.fn(),
  mergeTournamentIds: (...lists: (readonly number[])[]) => [...new Set(lists.flat())].sort((a, b) => a - b),
}));
jest.mock("@/lib/server/account-deletion-journal");
jest.mock("@/lib/server/users/account-deletion-hold");
jest.mock("@/lib/server/users/deleted-solo-entries", () => ({
  forfeitSoloEntriesAfterCommit: jest.fn(),
  listForfeitableSoloEntries: jest.fn(),
  logDeletionWithdrawal: jest.fn(),
  withdrawSoloRegistrationsOn: jest.fn(),
}));

import { getDatabase } from "@/lib/server/database";
import { recordAccountDeletion } from "@/lib/server/account-deletion-journal";
import { holdAccountIdentity } from "@/lib/server/users/account-deletion-hold";
import { sendBotLog } from "@/lib/server/bot-integration";
import { closeUserStreams } from "@/lib/server/session-streams";
import { deleteUnreferencedUpload } from "@/lib/server/stored-upload-cleanup";
import { withdrawUserCasts } from "@/lib/server/tournaments/match-casters";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { lockTournamentRow } from "@/lib/server/tournaments/registration";
import { lockMemberRoles, writeActiveMembership } from "@/lib/server/teams/access";
import { dissolveTeamOn } from "@/lib/server/teams/dissolution";
import { teamStreamTournamentIds } from "@/lib/server/teams/roster";
import { notifyTeamInviteInBackground } from "@/lib/server/team-invite-notifications";
import {
  listCastTournamentIds,
  listSoloRegistrationTournamentIds,
  loadAccountTrace,
  loadSoloRegistrations,
} from "@/lib/server/users/account-deletion";
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
  /** Le compte qui demande est administrateur. */
  isAdmin?: boolean;
  /** Autres administrateurs relevés, puis relus sous verrou (`locked`). */
  otherAdmins?: { id: number; locked: { is_admin: 0 | 1; is_deleted: 0 | 1 } | null }[];
  /** Matchs non joués que le compte arbitre (relevé avant le retrait). */
  refereedMatches?: number[];
  /** Erreurs levées par les premières transactions (rejeu sur interblocage). */
  transactionErrors?: Error[];
  teams?: number[];
  successors?: Member[];
  deadMembers?: number[];
  /** Membres sous suspension en cours. */
  suspendedMembers?: number[];
  activeTournament?: boolean;
  organized?: number[];
  /** Les tournois organisés relus dans la transaction, s'ils diffèrent du relevé d'avant. */
  organizedLater?: number[];
  organizerSuccessor?: number | null;
  failOn?: string;
  /** `deletion_requested_at` relue après l'écriture, telle que la base la rend (D21). */
  storedRequestedAt?: string;
};

const NO_TRACE = { playedMatches: false, soloRegistrations: false, organizedTournaments: false, ownedTeams: false };

function livingMembers(options: Options) {
  const dead = options.deadMembers ?? [];
  const suspended = options.suspendedMembers ?? [];
  return (options.successors ?? [])
    .filter((m) => !dead.includes(m.user_id))
    .map((m) => ({ id: m.user_id, suspended: suspended.includes(m.user_id) ? 1 : 0 }));
}

function organizerRows(options: Options) {
  return options.organizerSuccessor ? [{ id: options.organizerSuccessor }] : [];
}

/** Inscriptions de l'équipe (lecture verrouillante) puis état de leurs tournois : la même réponse aux deux. */
function isActiveRegistrationRead(sql: string) {
  return (
    sql.startsWith("SELECT tournament_id FROM bg_tournament_registrations WHERE team_id") ||
    sql.startsWith("SELECT 1 FROM bg_tournaments WHERE id IN")
  );
}

/** Le premier relevé (avant la transaction) lit `organized`, les suivants `organizedLater` s'il est donné. */
function organizedRows(options: Options, queries: { sql: string }[]) {
  const reads = queries.filter((entry) => entry.sql.startsWith("SELECT id FROM bg_tournaments WHERE organizer_user_id"));
  const ids = reads.length > 1 && options.organizedLater ? options.organizedLater : (options.organized ?? []);
  return ids.map((id) => ({ id }));
}

/** Lectures simples, sans état : la date relue (D21), les équipes, le logo. */
function accountReads(q: string, options: Options): object[] | null {
  if (q.startsWith("SELECT deletion_requested_at FROM bg_users")) {
    return options.storedRequestedAt ? [{ deletion_requested_at: options.storedRequestedAt }] : [];
  }
  if (q.startsWith("SELECT tm.team_id")) return (options.teams ?? []).map((team_id) => ({ team_id }));
  if (q.startsWith("SELECT logo_url, deleted_at FROM bg_teams")) return [{ logo_url: "/api/uploads/teams/3.webp", deleted_at: null }];
  return null;
}

function fakeDb(options: Options) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    queries.push({ sql: q, params });
    if (options.failOn && q.startsWith(options.failOn)) throw new Error("DB_DOWN");
    if (q.startsWith("SELECT is_deleted, is_admin, created_at FROM bg_users")) {
      const failure = options.transactionErrors?.shift();
      if (failure) throw failure;
      return [[{ is_deleted: options.alreadyDeleted ? 1 : 0, is_admin: options.isAdmin ? 1 : 0, created_at: "2025-01-01 10:00:00" }]];
    }
    if (q.startsWith("SELECT id FROM bg_matches WHERE referee_user_id = ? AND status <> 'COMPLETED'")) {
      return [(options.refereedMatches ?? []).map((id) => ({ id }))];
    }
    if (q.startsWith("SELECT id FROM bg_users WHERE is_admin = 1")) {
      return [(options.otherAdmins ?? []).map(({ id }) => ({ id }))];
    }
    if (q.startsWith("SELECT is_admin, is_deleted FROM bg_users WHERE id = ? FOR UPDATE")) {
      const other = (options.otherAdmins ?? []).find(({ id }) => id === params[0]);
      return [other?.locked ? [other.locked] : []];
    }
    const read = accountReads(q, options);
    if (read) return [read];
    if (q.startsWith("SELECT tm.id, tm.user_id, tm.roles_json, tm.joined_at")) return [options.successors ?? []];
    if (q.startsWith("SELECT u.id, EXISTS (")) return [livingMembers(options)];
    if (q.startsWith("SELECT u.id FROM bg_users u")) return [organizerRows(options)];
    if (isActiveRegistrationRead(q)) return [options.activeTournament ? [{ tournament_id: 8 }] : []];
    if (q.startsWith("SELECT id FROM bg_tournaments WHERE organizer_user_id")) return [organizedRows(options, queries)];
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
  jest.mocked(listCastTournamentIds).mockResolvedValue([]);
  jest.mocked(loadSoloRegistrations).mockResolvedValue([]);
  jest.mocked(loadAccountTrace).mockResolvedValue(NO_TRACE);
  jest.mocked(withdrawSoloRegistrationsOn).mockResolvedValue([]);
  jest.mocked(listForfeitableSoloEntries).mockResolvedValue([]);
  jest.mocked(forfeitSoloEntriesAfterCommit).mockResolvedValue(0);
  jest.mocked(logDeletionWithdrawal).mockResolvedValue(undefined);
  jest.mocked(withdrawUserCasts).mockResolvedValue({ matchIds: [], tournamentIds: [] });
  jest.mocked(lockMemberRoles).mockResolvedValue(["OWNER", "DPS"]);
  jest.mocked(writeActiveMembership).mockResolvedValue(undefined);
  jest.mocked(dissolveTeamOn).mockResolvedValue({ detachedUserIds: [7], everRegistered: false });
  jest.mocked(teamStreamTournamentIds).mockResolvedValue(new Set());
  jest.mocked(sendBotLog).mockReturnValue(undefined);
  jest.mocked(deleteUnreferencedUpload).mockResolvedValue(true);
  jest.mocked(holdAccountIdentity).mockResolvedValue(true);
  jest.mocked(recordAccountDeletion).mockResolvedValue(undefined);
});

describe("requestAccountDeletion — le compte", () => {
  it("requestAccountDeletion_alreadyDeleted_throwsUserNotFoundAndRollsBack", async () => {
    const { connection } = fakeDb({ alreadyDeleted: true });

    await expect(requestAccountDeletion(7)).rejects.toThrow("USER_NOT_FOUND");
    expect(connection.rollback).toHaveBeenCalled();
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  // Revue sécurité #571 : le rejeu ne touche jamais la ligne d'un autre compte.
  it("requestAccountDeletion_createdAtMismatchUnderLock_throwsAccountReassigned", async () => {
    const { connection } = fakeDb({});

    await expect(requestAccountDeletion(7, { accountCreatedAt: "2026-09-22 08:00:00" })).rejects.toThrow(
      "ACCOUNT_REASSIGNED",
    );
    expect(connection.rollback).toHaveBeenCalled();
    expect(recordAccountDeletion).not.toHaveBeenCalled();
  });

  it("requestAccountDeletion_nominal_marksPendingAndDeletesSessionsInTransaction", async () => {
    const { queries, connection } = fakeDb({});

    await requestAccountDeletion(7);

    // Le compte passe en attente et devient anonyme dans la même écriture
    // (`holdAccountIdentity`, sur la transaction).
    expect(holdAccountIdentity).toHaveBeenCalledWith(expect.anything(), 7, expect.any(Date));
    expect(queries.some((q) => q.sql === "DELETE FROM bg_user_sessions WHERE user_id = ?")).toBe(true);
    expect(connection.commit).toHaveBeenCalled();
    expect(closeUserStreams).toHaveBeenCalledWith(7);
  });

  // D21 : le journal garde la date telle que la base l'a écrite.
  it("requestAccountDeletion_nominal_journalsStoredRequestDate", async () => {
    fakeDb({ storedRequestedAt: "2026-11-10 09:15:00" });

    await requestAccountDeletion(7);

    expect(recordAccountDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, pending: true, requestedAt: "2026-11-10 09:15:00" }),
    );
  });

  it("requestAccountDeletion_storedDateUnreadable_journalsWithoutRawDate", async () => {
    fakeDb({});

    await requestAccountDeletion(7);

    expect(jest.mocked(recordAccountDeletion).mock.calls[0][0]).not.toHaveProperty("requestedAt");
  });

  it("requestAccountDeletion_replayWithRawDate_holdsRawText", async () => {
    fakeDb({});

    await requestAccountDeletion(7, { requestedAt: new Date("2026-11-10T08:15:00Z"), requestedAtRaw: "2026-11-10 09:15:00" });

    expect(holdAccountIdentity).toHaveBeenCalledWith(expect.anything(), 7, "2026-11-10 09:15:00");
  });

  // D30 : la demande du joueur ne bloque aucune image — seul ce que la
  // modération a supprimé l'est (D6).
  it("requestAccountDeletion_ownRequest_blocksNoImageHash", async () => {
    const { queries } = fakeDb({});

    await requestAccountDeletion(7);

    expect(queries.some((q) => q.sql.includes("bg_blocked_image_hashes"))).toBe(false);
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
      if (sql.startsWith("SELECT is_deleted, is_admin, created_at FROM bg_users")) order.push("account");
      return execute(sql, params);
    });

    await requestAccountDeletion(7);

    expect(order.slice(0, 3)).toEqual(["tournament 3", "tournament 5", "account"]);
  });

  it("requestAccountDeletion_organizedAndCastTournaments_locksUnionInIdOrderBeforeAccount", async () => {
    const order: string[] = [];
    jest.mocked(listSoloRegistrationTournamentIds).mockResolvedValue([3]);
    jest.mocked(listCastTournamentIds).mockResolvedValue([1, 3, 5]);
    jest.mocked(lockTournamentRow).mockImplementation(async (_c, id) => {
      order.push(`tournament ${id}`);
    });
    const { connection } = fakeDb({ organized: [4, 5] });
    const execute = connection.execute.getMockImplementation()!;
    connection.execute.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("SELECT is_deleted, is_admin, created_at FROM bg_users")) order.push("account");
      return execute(sql, params);
    });

    await requestAccountDeletion(7);

    expect(order.slice(0, 5)).toEqual(["tournament 1", "tournament 3", "tournament 4", "tournament 5", "account"]);
  });

  it("requestAccountDeletion_failureMidway_rollsBackAndSendsNothing", async () => {
    const { connection } = fakeDb({ failOn: "UPDATE bg_report_targets SET label_snapshot = NULL" });

    await expect(requestAccountDeletion(7)).rejects.toThrow("DB_DOWN");
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(closeUserStreams).not.toHaveBeenCalled();
    expect(forfeitSoloEntriesAfterCommit).not.toHaveBeenCalled();
  });
});

// ERREUR.txt (revue EF-21 #526) : un match qui n'attendait plus que l'arbitre
// part, et le staff est prévenu (ligne anonyme), au commit seulement.
describe("requestAccountDeletion — arbitrages retirés", () => {
  it("requestAccountDeletion_refereeOfOpenMatches_relaunchesThemAndFlushesAfterCommit", async () => {
    const { connection } = fakeDb({ refereedMatches: [4, 9] });

    await requestAccountDeletion(7);

    expect(relaunchAfterRefereeWithdrawal).toHaveBeenCalledWith(connection, [4, 9]);
    expect(flushBotLogs).toHaveBeenCalledWith(connection);
    expect(discardBotLogs).not.toHaveBeenCalled();
    const relaunchOrder = jest.mocked(relaunchAfterRefereeWithdrawal).mock.invocationCallOrder[0];
    expect(jest.mocked(withdrawUserCasts).mock.invocationCallOrder[0]).toBeLessThan(relaunchOrder);
    expect(connection.commit.mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(flushBotLogs).mock.invocationCallOrder[0]);
  });

  it("requestAccountDeletion_noRefereeing_relaunchesNothing", async () => {
    const { connection } = fakeDb({});

    await requestAccountDeletion(7);

    expect(relaunchAfterRefereeWithdrawal).toHaveBeenCalledWith(connection, []);
  });

  it("requestAccountDeletion_failureAfterRelaunch_discardsQueuedNotices", async () => {
    const { connection } = fakeDb({ refereedMatches: [4], failOn: "UPDATE bg_team_invitations" });

    await expect(requestAccountDeletion(7)).rejects.toThrow("DB_DOWN");
    expect(discardBotLogs).toHaveBeenCalledWith(connection);
    expect(flushBotLogs).not.toHaveBeenCalled();
  });
});

// ERREUR.txt (revue sécurité #509) : le dernier administrateur vivant ne
// ferme pas l'administration de la plateforme en supprimant son compte.
describe("requestAccountDeletion — dernier administrateur", () => {
  it("requestAccountDeletion_lastAdmin_refusedAndRolledBack", async () => {
    const { connection } = fakeDb({ isAdmin: true, otherAdmins: [] });

    await expect(requestAccountDeletion(7)).rejects.toThrow("LAST_ADMIN_ACCOUNT");
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(holdAccountIdentity).not.toHaveBeenCalled();
    expect(recordAccountDeletion).not.toHaveBeenCalled();
  });

  it("requestAccountDeletion_adminWithAnotherLivingAdmin_lockedAndAccepted", async () => {
    const { queries, connection } = fakeDb({ isAdmin: true, otherAdmins: [{ id: 9, locked: { is_admin: 1, is_deleted: 0 } }] });

    await requestAccountDeletion(7);

    expect(connection.commit).toHaveBeenCalled();
    const lock = queries.find(({ sql }) => sql.startsWith("SELECT is_admin, is_deleted FROM bg_users WHERE id = ? FOR UPDATE"));
    expect(lock?.params).toEqual([9]);
  });

  it("requestAccountDeletion_otherAdminGoneUnderLock_refused", async () => {
    fakeDb({
      isAdmin: true,
      otherAdmins: [
        { id: 9, locked: { is_admin: 1, is_deleted: 1 } },
        { id: 10, locked: { is_admin: 0, is_deleted: 0 } },
        { id: 11, locked: null },
      ],
    });

    await expect(requestAccountDeletion(7)).rejects.toThrow("LAST_ADMIN_ACCOUNT");
  });

  it("requestAccountDeletion_nonAdmin_neverReadsAdmins", async () => {
    const { queries } = fakeDb({ isAdmin: false });

    await requestAccountDeletion(7);

    expect(queries.some(({ sql }) => sql.includes("is_admin = 1"))).toBe(false);
  });

  it("requestAccountDeletion_replayOfLastAdmin_notRefused", async () => {
    const { connection } = fakeDb({ isAdmin: true, otherAdmins: [] });

    await requestAccountDeletion(7, { accountCreatedAt: "2025-01-01 10:00:00" });

    expect(connection.commit).toHaveBeenCalled();
  });
});

// ERREUR.txt (revue sécurité EF-21 #526) : la demande s'interbloque avec une
// désignation d'arbitre (match puis compte) ; la victime se rejoue.
describe("requestAccountDeletion — interblocage", () => {
  const deadlock = () => Object.assign(new Error("Deadlock found when trying to get lock"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });

  it("requestAccountDeletion_deadlockOnce_retriedAndCommitted", async () => {
    const { connection } = fakeDb({ transactionErrors: [deadlock()] });

    await requestAccountDeletion(7);

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(2);
    expect(recordAccountDeletion).toHaveBeenCalledTimes(1);
  });

  it("requestAccountDeletion_deadlockEveryAttempt_rethrowsAfterThree", async () => {
    const { connection } = fakeDb({ transactionErrors: [deadlock(), deadlock(), deadlock()] });

    await expect(requestAccountDeletion(7)).rejects.toThrow("Deadlock");
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(3);
  });

  it("requestAccountDeletion_otherError_notRetried", async () => {
    const { connection } = fakeDb({ transactionErrors: [new Error("DB_DOWN")] });

    await expect(requestAccountDeletion(7)).rejects.toThrow("DB_DOWN");
    expect(connection.release).toHaveBeenCalledTimes(1);
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

  it("requestAccountDeletion_ownerWithSuccessors_locksMembershipRowsWithoutJoiningUsers", async () => {
    const { queries } = fakeDb({ teams: [3], successors: [member(8, ["MANAGER"], "2025-01-01 00:00:00")] });

    await requestAccountDeletion(7);

    const lock = queries.find((q) => q.sql.startsWith("SELECT tm.id, tm.user_id, tm.roles_json"));
    expect(lock?.sql).toContain("FOR UPDATE");
    expect(lock?.sql).not.toContain("bg_users");
  });

  it("requestAccountDeletion_managerAccountDeleted_skippedForNextLivingMember", async () => {
    fakeDb({
      teams: [3],
      deadMembers: [9],
      successors: [member(8, ["CAPITAINE"], "2025-01-01 00:00:00"), member(9, ["MANAGER"], "2026-06-01 00:00:00")],
    });

    await requestAccountDeletion(7);

    expect(rolesWritten()).toEqual([{ teamId: 3, userId: 8, roles: ["OWNER", "CAPITAINE"] }]);
  });

  // Revue légale #546 cycle 3 : un copropriétaire ne reçoit ni écriture ni avis « propriété transférée ».
  it("requestAccountDeletion_coOwnerPresent_noRoleWriteAndNoOwnershipNotice", async () => {
    fakeDb({
      teams: [3],
      successors: [member(8, ["MANAGER"], "2025-01-01 00:00:00"), member(9, ["OWNER", "DPS"], "2026-06-01 00:00:00")],
    });

    await requestAccountDeletion(7);

    expect(rolesWritten()).toEqual([]);
    expect(notifyTeamInviteInBackground).not.toHaveBeenCalled();
    expect(leftTeams()).toEqual([{ teamId: 3, userId: 7 }]);
  });

  // Revue sécurité #546 (reprise, cycle 2) : un membre suspendu ne reçoit l'équipe qu'à défaut d'autre membre.
  it("requestAccountDeletion_suspendedManager_transfersToActiveMember", async () => {
    const { queries } = fakeDb({
      teams: [3],
      suspendedMembers: [9],
      successors: [member(8, ["TANK"], "2026-06-01 00:00:00"), member(9, ["MANAGER"], "2025-01-01 00:00:00")],
    });

    await requestAccountDeletion(7);

    expect(rolesWritten()).toEqual([{ teamId: 3, userId: 8, roles: ["OWNER", "TANK"] }]);
    expect(queries.find((q) => q.sql.startsWith("SELECT u.id, EXISTS ("))?.sql).toContain("bg_account_suspensions");
  });

  it("requestAccountDeletion_onlySuspendedMember_stillTransfersToIt", async () => {
    fakeDb({ teams: [3], suspendedMembers: [9], successors: [member(9, ["HEAL"], "2025-01-01 00:00:00")] });

    await requestAccountDeletion(7);

    expect(rolesWritten()).toEqual([{ teamId: 3, userId: 9, roles: ["OWNER", "HEAL"] }]);
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

  it("requestAccountDeletion_soleOwner_registrationReadIsLockingWithoutJoin", async () => {
    const { queries } = fakeDb({ teams: [3], successors: [], activeTournament: true });

    await requestAccountDeletion(7);

    const read = queries.find((q) => q.sql.startsWith("SELECT tournament_id FROM bg_tournament_registrations"));
    expect(read?.sql).toContain("LOCK IN SHARE MODE");
    expect(read?.sql).not.toContain("JOIN");
  });

  it("requestAccountDeletion_soleOwnerNoRegistration_skipsStateRead", async () => {
    const { queries } = fakeDb({ teams: [3], successors: [], activeTournament: false });

    await requestAccountDeletion(7);

    expect(queries.some((q) => q.sql.startsWith("SELECT 1 FROM bg_tournaments WHERE id IN"))).toBe(false);
  });

  it("requestAccountDeletion_soloEntryStaysInTournament_republishesIt", async () => {
    jest.mocked(listSoloRegistrationTournamentIds).mockResolvedValue([8]);
    fakeDb({});

    await requestAccountDeletion(7);

    expect(publishUpdatedEvent).toHaveBeenCalledWith(8);
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
    expect(handover?.sql).toContain("WHERE organizer_user_id = ? AND id IN (?, ?)");
    expect(handover?.params).toEqual([21, 7, 11, 12]);
  });

  it("requestAccountDeletion_tournamentAssignedAfterPreRead_notHandedOver", async () => {
    const { queries } = fakeDb({ organized: [11], organizedLater: [11, 12], organizerSuccessor: 21 });

    await requestAccountDeletion(7);

    const handover = queries.find((q) => q.sql.startsWith("UPDATE bg_tournaments SET organizer_user_id = ?"));
    expect(handover?.params).toEqual([21, 7, 11]);
  });

  it("findOrganizerSuccessor_query_excludesActivelySuspendedAccounts", async () => {
    const { queries } = fakeDb({ organized: [11], organizerSuccessor: 21 });

    await requestAccountDeletion(7);

    const lookup = queries.find((q) => q.sql.startsWith("SELECT u.id FROM bg_users u"));
    expect(lookup?.sql).toContain("NOT EXISTS ( SELECT 1 FROM bg_account_suspensions s WHERE s.user_id = u.id");
    expect(lookup?.sql).toContain("s.lifted_at IS NULL");
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
    expect(message).toContain("Suppression de compte demandée");
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
      return 1;
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
    jest.mocked(sendBotLog).mockImplementation(() => {
      throw new Error("BOT_DOWN");
    });
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
