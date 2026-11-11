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


import { getDatabase } from "@/lib/server/database";
import { loadEntrantManagerIds, loadNotificationRecipients, notifyUsers } from "@/lib/server/notify";

import { readMatchCasters } from "@/lib/server/tournaments/player-pushes";
import {
  dispatchLobbyBriefs,
  firstAnnounceableUrl,
  LOBBY_BRIEF_PHASE,
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
  brief_pairing: "1:2",
  voice_tracked: 0,
  stream_urls: null,
  host_team_id: null,
  team1_seed: null,
  team2_seed: null,
  first_map: "Ilios",
  // Le check-in ne part qu'en autogestion (décision du 2026-11-05).
  self_managed: 1,
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
    if (/WHERE m\.id = \? AND CONCAT\(m\.team1_id, ':', m\.team2_id\) = \?/.test(sql)) {
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
    if (sql.startsWith("INSERT IGNORE INTO bg_lobby_brief_marks")) return [{ affectedRows: 1 }];
    throw new Error(`requête inattendue : ${sql}`);
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute }));
  return { query, execute };
}

function releases(execute: ReturnType<typeof mockDb>["execute"]) {
  return execute.mock.calls.filter(([sql]) => sql.startsWith("DELETE FROM bg_match_start_notices"));
}

/** Paramètres des réservations seules (les marques durables du check-in sont à part). */
function claimParams(execute: ReturnType<typeof mockDb>["execute"]) {
  return execute.mock.calls.filter(([sql]) => sql.startsWith("INSERT IGNORE INTO bg_match_start_notices")).map(([, params]) => params);
}

