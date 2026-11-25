import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/notify", () => ({ loadNotificationRecipients: jest.fn(), notifyUsers: jest.fn() }));
jest.mock("@/lib/server/push-subscriptions", () => ({ usersWithTopicDisabled: jest.fn() }));
jest.mock("@/lib/server/staff-audit", () => ({ publishStaffAction: jest.fn() }));
jest.mock("@/lib/server/site-url", () => ({ siteUrl: jest.fn((path: string) => `https://bluegenji.test${path}`) }));
jest.mock("@/lib/server/periodic-clock", () => ({ startPeriodicClock: jest.fn(), trackBackgroundPass: jest.fn() }));

import { getDatabase } from "@/lib/server/database";
import { loadNotificationRecipients, notifyUsers, type NotificationRecipient } from "@/lib/server/notify";
import { usersWithTopicDisabled } from "@/lib/server/push-subscriptions";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { startPeriodicClock } from "@/lib/server/periodic-clock";
import {
  countTournamentStaffMessageRecipients,
  previewTournamentStaffMessage,
  purgeExpiredStaffMessageQuotas,
  reserveStaffMessageSend,
  selectRecipientIds,
  sendTournamentStaffMessage,
  startStaffMessageQuotaPurgeClock,
  type StaffMessageRequest,
} from "@/lib/server/tournament-staff-message";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/** `/message-tournoi` côté site : droits, état du tournoi, destinataires comptés, plafond, envoi. */

type Rows = Record<string, unknown>[];

/** État de la base simulée, lu par le routeur SQL ci-dessous. */
let staffRows: Rows;
let tournamentRows: Rows;
let entrantRows: Rows;
/** `affectedRows` de chaque `UPDATE` de réservation, dans l'ordre ; le dernier vaut ensuite. */
let quotaAffectedRows: number[];
let quotaMissing: boolean;
let purgedRows: number;
const execute = jest.fn<SqlQuery>();

function missingTable(): Error {
  return Object.assign(new Error("Table 'bg.bg_tournament_staff_message_quota' doesn't exist"), { code: "ER_NO_SUCH_TABLE" });
}

/** Chaque requête reçoit les lignes de sa table : l'ordre des appels (purge lancée sans attente) n'importe pas. */
async function route(sql: string): Promise<unknown> {
  if (sql.includes("FROM bg_users u")) return [staffRows];
  if (sql.includes("FROM bg_tournaments")) return [tournamentRows];
  if (sql.includes("bg_tournament_registrations")) return [entrantRows];
  if (sql.includes("bg_tournament_staff_message_quota")) {
    if (quotaMissing) throw missingTable();
    if (sql.startsWith("UPDATE bg_tournament_staff_message_quota\n")) {
      const affectedRows = quotaAffectedRows.length > 1 ? quotaAffectedRows.shift() : quotaAffectedRows[0];
      return [{ affectedRows }];
    }
    if (sql.startsWith("DELETE FROM bg_tournament_staff_message_quota")) return [{ affectedRows: purgedRows }];
    return [{ affectedRows: 1 }];
  }
  throw new Error(`requête inattendue : ${sql}`);
}

const staff = (overrides: Record<string, unknown> = {}) => ({
  id: 9,
  pseudo: "Arbitre",
  is_admin: 0,
  platform_roles_json: JSON.stringify(["ARBITRE"]),
  suspended: 0,
  ...overrides,
});

const request = (overrides: Partial<StaffMessageRequest> = {}): StaffMessageRequest => ({
  author: { discordId: "100000000000000009" },
  tournamentId: 12,
  categories: ["ALL"],
  message: "Check-in à 20 h",
  ...overrides,
});

const withDiscord = (userId: number): NotificationRecipient => ({
  userId,
  discord: { discordId: `10000000000000000${userId}`, handle: null, label: `p${userId}` },
});
const withoutDiscord = (userId: number): NotificationRecipient => ({ userId, discord: null });

