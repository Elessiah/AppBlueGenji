import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

// Simulé pour toute la suite (`tests/setup-env.cjs`) : ici, le vrai.
jest.unmock("@/lib/server/tournaments/lobby-brief");
jest.mock("@/lib/server/database");
jest.mock("@/lib/server/notify");
const siteRoot: { value: string | null; failFor: string | null } = { value: "https://bluegenji.test", failFor: null };
jest.mock("@/lib/server/site-url", () => ({
  siteUrl: (path: string) => {
    if (siteRoot.failFor !== null && path.includes(siteRoot.failFor)) throw new Error("SITE_URL");
    return siteRoot.value === null ? null : `${siteRoot.value}${path}`;
  },
}));
// Le vrai rédacteur, épiable : un test le fait lever pour un côté.
jest.mock("@/lib/server/tournaments/lobby-brief-dm", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/tournaments/lobby-brief-dm")>(
    "@/lib/server/tournaments/lobby-brief-dm",
  );
  return { ...actual, formatLobbyBriefDm: jest.fn(actual.formatLobbyBriefDm) };
});
jest.mock("@/lib/server/tournaments/player-pushes", () => ({ readMatchCasters: jest.fn() }));
jest.mock("@/lib/server/tournaments/cast-eligibility", () => ({ loadEligibleRefereeIds: jest.fn() }));

import { getDatabase } from "@/lib/server/database";
import { loadEntrantManagerIds, loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";
import { loadEligibleRefereeIds } from "@/lib/server/tournaments/cast-eligibility";
import { readMatchCasters } from "@/lib/server/tournaments/player-pushes";
import {
  dispatchLobbyBriefs,
  lobbyBriefPhase,
  resetLobbyBriefThrottle,
} from "@/lib/server/tournaments/lobby-brief";
import { formatLobbyBriefDm } from "@/lib/server/tournaments/lobby-brief-dm";
import { renderDm } from "@/lib/shared/dm-language";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";
import { resolvePush } from "../../helpers/push";

const MATCH = {
  id: 40,
  tournament_id: 4,
  tournament_name: "Coupe",
  participant_type: "TEAM",
  game: "OW",
  bracket: "UPPER",
  round_number: 1,
  swiss_round: null,
  team1_id: 1,
  team2_id: 2,
  team1_name: "Renards",
  team2_name: "Nova",
  launch_pairing: "1:2",
  host_team_id: null,
  team1_seed: null,
  team2_seed: null,
  first_map: "Ilios",
  self_managed: 0,
  referee_user_id: null,
};

const actualDm = jest.requireActual<typeof import("@/lib/server/tournaments/lobby-brief-dm")>(
  "@/lib/server/tournaments/lobby-brief-dm",
);

/**
 * Base simulée : la première lecture rend les candidats, les suivantes (la
 * relecture d'un côté réservé : id de la réservation, puis du match) la ligne
 * de `reread` ou le candidat, réservation toujours là (`claim_kept`) ; `null`
 * dans `reread` : relecture vide, le salon s'est refermé.
 * Chaque réservation posée reçoit un id (100, 101, …).
 */
function mockDb(candidates: Record<string, unknown>[], claims: boolean[] = [], reread = new Map<number, unknown>()) {
  const queue = [...claims];
  let nextId = 100;
  const query = jest.fn<SqlQuery>(async (sql, params) => {
    if (/WHERE m\.id = \? AND m\.launch_pairing = \?/.test(sql)) {
      const id = Number((params as unknown[])[1]);
      if (!reread.has(id)) return [candidates.filter((row) => row.id === id).map((row) => ({ ...row, claim_kept: 1 }))];
      const row = reread.get(id);
      return [row === null ? [] : [{ claim_kept: 1, ...(row as object) }]];
    }
    return [candidates];
  });
  const execute = jest.fn<SqlQuery>(async (sql) => {
    if (sql.startsWith("INSERT IGNORE INTO bg_match_start_notices")) {
      const claimed = queue.length > 0 ? queue.shift() : true;
      return [claimed ? { affectedRows: 1, insertId: nextId++ } : { affectedRows: 0, insertId: 0 }];
    }
    if (sql.startsWith("DELETE FROM bg_match_start_notices")) return [{ affectedRows: 1 }];
    throw new Error(`requête inattendue : ${sql}`);
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute }));
  return { query, execute };
}

function releases(execute: ReturnType<typeof mockDb>["execute"]) {
  return execute.mock.calls.filter(([sql]) => sql.startsWith("DELETE FROM bg_match_start_notices"));
}

function logged(error: { mock: { calls: unknown[][] } }, text: string): boolean {
  return error.mock.calls.some(([message]) => String(message).includes(text));
}