function marks(execute: ReturnType<typeof mockDb>["execute"]) {
  return execute.mock.calls.filter(([sql]) => sql.startsWith("INSERT IGNORE INTO bg_lobby_brief_marks"));
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
  it("ne lit que les matchs dus — par leur horaire ou, à défaut, par leur salon — pas encore briefés", async () => {
    const { query } = mockDb([]);
    expect(await dispatchLobbyBriefs()).toBe(0);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/t\.state = 'RUNNING'/);
    expect(sql).toMatch(/m\.status = 'READY' AND m\.is_bye = 0/);
    // Le quart d'heure avant le coup d'envoi : le repère de principe.
    expect(sql).toMatch(/m\.start_at <= NOW\(\) \+ INTERVAL 15 MINUTE/);
    // En retard, même fenêtre que le salon : pas de check-in en pleine partie.
    expect(sql).toMatch(/m\.start_at > NOW\(\) - INTERVAL 20 MINUTE/);
    // Sans horaire, le salon : le repli d'avant la fusion.
    expect(sql).toMatch(/OR \(m\.lobby_opened_at IS NOT NULL\s+AND \(m\.start_at IS NULL OR m\.start_at <= NOW\(\) OR m\.launched_at IS NOT NULL\)\s+AND m\.launch_pairing = CONCAT\(m\.team1_id, ':', m\.team2_id\)\s+AND m\.lobby_opened_at > NOW\(\) - INTERVAL 20 MINUTE\)/);
    // Un match qui porte un score est joué : aucun salon à régler.
    expect(sql).toMatch(/AND m\.team1_score IS NULL AND m\.team2_score IS NULL/);
    // Un match reste candidat tant qu'une de ses deux engagées n'est pas réservée
    // (clé : l'id de l'engagée ; l'ancien format compté par engagée, comme à la réservation).
    // `CONCAT(…, '')`, jamais `CAST(… AS CHAR)` : sa collation de connexion
    // heurterait celle de la colonne (« Illegal mix of collations »).
    expect(sql).toMatch(/n\.phase = \? AND n\.pairing = CONCAT\(m\.team1_id, ''\)/);
    expect(sql).toMatch(/n\.phase = \? AND n\.pairing = CONCAT\(m\.team2_id, ''\)/);
    expect(sql).not.toContain("AS CHAR");
    expect(params).toEqual(["LOBBY_BRIEF", "LOBBY_BRIEF"]);
  });

  it("dispatchLobbyBriefs_sweepSql_startBeyondLeadIsLobbyTriggeredWithoutVoiceLine", async () => {
    const { query } = mockDb([]);

    await dispatchLobbyBriefs();

    const sql = String(query.mock.calls[0][0]).replace(/\s+/g, " ");
    // Un horaire au-delà du quart d'heure n'est dû que par le salon (match lancé tôt).
    expect(sql).toContain(
      "CASE WHEN m.start_at IS NULL OR m.start_at > NOW() + INTERVAL 15 MINUTE THEN 'UNSCHEDULED' WHEN m.start_at > NOW() THEN 'SOON' ELSE 'PASSED' END AS kickoff_state",
    );
    // Le vocal n'ouvre qu'au quart d'heure de l'horaire : pas annoncé avant.
    expect(sql).toContain("AND m.start_at IS NOT NULL AND m.start_at <= NOW() + INTERVAL 15 MINUTE) AS voice_tracked");
  });

  it("dispatchLobbyBriefs_legacyReservation_matchesClaimGuardPerTeam", async () => {
    const { query } = mockDb([]);
    await dispatchLobbyBriefs();
    const sql = String(query.mock.calls[0][0]);
    // Un brief de l'ancien format vaut pour son engagée quel que soit l'adversaire d'alors.
    expect(sql).toMatch(/n\.phase = 'LOBBY_BRIEF_1' AND n\.pairing LIKE CONCAT\(m\.team1_id, ':%'\)/);
    expect(sql).toMatch(/n\.phase = 'LOBBY_BRIEF_2' AND n\.pairing LIKE CONCAT\('%:', m\.team2_id\)/);
    expect(sql).not.toMatch(/< 2/);
  });

  it("dispatchLobbyBriefs_sweep_skipsSideWithDurableMark", async () => {
    const { query } = mockDb([]);
    await dispatchLobbyBriefs();
    const sql = String(query.mock.calls[0][0]).replace(/\s+/g, " ");
    // Une engagée déjà briefée à cette place (match recréé par un retour arrière) n'est plus candidate.
    expect(sql).toContain("FROM bg_lobby_brief_marks k WHERE k.tournament_id = m.tournament_id AND k.phase_id = m.phase_id");
    expect(sql).toContain("k.match_number = m.match_number AND k.team_id = m.team1_id");
    expect(sql).toContain("k.match_number = m.match_number AND k.team_id = m.team2_id");
  });

  it("dispatchLobbyBriefs_claim_refusedWhenMatchPlaceAlreadyMarked", async () => {
    const { execute } = mockDb([MATCH]);
    await dispatchLobbyBriefs();
    const claim = String(execute.mock.calls[0][0]).replace(/\s+/g, " ");
    expect(claim).toContain(
      "AND NOT EXISTS (SELECT 1 FROM bg_lobby_brief_marks k WHERE k.tournament_id = m.tournament_id AND k.phase_id = m.phase_id AND k.bracket = m.bracket AND k.round_number = m.round_number AND k.match_number = m.match_number AND k.team_id = ?)",
    );
  });

  it("dispatchLobbyBriefs_sideSent_durableMarkWrittenWithTeamAndMatch", async () => {
    const { execute } = mockDb([MATCH]);

    await dispatchLobbyBriefs();

    expect(marks(execute).map(([, params]) => params)).toEqual([
      [1, 40],
      [2, 40],
    ]);
  });

  it("dispatchLobbyBriefs_briefNotRendered_noDurableMark", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(formatLobbyBriefDm).mockImplementationOnce(() => {
      throw new Error("RENDER");
    });
    const { execute } = mockDb([MATCH]);

    await dispatchLobbyBriefs();

    // Rien n'est parti du côté 1 : sa réservation est rendue, aucune marque ; le côté 2 en a une.
    expect(marks(execute).map(([, params]) => params)).toEqual([[2, 40]]);
    error.mockRestore();
  });

  it("dispatchLobbyBriefs_sendThrows_markStillWritten", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(notifyUsers).mockRejectedValueOnce(new Error("PUSH_DOWN"));
    const { execute } = mockDb([MATCH]);

    await dispatchLobbyBriefs();

    // Une partie a pu partir : la marque est posée, jamais deux fois.
    expect(marks(execute).map(([, params]) => params)).toEqual([
      [1, 40],
      [2, 40],
    ]);
    error.mockRestore();
  });

  it("dispatchLobbyBriefs_markWriteFails_sideStillCountedAndLogged", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { execute } = mockDb([MATCH]);
    const base = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql, params) => {
      if (sql.startsWith("INSERT IGNORE INTO bg_lobby_brief_marks")) throw new Error("DB_DOWN");
      return base(sql, params);
    });

    expect(await dispatchLobbyBriefs()).toBe(2);

    expect(logged(error, "parti sans marque durable")).toBe(true);
    expect(releases(execute)).toHaveLength(0);
    error.mockRestore();
  });

  it("dueSql_hiddenTournament_notDue", async () => {
    const { query } = mockDb([]);
    await dispatchLobbyBriefs();
    // Un tournoi masqué de nouveau n'envoie ni son nom ni ses équipes, comme les salons vocaux.
    expect(query.mock.calls[0][0]).toMatch(/AND t\.start_visibility_at <= NOW\(\)/);
  });

  it("dueSql_matchNotAnnouncedCast_streamUrlNull", async () => {
    const { query } = mockDb([]);
    await dispatchLobbyBriefs();
    // Lien tu tant que le match n'est pas annoncé casté, comme sur la page du match.
    expect(query.mock.calls[0][0]).toMatch(/CASE WHEN m.live_trigger IS NULL THEN NULL ELSE/);
  });

  it("dispatchLobbyBriefs_redirectStreamUrl_noStreamInBrief", async () => {
    mockDb([{ ...MATCH, stream_urls: "https://www.youtube.com/redirect?q=https://phish.example" }]);

    await dispatchLobbyBriefs();

    // Page de redirection d'un hôte permis : refusée comme dans une annonce #live.
    expect(jest.mocked(formatLobbyBriefDm).mock.calls[0][0].streamUrl).toBeNull();
  });

  it("dispatchLobbyBriefs_firstLinkRefusedSecondValid_keepsSecond", async () => {
    // Le premier lien est refusé (page de redirection) : le suivant du match prend sa place.
    mockDb([{ ...MATCH, stream_urls: "https://www.youtube.com/redirect?q=https://phish.example https://www.twitch.tv/voix" }]);

    await dispatchLobbyBriefs();

    expect(jest.mocked(formatLobbyBriefDm).mock.calls[0][0].streamUrl).toBe("https://www.twitch.tv/voix");
  });

  it("firstAnnounceableUrl_null_returnsNull", () => {
    expect(firstAnnounceableUrl(null)).toBeNull();
  });

  it("dispatchLobbyBriefs_plainStreamUrl_streamKeptInBrief", async () => {
    mockDb([{ ...MATCH, stream_urls: "https://www.twitch.tv/bluegenji" }]);

    await dispatchLobbyBriefs();

    expect(jest.mocked(formatLobbyBriefDm).mock.calls[0][0].streamUrl).toBe("https://www.twitch.tv/bluegenji");
  });

  it("voiceTracked_unscheduledMatch_noVoiceLine", async () => {
    const { query } = mockDb([]);
    await dispatchLobbyBriefs();
    // Le bot n'ouvre de salon qu'à un match qui a son horaire (`MATCH_VOICE.md`).
    expect(query.mock.calls[0][0]).toMatch(/AND m\.start_at IS NOT NULL\s+AND m\.start_at <= NOW\(\) \+ INTERVAL 15 MINUTE\) AS voice_tracked/);
    expect(LOBBY_BRIEF_PHASE.length).toBeLessThanOrEqual(16);
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it("dispatchLobbyBriefs_twoSides_recipientsReadOnceThenEachSideClaimedAndSent", async () => {
    // En autogestion : chaque côté lit son rôle dans la création de la partie.
    const { execute } = mockDb([{ ...MATCH, self_managed: 1 }]);

    expect(await dispatchLobbyBriefs()).toBe(2);

    expect(claimParams(execute)).toEqual([
      ["1", "LOBBY_BRIEF", 40, "1:2", "1", "1", "1"],
      ["2", "LOBBY_BRIEF", 40, "1:2", "2", "2", "2"],
    ]);
    expect(loadEntrantManagerIds).toHaveBeenCalledWith([1, 2]);
    // Une seule lecture pour tous les côtés ; message de match : tag certifié seul.
    expect(loadNotificationRecipients).toHaveBeenCalledTimes(1);
    expect(loadNotificationRecipients).toHaveBeenCalledWith([10, 11, 20], "certified", { matchDm: true });
    const [team1, team2] = sends();
    expect(team1.userIds).toEqual([10, 11]);
    expect(team1.notification.topic).toBe("MATCH_LOBBY_BRIEF");
    expect(team1.notification.discord?.context).toBe("lobby-brief");
    expect(team1.dm()).toContain("# Check-in du match « Renards » Vs « Nova »");
    expect(team1.dm()).toContain("coup d'envoi dans moins de 15 minutes");
    expect(team1.dm()).toContain("* Gauche (hôte) : « Renards » · Droite : « Nova »");
    // Les paramètres de partie, les mêmes pour tous les jeux.
    expect(team1.dm()).toContain("## Paramètres de partie\n* Mode compétitif\n* Pas de killcam\n* Pause à la déconnexion");
    expect(team1.dm()).toContain("N'oublie pas de rentrer les scores");
    expect(team1.dm()).toContain("pingue le rôle @Arbitre sur Discord");
    expect(team1.dm()).toContain("GL HF :)");
    expect(team1.dm()).toContain("https://bluegenji.test/tournois/4/matchs/40");
    expect(team1.push().url).toBe("/tournois/4/matchs/40");
    expect(team2.userIds).toEqual([20]);
    expect(team2.dm()).toContain("# Check-in du match « Nova » Vs « Renards »");
    // L'hôte crée la partie, l'autre vérifie les réglages.
    expect(team1.dm()).toContain("**C'est à ton équipe de créer la partie.**");
    expect(team2.dm()).toContain("L'équipe hôte crée la partie");
    expect(team2.dm("en")).toContain("* Left (host): “Renards” · Right: “Nova”");
    expect(team2.dm("en")).toContain("## Game settings\n* Competitive mode\n* No killcam\n* Pause on disconnect");
  });

  it("dispatchLobbyBriefs_eachSide_claimedThenSentBeforeTheNextClaim", async () => {
    const order: string[] = [];
    const { execute } = mockDb([MATCH]);
    const insert = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql, params) => {
      if (sql.startsWith("INSERT IGNORE INTO bg_match_start_notices")) order.push(`claim ${String((params as unknown[])[0])}`);
      return insert(sql, params);
    });
    jest.mocked(notifyUsers).mockImplementation(async (recipients) => {
      order.push(`send ${recipients.map((recipient) => recipient.userId).join(",")}`);
      return { discord: { sent: 1, unresolved: [], failed: [] }, discordUnreachedUserIds: [], pushed: 0 };
    });

    await dispatchLobbyBriefs();

    expect(order).toEqual(["claim 1", "send 10,11", "claim 2", "send 20"]);
  });

  it("ne réserve que si le salon est encore ouvert pour cet appariement et ces équipes (lancement défait ou réappariement entre-temps : rien)", async () => {
    const { execute } = mockDb([MATCH], [false, false]);
    expect(await dispatchLobbyBriefs()).toBe(0);
    const [sql] = execute.mock.calls[0];
    // La réservation relit le match dans la même instruction.
    expect(sql).toMatch(/INSERT IGNORE INTO bg_match_start_notices \(match_id, pairing, phase\)\s+SELECT m\.id, \?, \? FROM bg_matches m/);
    // Une réservation de l'ancien format (`LOBBY_BRIEF_1` / `_2`) vaut pour son engagée.
    expect(sql).toMatch(/AND NOT EXISTS \(SELECT 1 FROM bg_match_start_notices o/);
    // Le tournoi doit toujours être en cours, comme à la lecture des candidats.
    expect(sql).toMatch(/JOIN bg_tournaments t ON t\.id = m\.tournament_id AND t\.state = 'RUNNING'/);
    // Réapparié entre-temps : la clé est l'appariement courant, rien pour les anciennes équipes.
    expect(sql).toMatch(/WHERE m\.id = \? AND CONCAT\(m\.team1_id, ':', m\.team2_id\) = \? AND m\.status = 'READY'/);
    expect(sql).toMatch(/AND m\.team1_score IS NULL AND m\.team2_score IS NULL/);
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

    expect(sends()[0].dm()).toContain("# Check-in du match « Renards » Vs « Nova »");
    expect(sends()[0].dm()).toContain("match lancé.*");
    expect(sends()[0].dm()).not.toContain("coup d'envoi dans moins de 15 minutes");
    expect(sends()[0].dm()).toContain("* Gauche (hôte) : « Renards »");
    expect(sends()[0].push().title).toBe("Match lancé : réglages de la partie");
  });

  it("dispatchLobbyBriefs_launchedEarlyBeyondLead_saysLaunchedWithoutCheckInOrVoiceLine", async () => {
    // Lancement forcé à 18 h pour 21 h : le match se joue tout de suite.
    mockDb([{ ...MATCH, launched_at: "2026-11-03 18:00:00", kickoff_state: "UNSCHEDULED", voice_tracked: 0 }]);

    await dispatchLobbyBriefs();

    const dm = sends()[0].dm();
    expect(dm).toContain("match lancé.*");
    expect(dm).not.toContain("Le salon de check-in est ouvert");
    expect(dm).not.toContain("salon vocal");
  });

  it("dispatchLobbyBriefs_launchedAtFromReplacedPairing_notSaidLaunched", async () => {
    // `launched_at` date d'un appariement remplacé (correction de score) : pas « match lancé ».
    mockDb([{ ...MATCH, launched_at: "2026-11-03 20:00:00", launch_pairing: "1:9" }]);

    await dispatchLobbyBriefs();

    expect(sends()[0].dm()).not.toContain("match lancé");
  });

  it("dispatchLobbyBriefs_kickoffTimeAlreadyPassed_subtitleDoesNotPromiseFifteenMinutes", async () => {
    mockDb([{ ...MATCH, kickoff_state: "PASSED" }]);

    await dispatchLobbyBriefs();

    expect(sends()[0].dm()).toContain("l'heure du coup d'envoi est arrivée");
    expect(sends()[0].dm()).not.toContain("moins de 15 minutes");
  });

  it("dispatchLobbyBriefs_unscheduledMatch_noCheckInChannelLine", async () => {
    mockDb([{ ...MATCH, kickoff_state: "UNSCHEDULED" }]);

    await dispatchLobbyBriefs();

    expect(sends()[0].dm()).toContain("le salon du match est ouvert");
    expect(sends()[0].dm()).not.toContain("Le salon de check-in est ouvert");
  });

  it("dispatchLobbyBriefs_memberLeftBetweenSweepReadAndSend_notBriefed", async () => {
    mockDb([MATCH]);
    // Lecture du balayage, puis relecture de chaque côté juste avant son envoi : 11 a quitté l'équipe 1.
    jest
      .mocked(loadEntrantManagerIds)
      .mockResolvedValueOnce(new Map([[1, [10, 11]], [2, [20]]]))
      .mockResolvedValueOnce(new Map([[1, [10]]]))
      .mockResolvedValueOnce(new Map([[2, [20]]]));

    await dispatchLobbyBriefs();

    expect(sends().map((send) => send.userIds)).toEqual([[10], [20]]);
  });

  it("dispatchLobbyBriefs_onlyManagerLeftBeforeSend_nothingSentAndClaimReleased", async () => {
    const { execute } = mockDb([MATCH]);
    // Le seul gérant de l'équipe 2 la quitte entre la lecture du balayage et l'envoi.
    jest
      .mocked(loadEntrantManagerIds)
      .mockResolvedValueOnce(new Map([[1, [10]], [2, [20]]]))
      .mockResolvedValueOnce(new Map([[1, [10]]]))
      .mockResolvedValueOnce(new Map());

    await dispatchLobbyBriefs();

    expect(sends().map((send) => send.userIds)).toEqual([[10]]);
    // La réservation du côté 2 est rendue, sans marque : un gérant nommé dans la fenêtre sera briefé.
    expect(releases(execute)).toHaveLength(1);
    expect(marks(execute)).toHaveLength(1);
  });

  it("dispatchLobbyBriefs_sideReread_asksOnlyThatSidesTeam", async () => {
    mockDb([MATCH]);

    await dispatchLobbyBriefs();

    expect(jest.mocked(loadEntrantManagerIds).mock.calls.slice(1)).toEqual([[[1]], [[2]]]);
  });

  it("dispatchLobbyBriefs_accountActiveInBothEntrants_briefedOnceOnFirstSide", async () => {
    mockDb([MATCH]);
    jest.mocked(loadEntrantManagerIds).mockResolvedValue(
      new Map([
        [1, [10, 11]],
        [2, [11, 20]],
      ]),
    );
    // Comme la vraie lecture : un compte, une ligne.
    jest.mocked(loadNotificationRecipients).mockImplementation(async (ids) =>
      [...new Set(ids)].map((userId) => ({ userId, discord: { discordId: String(userId), handle: null, label: `u${userId}` } })),
    );

    await dispatchLobbyBriefs();

    expect(sends().map((send) => send.userIds)).toEqual([[10, 11], [20]]);
  });

  it("dispatchLobbyBriefs_firstSideAlreadyBriefed_sharedAccountStillExcludedFromSecondSide", async () => {
    // Balayage suivant : le côté 1 est déjà réservé, le côté 2 repris.
    mockDb([MATCH], [false, true]);
    jest.mocked(loadEntrantManagerIds).mockResolvedValue(
      new Map([
        [1, [10, 11]],
        [2, [11, 20]],
      ]),
    );
    jest.mocked(loadNotificationRecipients).mockImplementation(async (ids) =>
      [...new Set(ids)].map((userId) => ({ userId, discord: { discordId: String(userId), handle: null, label: `u${userId}` } })),
    );

    await dispatchLobbyBriefs();

    expect(sends().map((send) => send.userIds)).toEqual([[20]]);
  });

  it("dispatchLobbyBriefs_secondSideOnlySharedManagers_claimedWithoutSend", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { execute } = mockDb([MATCH]);
    jest.mocked(loadEntrantManagerIds).mockResolvedValue(
      new Map([
        [1, [10, 11]],
        [2, [11]],
      ]),
    );
    jest.mocked(loadNotificationRecipients).mockImplementation(async (ids) =>
      [...new Set(ids)].map((userId) => ({ userId, discord: { discordId: String(userId), handle: null, label: `u${userId}` } })),
    );

    await dispatchLobbyBriefs();

    // Les deux côtés réservés (le match quitte les candidats), un seul envoi, aucune fausse alerte.
    expect(claimParams(execute)).toHaveLength(2);
    expect(sends().map((send) => send.userIds)).toEqual([[10, 11]]);
    expect(marks(execute)).toHaveLength(1);
    expect(logged(error, "reçu par personne")).toBe(false);
    error.mockRestore();
  });

  it("dispatchLobbyBriefs_ghostOpponent_claimKeptOnlyRealTeamBriefedWithoutMutualInviteLine", async () => {
    jest.mocked(loadEntrantManagerIds).mockResolvedValue(new Map([[1, [10]]]));
    const { execute } = mockDb([{ ...MATCH, team2_ghost: 1, self_managed: 1 }]);

    expect(await dispatchLobbyBriefs()).toBe(1);

    // Les deux côtés réservés : la fantôme garde la sienne, le match quitte les candidats.
    expect(execute.mock.calls.filter(([sql]) => sql.startsWith("INSERT IGNORE INTO bg_match_start_notices"))).toHaveLength(2);
    expect(sends().map((send) => send.userIds)).toEqual([[10]]);
    expect(sends()[0].dm()).not.toContain("Autogestion");
  });

  it("dispatchLobbyBriefs_realTeamWithoutManager_notClaimedAndLoggedOncePerPairing", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(loadEntrantManagerIds).mockResolvedValue(new Map([[2, [20]]]));
    const { execute } = mockDb([MATCH]);

    expect(await dispatchLobbyBriefs()).toBe(1);

    expect(claimParams(execute)).toEqual([["2", "LOBBY_BRIEF", 40, "1:2", "2", "2", "2"]]);
    expect(logged(error, "aucun gérant actif")).toBe(true);
    // Balayage suivant : toujours sans gestionnaire, pm2 ne le redit pas.
    error.mockClear();
    jest.useFakeTimers({ now: Date.now() + 60_000, doNotFake: ["setTimeout", "clearTimeout"] });
    try {
      mockDb([MATCH], [false]);
      await dispatchLobbyBriefs();
    } finally {
      jest.useRealTimers();
    }
    expect(logged(error, "aucun gérant actif")).toBe(false);
    error.mockRestore();
  });

  it("dispatchLobbyBriefs_noSideCanBeBriefed_castersNotRead", async () => {
    jest.mocked(loadEntrantManagerIds).mockResolvedValue(new Map());
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { execute } = mockDb([MATCH]);

    expect(await dispatchLobbyBriefs()).toBe(0);

    expect(execute).not.toHaveBeenCalled();
    expect(readMatchCasters).toHaveBeenCalledWith(expect.anything(), []);
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
    expect(sends()[0].dm()).toContain("# Check-in de ton match");
    expect(sends()[0].dm()).toContain("* Gauche (hôte) : toi · Droite : ton adversaire");
    // Jamais de salon vocal pour une entrée solo (`MATCH_VOICE.md`).
    expect(sends()[0].dm()).not.toContain("salon vocal");
  });

  it("dispatchLobbyBriefs_marvelRivalsTournament_dmSpeaksOfNoBattletag", async () => {
    jest.mocked(readMatchCasters).mockResolvedValue(new Map([[40, [7]]]));
    const { query } = mockDb([{ ...MATCH, game: "MR" }]);

    await dispatchLobbyBriefs();

    expect(query.mock.calls[0][0]).toMatch(/t\.game/);
    const dm = sends()[0].dm();
    expect(dm).not.toContain("BattleTag");
    // Hors Overwatch, on ne s'invite pas par BattleTag : on prévient les casters.
    expect(dm).toContain("* Préviens les casters inscrits");
  });

  it("suit l'hôte choisi, la tête de série en BG Survie et le cast", async () => {
    jest.mocked(readMatchCasters).mockResolvedValue(new Map([[40, [7]]]));
    mockDb([
      { ...MATCH, host_team_id: 2 },
      { ...MATCH, id: 41, team1_seed: 4, team2_seed: 1 },
    ]);
    await dispatchLobbyBriefs();
    const [m40, , m41] = sends();
    expect(m40.dm()).toContain("* Gauche (hôte) : « Nova » · Droite : « Renards »");
    // Règle par défaut : celle qui n'héberge pas bannit la première.
    expect(m40.dm()).toContain("* Bans de la carte 1 : « Renards » d'abord, puis « Nova ».");
    expect(m40.dm()).toContain("## Match casté");
    expect(m40.dm()).toContain("**Ton match est en autogestion.**");
    expect(m40.dm()).toContain("L'équipe hôte crée la partie");
    expect(m41.dm()).toContain("* Gauche (hôte) : « Nova » · Droite : « Renards »");
    expect(m41.dm()).not.toContain("## Match casté");
  });

  it("dueSql_refereedOrUndecidedMatch_notDue", async () => {
    const { query } = mockDb([]);

    await dispatchLobbyBriefs();

    // Autogestion seulement (décision du 2026-11-05) : un match arbitré ou sans
    // décision ne reçoit aucun check-in, ni à la lecture ni à la réservation.
    expect(query.mock.calls[0][0]).toMatch(/AND m\.self_managed = 1 AND m\.referee_user_id IS NULL/);
  });

  it("dispatchLobbyBriefs_claim_requiresSelfManagedInTheSameStatement", async () => {
    const { execute } = mockDb([MATCH]);

    await dispatchLobbyBriefs();

    // Une autogestion retirée entre la lecture et la réservation : rien n'est réservé.
    expect(execute.mock.calls[0][0]).toMatch(/AND m\.self_managed = 1 AND m\.referee_user_id IS NULL/);
  });

  it("dispatchLobbyBriefs_settingsChangedBeforeClaim_rereadSettingsBriefed", async () => {
    const { query } = mockDb(
      [MATCH],
      [],
      new Map([[40, { ...MATCH, host_team_id: 2, first_map: "Busan" }]]),
    );

    await dispatchLobbyBriefs();

    // Une relecture par côté réservé.
    expect(query).toHaveBeenCalledTimes(3);
    expect(sends()[0].dm()).toContain("* Gauche (hôte) : « Nova »");
    expect(sends()[0].dm()).toContain("« Busan »");
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
      if (sql.startsWith("INSERT IGNORE INTO bg_match_start_notices")) {
        inserts += 1;
        if (inserts === 1) throw new Error("CONNECTION_LOST");
      }
      return base(sql, params);
    });

    expect(await dispatchLobbyBriefs()).toBe(2);

    // Le côté interrompu du 40 est rendu par sa clé ; le 41 part quand même.
    expect(releases(execute).map(([sql, params]) => [sql, params])).toEqual([
      ["DELETE FROM bg_match_start_notices WHERE match_id = ? AND pairing = ? AND phase = ?", [40, "1", "LOBBY_BRIEF"]],
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
      expect(second.execute.mock.calls.filter(([sql]) => sql.startsWith("INSERT IGNORE INTO bg_match_start_notices"))).toHaveLength(2);
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
    expect(execute.mock.calls.filter(([sql]) => sql.startsWith("INSERT IGNORE INTO bg_match_start_notices"))).toHaveLength(1);
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

    expect(claimParams(execute)).toEqual([["2", "LOBBY_BRIEF", 40, "1:2", "2", "2", "2"]]);
    expect(logged(error, "aucun gérant actif")).toBe(true);
    error.mockRestore();
  });

  it("dispatchLobbyBriefs_allManagersDeleted_castersNotRead", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(loadNotificationRecipients).mockResolvedValue([]);
    const { execute } = mockDb([MATCH]);

    expect(await dispatchLobbyBriefs()).toBe(0);

    expect(execute).not.toHaveBeenCalled();
    expect(readMatchCasters).toHaveBeenCalledWith(expect.anything(), []);
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
