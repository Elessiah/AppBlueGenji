import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

// Simulé pour toute la suite (`tests/setup-env.cjs`) : ici, le vrai.
jest.unmock("@/lib/server/tournaments/lobby-brief");
jest.mock("@/lib/server/database");
jest.mock("@/lib/server/notify");
jest.mock("@/lib/server/site-url", () => ({ siteCanonicalBase: () => "https://bluegenji.test" }));
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
import { renderDm } from "@/lib/shared/dm-language";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";
import { resolvePush } from "../../helpers/push";

const MATCH = {
  id: 40,
  tournament_id: 4,
  tournament_name: "Coupe",
  participant_type: "TEAM",
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

function mockDb(candidates: unknown[], claims: boolean[] = []) {
  const queue = [...claims];
  const query = jest.fn<SqlQuery>().mockResolvedValue([candidates]);
  const execute = jest.fn<SqlQuery>(async (sql) => {
    if (sql.startsWith("INSERT IGNORE INTO bg_match_start_notices")) {
      return [{ affectedRows: (queue.length > 0 ? queue.shift() : true) ? 1 : 0 }];
    }
    if (sql.startsWith("DELETE FROM bg_match_start_notices")) return [{ affectedRows: 1 }];
    throw new Error(`requête inattendue : ${sql}`);
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute }));
  return { query, execute };
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

afterEach(() => resetLobbyBriefThrottle());

describe("dispatchLobbyBriefs", () => {
  it("ne lit que les salons ouverts récemment, de l'appariement courant, pas encore briefés", async () => {
    const { query } = mockDb([]);
    expect(await dispatchLobbyBriefs()).toBe(0);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/t\.state = 'RUNNING'/);
    expect(sql).toMatch(/m\.status = 'READY' AND m\.is_bye = 0/);
    expect(sql).toMatch(/m\.launch_pairing = CONCAT\(m\.team1_id, ':', m\.team2_id\)/);
    expect(sql).toMatch(/m\.lobby_opened_at > NOW\(\) - INTERVAL \? MINUTE/);
    // Un match reste candidat tant qu'un de ses deux côtés n'est pas réservé.
    expect(sql).toMatch(/n\.phase IN \(\?, \?\)\) < 2/);
    expect(params).toEqual([20, "LOBBY_BRIEF_1", "LOBBY_BRIEF_2"]);
    expect(lobbyBriefPhase(2).length).toBeLessThanOrEqual(16);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("réserve le brief par engagée et par appariement, puis l'envoie aux managers de chaque engagée, de son côté", async () => {
    const { execute } = mockDb([MATCH]);

    expect(await dispatchLobbyBriefs()).toBe(2);

    expect(execute.mock.calls.map(([, params]) => params)).toEqual([
      ["LOBBY_BRIEF_1", 40, "1:2"],
      ["LOBBY_BRIEF_2", 40, "1:2"],
    ]);
    expect(loadEntrantManagerIds).toHaveBeenCalledWith([1, 2]);
    // Message de match : tag certifié seul, interrupteur du profil respecté.
    expect(loadNotificationRecipients).toHaveBeenCalledWith([10, 11], "certified", { matchDm: true });
    const [team1, team2] = sends();
    expect(team1.userIds).toEqual([10, 11]);
    expect(team1.notification.topic).toBe("MATCH_LOBBY_BRIEF");
    expect(team1.notification.discord?.context).toBe("lobby-brief");
    expect(team1.dm()).toContain("ton match « Renards » contre « Nova »");
    expect(team1.dm()).toContain("• Gauche (hôte) : « Renards »");
    expect(team1.dm()).toContain("• Premier ban : « Nova »");
    expect(team1.dm()).toContain("https://bluegenji.test/tournois/4/matchs/40");
    expect(team1.push().url).toBe("/tournois/4/matchs/40");
    expect(team2.userIds).toEqual([20]);
    expect(team2.dm()).toContain("ton match « Nova » contre « Renards »");
    expect(team2.dm("en")).toContain("• Left (host): “Renards”");
  });

  it("ne réserve que si le salon est encore ouvert pour cet appariement et ces équipes (lancement défait ou réappariement entre-temps : rien)", async () => {
    const { execute } = mockDb([MATCH], [false, false]);
    expect(await dispatchLobbyBriefs()).toBe(0);
    const [sql] = execute.mock.calls[0];
    // La réservation relit le match dans la même instruction.
    expect(sql).toMatch(/INSERT IGNORE INTO bg_match_start_notices \(match_id, pairing, phase\)\s+SELECT m\.id, m\.launch_pairing, \? FROM bg_matches m/);
    expect(sql).toMatch(/m\.id = \? AND m\.launch_pairing = \? AND m\.status = 'READY' AND m\.is_bye = 0/);
    expect(sql).toMatch(/m\.lobby_opened_at IS NOT NULL/);
    // Réapparié entre-temps (équipes changées, `launch_pairing` resté) : rien pour les anciennes équipes.
    expect(sql).toMatch(/AND m\.launch_pairing = CONCAT\(m\.team1_id, ':', m\.team2_id\)/);
    expect(sql).not.toMatch(/VALUES/);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("n'envoie rien quand un autre balayage a pris les réservations", async () => {
    mockDb([MATCH], [false, false]);
    expect(await dispatchLobbyBriefs()).toBe(0);
    expect(loadEntrantManagerIds).not.toHaveBeenCalled();
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("n'envoie que le côté encore libre : l'autre est déjà briefé", async () => {
    mockDb([MATCH], [false, true]);
    expect(await dispatchLobbyBriefs()).toBe(1);
    expect(loadEntrantManagerIds).toHaveBeenCalledWith([2]);
    expect(sends().map((send) => send.userIds)).toEqual([[20]]);
  });

  it("une fantôme n'a personne : seule l'autre engagée est briefée", async () => {
    jest.mocked(loadEntrantManagerIds).mockResolvedValue(new Map([[2, [20]]]));
    mockDb([MATCH]);
    expect(await dispatchLobbyBriefs()).toBe(1);
    expect(sends().map((send) => send.userIds)).toEqual([[20]]);
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
    expect(m40.dm()).toContain("• Premier ban : « Renards »");
    expect(m40.dm()).toContain("Match casté");
    expect(m40.dm()).toContain("Arbitre désigné");
    expect(m41.dm()).toContain("• Gauche (hôte) : « Nova »");
    expect(m41.dm()).toContain("Autogestion");
    expect(m41.dm()).not.toContain("Match casté");
    // Arbitre devenu inéligible : rien n'est promis.
    expect(m42.dm()).not.toMatch(/Arbitre|Autogestion/);
    expect(loadEligibleRefereeIds).toHaveBeenCalledWith(expect.anything(), [9, 8]);
  });

  it("bot injoignable : le push part, l'échec est dit dans pm2, sans nouvel essai", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(notifyUsers).mockResolvedValue({ discord: null, discordUnreachedUserIds: [10, 11], pushed: 2 });
    mockDb([MATCH]);
    await dispatchLobbyBriefs();
    expect(notifyUsers).toHaveBeenCalledTimes(2);
    expect(error.mock.calls.some(([message]) => String(message).includes("non remis sur Discord à 2 compte(s)"))).toBe(true);
    // Le balayage suivant ne retente pas : les réservations sont prises.
    jest.mocked(notifyUsers).mockClear();
    resetLobbyBriefThrottle();
    mockDb([MATCH], [false, false]);
    await dispatchLobbyBriefs();
    expect(notifyUsers).not.toHaveBeenCalled();
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

  it("une panne de lecture des managers rend les réservations : le balayage suivant réessaie", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(loadEntrantManagerIds).mockRejectedValueOnce(new Error("DB_DOWN"));
    const { execute } = mockDb([MATCH, { ...MATCH, id: 41 }]);
    expect(await dispatchLobbyBriefs()).toBe(0);
    const releases = execute.mock.calls.filter(([sql]) => sql.startsWith("DELETE FROM bg_match_start_notices"));
    // Une seule instruction : tout est rendu, ou rien.
    expect(releases).toHaveLength(1);
    expect(releases[0][1]).toEqual([
      40, "1:2", "LOBBY_BRIEF_1", 40, "1:2", "LOBBY_BRIEF_2", 41, "1:2", "LOBBY_BRIEF_1", 41, "1:2", "LOBBY_BRIEF_2",
    ]);
    expect(String(releases[0][0]).match(/\(match_id = \? AND pairing = \? AND phase = \?\)/g)).toHaveLength(4);
    expect(notifyUsers).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("destinataires illisibles d'un côté : il rend sa seule réservation, les autres sont briefés", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(loadNotificationRecipients).mockRejectedValueOnce(new Error("DB_DOWN"));
    const { execute } = mockDb([MATCH, { ...MATCH, id: 41 }]);
    expect(await dispatchLobbyBriefs()).toBe(3);
    expect(notifyUsers).toHaveBeenCalledTimes(3);
    expect(error.mock.calls.some(([message]) => String(message).includes("destinataires du match 40 illisibles"))).toBe(true);
    const releases = execute.mock.calls.filter(([sql]) => sql.startsWith("DELETE FROM bg_match_start_notices"));
    expect(releases.map(([, params]) => params)).toEqual([[40, "1:2", "LOBBY_BRIEF_1"]]);
    error.mockRestore();
  });

  it("un envoi qui lève garde sa réservation (une partie a pu partir) : jamais deux fois", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(notifyUsers).mockRejectedValueOnce(new Error("PUSH_DOWN"));
    const { execute } = mockDb([MATCH, { ...MATCH, id: 41 }]);
    expect(await dispatchLobbyBriefs()).toBe(3);
    expect(notifyUsers).toHaveBeenCalledTimes(4);
    expect(error.mock.calls.some(([message]) => String(message).includes("brief du match 40 non envoyé"))).toBe(true);
    expect(execute.mock.calls.some(([sql]) => sql.startsWith("DELETE FROM bg_match_start_notices"))).toBe(false);
    error.mockRestore();
  });

  it("une réservation qui échoue en cours de route rend celles déjà prises", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { execute } = mockDb([MATCH, { ...MATCH, id: 41 }]);
    let inserts = 0;
    execute.mockImplementation(async (sql) => {
      if (sql.startsWith("INSERT IGNORE")) {
        inserts += 1;
        if (inserts === 3) throw new Error("DB_DOWN");
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 2 }];
    });
    expect(await dispatchLobbyBriefs()).toBe(0);
    const releases = execute.mock.calls.filter(([sql]) => sql.startsWith("DELETE FROM bg_match_start_notices"));
    expect(releases.map(([, params]) => params)).toEqual([[40, "1:2", "LOBBY_BRIEF_1", 40, "1:2", "LOBBY_BRIEF_2"]]);
    expect(notifyUsers).not.toHaveBeenCalled();
    error.mockRestore();
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
