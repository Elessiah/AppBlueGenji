import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/notify");
jest.mock("@/lib/server/push-subscriptions");
jest.mock("@/lib/server/web-push", () => ({ webPushConfig: jest.fn() }));

import { getDatabase } from "@/lib/server/database";
import { loadEntrantMatchLeaderIds, loadEntrantPlayerIds, notifyUsers } from "@/lib/server/notify";
import { purgeStaleSubscriptions } from "@/lib/server/push-subscriptions";
import { webPushConfig, type WebPushConfig } from "@/lib/server/web-push";
import {
  dispatchMatchStartNotices,
  notifyScoreToConfirm,
  notifyTournamentStart,
  resetMatchStartNoticeThrottle,
} from "@/lib/server/tournaments/player-pushes";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

const CONFIG = { publicKey: "pk", privateKey: {} as WebPushConfig["privateKey"], subject: "mailto:a@b.test" };

const LOBBY_MATCH = {
  id: 40,
  tournament_id: 4,
  tournament_name: "Coupe",
  participant_type: "TEAM",
  team1_id: 1,
  team2_id: 2,
  team1_name: "Renards",
  team2_name: "Nova",
  caster_user_id: null,
  launch_pairing: "1:2",
  launched_at: null,
};

type Db = { query: jest.Mock<SqlQuery>; execute: jest.Mock<SqlQuery> };

/** `query` rend les candidats ; `execute` rejoue les réservations (`claims`) et l'existence d'une annonce. */
function mockDb(
  candidates: unknown[],
  options: {
    claims?: boolean[];
    lobbyAnnounced?: boolean;
    casters?: Record<string, unknown>[];
    castersFail?: boolean;
  } = {},
): Db {
  const claims = [...(options.claims ?? [])];
  const query = jest.fn<SqlQuery>().mockResolvedValue([candidates]);
  const execute = jest.fn<SqlQuery>(async (sql) => {
    if (sql.startsWith("INSERT IGNORE INTO bg_match_start_notices")) {
      return [{ affectedRows: (claims.length > 0 ? claims.shift() : true) ? 1 : 0 }];
    }
    if (sql.includes("SELECT 1 FROM bg_match_start_notices")) return [options.lobbyAnnounced ? [{}] : []];
    if (sql.includes("FROM bg_users WHERE id IN")) {
      if (options.castersFail) throw new Error("DB_DOWN");
      return [options.casters ?? []];
    }
    throw new Error(`requête inattendue : ${sql}`);
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute }));
  return { query, execute };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetMatchStartNoticeThrottle();
  jest.mocked(webPushConfig).mockReturnValue(CONFIG);
  jest.mocked(purgeStaleSubscriptions).mockResolvedValue(0);
  jest.mocked(loadEntrantPlayerIds).mockResolvedValue(
    new Map([
      [1, [10, 11]],
      [2, [20]],
    ]),
  );
  jest.mocked(notifyUsers).mockImplementation(async (recipients) => ({
    discord: { sent: 0, unresolved: [], failed: [] },
    pushed: recipients.length,
  }));
});

// La relève d'un balayage étranglé pose un minuteur : il ne survit pas au test.
afterEach(() => resetMatchStartNoticeThrottle());

function pushes() {
  return jest.mocked(notifyUsers).mock.calls.map(([recipients, notification]) => ({
    userIds: recipients.map((r) => r.userId),
    discord: recipients.map((r) => r.discord),
    notification,
  }));
}

