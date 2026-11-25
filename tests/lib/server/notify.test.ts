import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/push-subscriptions");

import { getDatabase } from "@/lib/server/database";
import { pushDiscordDirectMessages } from "@/lib/server/bot-integration";
import { loadStaffCandidates, pushToUsers, subscribedStaffCandidates, usersWithTopicDisabled } from "@/lib/server/push-subscriptions";
import {
  loadEntrantManagerIds,
  loadEntrantMatchLeaderIds,
  loadEntrantPlayerIds,
  loadNotificationRecipients,
  loadStaffIds,
  notifyStaff,
  staffHolding,
  notifyUsers,
  toNotificationRecipient,
} from "@/lib/server/notify";
import { resetLocaleColumnMemory } from "@/lib/server/users/account-locale";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";
import { recipientRow } from "../../helpers/recipient-row";

const PUSH = () => ({ title: "t", body: "b", url: "/" });
/** Message privé de test : sa langue se lit dans le texte. */
const DM = (locale: string) => `m-${locale}`;

/** Langue des comptes (`bg_users.locale`) telle que la base la rend. */
function accountLocales(rows: { id: number; locale: string }[]) {
  const query = jest.fn<SqlQuery>().mockResolvedValue([rows]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));
  return query;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetLocaleColumnMemory();
  jest.mocked(pushToUsers).mockResolvedValue(2);
  jest.mocked(pushDiscordDirectMessages).mockResolvedValue({ sent: 1, unresolved: [], failed: [] });
  accountLocales([{ id: 1, locale: "fr" }]);
});

