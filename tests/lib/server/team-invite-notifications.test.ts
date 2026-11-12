import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/push-subscriptions");
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://site.test" }));

import { getDatabase } from "@/lib/server/database";
import { pushDiscordDirectMessages } from "@/lib/server/bot-integration";
import { pushToUsers } from "@/lib/server/push-subscriptions";
import {
  claimTeamNoticeDmSlot,
  claimTeamNoticeSlot,
  notifyTeamInvite,
  notifyTeamInviteInBackground,
  releaseTeamNoticeDmSlot,
  releaseTeamNoticeSlot,
  resetTeamNoticeSlots,
} from "@/lib/server/team-invite-notifications";
import {
  TEAM_INVITE_NOTICE_COOLDOWN_HOURS,
  TEAM_INVITE_NOTICES_PER_PLAYER_CAP,
  TEAM_NOTICE_DMS_HOURLY_CAP,
} from "@/lib/shared/team-invite-notice";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";
import { resolvePush } from "../../helpers/push";

/** TEAM-INVITE-NOTIFY : lecture et envoi de l'avis au joueur visé. */

const TEAM_ID = 7;
const PLAYER_ID = 42;
const ACTOR_ID = 1;

type Scenario = {
  formerMember?: 0 | 1;
  byActor?: number;
  teamsToPlayer?: number;
  offers?: number;
  team?: Record<string, unknown> | null;
  account?: Record<string, unknown> | null;
  locale?: string;
};

function teamRow(overrides: Record<string, unknown> = {}) {
  return { name: "Les Glaciers", is_ghost: 0, solo_user_id: null, deleted_at: null, ...overrides };
}

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAYER_ID,
    pseudo: "NovaSecretPseudo",
    is_deleted: 0,
    suspended: 0,
    discord_id: "100000000000000042",
    discord_pseudo: "nova",
    discord_verified_at: "2026-09-01 10:00:00",
    ...overrides,
  };
}

function mockDb({
  formerMember = 0,
  byActor = 1,
  teamsToPlayer = 1,
  offers = 1,
  team = teamRow(),
  account = accountRow(),
  locale = "fr",
}: Scenario = {}) {
  const execute = jest.fn<SqlQuery>(async (sql) => {
    if (sql.includes("AS any_player")) {
      return [[{ any_player: 1, by_actor: byActor, teams_to_player: teamsToPlayer }], []];
    }
    if (sql.includes("AS offers")) return [[{ offers }], []];
    if (sql.includes("AS teams_to_player")) {
      return [[{ by_actor: byActor, teams_to_player: String(teamsToPlayer) }], []];
    }
    if (sql.includes("AS former_member")) return [formerMember === 1 ? [{ former_member: 1 }] : [], []];
    if (sql.includes("FROM bg_teams")) return [team === null ? [] : [team], []];
    if (sql.includes("FROM bg_users u")) return [account === null ? [] : [account], []];
    throw new Error(`requête inattendue : ${sql}`);
  });
  const query = jest.fn<SqlQuery>(async () => [[{ id: PLAYER_ID, locale }], []]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute, query }));
  return execute;
}