beforeEach(() => {
  jest.clearAllMocks();
  staffRows = [staff()];
  tournamentRows = [{ id: 12, name: "Coupe d'hiver", state: "RUNNING" }];
  entrantRows = [
    { user_id: 1, roles_json: JSON.stringify(["OWNER", "TANK"]), solo: 0 },
    { user_id: 2, roles_json: JSON.stringify(["COACH"]), solo: 0 },
  ];
  quotaAffectedRows = [1];
  quotaMissing = false;
  purgedRows = 0;
  execute.mockImplementation(route);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  jest.mocked(loadNotificationRecipients).mockImplementation(async (ids) =>
    ids.map((id) => (id === 2 ? withoutDiscord(id) : withDiscord(id))),
  );
  jest.mocked(usersWithTopicDisabled).mockResolvedValue(new Set());
  jest.mocked(notifyUsers).mockResolvedValue({ discord: { sent: 1, unresolved: [], failed: [] }, discordUnreachedUserIds: [], pushed: 3 });
});

describe("previewTournamentStaffMessage — droits", () => {
  it("previewTournamentStaffMessage_unlinkedDiscord_throws403NotLinked", async () => {
    staffRows = [];

    await expect(previewTournamentStaffMessage(request())).rejects.toMatchObject({ message: "DISCORD_ACCOUNT_NOT_LINKED", status: 403 });
  });

  it("previewTournamentStaffMessage_accountWithoutTournamentsPermission_throws403Forbidden", async () => {
    staffRows = [staff({ platform_roles_json: JSON.stringify(["CASTER"]) })];

    await expect(previewTournamentStaffMessage(request())).rejects.toMatchObject({ message: "FORBIDDEN", status: 403 });
  });

  it("previewTournamentStaffMessage_suspendedReferee_throws403Forbidden", async () => {
    staffRows = [staff({ suspended: 1 })];

    await expect(previewTournamentStaffMessage(request())).rejects.toMatchObject({ message: "FORBIDDEN", status: 403 });
  });

  it("previewTournamentStaffMessage_administratorWithoutRoles_isAllowed", async () => {
    staffRows = [staff({ is_admin: 1, platform_roles_json: "[]" })];

    await expect(previewTournamentStaffMessage(request())).resolves.toMatchObject({ tournament: { id: 12 } });
  });
});

describe("previewTournamentStaffMessage — tournoi et texte", () => {
  it("previewTournamentStaffMessage_unknownTournament_throws404", async () => {
    tournamentRows = [];

    await expect(previewTournamentStaffMessage(request())).rejects.toMatchObject({ message: "TOURNAMENT_NOT_FOUND", status: 404 });
  });

  it.each<[string]>([["FINISHED"], ["UPCOMING"]])("previewTournamentStaffMessage_%s_throws409", async (state) => {
    tournamentRows = [{ id: 12, name: "Coupe", state }];

    await expect(previewTournamentStaffMessage(request())).rejects.toMatchObject({ message: "TOURNAMENT_NOT_OPEN_FOR_MESSAGES", status: 409 });
  });

  it("previewTournamentStaffMessage_registrationOpen_isAllowed", async () => {
    tournamentRows = [{ id: 12, name: "Coupe", state: "REGISTRATION" }];

    await expect(previewTournamentStaffMessage(request())).resolves.toMatchObject({ tournament: { name: "Coupe" } });
  });

  it("previewTournamentStaffMessage_textTooLongOnceFormatted_throws400", async () => {
    await expect(previewTournamentStaffMessage(request({ message: "*".repeat(1200) }))).rejects.toMatchObject({
      message: "STAFF_MESSAGE_TOO_LONG",
      status: 400,
    });
  });
});