describe("notifyUsers", () => {
  it("envoie le message privé à qui Discord joint, et le push à tous", async () => {
    const report = await notifyUsers(
      [
        { userId: 1, discord: { discordId: "1", handle: null, label: "A" } },
        { userId: 2, discord: null },
      ],
      { topic: "TEAM_JOIN_REQUEST", push: PUSH, discord: { message: DM, context: "ctx" } },
    );

    expect(pushDiscordDirectMessages).toHaveBeenCalledWith("m-fr", [{ discordId: "1", handle: null, label: "A" }], "ctx");
    expect(pushToUsers).toHaveBeenCalledWith([1, 2], "TEAM_JOIN_REQUEST", PUSH, undefined);
    expect(report).toEqual({ discord: { sent: 1, unresolved: [], failed: [] }, discordUnreachedUserIds: [], pushed: 2 });
  });

  it("notifyUsers_discordOnly_sendsTheDmWithoutAnyPush", async () => {
    const report = await notifyUsers([{ userId: 1, discord: { discordId: "1", handle: null, label: "A" } }], {
      topic: "MATCH_REMINDER",
      push: PUSH,
      discord: { message: DM, context: "match-reminder" },
      discordOnly: true,
    });

    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
    expect(pushToUsers).not.toHaveBeenCalled();
    expect(report.pushed).toBe(0);
  });

  it("écrit à chacun dans la langue de son compte : un appel au bot par langue", async () => {
    const query = accountLocales([
      { id: 1, locale: "fr" },
      { id: 2, locale: "en" },
      { id: 3, locale: "en" },
    ]);
    jest
      .mocked(pushDiscordDirectMessages)
      .mockResolvedValueOnce({ sent: 1, unresolved: [], failed: [] })
      .mockResolvedValueOnce({ sent: 1, unresolved: ["C"], failed: [] });
    const a = { discordId: "1", handle: null, label: "A" };
    const b = { discordId: "2", handle: null, label: "B" };
    const c = { discordId: null, handle: "c", label: "C" };

    const report = await notifyUsers(
      [
        { userId: 1, discord: a },
        { userId: 2, discord: b },
        { userId: 3, discord: c },
      ],
      { topic: "MATCH_REMINDER", push: PUSH, discord: { message: DM, context: "match-reminder" } },
    );

    // La langue est lue pour les destinataires de l'envoi, et pour eux seuls.
    expect(query.mock.calls[0][0]).toMatch(/SELECT id, locale FROM bg_users/);
    expect(query.mock.calls[0][1]).toEqual([1, 2, 3]);
    expect(jest.mocked(pushDiscordDirectMessages).mock.calls).toEqual([
      ["m-fr", [a], "match-reminder"],
      ["m-en", [b, c], "match-reminder"],
    ]);
    expect(report.discord).toEqual({ sent: 2, unresolved: ["C"], failed: [] });
    expect(report.discordUnreachedUserIds).toEqual([]);
  });

  it("langue illisible ou compte absent : un seul message bilingue, français d'abord", async () => {
    jest.mocked(getDatabase).mockRejectedValue(new Error("ECONNREFUSED"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    await notifyUsers([{ userId: 1, discord: { discordId: "1", handle: null, label: "A" } }], {
      topic: "MODERATION",
      push: PUSH,
      discord: { message: DM, context: "ctx" },
    });
    accountLocales([]);
    await notifyUsers([{ userId: 7, discord: { discordId: "7", handle: null, label: "G" } }], {
      topic: "MODERATION",
      push: PUSH,
      discord: { message: DM, context: "ctx" },
    });

    const bilingual = "m-fr\n\n**— English —**\nm-en";
    expect(jest.mocked(pushDiscordDirectMessages).mock.calls.map(([message]) => message)).toEqual([bilingual, bilingual]);
  });

  it("notifyUsers_localeColumnRefusedEarlier_skipsLocaleQuery", async () => {
    const query = jest.fn<SqlQuery>().mockRejectedValue(
      Object.assign(new Error("Unknown column 'locale' in 'field list'"), { code: "ER_BAD_FIELD_ERROR" }),
    );
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));
    const options = { topic: "MODERATION", push: PUSH, discord: { message: DM, context: "ctx" } } as const;
    await notifyUsers([{ userId: 1, discord: { discordId: "1", handle: null, label: "A" } }], options);

    await notifyUsers([{ userId: 2, discord: { discordId: "2", handle: null, label: "B" } }], options);

    expect(query).toHaveBeenCalledTimes(1);
    expect(jest.mocked(pushDiscordDirectMessages).mock.calls[1][0]).toBe("m-fr\n\n**— English —**\nm-en");
  });

  it("un appel perdu (une langue) nomme ses comptes, les autres restent remis", async () => {
    accountLocales([
      { id: 1, locale: "fr" },
      { id: 2, locale: "en" },
    ]);
    jest
      .mocked(pushDiscordDirectMessages)
      .mockResolvedValueOnce({ sent: 1, unresolved: [], failed: [] })
      .mockResolvedValueOnce(null);

    const report = await notifyUsers(
      [
        { userId: 1, discord: { discordId: "1", handle: null, label: "A" } },
        { userId: 2, discord: { discordId: "2", handle: null, label: "B" } },
      ],
      { topic: "PRIVACY_CHANGE", push: PUSH, discord: { message: DM, context: "ctx" } },
    );

    expect(report.discord).toEqual({ sent: 1, unresolved: [], failed: [] });
    expect(report.discordUnreachedUserIds).toEqual([2]);
  });

  it("bot perdu au premier appel : les autres langues ne sont pas tentées, leurs comptes rendus non joints", async () => {
    accountLocales([
      { id: 1, locale: "fr" },
      { id: 2, locale: "en" },
      { id: 3, locale: "fr" },
    ]);
    jest.mocked(pushDiscordDirectMessages).mockResolvedValueOnce(null);

    const report = await notifyUsers(
      [
        { userId: 1, discord: { discordId: "1", handle: null, label: "A" } },
        { userId: 2, discord: { discordId: "2", handle: null, label: "B" } },
        { userId: 3, discord: { discordId: "3", handle: null, label: "C" } },
      ],
      { topic: "MATCH_REMINDER", push: PUSH, discord: { message: DM, context: "ctx" } },
    );

    // Un seul appel vers un bot tombé, comme avant le découpage par langue :
    // le coupe-circuit ne s'ouvre pas sur une seule notification.
    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
    expect(report.discord).toBeNull();
    expect(report.discordUnreachedUserIds).toEqual([1, 3, 2]);
  });

  it("les langues partent l'une après l'autre, jamais deux appels au bot en même temps", async () => {
    accountLocales([
      { id: 1, locale: "fr" },
      { id: 2, locale: "en" },
    ]);
    let inFlight = 0;
    let maxInFlight = 0;
    jest.mocked(pushDiscordDirectMessages).mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { sent: 1, unresolved: [], failed: [] };
    });

    const report = await notifyUsers(
      [
        { userId: 1, discord: { discordId: "1", handle: null, label: "A" } },
        { userId: 2, discord: { discordId: "2", handle: null, label: "B" } },
      ],
      { topic: "MATCH_REMINDER", push: PUSH, discord: { message: DM, context: "ctx" } },
    );

    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
    expect(report.discord).toEqual({ sent: 2, unresolved: [], failed: [] });
  });

  it("n'appelle pas le bot quand personne n'est joignable sur Discord, ou sans message", async () => {
    await notifyUsers([{ userId: 2, discord: null }], {
      topic: "MODERATION",
      push: PUSH,
      discord: { message: DM, context: "ctx" },
    });
    await notifyUsers([{ userId: 2, discord: { discordId: "9", handle: null, label: "X" } }], {
      topic: "MATCH_START",
      push: PUSH,
      pushOptions: { urgency: "high" },
    });

    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(jest.mocked(pushToUsers).mock.calls[1][3]).toEqual({ urgency: "high" });
  });

  it("remonte un bot injoignable", async () => {
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue(null);
    const report = await notifyUsers([{ userId: 1, discord: { discordId: "1", handle: null, label: "A" } }], {
      topic: "PRIVACY_CHANGE",
      push: PUSH,
      discord: { message: DM, context: "ctx" },
    });
    expect(report.discord).toBeNull();
    expect(report.discordUnreachedUserIds).toEqual([1]);
    expect(report.pushed).toBe(2);
  });
});