describe("notifyTeamInvite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetTeamNoticeSlots();
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue({ sent: 1, unresolved: [], failed: [] });
    jest.mocked(pushToUsers).mockResolvedValue(1);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("notifyTeamInvite_invite_sendsPushAndDmWithoutPseudo", async () => {
    mockDb();

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    const [message, recipients, context] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(message).toContain("« Les Glaciers »");
    expect(message).toContain("https://site.test/profil#invitations");
    expect(message).not.toContain("NovaSecretPseudo");
    expect(message).not.toContain("#42");
    expect(recipients).toEqual([{ discordId: "100000000000000042", handle: "nova", label: "NovaSecretPseudo" }]);
    expect(context).toBe("team-invitation");
    const [userIds, topic, content] = jest.mocked(pushToUsers).mock.calls[0];
    expect(userIds).toEqual([PLAYER_ID]);
    expect(topic).toBe("TEAM_INVITATION");
    expect(resolvePush(content).url).toBe("/profil#invitations");
  });

  it("notifyTeamInvite_englishAccount_dmInEnglishWithEnglishLink", async () => {
    mockDb({ locale: "en" });

    await notifyTeamInvite("OWNERSHIP", TEAM_ID, PLAYER_ID, ACTOR_ID);

    const [message] = jest.mocked(pushDiscordDirectMessages).mock.calls[0];
    expect(message).toContain("Ownership of your team “Les Glaciers”");
    expect(message).toContain("https://site.test/en/equipes/7");
  });

  // Le délai par joueur se compte sur les avis réellement partis (mémoire),
  // plus sur les lignes d'invitation : un retrait-renvoi n'écrit qu'une fois.
  it("notifyTeamInvite_reinviteWithinCooldown_sendsOnce", async () => {
    mockDb();

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);
    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
    expect(pushToUsers).toHaveBeenCalledTimes(1);
  });

  it("notifyTeamInvite_firstInviteNothingDelivered_nextInviteNotifies", async () => {
    mockDb();
    jest.mocked(pushDiscordDirectMessages).mockResolvedValueOnce({ sent: 0, unresolved: [], failed: [] });
    jest.mocked(pushToUsers).mockResolvedValueOnce(0);

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);
    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushToUsers).toHaveBeenCalledTimes(2);
  });

  it("notifyTeamInvite_formerMemberInvitedByTooManyTeams_sends", async () => {
    mockDb({ formerMember: 1, teamsToPlayer: TEAM_INVITE_NOTICES_PER_PLAYER_CAP + 1 });

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushToUsers).toHaveBeenCalledTimes(1);
  });

  it("notifyTeamInvite_dmHourlyCapReached_pushOnly", async () => {
    mockDb();
    const now = Date.now();
    for (let i = 0; i < TEAM_NOTICE_DMS_HOURLY_CAP; i += 1) claimTeamNoticeDmSlot(now);

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).toHaveBeenCalledTimes(1);
  });

  it("notifyTeamInvite_invite_budgetIgnoresGhostTakeoverRows", async () => {
    const execute = mockDb();

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    const budgetSql = execute.mock.calls.map(([sql]) => sql).find((sql) => sql.includes("AS any_player"));
    expect(budgetSql).toContain(`COALESCE(JSON_CONTAINS(i.roles_json, '"OWNER"'), 0) = 0`);
    // Appartenance au tableau JSON, pas sous-chaîne : le rendu texte du JSON
    // diffère entre MySQL et MariaDB.
    expect(budgetSql).not.toContain("LIKE");
  });

  it("notifyTeamInvite_invite_budgetParamsInOrder", async () => {
    const execute = mockDb();

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    const budgetCall = execute.mock.calls.find(([sql]) => sql.includes("AS any_player"));
    expect(budgetCall?.[1]).toEqual([TEAM_ID, ACTOR_ID, PLAYER_ID, TEAM_ID, ACTOR_ID, PLAYER_ID]);
  });

  it("notifyTeamInvite_invite_teamsToPlayerExcludesFormerTeams", async () => {
    const execute = mockDb();

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    const budgetSql = execute.mock.calls.map(([sql]) => sql).find((sql) => sql.includes("AS any_player"));
    expect(budgetSql?.replace(/\s+/g, " ")).toContain(
      "NOT EXISTS ( SELECT 1 FROM bg_team_members m WHERE m.team_id = i.team_id AND m.user_id = i.user_id )",
    );
  });

  it("notifyTeamInvite_formerMember_probeReadsMembershipOfThisTeam", async () => {
    const execute = mockDb();

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    const probe = execute.mock.calls.find(([sql]) => sql.includes("AS former_member"));
    expect(probe?.[0]).toContain("FROM bg_team_members WHERE team_id = ? AND user_id = ?");
    expect(probe?.[1]).toEqual([TEAM_ID, PLAYER_ID]);
  });

  it("notifyTeamInvite_dmNotDelivered_dmHourlySlotReturned", async () => {
    mockDb();
    const now = Date.now();
    for (let i = 0; i < TEAM_NOTICE_DMS_HOURLY_CAP - 1; i += 1) claimTeamNoticeDmSlot(now);
    jest.mocked(pushDiscordDirectMessages).mockResolvedValueOnce({ sent: 0, unresolved: [], failed: [] });

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(claimTeamNoticeDmSlot(Date.now())).toBe(true);
  });

  it("notifyTeamInvite_dmDelivered_dmHourlySlotKept", async () => {
    mockDb();
    const now = Date.now();
    for (let i = 0; i < TEAM_NOTICE_DMS_HOURLY_CAP - 1; i += 1) claimTeamNoticeDmSlot(now);

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(claimTeamNoticeDmSlot(Date.now())).toBe(false);
  });

  it("notifyTeamInvite_deliveryThrows_dmHourlySlotReturned", async () => {
    mockDb();
    const now = Date.now();
    for (let i = 0; i < TEAM_NOTICE_DMS_HOURLY_CAP - 1; i += 1) claimTeamNoticeDmSlot(now);
    jest.mocked(pushToUsers).mockRejectedValueOnce(new Error("push en panne"));

    await expect(notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID)).rejects.toThrow("push en panne");

    expect(claimTeamNoticeDmSlot(Date.now())).toBe(true);
  });

  it("notifyTeamInvite_actorOverCapAcrossTeams_sendsNothing", async () => {
    mockDb({ byActor: 11 });

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
  });

  it("notifyTeamInvite_playerInvitedByTooManyTeams_sendsNothing", async () => {
    mockDb({ teamsToPlayer: 4 });

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
  });

  it("notifyTeamInvite_ghostClaimFirstOffer_sends", async () => {
    const execute = mockDb({ team: teamRow({ is_ghost: 1 }) });

    await notifyTeamInvite("GHOST_CLAIM", TEAM_ID, PLAYER_ID, ACTOR_ID);

    const offersCall = execute.mock.calls.find(([sql]) => sql.includes("AS teams_to_player"));
    expect(offersCall?.[0]).toContain(`COALESCE(JSON_CONTAINS(i.roles_json, '"OWNER"'), 0) = 1`);
    expect(offersCall?.[0]).toContain("NOT EXISTS");
    expect(offersCall?.[0]).not.toContain("LIKE");
    expect(offersCall?.[1]).toEqual([ACTOR_ID, PLAYER_ID, PLAYER_ID, ACTOR_ID]);
    expect(execute.mock.calls.some(([sql]) => sql.includes("AS any_player"))).toBe(false);
    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(1);
    expect(pushToUsers).toHaveBeenCalledTimes(1);
  });

  it("notifyTeamInvite_ghostClaimReofferedWithinWindow_sendsOnce", async () => {
    mockDb({ team: teamRow({ is_ghost: 1 }) });

    await notifyTeamInvite("GHOST_CLAIM", TEAM_ID, PLAYER_ID, ACTOR_ID);
    await notifyTeamInvite("GHOST_CLAIM", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushToUsers).toHaveBeenCalledTimes(1);
  });

  it("notifyTeamInvite_ghostClaimFormerMemberOverTeamsCap_sends", async () => {
    mockDb({ formerMember: 1, teamsToPlayer: 1000, team: teamRow({ is_ghost: 1 }) });

    await notifyTeamInvite("GHOST_CLAIM", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushToUsers).toHaveBeenCalledTimes(1);
  });

  it("notifyTeamInvite_ownership_runsNoBudgetQuery", async () => {
    const execute = mockDb();

    await notifyTeamInvite("OWNERSHIP", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(
      execute.mock.calls.some(([sql]) => sql.includes("AS teams_to_player") || sql.includes("AS former_member")),
    ).toBe(false);
    expect(pushToUsers).toHaveBeenCalledTimes(1);
  });

  it("notifyTeamInvite_ghostClaimActorOverDailyCap_sendsNothing", async () => {
    mockDb({ byActor: 1000, team: teamRow({ is_ghost: 1 }) });

    await notifyTeamInvite("GHOST_CLAIM", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
  });

  it("notifyTeamInvite_ghostClaimPlayerOfferedTooManyTeams_sendsNothing", async () => {
    mockDb({ teamsToPlayer: 1000, team: teamRow({ is_ghost: 1 }) });

    await notifyTeamInvite("GHOST_CLAIM", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushToUsers).not.toHaveBeenCalled();
  });

  it("notifyTeamInvite_ownershipTwiceWithinWindow_sendsOnce", async () => {
    mockDb();

    await notifyTeamInvite("OWNERSHIP", TEAM_ID, PLAYER_ID, ACTOR_ID);
    await notifyTeamInvite("OWNERSHIP", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushToUsers).toHaveBeenCalledTimes(1);
  });

  it("notifyTeamInvite_ownershipNothingDelivered_nextTransferNotifiesAgain", async () => {
    mockDb();
    jest.mocked(pushDiscordDirectMessages).mockResolvedValueOnce(null);
    jest.mocked(pushToUsers).mockResolvedValueOnce(0);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    await notifyTeamInvite("OWNERSHIP", TEAM_ID, PLAYER_ID, ACTOR_ID);

    await notifyTeamInvite("OWNERSHIP", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushDiscordDirectMessages).toHaveBeenCalledTimes(2);
  });

  it("notifyTeamInvite_ownershipDeliveryThrows_slotReleased", async () => {
    mockDb();
    jest.mocked(pushToUsers).mockRejectedValueOnce(new Error("push en panne"));
    await expect(notifyTeamInvite("OWNERSHIP", TEAM_ID, PLAYER_ID, ACTOR_ID)).rejects.toThrow("push en panne");

    await notifyTeamInvite("OWNERSHIP", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushToUsers).toHaveBeenCalledTimes(2);
  });

  it("notifyTeamInvite_ownershipSuspendedAccount_consumesNoSlot", async () => {
    mockDb({ account: accountRow({ suspended: 1 }) });
    await notifyTeamInvite("OWNERSHIP", TEAM_ID, PLAYER_ID, ACTOR_ID);
    mockDb();

    await notifyTeamInvite("OWNERSHIP", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushToUsers).toHaveBeenCalledTimes(1);
  });

  it("notifyTeamInvite_suspendedAccount_sendsNothing", async () => {
    const execute = mockDb({ account: accountRow({ suspended: 1 }) });

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    const accountSql = execute.mock.calls.map(([sql]) => sql).find((sql) => sql.includes("FROM bg_users u"));
    expect(accountSql).toContain("bg_account_suspensions");
    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).not.toHaveBeenCalled();
  });

  it("notifyTeamInvite_teamMissing_sendsNothing", async () => {
    mockDb({ team: null });

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushToUsers).not.toHaveBeenCalled();
  });

  it("notifyTeamInvite_accountMissing_sendsNothing", async () => {
    mockDb({ account: null });

    await notifyTeamInvite("OWNERSHIP", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushToUsers).not.toHaveBeenCalled();
  });

  it("notifyTeamInvite_noProvenDiscord_pushOnly", async () => {
    mockDb({ account: accountRow({ discord_id: null, discord_verified_at: null }) });

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(pushDiscordDirectMessages).not.toHaveBeenCalled();
    expect(pushToUsers).toHaveBeenCalledTimes(1);
  });

  it("notifyTeamInvite_botDown_logsWithoutPlayerDataAndStillPushes", async () => {
    mockDb();
    jest.mocked(pushDiscordDirectMessages).mockResolvedValue(null);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await notifyTeamInvite("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID);

    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0].join(" ");
    expect(line).not.toContain("NovaSecretPseudo");
    expect(line).not.toContain(String(PLAYER_ID));
    expect(line).not.toContain("100000000000000042");
    expect(pushToUsers).toHaveBeenCalledTimes(1);
  });
});