describe("previewTournamentStaffMessage — destinataires", () => {
  it("previewTournamentStaffMessage_mixedRecipients_returnsCountsOnly", async () => {
    entrantRows = [
      { user_id: 1, roles_json: "[\"DPS\"]", solo: 0 },
      { user_id: 2, roles_json: "[\"DPS\"]", solo: 0 },
      { user_id: 3, roles_json: "[\"DPS\"]", solo: 0 },
    ];
    jest.mocked(usersWithTopicDisabled).mockResolvedValue(new Set([3]));

    const actual = await previewTournamentStaffMessage(request());

    expect(actual).toEqual({
      tournament: { id: 12, name: "Coupe d'hiver" },
      recipients: { total: 3, reachable: 1, withoutDiscord: 1, optedOut: 1 },
    });
  });

  it("previewTournamentStaffMessage_loadsProvenReachExcludingSuspended", async () => {
    await previewTournamentStaffMessage(request());

    expect(loadNotificationRecipients).toHaveBeenCalledWith([1, 2], "proven", { excludeSuspended: true });
  });

  it("previewTournamentStaffMessage_optOutTableMissing_countsNobodyAsOptedOut", async () => {
    jest.mocked(usersWithTopicDisabled).mockRejectedValue(Object.assign(new Error("missing"), { code: "ER_NO_SUCH_TABLE" }));

    const actual = await previewTournamentStaffMessage(request());

    expect(actual.recipients.optedOut).toBe(0);
  });

  it("previewTournamentStaffMessage_entrantQuery_excludesGhostsDissolvedLeftAndForfeitedEntrants", async () => {
    await previewTournamentStaffMessage(request());

    const sql = String(execute.mock.calls.find(([text]) => text.includes("bg_tournament_registrations"))?.[0]);
    expect(sql).toContain("t.is_ghost = 0");
    expect(sql).toContain("t.deleted_at IS NULL");
    expect(sql).toContain("tm.left_at IS NULL");
    expect(sql).toContain("t.solo_user_id IS NULL");
    expect(sql).toContain("bg_swiss_standings st WHERE st.tournament_id = r.tournament_id AND st.team_id = r.team_id AND st.status = 'FORFEIT'");
    expect(sql).toContain("bg_survival_standings");
    expect(sql).toContain("bg_endurance_standings");
  });

  it("previewTournamentStaffMessage_neverReservesQuotaNorSends", async () => {
    await previewTournamentStaffMessage(request());

    expect(notifyUsers).not.toHaveBeenCalled();
    expect(execute.mock.calls.some(([sql]) => sql.startsWith("UPDATE bg_tournament_staff_message_quota"))).toBe(false);
  });
});