describe("notifyUsers — langue portée et rédaction avant envoi (EF-14)", () => {
  it("notifyUsers_dmWriterThrows_rejectsBeforeAnyPush", async () => {
    const throwing = () => {
      throw new RangeError("Invalid time value");
    };

    await expect(
      notifyUsers([{ userId: 1, discord: { discordId: "1", handle: null, label: "A" } }], {
        topic: "MATCH_REMINDER",
        push: PUSH,
        discord: { message: throwing, context: "match-reminder" },
      }),
    ).rejects.toThrow("Invalid time value");
    expect(pushToUsers).not.toHaveBeenCalled();
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
  });

  it("notifyUsers_recipientsCarryLocale_noLocaleQuery", async () => {
    const query = accountLocales([]);

    await notifyUsers(
      [
        { userId: 1, discord: { discordId: "1", handle: null, label: "A" }, locale: "en" },
        { userId: 2, discord: { discordId: "2", handle: null, label: "B" }, locale: "en" },
      ],
      { topic: "MATCH_REMINDER", push: PUSH, discord: { message: DM, context: "ctx" } },
    );

    expect(query).not.toHaveBeenCalled();
    expect(jest.mocked(pushDiscordDirectMessages).mock.calls).toEqual([
      ["m-en", [{ discordId: "1", handle: null, label: "A" }, { discordId: "2", handle: null, label: "B" }], "ctx"],
    ]);
  });

  it("notifyUsers_writerThrowsForUnusedLocale_sentInNeededLocale", async () => {
    const frOnly = (locale: string) => {
      if (locale !== "fr") throw new RangeError("no en text");
      return "m-fr";
    };

    await notifyUsers([{ userId: 1, discord: { discordId: "1", handle: null, label: "A" }, locale: "fr" }], {
      topic: "MATCH_REMINDER",
      push: PUSH,
      discord: { message: frOnly, context: "ctx" },
    });

    expect(pushDiscordDirectMessages).toHaveBeenCalledWith("m-fr", [{ discordId: "1", handle: null, label: "A" }], "ctx");
    expect(pushToUsers).toHaveBeenCalled();
  });

  it("toNotificationRecipient_rowWithLocale_localeCarried", () => {
    const row = recipientRow({ id: 7, pseudo: "Iris", discord_id: "7", locale: "en" });

    expect(toNotificationRecipient(row, "proven").locale).toBe("en");
  });

  it("notifyUsers_mixedCarriedAndMissingLocale_readsOnlyMissing", async () => {
    const query = accountLocales([{ id: 2, locale: "fr" }]);

    await notifyUsers(
      [
        { userId: 1, discord: { discordId: "1", handle: null, label: "A" }, locale: "en" },
        { userId: 2, discord: { discordId: "2", handle: null, label: "B" } },
      ],
      { topic: "MATCH_REMINDER", push: PUSH, discord: { message: DM, context: "ctx" } },
    );

    expect(query.mock.calls[0][1]).toEqual([2]);
  });
});