describe("notifyTeamInviteInBackground", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("notifyTeamInviteInBackground_dbFails_logsAndDoesNotThrow", async () => {
    jest.mocked(getDatabase).mockRejectedValue(new Error("DB_DOWN"));
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => notifyTeamInviteInBackground("INVITE", TEAM_ID, PLAYER_ID, ACTOR_ID)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toBe("[teams] joueur non prévenu (INVITE)");
  });
});

describe("claimTeamNoticeSlot (propriété)", () => {
  const WINDOW_MS = TEAM_INVITE_NOTICE_COOLDOWN_HOURS * 3_600_000;

  beforeEach(() => {
    resetTeamNoticeSlots();
  });

  it("claimTeamNoticeSlot_ownershipfirstNotice_granted", () => {
    expect(claimTeamNoticeSlot("OWNERSHIP", TEAM_ID, PLAYER_ID, 0)).toBe(true);
  });

  it("claimTeamNoticeSlot_ownershipjustBeforeWindowEnds_refused", () => {
    claimTeamNoticeSlot("OWNERSHIP", TEAM_ID, PLAYER_ID, 0);

    expect(claimTeamNoticeSlot("OWNERSHIP", TEAM_ID, PLAYER_ID, WINDOW_MS - 1)).toBe(false);
  });

  it("claimTeamNoticeSlot_ownershipwindowElapsed_grantedAgain", () => {
    claimTeamNoticeSlot("OWNERSHIP", TEAM_ID, PLAYER_ID, 0);

    expect(claimTeamNoticeSlot("OWNERSHIP", TEAM_ID, PLAYER_ID, WINDOW_MS)).toBe(true);
  });

  it("releaseTeamNoticeSlot_ownershipnewerClaim_keepsIt", () => {
    claimTeamNoticeSlot("OWNERSHIP", TEAM_ID, PLAYER_ID, 0);
    releaseTeamNoticeSlot("OWNERSHIP", TEAM_ID, PLAYER_ID, 0);
    claimTeamNoticeSlot("OWNERSHIP", TEAM_ID, PLAYER_ID, 5);

    releaseTeamNoticeSlot("OWNERSHIP", TEAM_ID, PLAYER_ID, 0);

    expect(claimTeamNoticeSlot("OWNERSHIP", TEAM_ID, PLAYER_ID, 6)).toBe(false);
  });

  it("claimTeamNoticeSlot_ownershipotherTeam_granted", () => {
    claimTeamNoticeSlot("OWNERSHIP", TEAM_ID, PLAYER_ID, 0);

    expect(claimTeamNoticeSlot("OWNERSHIP", TEAM_ID + 1, PLAYER_ID, 1)).toBe(true);
  });
});

