import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/notify");
jest.mock("@/lib/server/coalescer");
jest.mock("@/lib/server/tournaments/transaction");
jest.mock("@/lib/server/tournaments/match-launch");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/match-players");
jest.mock("@/lib/server/tournaments/match-log-subject", () => ({
  ...jest.requireActual<typeof import("@/lib/server/tournaments/match-log-subject")>(
    "@/lib/server/tournaments/match-log-subject",
  ),
  loadMatchLogRow: jest.fn(),
}));
jest.mock("@/lib/server/suspension-sql", () => ({
  ...jest.requireActual<typeof import("@/lib/server/suspension-sql")>("@/lib/server/suspension-sql"),
  lockedSuspendedUserIds: jest.fn(),
}));

import { sendBotLog } from "@/lib/server/bot-integration";
import { trackAnnouncement } from "@/lib/server/coalescer";
import { withConnection } from "@/lib/server/database";
import { loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { lockedSuspendedUserIds } from "@/lib/server/suspension-sql";
import { resolveTeamParty } from "@/lib/server/tournaments/match-launch";
import { loadMatchLogRow, type MatchLogRow } from "@/lib/server/tournaments/match-log-subject";
import { loadMatchPlayerIds } from "@/lib/server/tournaments/match-players";
import {
  assignMatchProd,
  claimMatchProd,
  formatProdNotice,
  loadProdPanel,
  prodLogCategory,
  releaseMatchProd,
  withdrawLostProdPlaces,
} from "@/lib/server/tournaments/match-prod";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { inTransaction } from "@/lib/server/tournaments/transaction";
import type { ProdNoticeMatch } from "@/lib/shared/match-prod";
import { authUser } from "../../helpers/auth-user";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/**
 * La prod d'un match (`lib/server/tournaments/match-prod.ts`,
 * `docs/features/MATCH_PROD.md`) : se placer, se retirer, placement par le
 * staff, places rendues à la perte du rôle, fenêtre du staff, avis.
 */

const PROD_ID = 5;
const OTHER_PROD_ID = 6;
const STAFF_ID = 1;

type Account = { is_deleted: number; holds_prod: number };

let match: Record<string, unknown> | null;
let accounts: Map<number, Account>;
let casterIds: number[];
let execute: jest.Mock<SqlQuery>;
let announcements: Promise<void>[];

function updatesOfProd() {
  return execute.mock.calls.filter(([sql]) => sql.startsWith("UPDATE bg_matches SET prod_user_id"));
}

const LOG_ROW = {
  id: 42,
  bracket: "UPPER",
  round_number: 2,
  swiss_round: null,
  team1_name: "Alpha",
  team2_name: "Beta",
  team1_id: 10,
  team2_id: 11,
  tournament_id: 7,
  tournament_name: "Coupe",
  participant_type: "TEAM",
} as MatchLogRow;

beforeEach(() => {
  jest.clearAllMocks();
  match = {
    id: 42,
    tournament_id: 7,
    status: "READY",
    is_bye: 0,
    team1_id: 10,
    team2_id: 11,
    prod_user_id: null,
  };
  accounts = new Map([
    [PROD_ID, { is_deleted: 0, holds_prod: 1 }],
    [OTHER_PROD_ID, { is_deleted: 0, holds_prod: 1 }],
  ]);
  casterIds = [];
  announcements = [];
  execute = jest.fn<SqlQuery>(async (sql, params) => {
    const values = params as unknown[];
    if (sql.includes("LOCK IN SHARE MODE")) {
      const account = accounts.get(Number(values[0]));
      return [account ? [account] : [], []];
    }
    if (sql.includes("FROM bg_matches WHERE id = ? LIMIT 1 FOR UPDATE")) return [match ? [match] : [], []];
    if (sql.includes("FROM bg_match_casters WHERE match_id = ? AND user_id = ?")) {
      return [casterIds.includes(Number(values[1])) ? [{ 1: 1 }] : [], []];
    }
    if (sql.startsWith("UPDATE bg_matches SET prod_user_id")) return [{ affectedRows: 1 }, []];
    throw new Error(`requête inattendue : ${sql}`);
  });
  jest.mocked(inTransaction).mockImplementation((run) => run(fakeConnection({ execute })));
  jest.mocked(resolveTeamParty).mockResolvedValue(null);
  jest.mocked(lockedSuspendedUserIds).mockResolvedValue(new Set());
  jest.mocked(trackAnnouncement).mockImplementation((announcement) => {
    announcements.push(announcement);
    return announcement;
  });
  jest.mocked(loadMatchLogRow).mockResolvedValue(LOG_ROW);
  jest.mocked(loadNotificationRecipients).mockImplementation(async (ids) =>
    ids.map((userId) => ({ userId, discord: null, locale: "fr" as const })),
  );
});

async function settle() {
  await Promise.all(announcements);
}

const prodActor = authUser({ id: PROD_ID, roles: ["PROD"] });

describe("claimMatchProd", () => {
  it("claimMatchProd_freePlace_writesProdAndAnnouncesClaimed", async () => {
    await claimMatchProd(42, prodActor);
    await settle();

    expect(updatesOfProd()).toEqual([[expect.any(String), [PROD_ID, 42]]]);
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7, { landingLive: true });
    expect(sendBotLog).toHaveBeenCalledTimes(1);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("claimMatchProd_accountWithoutProd_throwsNotProd", async () => {
    accounts.set(PROD_ID, { is_deleted: 0, holds_prod: 0 });

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("NOT_PROD");
    expect(updatesOfProd()).toHaveLength(0);
  });

  it("claimMatchProd_deletedAccount_throwsNotProd", async () => {
    accounts.set(PROD_ID, { is_deleted: 1, holds_prod: 1 });

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("NOT_PROD");
  });

  it("claimMatchProd_alreadyOwnPlace_noWriteNoAnnouncement", async () => {
    match = { ...match, prod_user_id: PROD_ID };

    await claimMatchProd(42, prodActor);

    expect(updatesOfProd()).toHaveLength(0);
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
    expect(trackAnnouncement).not.toHaveBeenCalled();
  });

  it("claimMatchProd_takenByOther_throwsMatchProdTaken", async () => {
    match = { ...match, prod_user_id: OTHER_PROD_ID };

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("MATCH_PROD_TAKEN");
  });

  it("claimMatchProd_missingMatch_throwsMatchNotFound", async () => {
    match = null;

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("MATCH_NOT_FOUND");
  });

  it("claimMatchProd_completedMatch_throwsMatchAlreadyCompleted", async () => {
    match = { ...match, status: "COMPLETED" };

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("MATCH_ALREADY_COMPLETED");
  });

  it("claimMatchProd_byeMatch_throwsMatchNotLaunchable", async () => {
    match = { ...match, is_bye: 1 };

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("MATCH_NOT_LAUNCHABLE");
  });

  it("claimMatchProd_claimerIsCaster_throwsProdIsCaster", async () => {
    casterIds = [PROD_ID];

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("PROD_IS_CASTER");
    expect(updatesOfProd()).toHaveLength(0);
  });

  it("claimMatchProd_claimerPlays_throwsProdIsPlayer", async () => {
    jest.mocked(resolveTeamParty).mockResolvedValue({ role: "TEAM1", canDeclareReady: true });

    await expect(claimMatchProd(42, prodActor)).rejects.toThrow("PROD_IS_PLAYER");
  });

  it("claimMatchProd_playerView_throwsPlayerViewActive", async () => {
    const impersonating = authUser({ id: PROD_ID, isAdmin: true, playerView: true, roles: [] });

    await expect(claimMatchProd(42, impersonating)).rejects.toThrow("PLAYER_VIEW_ACTIVE");
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("releaseMatchProd", () => {
  it("releaseMatchProd_ownPlace_clearsProd", async () => {
    match = { ...match, prod_user_id: PROD_ID };

    await releaseMatchProd(42, prodActor);
    await settle();

    expect(updatesOfProd()).toEqual([[expect.any(String), [null, 42]]]);
    expect(sendBotLog).toHaveBeenCalledWith(expect.any(String), { tournamentId: 7, category: "staff-removal" });
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("releaseMatchProd_notOwnPlace_throwsNotMatchProd", async () => {
    match = { ...match, prod_user_id: OTHER_PROD_ID };

    await expect(releaseMatchProd(42, prodActor)).rejects.toThrow("NOT_MATCH_PROD");
    expect(updatesOfProd()).toHaveLength(0);
  });
});

describe("assignMatchProd", () => {
  it("assignMatchProd_emptyPlace_assignsAndNotifiesAssigned", async () => {
    await assignMatchProd(42, STAFF_ID, PROD_ID, null);
    await settle();

    expect(updatesOfProd()).toEqual([[expect.any(String), [PROD_ID, 42]]]);
    expect(sendBotLog).toHaveBeenCalledWith(expect.any(String), { tournamentId: 7, category: "casts" });
    expect(loadNotificationRecipients).toHaveBeenCalledTimes(1);
    expect(loadNotificationRecipients).toHaveBeenCalledWith([PROD_ID], "certified", { matchDm: true });
    expect(notifyUsers).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ topic: "MATCH_PROD" }));
  });

  it("assignMatchProd_replace_notifiesBothAndLogsReplaced", async () => {
    match = { ...match, prod_user_id: OTHER_PROD_ID };

    await assignMatchProd(42, STAFF_ID, PROD_ID, OTHER_PROD_ID);
    await settle();

    expect(loadNotificationRecipients).toHaveBeenNthCalledWith(1, [OTHER_PROD_ID], "certified", { matchDm: true });
    expect(loadNotificationRecipients).toHaveBeenNthCalledWith(2, [PROD_ID], "certified", { matchDm: true });
    expect(sendBotLog).toHaveBeenCalledWith(expect.any(String), { tournamentId: 7, category: "casts" });
  });

  it("assignMatchProd_remove_logsReleasedByStaffAndNotifiesReleased", async () => {
    match = { ...match, prod_user_id: PROD_ID };

    await assignMatchProd(42, STAFF_ID, null, PROD_ID);
    await settle();

    expect(updatesOfProd()).toEqual([[expect.any(String), [null, 42]]]);
    expect(sendBotLog).toHaveBeenCalledWith(expect.any(String), { tournamentId: 7, category: "staff-removal" });
    expect(loadNotificationRecipients).toHaveBeenCalledWith([PROD_ID], "certified", { matchDm: true });
    expect(execute.mock.calls.some(([sql]) => sql.includes("LOCK IN SHARE MODE"))).toBe(false);
  });

  it("assignMatchProd_staffAssignsSelf_noNotice", async () => {
    accounts.set(STAFF_ID, { is_deleted: 0, holds_prod: 1 });

    await assignMatchProd(42, STAFF_ID, STAFF_ID, null);
    await settle();

    expect(updatesOfProd()).toHaveLength(1);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("assignMatchProd_expectedDiffers_throwsProdChanged", async () => {
    match = { ...match, prod_user_id: OTHER_PROD_ID };

    await expect(assignMatchProd(42, STAFF_ID, PROD_ID, null)).rejects.toThrow("PROD_CHANGED");
    expect(updatesOfProd()).toHaveLength(0);
  });

  it("assignMatchProd_sameAsCurrent_noWrite", async () => {
    match = { ...match, prod_user_id: PROD_ID };

    await assignMatchProd(42, STAFF_ID, PROD_ID, null);

    expect(updatesOfProd()).toHaveLength(0);
    expect(trackAnnouncement).not.toHaveBeenCalled();
  });

  it("assignMatchProd_targetWithoutProd_throwsNotProd", async () => {
    accounts.set(PROD_ID, { is_deleted: 0, holds_prod: 0 });

    await expect(assignMatchProd(42, STAFF_ID, PROD_ID)).rejects.toThrow("NOT_PROD");
  });

  it("assignMatchProd_suspendedTarget_throwsProdUnavailable", async () => {
    jest.mocked(lockedSuspendedUserIds).mockResolvedValue(new Set([PROD_ID]));

    await expect(assignMatchProd(42, STAFF_ID, PROD_ID)).rejects.toThrow("PROD_UNAVAILABLE");
    expect(updatesOfProd()).toHaveLength(0);
  });

  it("assignMatchProd_targetIsCaster_throwsProdIsCaster", async () => {
    casterIds = [PROD_ID];

    await expect(assignMatchProd(42, STAFF_ID, PROD_ID)).rejects.toThrow("PROD_IS_CASTER");
  });
});

describe("withdrawLostProdPlaces", () => {
  it("withdrawLostProdPlaces_openPlaces_clearsAndReturnsThem", async () => {
    const lost = jest.fn<SqlQuery>(async (sql) => {
      if (sql.startsWith("SELECT")) return [[{ ...match, prod_user_id: PROD_ID }], []];
      return [{ affectedRows: 1 }, []];
    });

    const released = await withdrawLostProdPlaces(fakeConnection({ execute: lost }), PROD_ID);

    expect(released).toEqual([{ matchId: 42, tournamentId: 7, pairing: { team1Id: 10, team2Id: 11 } }]);
    expect(lost).toHaveBeenLastCalledWith(expect.stringContaining("SET prod_user_id = NULL"), [PROD_ID]);
  });

  it("withdrawLostProdPlaces_none_returnsEmptyWithoutUpdate", async () => {
    const lost = jest.fn<SqlQuery>(async () => [[], []]);

    expect(await withdrawLostProdPlaces(fakeConnection({ execute: lost }), PROD_ID)).toEqual([]);
    expect(lost).toHaveBeenCalledTimes(1);
  });
});

describe("loadProdPanel", () => {
  let panelMatch: Record<string, unknown> | null;
  let users: Record<string, unknown>[];
  let panelCasters: number[];
  let panelExecute: jest.Mock<SqlQuery>;

  beforeEach(() => {
    panelMatch = { id: 42, team1_id: 10, team2_id: 11, prod_user_id: null };
    users = [
      { id: PROD_ID, pseudo: "Prod" },
      { id: OTHER_PROD_ID, pseudo: "Prod2" },
      { id: 8, pseudo: "Joueuse" },
    ];
    panelCasters = [];
    panelExecute = jest.fn<SqlQuery>(async (sql) => {
      if (sql.includes("FROM bg_matches")) return [panelMatch ? [panelMatch] : [], []];
      if (sql.includes("FROM bg_match_casters")) return [panelCasters.map((user_id) => ({ user_id })), []];
      if (sql.includes("WHERE id = ? LIMIT 1")) return [[{ id: 9, pseudo: "Ancienne" }], []];
      if (sql.includes("FROM bg_users u")) return [users, []];
      throw new Error(`requête inattendue : ${sql}`);
    });
    jest.mocked(withConnection).mockImplementation((run) => run(fakeConnection({ execute: panelExecute })));
    jest.mocked(loadMatchPlayerIds).mockResolvedValue(new Set([8]));
  });

  it("loadProdPanel_missingMatch_returnsNull", async () => {
    panelMatch = null;

    expect(await loadProdPanel(42)).toBeNull();
  });

  it("loadProdPanel_marksPlayersAndCasters_blocks", async () => {
    panelCasters = [OTHER_PROD_ID];

    expect(await loadProdPanel(42)).toEqual({
      matchId: 42,
      prod: null,
      candidates: [
        { userId: PROD_ID, pseudo: "Prod", block: null },
        { userId: OTHER_PROD_ID, pseudo: "Prod2", block: "PROD_IS_CASTER" },
        { userId: 8, pseudo: "Joueuse", block: "PROD_IS_PLAYER" },
      ],
    });
  });

  it("loadProdPanel_currentProdIsCandidate_namesIt", async () => {
    panelMatch = { ...panelMatch, prod_user_id: PROD_ID };

    expect((await loadProdPanel(42))?.prod).toEqual({ userId: PROD_ID, pseudo: "Prod" });
  });

  it("loadProdPanel_currentProdNotCandidate_readsPseudo", async () => {
    panelMatch = { ...panelMatch, prod_user_id: 9 };

    expect((await loadProdPanel(42))?.prod).toEqual({ userId: 9, pseudo: "Ancienne" });
  });
});

describe("prodLogCategory", () => {
  it("prodLogCategory_losses_areStaffRemoval", () => {
    expect(prodLogCategory("RELEASED")).toBe("staff-removal");
    expect(prodLogCategory("RELEASED_BY_STAFF")).toBe("staff-removal");
    expect(prodLogCategory("INELIGIBLE")).toBe("staff-removal");
  });

  it("prodLogCategory_gains_areCasts", () => {
    expect(prodLogCategory("CLAIMED")).toBe("casts");
    expect(prodLogCategory("ASSIGNED")).toBe("casts");
    expect(prodLogCategory("REPLACED")).toBe("casts");
  });
});

describe("formatProdNotice", () => {
  const notice: ProdNoticeMatch = {
    tournamentId: 7,
    tournamentName: "Coupe",
    matchId: 42,
    bracket: "UPPER",
    roundNumber: 2,
    team1Name: "Alpha",
    team2Name: "Beta",
    solo: false,
    kind: "ASSIGNED",
  };

  it("formatProdNotice_teamMatchFr_namesTeams", () => {
    const text = formatProdNotice(notice, "https://bluegenji.test/tournois/7#match-42", "fr");

    expect(text).toContain("Le staff te place comme prod du match");
    expect(text).toContain("Alpha");
    expect(text).toContain("Beta");
    expect(text).toContain("https://bluegenji.test/tournois/7#match-42");
  });

  it("formatProdNotice_soloEn_saysAMatch", () => {
    const text = formatProdNotice(
      { ...notice, solo: true, kind: "RELEASED", team1Name: "Pseudo1", team2Name: "Pseudo2" },
      "https://bluegenji.test/tournois/7#match-42",
      "en",
    );

    expect(text).toContain("The staff removed you as the prod of a match");
    expect(text).not.toContain("Pseudo1");
    expect(text).not.toContain("Pseudo2");
  });
});