describe("notifyUsers — sujet réservé à une permission", () => {
  it("remet tous les destinataires à pushToUsers, qui juge la permission sur ses propres lignes : aucune lecture des droits ici", async () => {
    const query = accountLocales([{ id: 5, locale: "fr" }]);
    await notifyUsers(
      [5, 6, 7].map((userId) => ({ userId, discord: null })),
      { topic: "CAST_RELEASED", push: PUSH },
    );
    expect(pushToUsers).toHaveBeenCalledWith([5, 6, 7], "CAST_RELEASED", PUSH, undefined);
    expect(query).not.toHaveBeenCalled();
  });

  it("le message privé part quand même à qui a perdu la permission", async () => {
    accountLocales([{ id: 5, locale: "fr" }]);
    const report = await notifyUsers(
      [{ userId: 5, discord: { discordId: "5", handle: null, label: "C" } }],
      { topic: "CAST_RELEASED", push: PUSH, discord: { message: DM, context: "cast-released" } },
    );
    expect(pushDiscordDirectMessages).toHaveBeenCalledWith("m-fr", [{ discordId: "5", handle: null, label: "C" }], "cast-released");
    expect(report.discord).toEqual({ sent: 1, unresolved: [], failed: [] });
  });
});

describe("notifyStaff", () => {
  it("pousse aux seuls comptes qui détiennent la permission du sujet", async () => {
    jest.mocked(subscribedStaffCandidates).mockResolvedValue([
      { userId: 1, isAdmin: true, rolesJson: null, planningGuest: false },
      { userId: 2, isAdmin: false, rolesJson: JSON.stringify(["ARBITRE"]), planningGuest: false },
      { userId: 3, isAdmin: false, rolesJson: JSON.stringify(["CASTER"]), planningGuest: false },
      { userId: 4, isAdmin: false, rolesJson: "illisible", planningGuest: false },
    ]);
    const discord = jest.fn(async () => ({ sent: 3, unresolved: [], failed: [] }));

    const report = await notifyStaff({ topic: "REFEREE_ALERT", push: PUSH, discord });

    expect(discord).toHaveBeenCalledTimes(1);
    expect(pushToUsers).toHaveBeenCalledWith([1, 2], "REFEREE_ALERT", PUSH, undefined);
    expect(report.discord).toEqual({ sent: 3, unresolved: [], failed: [] });
  });

  it("ne donne la modération qu'aux administrateurs", async () => {
    jest.mocked(subscribedStaffCandidates).mockResolvedValue([
      { userId: 1, isAdmin: true, rolesJson: null, planningGuest: false },
      { userId: 2, isAdmin: false, rolesJson: JSON.stringify(["ARBITRE", "COMMUNITY_MANAGER"]), planningGuest: false },
    ]);
    await notifyStaff({ topic: "STAFF_REPORT", push: PUSH });
    expect(pushToUsers).toHaveBeenCalledWith([1], "STAFF_REPORT", PUSH, undefined);
  });

  it("prévient les arbitres d'un match programmé, sauf l'auteur du geste", async () => {
    jest.mocked(subscribedStaffCandidates).mockResolvedValue([
      { userId: 1, isAdmin: true, rolesJson: null, planningGuest: false },
      { userId: 2, isAdmin: false, rolesJson: JSON.stringify(["ARBITRE"]), planningGuest: false },
      { userId: 3, isAdmin: false, rolesJson: JSON.stringify(["CASTER"]), planningGuest: false },
      { userId: 5, isAdmin: false, rolesJson: JSON.stringify(["ARBITRE"]), planningGuest: false },
    ]);
    await notifyStaff({ topic: "MATCH_SCHEDULED", push: PUSH, excludeUserIds: [2] });
    expect(pushToUsers).toHaveBeenCalledWith([1, 5], "MATCH_SCHEDULED", PUSH, undefined);
  });

  it("ne vise aucun staff pour un sujet destiné à tous les joueurs", async () => {
    await notifyStaff({ topic: "MATCH_START", push: PUSH });
    expect(subscribedStaffCandidates).not.toHaveBeenCalled();
  });

  it("garde le bilan Discord même si le push échoue", async () => {
    jest.mocked(subscribedStaffCandidates).mockRejectedValue(new Error("panne"));
    const report = await notifyStaff({
      topic: "REFEREE_ALERT",
      push: PUSH,
      discord: async () => ({ sent: 1, unresolved: [], failed: [] }),
    });
    expect(report).toEqual({ discord: { sent: 1, unresolved: [], failed: [] }, discordUnreachedUserIds: [], pushed: 0 });
  });
});