describe("claimTeamNoticeSlot", () => {
  beforeEach(() => {
    resetTeamNoticeSlots();
  });

  it("claimTeamNoticeSlot_sameTeamPlayerOtherKind_granted", () => {
    claimTeamNoticeSlot("INVITE", TEAM_ID, PLAYER_ID, 0);

    expect(claimTeamNoticeSlot("OWNERSHIP", TEAM_ID, PLAYER_ID, 1)).toBe(true);
  });

  it("claimTeamNoticeSlot_sameKindWithinWindow_refused", () => {
    claimTeamNoticeSlot("GHOST_CLAIM", TEAM_ID, PLAYER_ID, 0);

    expect(claimTeamNoticeSlot("GHOST_CLAIM", TEAM_ID, PLAYER_ID, 1)).toBe(false);
  });

  it("claimTeamNoticeSlot_thousandsOfOtherClaims_keepsPlayerReservation", () => {
    // Une poignée de comptes jetables ne chasse pas la réservation d'un joueur
    // encore dans sa fenêtre (revue sécurité #596).
    claimTeamNoticeSlot("INVITE", TEAM_ID, PLAYER_ID, 0);
    for (let other = 1; other <= 5_000; other += 1) claimTeamNoticeSlot("INVITE", TEAM_ID + other, PLAYER_ID, other);

    expect(claimTeamNoticeSlot("INVITE", TEAM_ID, PLAYER_ID, 5_001)).toBe(false);
  });
});