describe("dispatchMatchStartNotices", () => {
  it("n'est rien sans clés VAPID : ni lecture, ni réservation", async () => {
    jest.mocked(webPushConfig).mockReturnValue(null);
    const { query } = mockDb([LOBBY_MATCH]);
    expect(await dispatchMatchStartNotices()).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("appelle les « Prêt » de chaque engagée, vue de son côté, en push seul et urgent", async () => {
    const { execute } = mockDb([LOBBY_MATCH]);

    expect(await dispatchMatchStartNotices()).toBe(3);

    expect(execute.mock.calls[0][1]).toEqual([40, "1:2", "LOBBY"]);
    const [side1, side2] = pushes();
    expect(side1.userIds).toEqual([10, 11]);
    expect(side1.discord).toEqual([null, null]);
    expect(side1.notification.topic).toBe("MATCH_START");
    expect(side1.notification.discord).toBeUndefined();
    expect(side1.notification.push.body).toContain("Renards contre Nova");
    expect(side1.notification.push.title).toBe("Ton match commence");
    expect(side1.notification.pushOptions).toEqual({ urgency: "high", ttlSeconds: 15 * 60 });
    expect(side2.userIds).toEqual([20]);
    expect(side2.notification.push.body).toContain("Nova contre Renards");
  });

  it("ne lit que l'appariement courant, jouable, dans la fenêtre, et pas déjà annoncé", async () => {
    const { query } = mockDb([]);
    await dispatchMatchStartNotices();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/t\.state = 'RUNNING'/);
    expect(sql).toMatch(/m\.status = 'READY' AND m\.is_bye = 0/);
    expect(sql).toMatch(/m\.launch_pairing = CONCAT\(m\.team1_id, ':', m\.team2_id\)/);
    expect(sql).toMatch(/n\.phase = 'LOBBY' OR m\.launched_at IS NOT NULL/);
    expect(params).toEqual([20, 10]);
  });

  it("n'envoie rien quand un autre balayage a pris la réservation", async () => {
    mockDb([LOBBY_MATCH], { claims: [false] });
    expect(await dispatchMatchStartNotices()).toBe(0);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("annonce un départ jamais appelé (lancement forcé)", async () => {
    const { execute } = mockDb([{ ...LOBBY_MATCH, launched_at: new Date() }]);
    await dispatchMatchStartNotices();
    expect(execute.mock.calls.at(-1)?.[1]).toEqual([40, "1:2", "LAUNCHED"]);
    expect(pushes()[0].notification.push.title).toBe("Ton match est lancé");
  });

  it("ne fait pas sonner deux fois un départ déjà appelé", async () => {
    const { execute } = mockDb([{ ...LOBBY_MATCH, launched_at: new Date() }], { lobbyAnnounced: true });
    expect(await dispatchMatchStartNotices()).toBe(0);
    expect(execute.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
  });

  const caster = (overrides: Record<string, unknown> = {}) => ({
    id: 99,
    discord_verified_at: new Date(),
    discord_pseudo: "caster",
    blizzard_sub: "sub",
    overwatch_battletag: "Caster#1",
    is_deleted: 0,
    is_admin: 0,
    platform_roles_json: JSON.stringify(["CASTER"]),
    ...overrides,
  });

  it("prévient aussi le caster inscrit", async () => {
    mockDb([{ ...LOBBY_MATCH, caster_user_id: 99 }], { casters: [caster()] });
    await dispatchMatchStartNotices();
    expect(pushes().map((p) => p.userIds)).toEqual([[10, 11], [20], [99]]);
  });

  it("prévient les joueurs même si la lecture des casters échoue", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb([{ ...LOBBY_MATCH, caster_user_id: 99 }], { castersFail: true });
    await dispatchMatchStartNotices();
    expect(pushes().map((p) => p.userIds)).toEqual([[10, 11], [20]]);
    error.mockRestore();
  });

  it("ne prévient pas un caster inscrit qui ne remplit plus la condition", async () => {
    mockDb([{ ...LOBBY_MATCH, caster_user_id: 99 }], { casters: [caster({ platform_roles_json: null })] });
    await dispatchMatchStartNotices();
    expect(pushes().map((p) => p.userIds)).toEqual([[10, 11], [20]]);
  });

  it("ne nomme aucun joueur en tournoi individuel", async () => {
    mockDb([{ ...LOBBY_MATCH, participant_type: "SOLO", team1_name: "Kiro", team2_name: "Nova" }]);
    await dispatchMatchStartNotices();
    for (const push of pushes()) {
      expect(push.notification.push.body).not.toMatch(/Kiro|Nova/);
    }
  });

  it("rejoue un balayage étranglé une fois le délai écoulé, au lieu de le perdre", async () => {
    jest.useFakeTimers();
    try {
      const { query } = mockDb([]);
      await dispatchMatchStartNotices();
      expect(query).toHaveBeenCalledTimes(1);

      // Un lancement s'ouvre juste après : l'appel est étranglé…
      expect(await dispatchMatchStartNotices()).toBe(0);
      expect(query).toHaveBeenCalledTimes(1);

      // … mais la relève repasse d'elle-même, une seule fois.
      await dispatchMatchStartNotices();
      await jest.advanceTimersByTimeAsync(10_000);
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      resetMatchStartNoticeThrottle();
      jest.useRealTimers();
    }
  });

  it("s'étrangle, et ne lève jamais", async () => {
    mockDb([]);
    await dispatchMatchStartNotices();
    expect(await dispatchMatchStartNotices()).toBe(0);
    expect(jest.mocked(getDatabase)).toHaveBeenCalledTimes(1);
    resetMatchStartNoticeThrottle();
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(getDatabase).mockRejectedValue(new Error("panne"));
    expect(await dispatchMatchStartNotices()).toBe(0);
    spy.mockRestore();
  });

  it("purge les abonnements oubliés au plus une fois par heure", async () => {
    mockDb([]);
    await dispatchMatchStartNotices();
    expect(purgeStaleSubscriptions).toHaveBeenCalledTimes(1);
  });
});

describe("notifyScoreToConfirm", () => {
  function reported(overrides: Record<string, unknown>) {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([
      [
        {
          tournament_id: 4,
          tournament_name: "Coupe",
          participant_type: "TEAM",
          status: "AWAITING_CONFIRMATION",
          team1_id: 1,
          team2_id: 2,
          team1_name: "Renards",
          team2_name: "Nova",
          team1_reported_at: new Date(),
          team2_reported_at: null,
          ...overrides,
        },
      ],
    ]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  }

  it("prévient l'engagée qui n'a pas encore saisi — ceux qui peuvent y répondre", async () => {
    reported({});
    jest.mocked(loadEntrantMatchLeaderIds).mockResolvedValue(new Map([[2, [20]]]));

    expect(await notifyScoreToConfirm(40)).toBe(1);

    expect(loadEntrantMatchLeaderIds).toHaveBeenCalledWith([2]);
    const [push] = pushes();
    expect(push.notification.topic).toBe("SCORE_TO_CONFIRM");
    expect(push.notification.push.body).toContain("Renards a saisi");
    expect(push.notification.push.url).toBe("/tournois/4#match-40");
  });

  it("ne nomme pas l'adversaire en tournoi individuel", async () => {
    reported({ participant_type: "SOLO", team1_name: "Kiro", team2_name: "Nova" });
    jest.mocked(loadEntrantMatchLeaderIds).mockResolvedValue(new Map([[2, [20]]]));
    await notifyScoreToConfirm(40);
    expect(pushes()[0].notification.push.body).toContain("Ton adversaire a saisi");
  });

  it.each([
    ["match déjà tranché", { status: "COMPLETED" }],
    ["conflit : les deux ont saisi", { team2_reported_at: new Date() }],
    ["aucune saisie", { team1_reported_at: null }],
  ])("se tait : %s", async (_, overrides) => {
    reported(overrides);
    expect(await notifyScoreToConfirm(40)).toBe(0);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("se tait sans clés", async () => {
    jest.mocked(webPushConfig).mockReturnValue(null);
    expect(await notifyScoreToConfirm(40)).toBe(0);
    expect(getDatabase).not.toHaveBeenCalled();
  });
});

describe("notifyTournamentStart", () => {
  it("prévient une fois chaque joueur engagé", async () => {
    const execute = jest
      .fn<SqlQuery>()
      .mockResolvedValueOnce([[{ name: "Coupe" }]])
      .mockResolvedValueOnce([[{ team_id: 1 }, { team_id: 2 }]]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    jest.mocked(loadEntrantPlayerIds).mockResolvedValue(
      new Map([
        [1, [10, 11]],
        [2, [11, 20]],
      ]),
    );

    expect(await notifyTournamentStart(4)).toBe(3);
    const [push] = pushes();
    expect(push.userIds).toEqual([10, 11, 20]);
    expect(push.notification.topic).toBe("TOURNAMENT_START");
    expect(push.notification.push.url).toBe("/tournois/4");
  });

  it("ne fait rien pour un tournoi disparu", async () => {
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: jest.fn<SqlQuery>().mockResolvedValue([[]]) }));
    expect(await notifyTournamentStart(4)).toBe(0);
  });
});