describe("staffHolding / loadStaffIds", () => {
  const CANDIDATES = [
    { userId: 1, isAdmin: true, rolesJson: null, planningGuest: false },
    { userId: 2, isAdmin: false, rolesJson: JSON.stringify(["ARBITRE"]), planningGuest: false },
    { userId: 3, isAdmin: false, rolesJson: JSON.stringify(["CASTER"]), planningGuest: false },
    { userId: 4, isAdmin: false, rolesJson: JSON.stringify(["ARBITRE"]), planningGuest: false },
  ];

  it("staffHolding_tournamentsPermission_keepsHoldersOnly", () => {
    expect(staffHolding(CANDIDATES, "tournaments", new Set())).toEqual([1, 2, 4]);
  });

  it("staffHolding_planningGuest_losesPlanningKeepsCasting", () => {
    const guest = [{ userId: 9, isAdmin: false, rolesJson: JSON.stringify(["CASTER"]), planningGuest: true }];

    expect(staffHolding(guest, "planning", new Set())).toEqual([]);
    expect(staffHolding(guest, "casting", new Set())).toEqual([9]);
  });

  it("staffHolding_excludedAccounts_leftOut", () => {
    expect(staffHolding(CANDIDATES, "tournaments", new Set([2, 4]))).toEqual([1]);
  });

  it("loadStaffIds_readsEveryCandidateNotOnlySubscribed", async () => {
    jest.mocked(loadStaffCandidates).mockResolvedValue(CANDIDATES);

    await expect(loadStaffIds("tournaments", [4])).resolves.toEqual([1, 2]);
    expect(loadStaffCandidates).toHaveBeenCalledWith({ subscribedOnly: false });
  });

  it("loadStaffIds_readFails_rejects", async () => {
    jest.mocked(loadStaffCandidates).mockRejectedValue(new Error("ECONNRESET"));

    await expect(loadStaffIds("tournaments")).rejects.toThrow("ECONNRESET");
  });
});