describe("claimTeamNoticeDmSlot", () => {
  const HOUR_MS = 3_600_000;
  const T0 = 10 * HOUR_MS;

  beforeEach(() => {
    resetTeamNoticeSlots();
  });

  it("claimTeamNoticeDmSlot_atHourlyCap_lastGranted", () => {
    for (let i = 0; i < TEAM_NOTICE_DMS_HOURLY_CAP - 1; i += 1) claimTeamNoticeDmSlot(T0);

    expect(claimTeamNoticeDmSlot(T0)).toBe(true);
  });

  it("claimTeamNoticeDmSlot_overHourlyCap_refused", () => {
    for (let i = 0; i < TEAM_NOTICE_DMS_HOURLY_CAP; i += 1) claimTeamNoticeDmSlot(T0);

    expect(claimTeamNoticeDmSlot(T0 + HOUR_MS - 1)).toBe(false);
  });

  it("releaseTeamNoticeDmSlot_claimFromPreviousWindow_ignored", () => {
    for (let i = 0; i < TEAM_NOTICE_DMS_HOURLY_CAP; i += 1) claimTeamNoticeDmSlot(T0 + HOUR_MS);

    releaseTeamNoticeDmSlot(T0);

    expect(claimTeamNoticeDmSlot(T0 + HOUR_MS + 1)).toBe(false);
  });

  it("releaseTeamNoticeDmSlot_sameWindow_slotGrantedAgain", () => {
    for (let i = 0; i < TEAM_NOTICE_DMS_HOURLY_CAP; i += 1) claimTeamNoticeDmSlot(T0);

    releaseTeamNoticeDmSlot(T0);

    expect(claimTeamNoticeDmSlot(T0 + 1)).toBe(true);
  });

  it("claimTeamNoticeDmSlot_hourElapsed_grantedAgain", () => {
    for (let i = 0; i < TEAM_NOTICE_DMS_HOURLY_CAP; i += 1) claimTeamNoticeDmSlot(T0);

    expect(claimTeamNoticeDmSlot(T0 + HOUR_MS)).toBe(true);
  });
});