function sends() {
  return jest.mocked(notifyUsers).mock.calls.map(([recipients, notification]) => ({
    userIds: recipients.map((recipient) => recipient.userId),
    notification,
    dm: (locale: "fr" | "en" | null = "fr") => renderDm(notification.discord!.message, locale),
    push: (locale: "fr" | "en" = "fr") => resolvePush(notification.push, locale),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  resetLobbyBriefThrottle();
  siteRoot.failFor = null;
  jest.mocked(loadEntrantManagerIds).mockResolvedValue(
    new Map([
      [1, [10, 11]],
      [2, [20]],
    ]),
  );
  jest.mocked(loadNotificationRecipients).mockImplementation(async (ids) =>
    ids.map((userId) => ({ userId, discord: { discordId: String(userId), handle: null, label: `u${userId}` } })),
  );
  jest.mocked(readMatchCasters).mockResolvedValue(new Map());
  jest.mocked(loadEligibleRefereeIds).mockResolvedValue(new Set());
  jest.mocked(notifyUsers).mockResolvedValue({
    discord: { sent: 1, unresolved: [], failed: [] },
    discordUnreachedUserIds: [],
    pushed: 1,
  });
});

afterEach(() => {
  resetLobbyBriefThrottle();
  siteRoot.value = "https://bluegenji.test";
});

describe("dispatchLobbyBriefs", () => {
  it("ne lit que les salons ouverts récemment, de l'appariement courant, pas encore briefés", async () => {
    const { query } = mockDb([]);
    expect(await dispatchLobbyBriefs()).toBe(0);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/t\.state = 'RUNNING'/);
    expect(sql).toMatch(/m\.status = 'READY' AND m\.is_bye = 0/);
    expect(sql).toMatch(/m\.launch_pairing = CONCAT\(m\.team1_id, ':', m\.team2_id\)/);
    expect(sql).toMatch(/m\.lobby_opened_at > NOW\(\) - INTERVAL \? MINUTE/);
    // Un match qui porte un score est joué : aucun salon à régler.
    expect(sql).toMatch(/AND m\.team1_score IS NULL AND m\.team2_score IS NULL/);
    // Un match reste candidat tant qu'un de ses deux côtés n'est pas réservé.
    expect(sql).toMatch(/n\.phase IN \(\?, \?\)\) < 2/);
    expect(params).toEqual([20, "LOBBY_BRIEF_1", "LOBBY_BRIEF_2"]);
    expect(lobbyBriefPhase(2).length).toBeLessThanOrEqual(16);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("dispatchLobbyBriefs_twoSides_recipientsReadOnceThenEachSideClaimedAndSent", async () => {
    const { execute } = mockDb([MATCH]);

    expect(await dispatchLobbyBriefs()).toBe(2);

    expect(execute.mock.calls.map(([, params]) => params)).toEqual([
      ["LOBBY_BRIEF_1", 40, "1:2"],
      ["LOBBY_BRIEF_2", 40, "1:2"],
    ]);
    expect(loadEntrantManagerIds).toHaveBeenCalledWith([1, 2]);
    // Une seule lecture pour tous les côtés ; message de match : tag certifié seul.
    expect(loadNotificationRecipients).toHaveBeenCalledTimes(1);
    expect(loadNotificationRecipients).toHaveBeenCalledWith([10, 11, 20], "certified", { matchDm: true });
    const [team1, team2] = sends();
    expect(team1.userIds).toEqual([10, 11]);
    expect(team1.notification.topic).toBe("MATCH_LOBBY_BRIEF");
    expect(team1.notification.discord?.context).toBe("lobby-brief");
    expect(team1.dm()).toContain("Le salon de ton match « Renards » contre « Nova » est ouvert");
    expect(team1.dm()).toContain("• Gauche (hôte) : « Renards »");
    expect(team1.dm()).toContain("• Droite (1er ban) : « Nova »");
    expect(team1.dm()).toContain("https://bluegenji.test/tournois/4/matchs/40");
    expect(team1.push().url).toBe("/tournois/4/matchs/40");
    expect(team2.userIds).toEqual([20]);
    expect(team2.dm()).toContain("ton match « Nova » contre « Renards »");
    expect(team2.dm("en")).toContain("• Left (host): “Renards”");
  });

  it("dispatchLobbyBriefs_eachSide_claimedThenSentBeforeTheNextClaim", async () => {
    const order: string[] = [];
    const { execute } = mockDb([MATCH]);
    const insert = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql, params) => {
      if (sql.startsWith("INSERT IGNORE")) order.push(`claim ${String((params as unknown[])[0])}`);
      return insert(sql, params);
    });
    jest.mocked(notifyUsers).mockImplementation(async (recipients) => {
      order.push(`send ${recipients.map((recipient) => recipient.userId).join(",")}`);
      return { discord: { sent: 1, unresolved: [], failed: [] }, discordUnreachedUserIds: [], pushed: 0 };
    });

    await dispatchLobbyBriefs();

    expect(order).toEqual(["claim LOBBY_BRIEF_1", "send 10,11", "claim LOBBY_BRIEF_2", "send 20"]);
  });

  it("ne réserve que si le salon est encore ouvert pour cet appariement et ces équipes (lancement défait ou réappariement entre-temps : rien)", async () => {
    const { execute } = mockDb([MATCH], [false, false]);
    expect(await dispatchLobbyBriefs()).toBe(0);
    const [sql] = execute.mock.calls[0];
    // La réservation relit le match dans la même instruction.
    expect(sql).toMatch(/INSERT IGNORE INTO bg_match_start_notices \(match_id, pairing, phase\)\s+SELECT m\.id, m\.launch_pairing, \? FROM bg_matches m/);
    expect(sql).toMatch(/m\.id = \? AND m\.launch_pairing = \? AND m\.status = 'READY' AND m\.is_bye = 0/);
    expect(sql).toMatch(/m\.lobby_opened_at IS NOT NULL AND m\.team1_score IS NULL AND m\.team2_score IS NULL/);
    // Réapparié entre-temps (équipes changées, `launch_pairing` resté) : rien pour les anciennes équipes.
    expect(sql).toMatch(/AND m\.launch_pairing = CONCAT\(m\.team1_id, ':', m\.team2_id\)/);
    expect(sql).not.toMatch(/VALUES/);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("n'envoie que le côté encore libre : l'autre est déjà briefé", async () => {
    mockDb([MATCH], [false, true]);
    expect(await dispatchLobbyBriefs()).toBe(1);
    expect(sends().map((send) => send.userIds)).toEqual([[20]]);
  });

  it("dispatchLobbyBriefs_launchedMatch_dmAndPushSayLaunched", async () => {
    mockDb([{ ...MATCH, launched_at: "2026-11-03 20:00:00" }]);

    await dispatchLobbyBriefs();

    expect(sends()[0].dm()).toContain("🎮 BlueGenji — Ton match « Renards » contre « Nova » est lancé (");
    expect(sends()[0].dm()).toContain("• Gauche (hôte) : « Renards »");
    expect(sends()[0].push().title).toBe("Match lancé : réglages de la partie");
  });

  it("dispatchLobbyBriefs_ghostOpponent_claimKeptOnlyRealTeamBriefedWithoutMutualInviteLine", async () => {
    jest.mocked(loadEntrantManagerIds).mockResolvedValue(new Map([[1, [10]]]));
    const { execute } = mockDb([{ ...MATCH, team2_ghost: 1, self_managed: 1 }]);

    expect(await dispatchLobbyBriefs()).toBe(1);

    // Les deux côtés réservés : la fantôme garde la sienne, le match quitte les candidats.
    expect(execute.mock.calls.filter(([sql]) => sql.startsWith("INSERT IGNORE"))).toHaveLength(2);
    expect(sends().map((send) => send.userIds)).toEqual([[10]]);
    expect(sends()[0].dm()).not.toContain("Autogestion");
  });

  it("dispatchLobbyBriefs_realTeamWithoutManager_notClaimedAndLoggedOncePerPairing", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(loadEntrantManagerIds).mockResolvedValue(new Map([[2, [20]]]));
    const { execute } = mockDb([MATCH]);

    expect(await dispatchLobbyBriefs()).toBe(1);

    expect(execute.mock.calls.map(([, params]) => params)).toEqual([["LOBBY_BRIEF_2", 40, "1:2"]]);
    expect(logged(error, "aucun gestionnaire actif")).toBe(true);
    // Balayage suivant : toujours sans gestionnaire, pm2 ne le redit pas.
    error.mockClear();
    jest.useFakeTimers({ now: Date.now() + 60_000, doNotFake: ["setTimeout", "clearTimeout"] });
    try {
      mockDb([MATCH], [false]);
      await dispatchLobbyBriefs();
    } finally {
      jest.useRealTimers();
    }
    expect(logged(error, "aucun gestionnaire actif")).toBe(false);
    error.mockRestore();
  });

  it("dispatchLobbyBriefs_noSideCanBeBriefed_castersAndRefereesNotRead", async () => {
    jest.mocked(loadEntrantManagerIds).mockResolvedValue(new Map());
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { execute } = mockDb([{ ...MATCH, referee_user_id: 9 }]);

    expect(await dispatchLobbyBriefs()).toBe(0);

    expect(execute).not.toHaveBeenCalled();
    expect(readMatchCasters).toHaveBeenCalledWith(expect.anything(), []);
    expect(loadEligibleRefereeIds).not.toHaveBeenCalled();
    jest.mocked(console.error).mockRestore();
  });

  it("en tournoi individuel, le joueur reçoit le brief sans aucun pseudo", async () => {
    jest.mocked(loadEntrantManagerIds).mockResolvedValue(
      new Map([
        [1, [10]],
        [2, [20]],
      ]),
    );
    mockDb([{ ...MATCH, participant_type: "SOLO", team1_name: "PseudoA", team2_name: "PseudoB" }]);
    await dispatchLobbyBriefs();
    for (const send of sends()) {
      for (const text of [send.dm(), send.dm("en"), send.dm(null), send.push().body, send.push("en").body]) {
        expect(text).not.toMatch(/PseudoA|PseudoB/);
      }
    }
    expect(sends()[0].dm()).toContain("• Gauche (hôte) : toi");
  });

  it("dispatchLobbyBriefs_marvelRivalsTournament_dmSpeaksOfNoBattletag", async () => {
    jest.mocked(loadEligibleRefereeIds).mockResolvedValue(new Set([9]));
    const { query } = mockDb([{ ...MATCH, game: "MR", referee_user_id: 9 }]);

    await dispatchLobbyBriefs();

    expect(query.mock.calls[0][0]).toMatch(/t\.game/);
    const dm = sends()[0].dm();
    expect(dm).toContain("• Arbitre désigné : il invitera les joueurs dans le salon.");
    expect(dm).not.toContain("BattleTag");
  });

  it("suit l'hôte choisi, la tête de série en BG Survie, le cast et l'arbitre encore éligible", async () => {
    jest.mocked(readMatchCasters).mockResolvedValue(new Map([[40, [7]]]));
    jest.mocked(loadEligibleRefereeIds).mockResolvedValue(new Set([9]));
    mockDb([
      { ...MATCH, host_team_id: 2, referee_user_id: 9 },
      { ...MATCH, id: 41, team1_seed: 4, team2_seed: 1, self_managed: 1 },
      { ...MATCH, id: 42, referee_user_id: 8 },
    ]);
    await dispatchLobbyBriefs();
    const [m40, , m41, , m42] = sends();
    expect(m40.dm()).toContain("• Gauche (hôte) : « Nova »");
    expect(m40.dm()).toContain("• Bans de la carte 1 : « Renards » d'abord, puis « Nova »");
    expect(m40.dm()).toContain("Match casté");
    expect(m40.dm()).toContain("Arbitre désigné");
    expect(m41.dm()).toContain("• Gauche (hôte) : « Nova »");
    expect(m41.dm()).toContain("Autogestion");
    expect(m41.dm()).not.toContain("Match casté");
    // Arbitre devenu inéligible : rien n'est promis.
    expect(m42.dm()).not.toMatch(/Arbitre|Autogestion/);
    expect(loadEligibleRefereeIds).toHaveBeenCalledWith(expect.anything(), [9, 8]);
  });

  it("dispatchLobbyBriefs_refereePlaysTheMatch_noRefereeLine", async () => {
    jest.mocked(loadEligibleRefereeIds).mockResolvedValue(new Set([9]));
    const { query } = mockDb([{ ...MATCH, referee_user_id: 9, referee_plays: 1 }]);

    await dispatchLobbyBriefs();

    // Même règle que l'éligibilité des matchs (`playsMatchSql`) : membre actif ou joueur solo.
    expect(query.mock.calls[0][0]).toMatch(/rptm\.user_id = m\.referee_user_id/);
    expect(query.mock.calls[0][0]).toMatch(/rptm\.team_id IN \(m\.team1_id, m\.team2_id\)/);
    expect(query.mock.calls[0][0]).toMatch(/rpst\.solo_user_id = m\.referee_user_id AND rpst\.id IN \(m\.team1_id, m\.team2_id\)/);
    expect(sends()[0].dm()).not.toContain("Arbitre");
  });

  it("dispatchLobbyBriefs_settingsChangedBeforeClaim_rereadSettingsBriefed", async () => {
    jest.mocked(loadEligibleRefereeIds).mockImplementation(async (_db, ids) => new Set(ids.filter((id) => id === 5)));
    const { query } = mockDb(
      [MATCH],
      [],
      new Map([[40, { ...MATCH, host_team_id: 2, first_map: "Busan", referee_user_id: 5 }]]),
    );

    await dispatchLobbyBriefs();

    // Une relecture par côté réservé.
    expect(query).toHaveBeenCalledTimes(3);
    expect(sends()[0].dm()).toContain("• Gauche (hôte) : « Nova »");
    expect(sends()[0].dm()).toContain("« Busan »");
    // Arbitre désigné entre les deux lectures : sa condition est lue à part.
    expect(loadEligibleRefereeIds).toHaveBeenLastCalledWith(expect.anything(), [5]);
    expect(sends()[0].dm()).toContain("Arbitre désigné");
  });

  it("dispatchLobbyBriefs_rereadFails_claimReleasedByIdNothingSentRetryArmed", async () => {
    jest.useFakeTimers();
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { query, execute } = mockDb([MATCH]);
      query.mockResolvedValueOnce([[MATCH]]).mockRejectedValueOnce(new Error("DB_DOWN"));

      expect(await dispatchLobbyBriefs()).toBe(0);

      expect(notifyUsers).not.toHaveBeenCalled();
      expect(releases(execute).map(([sql, params]) => [sql, params])).toEqual([
        ["DELETE FROM bg_match_start_notices WHERE id IN (?)", [100]],
      ]);
      // La relance armée briefe sans autre déclencheur.
      await jest.advanceTimersByTimeAsync(10_000);
      expect(notifyUsers).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
      error.mockRestore();
    }
  });

  it("dispatchLobbyBriefs_twoClaimedSides_eachSideRereadWithItsOwnClaimId", async () => {
    const { query } = mockDb([MATCH]);

    await dispatchLobbyBriefs();

    expect(query.mock.calls.slice(1).map(([, params]) => params)).toEqual([
      [100, 40, "1:2"],
      [101, 40, "1:2"],
    ]);
  });

  it("dispatchLobbyBriefs_claimErasedWhileLobbyOpen_sideNotSentNothingReleasedRetryArmed", async () => {
    jest.useFakeTimers();
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { query, execute } = mockDb([MATCH]);
      query
        .mockResolvedValueOnce([[MATCH]])
        .mockResolvedValueOnce([[{ ...MATCH, claim_kept: 0 }]])
        .mockResolvedValueOnce([[{ ...MATCH, claim_kept: 1 }]]);

      expect(await dispatchLobbyBriefs()).toBe(1);

      expect(sends().map((send) => send.userIds)).toEqual([[20]]);
      expect(releases(execute)).toHaveLength(0);
      expect(logged(error, "réservation effacée avant l'envoi")).toBe(true);
      await jest.advanceTimersByTimeAsync(10_000);
      expect(query.mock.calls.filter(([sql]) => !/WHERE m\.id = \?/.test(sql))).toHaveLength(2);
    } finally {
      jest.useRealTimers();
      error.mockRestore();
    }
  });

  it("dispatchLobbyBriefs_releaseFails_countLogged", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(formatLobbyBriefDm).mockImplementationOnce(() => {
      throw new Error("RENDER");
    });
    const { execute } = mockDb([MATCH]);
    const insertOrDelete = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql, params) => {
      if (sql.startsWith("DELETE FROM bg_match_start_notices WHERE id IN")) throw new Error("DB_DOWN");
      return insertOrDelete(sql, params);
    });

    await dispatchLobbyBriefs();

    expect(logged(error, "1 réservation(s) non rendue(s)")).toBe(true);
    expect(logged(error, "remis au balayage suivant")).toBe(false);
    error.mockRestore();
  });

  it("dispatchLobbyBriefs_siteRootUnknown_dmWithoutLinkLine", async () => {
    siteRoot.value = null;
    mockDb([MATCH]);

    await dispatchLobbyBriefs();

    expect(sends()[0].dm()).not.toContain("localhost");
    expect(sends()[0].dm()).not.toContain("BattleTags à inviter");
    expect(sends()[0].push().url).toBe("/tournois/4/matchs/40");
  });

  it("dispatchLobbyBriefs_nobodyReached_sideNotCountedAndLogged", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(notifyUsers).mockResolvedValue({
      discord: { sent: 0, unresolved: [], failed: [] },
      discordUnreachedUserIds: [],
      pushed: 0,
    });
    const { execute } = mockDb([MATCH]);

    expect(await dispatchLobbyBriefs()).toBe(0);

    expect(logged(error, "reçu par personne")).toBe(true);
    // Rien à réessayer : la réservation reste.
    expect(releases(execute)).toHaveLength(0);
    error.mockRestore();
  });

  it("bot injoignable : le push part, l'échec est dit dans pm2, sans nouvel essai", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(notifyUsers).mockResolvedValue({ discord: null, discordUnreachedUserIds: [10, 11], pushed: 2 });
    mockDb([MATCH]);
    expect(await dispatchLobbyBriefs()).toBe(2);
    expect(logged(error, "non remis sur Discord à 2 compte(s)")).toBe(true);
    error.mockRestore();
  });

  it("une panne de lecture des casters ou des arbitres ne prive pas les managers du brief", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(loadEligibleRefereeIds).mockRejectedValue(new Error("DB_DOWN"));
    mockDb([{ ...MATCH, referee_user_id: 9 }]);
    expect(await dispatchLobbyBriefs()).toBe(2);
    expect(sends()[0].dm()).not.toContain("Arbitre");
    error.mockRestore();
  });

  it("dispatchLobbyBriefs_managersOrRecipientsUnreadable_nothingClaimed", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(loadNotificationRecipients).mockRejectedValueOnce(new Error("DB_DOWN"));
    const { execute } = mockDb([MATCH, { ...MATCH, id: 41 }]);

    expect(await dispatchLobbyBriefs()).toBe(0);

    expect(execute).not.toHaveBeenCalled();
    expect(notifyUsers).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("un envoi qui lève garde sa réservation (une partie a pu partir) : jamais deux fois", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(notifyUsers).mockRejectedValueOnce(new Error("PUSH_DOWN"));
    const { execute } = mockDb([MATCH, { ...MATCH, id: 41 }]);
    expect(await dispatchLobbyBriefs()).toBe(3);
    expect(notifyUsers).toHaveBeenCalledTimes(4);
    expect(logged(error, "brief du match 40 non envoyé")).toBe(true);
    expect(releases(execute)).toHaveLength(0);
    error.mockRestore();
  });

  it("dispatchLobbyBriefs_claimThrowsOnFirstMatch_releasedByKeyAndNextMatchStillBriefed", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { execute } = mockDb([MATCH, { ...MATCH, id: 41 }]);
    const base = execute.getMockImplementation()!;
    let inserts = 0;
    execute.mockImplementation(async (sql, params) => {
      if (sql.startsWith("INSERT IGNORE")) {
        inserts += 1;
        if (inserts === 1) throw new Error("CONNECTION_LOST");
      }
      return base(sql, params);
    });

    expect(await dispatchLobbyBriefs()).toBe(2);

    // Le côté interrompu du 40 est rendu par sa clé ; le 41 part quand même.
    expect(releases(execute).map(([sql, params]) => [sql, params])).toEqual([
      ["DELETE FROM bg_match_start_notices WHERE match_id = ? AND pairing = ? AND phase = ?", [40, "1:2", "LOBBY_BRIEF_1"]],
    ]);
    expect(notifyUsers).toHaveBeenCalledTimes(2);
    expect(logged(error, "brief du match 40 interrompu")).toBe(true);
    error.mockRestore();
  });

  it("dispatchLobbyBriefs_linkThrowsAfterClaim_claimReleasedByIdAndNextMatchStillBriefed", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    siteRoot.failFor = "/matchs/40";
    const { execute } = mockDb([MATCH, { ...MATCH, id: 41 }]);

    expect(await dispatchLobbyBriefs()).toBe(2);

    // Rien n'est parti pour le 40 : sa réservation (id 100) est rendue par son id.
    expect(releases(execute).map(([sql, params]) => [sql, params])).toEqual([
      ["DELETE FROM bg_match_start_notices WHERE id IN (?)", [100]],
    ]);
    expect(notifyUsers).toHaveBeenCalledTimes(2);
    expect(logged(error, "brief du match 40 interrompu")).toBe(true);
    error.mockRestore();
  });

  it("dispatchLobbyBriefs_recipientsUnreadable_nothingClaimedAndTrailingSweepBriefs", async () => {
    jest.useFakeTimers();
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      jest.mocked(loadNotificationRecipients).mockRejectedValueOnce(new Error("DB_DOWN"));
      const { execute } = mockDb([MATCH]);

      expect(await dispatchLobbyBriefs()).toBe(0);
      expect(execute).not.toHaveBeenCalled();
      expect(logged(error, "briefs du salon non envoyés")).toBe(true);

      // La relance armée par l'échec briefe sans autre déclencheur.
      await jest.advanceTimersByTimeAsync(10_000);
      expect(notifyUsers).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
      error.mockRestore();
    }
  });

  it("dispatchLobbyBriefs_briefNotRendered_releasedByIdAndOnlyThatSideRebriefedNextSweep", async () => {
    jest.useFakeTimers();
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      jest.mocked(formatLobbyBriefDm).mockImplementationOnce(() => {
        throw new Error("RENDER");
      });
      const { execute } = mockDb([MATCH]);

      expect(await dispatchLobbyBriefs()).toBe(1);

      // Rien n'est parti pour le côté 1 : sa réservation (id 100) est rendue par son id.
      expect(releases(execute).map(([sql, params]) => [sql, params])).toEqual([
        ["DELETE FROM bg_match_start_notices WHERE id IN (?)", [100]],
      ]);
      expect(sends().map((send) => send.userIds)).toEqual([[20]]);
      expect(logged(error, "1 brief(s) remis au balayage suivant")).toBe(true);

      // Le balayage suivant part seul (relève armée) : seul le côté rendu est rebriefé.
      jest.mocked(notifyUsers).mockClear();
      const second = mockDb([MATCH], [true, false]);
      await jest.advanceTimersByTimeAsync(10_000);
      expect(second.execute.mock.calls.filter(([sql]) => sql.startsWith("INSERT IGNORE"))).toHaveLength(2);
      expect(sends().map((send) => send.userIds)).toEqual([[10, 11]]);
    } finally {
      jest.useRealTimers();
      error.mockRestore();
    }
  });

  it("dispatchLobbyBriefs_retriesExhausted_noMoreTrailingSweep", async () => {
    jest.useFakeTimers();
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      jest.mocked(formatLobbyBriefDm).mockImplementation(() => {
        throw new Error("RENDER");
      });
      const { query } = mockDb([MATCH]);

      await dispatchLobbyBriefs();
      for (let i = 0; i < 6; i += 1) await jest.advanceTimersByTimeAsync(10_000);

      // Le balayage initial puis trois relances au plus.
      expect(query.mock.calls.filter(([sql]) => !/WHERE m\.id = \?/.test(sql))).toHaveLength(4);
      expect(logged(error, "relances épuisées")).toBe(true);
    } finally {
      jest.mocked(formatLobbyBriefDm).mockImplementation(actualDm.formatLobbyBriefDm);
      jest.useRealTimers();
      error.mockRestore();
    }
  });

  it("dispatchLobbyBriefs_oneMatchExhaustedItsRetries_anotherMatchFailingStillArmsARetry", async () => {
    jest.useFakeTimers();
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      jest.mocked(formatLobbyBriefDm).mockImplementation(() => {
        throw new Error("RENDER");
      });
      mockDb([MATCH]);
      await dispatchLobbyBriefs();
      for (let i = 0; i < 6; i += 1) await jest.advanceTimersByTimeAsync(10_000);

      // Le match 40 a épuisé ses relances ; le 41 échoue à son tour, il a les siennes.
      const { query } = mockDb([{ ...MATCH, id: 41 }]);
      await dispatchLobbyBriefs();
      await jest.advanceTimersByTimeAsync(10_000);

      expect(query.mock.calls.filter(([sql]) => !/WHERE m\.id = \?/.test(sql))).toHaveLength(2);
    } finally {
      jest.mocked(formatLobbyBriefDm).mockImplementation(actualDm.formatLobbyBriefDm);
      jest.useRealTimers();
      error.mockRestore();
    }
  });

  it("dispatchLobbyBriefs_lobbyClosedBetweenClaimAndReread_claimReleasedByIdAndNothingSent", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { execute } = mockDb([MATCH], [], new Map([[40, null]]));

    expect(await dispatchLobbyBriefs()).toBe(0);

    expect(notifyUsers).not.toHaveBeenCalled();
    expect(execute.mock.calls.filter(([sql]) => sql.startsWith("INSERT IGNORE"))).toHaveLength(1);
    expect(releases(execute).map(([sql, params]) => [sql, params])).toEqual([
      ["DELETE FROM bg_match_start_notices WHERE id IN (?)", [100]],
    ]);
    error.mockRestore();
  });

  it("dispatchLobbyBriefs_claimedSide_rereadChecksTheClaimStillExists", async () => {
    const { query } = mockDb([MATCH]);

    await dispatchLobbyBriefs();

    expect(query.mock.calls[1][0]).toContain("bg_match_start_notices n WHERE n.id = ?) AS claim_kept");
  });

  it("dispatchLobbyBriefs_lobbyClosedBeforeSend_noRetryArmedAndLoggedAsClosed", async () => {
    jest.useFakeTimers();
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { query } = mockDb([MATCH], [], new Map([[40, null]]));

      await dispatchLobbyBriefs();
      await jest.advanceTimersByTimeAsync(10_000);

      expect(logged(error, "salon refermé avant l'envoi")).toBe(true);
      expect(logged(error, "remis au balayage suivant")).toBe(false);
      expect(query.mock.calls.filter(([sql]) => !/WHERE m\.id = \?/.test(sql))).toHaveLength(1);
    } finally {
      jest.useRealTimers();
      error.mockRestore();
    }
  });

  it("dispatchLobbyBriefs_side1SentThenSide2Closed_side1ClaimKept", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { query, execute } = mockDb([MATCH]);
    query
      .mockResolvedValueOnce([[MATCH]])
      .mockResolvedValueOnce([[{ ...MATCH, claim_kept: 1 }]])
      .mockResolvedValueOnce([[]]);

    expect(await dispatchLobbyBriefs()).toBe(1);

    expect(releases(execute).map(([, params]) => params)).toEqual([[101]]);
    error.mockRestore();
  });

  it("dispatchLobbyBriefs_side1NotRenderedThenSide2Closed_bothReleasedNoRetry", async () => {
    jest.useFakeTimers();
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      jest.mocked(formatLobbyBriefDm).mockImplementationOnce(() => {
        throw new Error("RENDER");
      });
      const { query, execute } = mockDb([MATCH]);
      query
        .mockResolvedValueOnce([[MATCH]])
        .mockResolvedValueOnce([[{ ...MATCH, claim_kept: 1 }]])
        .mockResolvedValueOnce([[]]);

      await dispatchLobbyBriefs();
      await jest.advanceTimersByTimeAsync(10_000);

      expect(releases(execute).map(([, params]) => params)).toEqual([[100, 101]]);
      expect(logged(error, "remis au balayage suivant")).toBe(false);
      expect(query.mock.calls.filter(([sql]) => !/WHERE m\.id = \?/.test(sql))).toHaveLength(1);
    } finally {
      jest.useRealTimers();
      error.mockRestore();
    }
  });

  it("dispatchLobbyBriefs_sameMatchLostAndRetried_budgetCountedOnce", async () => {
    jest.useFakeTimers();
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      jest.mocked(formatLobbyBriefDm).mockImplementation(() => {
        throw new Error("RENDER");
      });
      const { query } = mockDb([MATCH]);
      // Chaque balayage réserve deux côtés : le premier (id pair) a perdu sa réservation.
      query.mockImplementation(async (sql, params) => {
        if (!/WHERE m\.id = \? AND m\.launch_pairing = \?/.test(sql)) return [[MATCH]];
        return [[{ ...MATCH, claim_kept: Number((params as unknown[])[0]) % 2 }]];
      });

      await dispatchLobbyBriefs();
      for (let i = 0; i < 6; i += 1) await jest.advanceTimersByTimeAsync(10_000);

      // Le balayage initial puis trois relances : la clé du match n'est comptée qu'une fois par balayage.
      expect(query.mock.calls.filter(([sql]) => !/WHERE m\.id = \?/.test(sql))).toHaveLength(4);
    } finally {
      jest.mocked(formatLobbyBriefDm).mockImplementation(actualDm.formatLobbyBriefDm);
      jest.useRealTimers();
      error.mockRestore();
    }
  });

  it("dispatchLobbyBriefs_side1LostThenSide2Closed_noRetryArmed", async () => {
    jest.useFakeTimers();
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { query, execute } = mockDb([MATCH]);
      query
        .mockResolvedValueOnce([[MATCH]])
        .mockResolvedValueOnce([[{ ...MATCH, claim_kept: 0 }]])
        .mockResolvedValueOnce([[]]);

      await dispatchLobbyBriefs();
      await jest.advanceTimersByTimeAsync(10_000);

      expect(releases(execute).map(([, params]) => params)).toEqual([[101]]);
      expect(query.mock.calls.filter(([sql]) => !/WHERE m\.id = \?/.test(sql))).toHaveLength(1);
    } finally {
      jest.useRealTimers();
      error.mockRestore();
    }
  });

  it("dispatchLobbyBriefs_ghostSideThenLobbyClosed_bothClaimsReleased", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { execute } = mockDb([{ ...MATCH, team1_ghost: 1 }], [], new Map([[40, null]]));

    expect(await dispatchLobbyBriefs()).toBe(0);

    expect(notifyUsers).not.toHaveBeenCalled();
    expect(releases(execute).map(([sql, params]) => [sql, params])).toEqual([
      ["DELETE FROM bg_match_start_notices WHERE id IN (?, ?)", [100, 101]],
    ]);
    error.mockRestore();
  });

  it("dispatchLobbyBriefs_onlyManagerAccountDeleted_sideNotClaimedAndLogged", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    // Les comptes 10 et 11 (équipe 1) sont supprimés : plus destinataires.
    jest.mocked(loadNotificationRecipients).mockResolvedValue([
      { userId: 20, discord: { discordId: "20", handle: null, label: "u20" } },
    ]);
    const { execute } = mockDb([MATCH]);

    expect(await dispatchLobbyBriefs()).toBe(1);

    expect(execute.mock.calls.map(([, params]) => params)).toEqual([["LOBBY_BRIEF_2", 40, "1:2"]]);
    expect(logged(error, "aucun gestionnaire actif")).toBe(true);
    error.mockRestore();
  });

  it("dispatchLobbyBriefs_allManagersDeleted_castersAndRefereesNotRead", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(loadNotificationRecipients).mockResolvedValue([]);
    const { execute } = mockDb([{ ...MATCH, referee_user_id: 9 }]);

    expect(await dispatchLobbyBriefs()).toBe(0);

    expect(execute).not.toHaveBeenCalled();
    expect(readMatchCasters).toHaveBeenCalledWith(expect.anything(), []);
    expect(loadEligibleRefereeIds).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("dispatchLobbyBriefs_emptySweepAfterSharedReadFailures_resetsSweepRetryBudget", async () => {
    jest.useFakeTimers();
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // Quatre pannes de la lecture commune, chacune suivie d'un balayage sans candidat.
      jest.mocked(loadNotificationRecipients).mockRejectedValueOnce(new Error("DB_DOWN"));
      mockDb([MATCH]);
      await dispatchLobbyBriefs();
      for (let failure = 2; failure <= 4; failure += 1) {
        mockDb([]);
        await jest.advanceTimersByTimeAsync(10_000);
        jest.mocked(loadNotificationRecipients).mockRejectedValueOnce(new Error("DB_DOWN"));
        mockDb([MATCH]);
        await dispatchLobbyBriefs();
        await jest.advanceTimersByTimeAsync(10_000);
      }

      // La quatrième panne arme encore la relance : le brief part sans autre déclencheur.
      expect(logged(error, "relances épuisées")).toBe(false);
      mockDb([MATCH]);
      await jest.advanceTimersByTimeAsync(10_000);
      expect(notifyUsers).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
      error.mockRestore();
    }
  });

  it("ne lève jamais : une base en panne rend 0", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(getDatabase).mockRejectedValue(new Error("DB_DOWN"));
    expect(await dispatchLobbyBriefs()).toBe(0);
    error.mockRestore();
  });

  it("est étranglé : un second appel immédiat ne relit pas", async () => {
    const { query } = mockDb([]);
    await dispatchLobbyBriefs();
    expect(await dispatchLobbyBriefs()).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