describe("destinataires", () => {
  const row = recipientRow({ id: 5, pseudo: "Nova", discord_pseudo: "nova" });

  it("n'écrit jamais à un tag saisi, quelle que soit la portée", () => {
    expect(toNotificationRecipient(row, "proven")).toEqual({ userId: 5, discord: null });
    expect(toNotificationRecipient(row, "certified")).toEqual({ userId: 5, discord: null });
  });

  it("certified : un tag certifié seul ouvre le canal, avec l'identifiant du compte qui l'a certifié", () => {
    const certified = { ...row, discord_id: "1", discord_verified_at: "2026-09-01" };
    expect(toNotificationRecipient(certified, "certified")).toEqual({
      userId: 5,
      discord: { discordId: "1", handle: "nova", label: "Nova" },
    });
    // Identifiant rattaché sans tag certifié : pas de message de match (contre le spam).
    expect(toNotificationRecipient({ ...row, discord_id: "1" }, "certified")).toEqual({
      userId: 5,
      discord: null,
    });
  });

  it("prend le tag certifié et l'identifiant comme preuves", () => {
    expect(toNotificationRecipient({ ...row, discord_verified_at: "2026-09-01" }, "proven").discord?.handle).toBe(
      "nova",
    );
    expect(toNotificationRecipient({ ...row, discord_id: "1" }, "proven").discord).toEqual({
      discordId: "1",
      handle: null,
      label: "Nova",
    });
  });

  it("lit les comptes vivants, sans doublon", async () => {
    const query = jest.fn<SqlQuery>().mockResolvedValue([[row]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));

    expect(await loadNotificationRecipients([], "proven")).toEqual([]);
    await loadNotificationRecipients([5, 5, 6], "proven");

    expect(query.mock.calls[0][0]).toMatch(/is_deleted = 0/);
    expect(query.mock.calls[0][1]).toEqual([5, 6]);
  });

  it("loadNotificationRecipients_excludeSuspended_filtersActiveSuspensionsInSql", async () => {
    const query = jest.fn<SqlQuery>().mockResolvedValue([[row]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));

    await loadNotificationRecipients([5], "proven", { excludeSuspended: true });

    expect(String(query.mock.calls[0][0])).toContain("NOT EXISTS (SELECT 1 FROM bg_account_suspensions sus");
  });

  it("loadNotificationRecipients_planningMembersOnly_dropsGuestsAndNonMembers", async () => {
    const query = jest.fn<SqlQuery>().mockResolvedValue([
      [
        { ...recipientRow({ id: 5 }), is_admin: 0, platform_roles_json: JSON.stringify(["CASTER"]), is_guest_staff: 0 },
        { ...recipientRow({ id: 6 }), is_admin: 0, platform_roles_json: JSON.stringify(["CASTER"]), is_guest_staff: 1 },
        { ...recipientRow({ id: 7 }), is_admin: 0, platform_roles_json: null, is_guest_staff: 0 },
        { ...recipientRow({ id: 8 }), is_admin: 1, platform_roles_json: null, is_guest_staff: 1 },
      ],
    ]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));

    const recipients = await loadNotificationRecipients([5, 6, 7, 8], "proven", { planningMembersOnly: true });

    expect(recipients.map((recipient) => recipient.userId)).toEqual([5, 8]);
    expect(String(query.mock.calls[0][0])).toContain("is_guest_staff");
  });

  it("loadNotificationRecipients_planningMembersOnly_guestColumnMissing_readsWithoutIt", async () => {
    const query = jest.fn<SqlQuery>().mockImplementation(async (sql) => {
      if (String(sql).includes("is_guest_staff")) {
        throw Object.assign(new Error("Unknown column 'is_guest_staff' in 'field list'"), { code: "ER_BAD_FIELD_ERROR" });
      }
      return [[{ ...recipientRow({ id: 5 }), is_admin: 0, platform_roles_json: JSON.stringify(["CASTER"]) }]];
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));

    const recipients = await loadNotificationRecipients([5], "proven", { planningMembersOnly: true });

    expect(recipients.map((recipient) => recipient.userId)).toEqual([5]);
    expect(String(query.mock.calls[0][0])).toContain("is_guest_staff");
    expect(String(query.mock.calls.at(-1)?.[0])).not.toContain("is_guest_staff");
  });

  it("loadNotificationRecipients_matchDmGuestColumnMissing_skipsEveryReadAskingForIt", async () => {
    const query = jest.fn<SqlQuery>().mockImplementation(async (sql) => {
      if (String(sql).includes("is_guest_staff")) {
        throw Object.assign(new Error("Unknown column 'is_guest_staff' in 'field list'"), { code: "ER_BAD_FIELD_ERROR" });
      }
      return [[{ ...recipientRow({ id: 5 }), is_admin: 0, platform_roles_json: JSON.stringify(["CASTER"]) }]];
    });
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));

    const recipients = await loadNotificationRecipients([5], "proven", { planningMembersOnly: true, matchDm: true });

    expect(recipients.map((recipient) => recipient.userId)).toEqual([5]);
    // Une seule lecture en échec : les trois autres qui réclament la colonne absente ne sont pas jouées.
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("loadNotificationRecipients_withoutPlanningOption_readsNoRights", async () => {
    const query = jest.fn<SqlQuery>().mockResolvedValue([[row]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));

    await loadNotificationRecipients([5], "proven");

    expect(String(query.mock.calls[0][0])).not.toContain("is_guest_staff");
  });

  it("loadNotificationRecipients_default_keepsSuspendedAccounts", async () => {
    const query = jest.fn<SqlQuery>().mockResolvedValue([[row]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));

    await loadNotificationRecipients([5], "proven");

    expect(String(query.mock.calls[0][0])).not.toContain("bg_account_suspensions");
  });

  it("réunit membres actuels et joueur d'une entrée solo, par engagée", async () => {
    const query = jest.fn<SqlQuery>().mockResolvedValue([
      [
        { team_id: 1, user_id: 10 },
        { team_id: 1, user_id: 11 },
        { team_id: 2, user_id: 20 },
      ],
    ]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));

    const byTeam = await loadEntrantPlayerIds([1, 2, 1]);

    expect(byTeam.get(1)).toEqual([10, 11]);
    expect(byTeam.get(2)).toEqual([20]);
    expect(query.mock.calls[0][0]).toMatch(/left_at IS NULL/);
    expect(query.mock.calls[0][0]).toMatch(/solo_user_id IS NOT NULL/);
    expect(query.mock.calls[0][1]).toEqual([1, 2, 1, 2]);
    expect((await loadEntrantPlayerIds([])).size).toBe(0);
  });
});