describe("porte du site (compte de session)", () => {
  const fromSite = (overrides: Partial<StaffMessageRequest> = {}): StaffMessageRequest => request({ author: { userId: 9 }, ...overrides });

  it("countTournamentStaffMessageRecipients_staffBySession_returnsCountsWithoutReservingOrSending", async () => {
    const actual = await countTournamentStaffMessageRecipients({ author: { userId: 9 }, tournamentId: 12, categories: ["ALL"] });

    expect(actual).toEqual({
      tournament: { id: 12, name: "Coupe d'hiver" },
      recipients: { total: 2, reachable: 1, withoutDiscord: 1, optedOut: 0 },
    });
    expect(execute.mock.calls.some(([sql]) => sql.includes("bg_tournament_staff_message_quota") && !sql.startsWith("DELETE"))).toBe(false);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("countTournamentStaffMessageRecipients_finishedTournament_rejectsNotOpen", async () => {
    tournamentRows = [{ id: 12, name: "Coupe", state: "FINISHED" }];

    await expect(
      countTournamentStaffMessageRecipients({ author: { userId: 9 }, tournamentId: 12, categories: ["ALL"] }),
    ).rejects.toMatchObject({ message: "TOURNAMENT_NOT_OPEN_FOR_MESSAGES", status: 409 });
  });

  it("previewTournamentStaffMessage_sessionAccountGone_rejectsForbidden", async () => {
    staffRows = [];

    await expect(previewTournamentStaffMessage(fromSite())).rejects.toMatchObject({ message: "FORBIDDEN", status: 403 });
  });

  it("sendTournamentStaffMessage_sessionAuthor_readsAccountById", async () => {
    await sendTournamentStaffMessage(fromSite());

    const lookup = execute.mock.calls.find(([sql]) => sql.includes("FROM bg_users u"));
    expect(lookup?.[0]).toContain("WHERE u.id = ?");
    expect(lookup?.[1]).toEqual([9]);
  });
});

describe("selectRecipientIds", () => {
  const rows = [
    { user_id: 1, roles_json: "[\"OWNER\"]", solo: 0 },
    { user_id: 2, roles_json: "[\"TANK\"]", solo: 0 },
    { user_id: 3, roles_json: null, solo: 1 },
    { user_id: 2, roles_json: "[\"MANAGER\"]", solo: 0 },
  ] as Parameters<typeof selectRecipientIds>[0];

  it("selectRecipientIds_owners_returnsOwnersOnly", () => {
    expect(selectRecipientIds(rows, ["OWNERS"])).toEqual([1]);
  });

  it("selectRecipientIds_players_includesSoloPlayer", () => {
    expect(selectRecipientIds(rows, ["PLAYERS"])).toEqual([2, 3]);
  });

  it("selectRecipientIds_all_countsMemberOfTwoTeamsOnce", () => {
    expect(selectRecipientIds(rows, ["ALL"])).toEqual([1, 2, 3]);
  });
});

describe("sendTournamentStaffMessage", () => {
  it("sendTournamentStaffMessage_nobodyToNotify_throws409WithoutReserving", async () => {
    jest.mocked(usersWithTopicDisabled).mockResolvedValue(new Set([1, 2]));

    await expect(sendTournamentStaffMessage(request())).rejects.toMatchObject({ message: "NO_RECIPIENTS", status: 409 });
    expect(execute.mock.calls.some(([sql]) => sql.includes("bg_tournament_staff_message_quota"))).toBe(false);
  });

  it("sendTournamentStaffMessage_quotaReached_throws429WithoutSending", async () => {
    quotaAffectedRows = [0];

    await expect(sendTournamentStaffMessage(request())).rejects.toMatchObject({ message: "STAFF_MESSAGE_QUOTA_EXCEEDED", status: 429 });
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("sendTournamentStaffMessage_quotaTableMissing_throws503", async () => {
    quotaMissing = true;

    await expect(sendTournamentStaffMessage(request())).rejects.toMatchObject({ message: "STAFF_MESSAGE_UNAVAILABLE", status: 503 });
  });

  it("sendTournamentStaffMessage_ok_notifiesThroughTopicWithStaffDelivery", async () => {
    await sendTournamentStaffMessage(request());

    expect(notifyUsers).toHaveBeenCalledWith(
      [withDiscord(1), withoutDiscord(2)],
      expect.objectContaining({
        topic: "TOURNAMENT_STAFF_MESSAGE",
        dmFollowsTopic: true,
        discord: expect.objectContaining({
          context: "tournament-staff-message",
          delivery: { batchSize: 25, timeoutMs: 120_000, honourCircuit: false, uncertainIsNotLost: true },
        }),
      }),
    );
  });

  it("sendTournamentStaffMessage_ok_directMessageQuotesTheStaffText", async () => {
    await sendTournamentStaffMessage(request());

    const dm = jest.mocked(notifyUsers).mock.calls[0][1].discord?.message;
    expect(dm?.("fr")).toContain("> Check\\-in à 20 h");
  });

  it("sendTournamentStaffMessage_ok_returnsCountedDelivery", async () => {
    const actual = await sendTournamentStaffMessage(request());

    expect(actual.delivery).toEqual({ sent: 1, failed: 0, skipped: 1, pushed: 3, botUnreachable: false, pending: false });
  });

  it("sendTournamentStaffMessage_dmUndelivered_countsItFailed", async () => {
    jest.mocked(notifyUsers).mockResolvedValue({ discord: { sent: 0, unresolved: ["p1"], failed: [] }, discordUnreachedUserIds: [], pushed: 0 });

    const actual = await sendTournamentStaffMessage(request());

    expect(actual.delivery).toMatchObject({ sent: 0, failed: 1, botUnreachable: false });
  });

  it("sendTournamentStaffMessage_botUnreachableAndNoPush_refundsTheReservedSend", async () => {
    jest.mocked(notifyUsers).mockResolvedValue({ discord: null, discordUnreachedUserIds: [1], pushed: 0 });

    const actual = await sendTournamentStaffMessage(request());

    expect(actual.delivery.botUnreachable).toBe(true);
    expect(execute.mock.calls.some(([sql]) => sql.includes("SET sends = GREATEST(sends - 1, 0)"))).toBe(true);
  });

  it("sendTournamentStaffMessage_pushReachedDespiteBot_keepsTheReservedSend", async () => {
    jest.mocked(notifyUsers).mockResolvedValue({ discord: null, discordUnreachedUserIds: [1], pushed: 2 });

    await sendTournamentStaffMessage(request());

    expect(execute.mock.calls.some(([sql]) => sql.includes("GREATEST(sends - 1, 0)"))).toBe(false);
  });

  it("sendTournamentStaffMessage_ok_publishesAnonymousLineWithoutTheText", async () => {
    await sendTournamentStaffMessage(request({ message: "Texte secret" }));

    const [line, actor, options] = jest.mocked(publishStaffAction).mock.calls[0];
    expect(line).toContain("« Coupe d'hiver »");
    expect(line).toContain("par le staff");
    expect(line).not.toContain("Texte secret");
    expect(line).not.toContain("Arbitre");
    expect(actor).toEqual({ id: 9, pseudo: "Arbitre" });
    expect(options).toMatchObject({ category: "tournament", tournamentId: 12 });
    expect(options.auditLine).not.toContain("Texte secret");
  });
});

describe("reserveStaffMessageSend", () => {
  it("reserveStaffMessageSend_placeLeft_returnsTrue", async () => {
    await expect(reserveStaffMessageSend(12, 9)).resolves.toBe(true);
  });

  it("reserveStaffMessageSend_windowFull_returnsFalse", async () => {
    quotaAffectedRows = [0];

    await expect(reserveStaffMessageSend(12, 9)).resolves.toBe(false);
  });

  it("reserveStaffMessageSend_reservesInOneConditionalUpdate", async () => {
    await reserveStaffMessageSend(12, 9);

    const update = execute.mock.calls.find(([sql]) => sql.startsWith("UPDATE bg_tournament_staff_message_quota\n"));
    expect(update?.[0]).toContain("AND (sends < ? OR window_started_at <= NOW() - INTERVAL ? MINUTE)");
    expect(update?.[1]).toEqual([60, 60, 12, 9, 3, 60]);
  });
});

describe("sendTournamentStaffMessage — délai de réponse", () => {
  /** Un envoi qui ne finit qu'à la demande du test. */
  function slowDelivery() {
    let finish: (value: Awaited<ReturnType<typeof notifyUsers>>) => void = () => undefined;
    let fail: (error: Error) => void = () => undefined;
    jest.mocked(notifyUsers).mockReturnValue(
      new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
    );
    return { finish: (value: Awaited<ReturnType<typeof notifyUsers>>) => finish(value), fail: (error: Error) => fail(error) };
  }

  it("sendTournamentStaffMessage_deliveryOutlastsDeadline_returnsPendingWithZeroCounts", async () => {
    slowDelivery();

    const actual = await sendTournamentStaffMessage(request(), { replyDeadlineMs: 5 });

    expect(actual.delivery).toEqual({ sent: 0, failed: 0, skipped: 1, pushed: 0, botUnreachable: false, pending: true });
  });

  it("sendTournamentStaffMessage_deliveryOutlastsDeadline_publishesStaffLogWhenItFinishes", async () => {
    const delivery = slowDelivery();
    await sendTournamentStaffMessage(request(), { replyDeadlineMs: 5 });
    expect(publishStaffAction).not.toHaveBeenCalled();

    delivery.finish({ discord: { sent: 1, unresolved: [], failed: [] }, discordUnreachedUserIds: [], pushed: 1 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(publishStaffAction).toHaveBeenCalledTimes(1);
  });

  it("sendTournamentStaffMessage_deliveryFailsAfterDeadline_logsWithoutThrowing", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const delivery = slowDelivery();
    await sendTournamentStaffMessage(request(), { replyDeadlineMs: 5 });

    delivery.fail(new Error("bot figé"));
    await new Promise((resolve) => setImmediate(resolve));

    expect(consoleError).toHaveBeenCalledWith("[staff-message] envoi interrompu en arrière-plan", expect.anything());
    consoleError.mockRestore();
  });

  it("sendTournamentStaffMessage_deliveryFailsBeforeDeadline_rejects", async () => {
    jest.mocked(notifyUsers).mockRejectedValue(new Error("rédacteur en panne"));

    await expect(sendTournamentStaffMessage(request())).rejects.toThrow("rédacteur en panne");
  });

  it("sendTournamentStaffMessage_discordUncertain_returnsPendingWithoutRefund", async () => {
    jest.mocked(notifyUsers).mockResolvedValue({ discord: null, discordUnreachedUserIds: [1], pushed: 0, discordUncertain: true });

    const actual = await sendTournamentStaffMessage(request());

    expect(actual.delivery).toMatchObject({ botUnreachable: false, pending: true });
    expect(execute.mock.calls.some(([sql]) => sql.includes("GREATEST(sends - 1, 0)"))).toBe(false);
  });
});

describe("reserveStaffMessageSend — seconde passe", () => {
  it("reserveStaffMessageSend_rowPurgedBetweenInsertAndUpdate_succeedsOnSecondPass", async () => {
    quotaAffectedRows = [0, 1];

    const actual = await reserveStaffMessageSend(12, 9);

    expect(actual).toBe(true);
    const inserts = execute.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO bg_tournament_staff_message_quota"));
    expect(inserts).toHaveLength(2);
  });

  it("reserveStaffMessageSend_windowFull_refusesAfterTwoPasses", async () => {
    quotaAffectedRows = [0];

    const actual = await reserveStaffMessageSend(12, 9);

    expect(actual).toBe(false);
    const updates = execute.mock.calls.filter(([sql]) => sql.startsWith("UPDATE bg_tournament_staff_message_quota\n"));
    expect(updates).toHaveLength(2);
  });
});

describe("purgeExpiredStaffMessageQuotas", () => {
  it("purgeExpiredStaffMessageQuotas_expiredRows_returnsDeletedCount", async () => {
    purgedRows = 4;

    const actual = await purgeExpiredStaffMessageQuotas();

    expect(actual).toBe(4);
    const purge = execute.mock.calls.find(([sql]) => sql.startsWith("DELETE FROM bg_tournament_staff_message_quota"));
    expect(purge?.[1]).toEqual([60]);
  });

  it("purgeExpiredStaffMessageQuotas_tableMissing_resolvesZero", async () => {
    quotaMissing = true;

    await expect(purgeExpiredStaffMessageQuotas()).resolves.toBe(0);
  });

  it("purgeExpiredStaffMessageQuotas_otherError_rejects", async () => {
    execute.mockRejectedValueOnce(new Error("base indisponible"));

    await expect(purgeExpiredStaffMessageQuotas()).rejects.toThrow("base indisponible");
  });
});

describe("startStaffMessageQuotaPurgeClock", () => {
  it("startStaffMessageQuotaPurgeClock_called_registersQuarterHourClock", () => {
    startStaffMessageQuotaPurgeClock();

    expect(startPeriodicClock).toHaveBeenCalledWith(
      expect.objectContaining({ key: "staff-message-quota-purge", tickMs: 15 * 60_000, run: purgeExpiredStaffMessageQuotas }),
    );
  });
});