describe("loadEntrantMatchLeaderIds", () => {
  it("ne garde que ceux qui mènent le match — capitaine, manager, propriétaire — et le joueur d'une entrée solo", async () => {
    const query = jest.fn<SqlQuery>().mockResolvedValue([
      [
        { team_id: 1, user_id: 10, roles_json: JSON.stringify(["OWNER", "TANK"]), solo: 0 },
        { team_id: 1, user_id: 11, roles_json: JSON.stringify(["COACH", "DPS"]), solo: 0 },
        { team_id: 1, user_id: 13, roles_json: JSON.stringify(["CAPITAINE", "HEAL"]), solo: 0 },
        { team_id: 1, user_id: 12, roles_json: JSON.stringify(["MANAGER"]), solo: 0 },
        { team_id: 2, user_id: 20, roles_json: null, solo: 1 },
      ],
    ]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));

    const byTeam = await loadEntrantMatchLeaderIds([1, 2, 1]);

    expect(byTeam.get(1)).toEqual([10, 13, 12]);
    expect(byTeam.get(2)).toEqual([20]);
    expect(query.mock.calls[0][0]).toMatch(/left_at IS NULL/);
    expect(query.mock.calls[0][0]).toMatch(/solo_user_id IS NOT NULL/);
    expect(query.mock.calls[0][1]).toEqual([1, 2, 1, 2]);
    expect((await loadEntrantMatchLeaderIds([])).size).toBe(0);
  });
});

describe("loadEntrantManagerIds", () => {
  it("ne garde que ceux qui gèrent — propriétaire, manager — et le joueur d'une entrée solo ; une fantôme n'a personne", async () => {
    const query = jest.fn<SqlQuery>().mockResolvedValue([
      [
        { team_id: 1, user_id: 10, roles_json: JSON.stringify(["OWNER", "TANK"]), solo: 0 },
        { team_id: 1, user_id: 13, roles_json: JSON.stringify(["CAPITAINE", "HEAL"]), solo: 0 },
        { team_id: 1, user_id: 11, roles_json: JSON.stringify(["COACH"]), solo: 0 },
        { team_id: 1, user_id: 12, roles_json: JSON.stringify(["MANAGER"]), solo: 0 },
        { team_id: 1, user_id: 12, roles_json: JSON.stringify(["MANAGER"]), solo: 0 },
        { team_id: 2, user_id: 20, roles_json: null, solo: 1 },
      ],
    ]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ query }));

    const byTeam = await loadEntrantManagerIds([1, 2, 3]);

    expect(byTeam.get(1)).toEqual([10, 12]);
    expect(byTeam.get(2)).toEqual([20]);
    // L'équipe 3 (fantôme) n'a ni membre ni joueur solo : aucune entrée.
    expect(byTeam.has(3)).toBe(false);
    expect(query.mock.calls[0][1]).toEqual([1, 2, 3, 1, 2, 3]);
    expect((await loadEntrantManagerIds([])).size).toBe(0);
  });
});

describe("notifyUsers — dmFollowsTopic (sujets du planning)", () => {
  const a = { discordId: "1", handle: null, label: "A" };
  const b = { discordId: "2", handle: null, label: "B" };

  it("notifyUsers_dmFollowsTopicOptedOut_skipsThatDmOnly", async () => {
    accountLocales([
      { id: 1, locale: "fr" },
      { id: 2, locale: "fr" },
    ]);
    jest.mocked(usersWithTopicDisabled).mockResolvedValue(new Set([2]));

    await notifyUsers(
      [
        { userId: 1, discord: a },
        { userId: 2, discord: b },
      ],
      { topic: "PLANNING_ASSIGNED", push: PUSH, discord: { message: DM, context: "planning-assigned" }, dmFollowsTopic: true },
    );

    expect(usersWithTopicDisabled).toHaveBeenCalledWith([1, 2], "PLANNING_ASSIGNED");
    expect(pushDiscordDirectMessages).toHaveBeenCalledWith("m-fr", [a], "planning-assigned");
    expect(jest.mocked(pushToUsers).mock.calls[0][0]).toEqual([1, 2]);
  });

  it("notifyUsers_optOutReadFails_sendsNoDm", async () => {
    jest.mocked(usersWithTopicDisabled).mockRejectedValue(new Error("ER_LOCK_WAIT_TIMEOUT"));

    await notifyUsers([{ userId: 1, discord: a }], {
      topic: "PLANNING_WITHDRAWAL",
      push: PUSH,
      discord: { message: DM, context: "planning-withdrawal" },
      dmFollowsTopic: true,
    });

    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).toHaveBeenCalledTimes(1);
  });

  it("notifyUsers_withoutDmFollowsTopic_neverReadsOptOuts", async () => {
    await notifyUsers([{ userId: 1, discord: a }], { topic: "TEAM_JOIN_REQUEST", push: PUSH, discord: { message: DM, context: "ctx" } });

    expect(usersWithTopicDisabled).not.toHaveBeenCalled();
  });
});

describe("notifyUsers — envoi par lots", () => {
  const recipient = (userId: number) => ({
    userId,
    locale: "fr" as const,
    discord: { discordId: String(userId), handle: null, label: `p${userId}` },
  });
  const many = (count: number) => Array.from({ length: count }, (_unused, index) => recipient(index + 1));

  it("notifyUsers_moreRecipientsThanTheBotAcceptsPerCall_splitsIntoCallsOfOneHundred", async () => {
    await notifyUsers(many(101), { topic: "TEAM_JOIN_REQUEST", push: PUSH, discord: { message: DM, context: "ctx" } });

    const sizes = jest.mocked(pushDiscordDirectMessages).mock.calls.map(([, recipients]) => recipients.length);
    expect(sizes).toEqual([100, 1]);
  });

  it("notifyUsers_deliveryOptions_batchesAndPassesTimeoutAndCircuit", async () => {
    await notifyUsers(many(3), {
      topic: "TEAM_JOIN_REQUEST",
      push: PUSH,
      discord: { message: DM, context: "ctx", delivery: { batchSize: 2, timeoutMs: 120_000, honourCircuit: false } },
    });

    expect(jest.mocked(pushDiscordDirectMessages).mock.calls.map(([, recipients, , options]) => [recipients.length, options])).toEqual([
      [2, { honourCircuit: false, timeoutMs: 120_000 }],
      [1, { honourCircuit: false, timeoutMs: 120_000 }],
    ]);
  });

  it("notifyUsers_lostBatch_stopsLaterBatchesAndNamesTheirAccounts", async () => {
    jest.mocked(pushDiscordDirectMessages).mockResolvedValueOnce({ sent: 2, unresolved: [], failed: [] }).mockResolvedValueOnce(null);

    const actual = await notifyUsers(many(5), {
      topic: "TEAM_JOIN_REQUEST",
      push: PUSH,
      discord: { message: DM, context: "ctx", delivery: { batchSize: 2 } },
    });

    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(2);
    expect(actual.discord).toEqual({ sent: 2, unresolved: [], failed: [] });
    expect(actual.discordUnreachedUserIds).toEqual([3, 4, 5]);
  });

  it("notifyUsers_uncertainBatchWithUncertainIsNotLost_sendsLaterBatchesAndFlagsUncertain", async () => {
    jest
      .mocked(pushDiscordDirectMessages)
      .mockImplementationOnce(async (_text, _recipients, _context, options) => {
        options?.onUncertain?.();
        return null;
      })
      .mockResolvedValueOnce({ sent: 1, unresolved: [], failed: [] });

    const actual = await notifyUsers(many(2), {
      topic: "TEAM_JOIN_REQUEST",
      push: PUSH,
      discord: { message: DM, context: "ctx", delivery: { batchSize: 1, uncertainIsNotLost: true } },
    });

    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(2);
    expect(actual.discordUncertain).toBe(true);
    expect(actual.discord).toEqual({ sent: 1, unresolved: [], failed: [] });
    expect(actual.discordUnreachedUserIds).toEqual([1]);
  });

  it("notifyUsers_unreachableBatchWithUncertainIsNotLost_stopsLaterBatches", async () => {
    jest.mocked(pushDiscordDirectMessages).mockResolvedValueOnce(null);

    const actual = await notifyUsers(many(2), {
      topic: "TEAM_JOIN_REQUEST",
      push: PUSH,
      discord: { message: DM, context: "ctx", delivery: { batchSize: 1, uncertainIsNotLost: true } },
    });

    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
    expect(actual.discordUncertain).toBeUndefined();
    expect(actual.discord).toBeNull();
  });
});
