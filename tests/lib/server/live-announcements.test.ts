import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration", () => ({
  isBotCircuitOpen: jest.fn(),
  pushLiveEvening: jest.fn(),
}));

import { getDatabase } from "@/lib/server/database";
import { isBotCircuitOpen, pushLiveEvening, type LiveAnnouncementOutcome } from "@/lib/server/bot-integration";
import {
  LIVE_ANNOUNCE_MAX_AGE_MINUTES,
  LIVE_ANNOUNCE_RETRY_DELAY_MS,
  LIVE_EVENING_REFRESH_DELAY_MS,
  LIVE_EVENING_REFRESH_MAX_RETRIES,
  dispatchLiveAnnouncements,
  eveningTextKey,
  liveAnnouncementsEnabled,
  liveEntrantName,
  purgeEndedEvenings,
  refreshLiveEvenings,
  requestLiveEveningRefresh,
  resetLiveAnnouncementThrottle,
  runLiveAnnouncementSweep,
  soloPseudoRegisteredSince,
} from "@/lib/server/tournaments/live-announcements";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { PROCESSING_ACTIVITIES } from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";
import { PRIVACY_POLICY } from "@/lib/shared/bot-legal-content";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

const NOW = Date.parse("2026-10-14T20:00:00Z");

/** Chaîne officielle : seule à notifier @everyone, les autres notifient le rôle StreamViewer. */
const OFFICIAL = "https://www.twitch.tv/bluegenjiesport";

/** Match `AUTO` lancé pour son affiche courante : à l'antenne. */
const AUTO_LIVE = {
  id: 40,
  tournament_id: 4,
  tournament_name: "Coupe d'hiver",
  participant_type: "TEAM",
  tournament_live_url: "https://twitch.tv/bluegenji",
  status: "READY",
  start_at: null,
  live_trigger: "AUTO",
  live_started_at: null,
  live_url: "https://www.twitch.tv/caster",
  launched_at: "2026-10-14T19:58:00Z",
  launch_pairing: "1:2",
  pairing: "1:2",
  team1_name: "Renards",
  team2_name: "Nova",
  team1_solo_user_id: null,
  team2_solo_user_id: null,
  team1_pseudo: null,
  team2_pseudo: null,
};

/**
 * Envoi au bot, vu comme avant la soirée : texte, premier lien, étiquette et
 * version de logs — le simulacre de `pushLiveEvening` le rejoue.
 */
const pushLiveAnnouncement = jest.fn<(message: string, url: string, context: string, logMessage?: string) => Promise<LiveAnnouncementOutcome>>();

/** Texte de soirée d'un seul match à l'antenne depuis 21:58 (Paris). */
function single(line: string, at = "21:58"): string {
  return `🔴 **Les lives de la soirée**

**${at}** · En direct
${line}
{{lien:1}}`;
}

/** Soirée simulée : ouverte à 19:58 UTC, sans message publié. */
const EVENING = { id: 3, started_at: "2026-10-14T19:58:00Z", window_end: "2026-10-14T23:58:00Z", discord_message_id: null };

type Db = { query: jest.Mock<SqlQuery>; execute: jest.Mock<SqlQuery>; evening: jest.Mock<SqlQuery> };

/** `query` rend les candidats ; `execute` rejoue les réservations (`claims`) et les rendus. */
function mockDb(candidates: unknown[], claims: boolean[] = []): Db {
  const queue = [...claims];
  const query = jest.fn<SqlQuery>().mockResolvedValue([candidates]);
  // Lectures de la soirée (la soirée elle-même, puis ses matchs) : à part, pour
  // que `query` ne compte que la lecture des candidats.
  const evening = jest.fn<SqlQuery>(async (sql) => (sql.includes("FROM bg_live_evenings") ? [[EVENING]] : [candidates]));
  const route = jest.fn<SqlQuery>(async (sql, params) =>
    sql.includes("bg_live_evenings") || sql.includes("a.sent_at >= ?") ? evening(sql, params) : query(sql, params),
  );
  const execute = jest.fn<SqlQuery>(async (sql) => {
    if (sql.includes("bg_live_evenings")) return [{ affectedRows: 1 }];
    if (sql.startsWith("INSERT IGNORE INTO bg_live_announcements")) {
      return [{ affectedRows: (queue.length > 0 ? queue.shift() : true) ? 1 : 0 }];
    }
    if (sql.startsWith("DELETE FROM bg_live_announcements WHERE (match_id, pairing) IN (")) return [{ affectedRows: 1 }];
    if (/^UPDATE bg_live_announcements SET (sent_at|refused)/.test(sql)) return [{ affectedRows: 1 }];
    throw new Error(`requête inattendue : ${sql}`);
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ query: route, execute }));
  return { query, execute, evening };
}

function claimsOf(execute: Db["execute"]): unknown[] {
  return execute.mock.calls.filter(([sql]) => sql.startsWith("INSERT IGNORE")).map(([, params]) => params);
}

/** Réservations rendues, une paire `[match, affiche]` par ligne (une requête par groupe). */
function releasesOf(execute: Db["execute"]): unknown[] {
  return execute.mock.calls
    .filter(([sql]) => sql.startsWith("DELETE FROM bg_live_announcements"))
    .flatMap(([, params]) => {
      const flat = params as unknown[];
      const pairs: unknown[] = [];
      for (let i = 0; i < flat.length; i += 2) pairs.push([flat[i], flat[i + 1]]);
      return pairs;
    });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetLiveAnnouncementThrottle();
  jest.replaceProperty(process, "env", {
    ...process.env,
    NODE_ENV: "production",
    APP_URL: "https://site-public.fr",
    LIVE_ANNOUNCEMENTS_ENABLED: "1",
  });
  jest.mocked(isBotCircuitOpen).mockReturnValue(false);
  pushLiveAnnouncement.mockReset();
  pushLiveAnnouncement.mockResolvedValue("posted");
  jest.mocked(pushLiveEvening).mockImplementation(async (request) => ({
    outcome: await pushLiveAnnouncement(
      request.message,
      request.streamUrls[0],
      request.context,
      ...(request.logMessage === undefined ? [] : [request.logMessage]),
    ),
    messageId: "123456789012345678",
  }));
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  resetLiveAnnouncementThrottle();
  jest.restoreAllMocks();
});

describe("runLiveAnnouncementSweep", () => {
  it("annonce un match `AUTO` lancé : réserve son affiche, puis le bot publie texte et lien", async () => {
    const { execute } = mockDb([AUTO_LIVE]);

    expect(await runLiveAnnouncementSweep(NOW)).toBe(1);

    expect(claimsOf(execute)).toEqual([[40, "1:2"]]);
    expect(pushLiveAnnouncement).toHaveBeenCalledWith(
      single("Renards contre Nova — Coupe d'hiver"),
      "https://www.twitch.tv/caster",
      "live-announce soiree-3 tournoi-4 match-40",
    );
    expect(releasesOf(execute)).toEqual([]);
    // Trace pm2 : identifiants, aucun nom.
    expect(console.info).toHaveBeenCalledWith("[live-announce] match 40 (tournoi 4) annoncé dans #live (soirée 3, dans un nouveau message)");
  });

  it("nomme une entrée individuelle par le pseudo du compte, pas par le nom de l'entrée, même au type illisible", async () => {
    const { query } = mockDb([
      {
        ...AUTO_LIVE,
        participant_type: null,
        team1_name: "Alpha (2)",
        team2_name: "Bravo",
        team1_solo_user_id: 7,
        team2_solo_user_id: 8,
        team1_pseudo: "Alpha",
        team2_pseudo: "Bravo",
      },
    ]);
    await runLiveAnnouncementSweep(NOW);
    expect(jest.mocked(pushLiveAnnouncement).mock.calls[0][0]).toBe(single("Alpha contre Bravo — Coupe d'hiver"));
    // Le pseudo vient du compte vivant de l'entrée solo, jamais d'un compte supprimé.
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/LEFT JOIN bg_users u1 ON u1\.id = t1\.solo_user_id AND u1\.is_deleted = 0/);
    expect(sql).toMatch(/LEFT JOIN bg_users u2 ON u2\.id = t2\.solo_user_id AND u2\.is_deleted = 0/);
  });

  it("ne lit le pseudo que d'une inscription faite depuis la publication du changement qui l'annonce", async () => {
    const { query } = mockDb([AUTO_LIVE]);
    await runLiveAnnouncementSweep(NOW);
    const [sql, params] = query.mock.calls[0];
    const since = soloPseudoRegisteredSince();
    const publishedAt = PRIVACY_CHANGES.find((c) => c.id === "2026-10-pseudo-live-et-messages-de-match")?.publishedAt;
    // Minuit à Paris du jour de publication (heure d'été : 22 h UTC la veille), en secondes Unix.
    expect(publishedAt).toBe("2026-10-16");
    expect(since).toBe(Date.UTC(2026, 9, 15, 22, 0) / 1000);
    // Un joueur inscrit avant a lu « un joueur, jamais un pseudo » : son entrée le reste.
    for (const alias of ["t1", "t2"]) {
      expect(String(sql).replace(/\s+/g, " ")).toContain(
        `EXISTS (SELECT 1 FROM bg_tournament_registrations r WHERE r.tournament_id = m.tournament_id AND r.team_id = ${alias}.id AND UNIX_TIMESTAMP(r.registered_at) >= ?)`,
      );
    }
    expect(params).toEqual([since, since]);
  });

  it("les textes légaux datent le seuil comme le changement publié (FR et EN)", () => {
    // Déplacer `publishedAt` déplace le seuil : ces textes doivent suivre.
    expect(soloPseudoRegisteredSince()).toBe(Date.UTC(2026, 9, 15, 22, 0) / 1000);
    const t16 = (list: typeof PROCESSING_ACTIVITIES) => JSON.stringify(list.find((sheet) => sheet.ref === "T16"));
    expect(t16(PROCESSING_ACTIVITIES)).toContain("inscription antérieure au 16 octobre 2026");
    expect(t16(PROCESSING_ACTIVITIES_EN)).toContain("registration made before 16 October 2026");
    const policy = JSON.stringify(PRIVACY_POLICY);
    expect(policy).toContain("inscription antérieure au 16 octobre 2026");
    expect(policy).toContain("registration made before 16 October 2026");
  });

  it("donne au bot une version sans pseudo à citer dans son canal de logs en cas d'échec", async () => {
    mockDb([{ ...AUTO_LIVE, participant_type: "SOLO", team1_solo_user_id: 7, team2_solo_user_id: 8, team1_pseudo: "Kiro", team2_pseudo: "Ayla" }]);
    await runLiveAnnouncementSweep(NOW);
    const [message, , , logMessage] = jest.mocked(pushLiveAnnouncement).mock.calls[0];
    expect(message).toBe(single("Kiro contre Ayla — Coupe d'hiver"));
    expect(logMessage).toBe(single("un joueur contre un joueur — Coupe d'hiver"));
  });

  it("n'envoie pas de version de logs quand l'annonce ne nomme que des équipes", async () => {
    mockDb([AUTO_LIVE]);
    await runLiveAnnouncementSweep(NOW);
    expect(jest.mocked(pushLiveAnnouncement).mock.calls[0]).toHaveLength(3);
  });

  it("écrit « un joueur » pour une entrée individuelle dont le compte est supprimé", async () => {
    mockDb([{ ...AUTO_LIVE, team1_name: "Anonyme-1", team2_name: "Bravo", team1_solo_user_id: 7, team2_solo_user_id: 8, team2_pseudo: "Bravo" }]);
    await runLiveAnnouncementSweep(NOW);
    expect(jest.mocked(pushLiveAnnouncement).mock.calls[0][0]).toBe(single("un joueur contre Bravo — Coupe d'hiver"));
  });

  it("tournoi individuel : un invité sans compte (fantôme nommé par le staff) s'écrit « un joueur », jamais son nom", async () => {
    mockDb([
      { ...AUTO_LIVE, participant_type: "SOLO", team1_name: "Lucas Martin", team2_name: "Bravo (2)", team2_solo_user_id: 8, team2_pseudo: "Bravo" },
    ]);
    await runLiveAnnouncementSweep(NOW);
    const message = jest.mocked(pushLiveAnnouncement).mock.calls[0][0];
    expect(message).toBe(single("un joueur contre Bravo — Coupe d'hiver"));
    expect(message).not.toContain("Lucas");
  });

  it("type illisible mais entrée individuelle dans le groupe : l'invité sans compte reste « un joueur »", async () => {
    mockDb([{ ...AUTO_LIVE, participant_type: null, team1_name: "Lucas Martin", team2_solo_user_id: 8, team2_pseudo: "Bravo" }]);
    await runLiveAnnouncementSweep(NOW);
    expect(jest.mocked(pushLiveAnnouncement).mock.calls[0][0]).toBe(single("un joueur contre Bravo — Coupe d'hiver"));
  });

  it("liveEntrantName : équipe par son nom, entrée solo par son pseudo, sinon « un joueur » (null)", () => {
    expect(liveEntrantName(null, "Renards", null, "TEAM")).toBe("Renards");
    expect(liveEntrantName(null, "Renards", null, "inconnu")).toBe("Renards");
    expect(liveEntrantName(null, "Lucas Martin", null, "SOLO")).toBeNull();
    expect(liveEntrantName(7, "Alpha (2)", "Alpha", "SOLO")).toBe("Alpha");
    expect(liveEntrantName(7, "Alpha (2)", "  ", "TEAM")).toBeNull();
    expect(liveEntrantName(7, "Alpha (2)", null, null)).toBeNull();
  });

  it("n'annonce pas un match `AUTO` pas encore lancé, ni lancé pour une autre affiche", async () => {
    const { execute } = mockDb([
      { ...AUTO_LIVE, launched_at: null },
      { ...AUTO_LIVE, id: 41, launch_pairing: "1:3" },
    ]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(claimsOf(execute)).toEqual([]);
    expect(pushLiveAnnouncement).not.toHaveBeenCalled();
  });

  it("annonce `START_TIME` à l'heure dite seulement, et `MANUAL` une fois l'antenne ouverte", async () => {
    const { execute } = mockDb([
      { ...AUTO_LIVE, id: 50, live_trigger: "START_TIME", launched_at: null, start_at: "2026-10-14T19:30:00Z" },
      { ...AUTO_LIVE, id: 51, live_trigger: "START_TIME", launched_at: null, start_at: "2026-10-14T21:00:00Z" },
      { ...AUTO_LIVE, id: 52, live_trigger: "MANUAL", launched_at: null, live_started_at: "2026-10-14T19:59:00Z" },
      { ...AUTO_LIVE, id: 53, live_trigger: "MANUAL", launched_at: null, live_started_at: null },
    ]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(2);
    expect(claimsOf(execute)).toEqual([
      [50, "1:2"],
      [52, "1:2"],
    ]);
  });

  it("n'annonce pas un match sans diffusion exploitable, mais se replie sur la chaîne officielle", async () => {
    const { execute } = mockDb([
      { ...AUTO_LIVE, id: 60, live_url: null, tournament_live_url: null },
      { ...AUTO_LIVE, id: 61, live_url: "https://evil.example/x", tournament_live_url: null },
      { ...AUTO_LIVE, id: 62, live_url: null },
    ]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(1);
    expect(claimsOf(execute)).toEqual([[62, "1:2"]]);
    expect(jest.mocked(pushLiveAnnouncement).mock.calls[0][1]).toBe("https://twitch.tv/bluegenji");
  });

  it("ne reposte pas une affiche déjà réservée par un autre passage", async () => {
    mockDb([AUTO_LIVE], [false]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(pushLiveAnnouncement).not.toHaveBeenCalled();
  });

  it("ne lit que les affiches non annoncées : la requête exclut celles déjà réservées", async () => {
    const { query } = mockDb([]);
    await runLiveAnnouncementSweep(NOW);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM bg_live_announcements");
    expect(sql).toContain("t.state = 'RUNNING'");
    expect(sql).toContain("m.live_trigger IS NOT NULL");
  });

  it("n'annonce qu'un passage à l'antenne de moins de deux heures, mesuré par l'horloge de la base", async () => {
    const { query } = mockDb([]);
    await runLiveAnnouncementSweep(NOW);
    const sql = String(query.mock.calls[0][0]).replace(/\s+/g, " ");
    expect(LIVE_ANNOUNCE_MAX_AGE_MINUTES).toBe(120);
    // Chaque mode lit sa propre colonne de passage à l'antenne.
    expect(sql).toContain("m.live_trigger = 'AUTO' AND m.launched_at > NOW() - INTERVAL 120 MINUTE");
    // Un `START_TIME` à venir n'est pas lu : il n'est pas à l'antenne.
    expect(sql).toContain(
      "m.live_trigger = 'START_TIME' AND m.start_at <= NOW() AND (m.start_at > NOW() - INTERVAL 120 MINUTE",
    );
    expect(sql).toContain("m.live_trigger = 'MANUAL' AND m.live_started_at > NOW() - INTERVAL 120 MINUTE");
    // `START_TIME` devenu jouable après son heure : son lancement, pour l'affiche courante, compte.
    expect(sql).toContain(
      "OR (m.launched_at > NOW() - INTERVAL 120 MINUTE AND m.launch_pairing = CONCAT(m.team1_id, ':', m.team2_id))",
    );
  });

  it("rend la réservation quand rien n'est parti, pour réessayer au passage suivant", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("unavailable");
    const { execute } = mockDb([AUTO_LIVE]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(releasesOf(execute)).toEqual([[40, "1:2"]]);
  });

  it("salon #live fermé : rend la réservation et dit au staff la vraie cause, une fois par heure", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("channel-closed");
    const { execute } = mockDb([AUTO_LIVE]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(releasesOf(execute)).toEqual([
      [40, "1:2"],
      [40, "1:2"],
    ]);
    // Le balayage réessaie toutes les dix secondes : pm2 n'est pas inondé.
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(String(jest.mocked(console.warn).mock.calls[0][0])).toContain("salon #live fermé au bot");
  });

  it("Discord n'a pas répondu en lisant le salon : rend la réservation, sans accuser les permissions du bot", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("discord-unreachable");
    const { execute } = mockDb([AUTO_LIVE]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(releasesOf(execute)).toEqual([[40, "1:2"]]);
    const warning = String(jest.mocked(console.warn).mock.calls[0][0]);
    expect(warning).toContain("ou n'a pas répondu au bot");
    expect(warning).not.toContain("permission");
  });

  it("AutoMod a bloqué le message : garde la réservation, pas d'essai à chaque balayage", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("discord-refused");
    const { execute } = mockDb([AUTO_LIVE]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(releasesOf(execute)).toEqual([]);
    expect(String(jest.mocked(console.error).mock.calls[0][0])).toContain("le même message serait bloqué de nouveau");
  });

  it("un autre match reporté pour la même cause laisse aussi sa trace", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("channel-closed");
    mockDb([AUTO_LIVE, { ...AUTO_LIVE, id: 55, tournament_id: 7, pairing: "5:6", launch_pairing: "5:6", live_url: OFFICIAL }]);
    await runLiveAnnouncementSweep(NOW);
    await runLiveAnnouncementSweep(NOW);
    const warnings = jest.mocked(console.warn).mock.calls.map(([text]) => String(text));
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("match 40 (tournoi 4)");
    expect(warnings[1]).toContain("match 55 (tournoi 7)");
  });

  it("bot injoignable ou antérieur : un avertissement distinct de celui du salon fermé", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValueOnce("unavailable").mockResolvedValueOnce("channel-closed");
    mockDb([AUTO_LIVE]);
    await runLiveAnnouncementSweep(NOW);
    await runLiveAnnouncementSweep(NOW);
    const warnings = jest.mocked(console.warn).mock.calls.map(([text]) => String(text));
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("bot injoignable");
    expect(warnings[1]).toContain("salon #live fermé");
  });

  it("réserve l'affiche sans ordre : les deux mêmes engagés remis dans l'autre ordre ne sont pas réannoncés", async () => {
    const { query, execute } = mockDb([{ ...AUTO_LIVE, pairing: "7:5", launch_pairing: "7:5" }]);
    await runLiveAnnouncementSweep(NOW);
    expect(claimsOf(execute)).toEqual([[40, "5:7"]]);
    expect(String(query.mock.calls[0][0])).toContain(
      "a.pairing = CONCAT(LEAST(m.team1_id, m.team2_id), ':', GREATEST(m.team1_id, m.team2_id))",
    );
  });

  it("rend la réservation sous la même clé sans ordre", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("unavailable");
    const { execute } = mockDb([{ ...AUTO_LIVE, pairing: "7:5", launch_pairing: "7:5" }]);
    await runLiveAnnouncementSweep(NOW);
    expect(releasesOf(execute)).toEqual([[40, "5:7"]]);
  });

  // Aucune consigne de poster à la main quand l'envoi du bot a pu partir ;
  // un jeton refusé désigne la configuration, pas un bot injoignable.
  const TRACED_OUTCOMES: [string, LiveAnnouncementOutcome, "warn" | "error", unknown[], string, string][] = [
    ["délai dépassé : l'envoi du bot peut encore partir", "timed-out", "error", [], "son envoi peut encore aboutir", "à la main"],
    ["bot tombé avant sa réponse (redémarrage)", "interrupted", "error", [], "annonce peut-être publiée, non réessayée", "à la main"],
    ["jeton interne refusé", "unauthorized", "warn", [[40, "1:2"]], "jeton interne refusé ou absent", "injoignable"],
  ];
  it.each(TRACED_OUTCOMES)("%s : réservation gardée ou rendue selon l'issue, trace pm2 juste", async (_label, outcome, level, released, says, never) => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue(outcome);
    const { execute } = mockDb([AUTO_LIVE]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(releasesOf(execute)).toEqual(released);
    const line = String(jest.mocked(level === "warn" ? console.warn : console.error).mock.calls[0][0]);
    expect(line).toContain(says);
    expect(line).not.toContain(never);
  });

  it("Discord lâché pendant l'envoi : garde la réservation, #live fait foi", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("uncertain");
    const { execute } = mockDb([AUTO_LIVE]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(releasesOf(execute)).toEqual([]);
    expect(String(jest.mocked(console.error).mock.calls[0][0])).toBe(
      "[live-announce] match 40 (tournoi 4) : publication non confirmée (Discord en panne pendant l'envoi), annonce peut-être publiée, non réessayée — vérifier #live",
    );
  });

  it("publié sans pouvoir mentionner @everyone : gardé, et la trace pm2 le dit", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("posted-silent");
    const { execute } = mockDb([AUTO_LIVE]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(1);
    expect(releasesOf(execute)).toEqual([]);
    expect(console.info).toHaveBeenCalledWith(
      "[live-announce] match 40 (tournoi 4) annoncé dans #live (soirée 3, dans un nouveau message) sans notifier (permission de mentionner absente)",
    );
  });

  it("un seul message pour les matchs d'une soirée d'un même public, quels que soient tournoi et lien", async () => {
    const { execute } = mockDb([
      { ...AUTO_LIVE, live_url: null },
      {
        ...AUTO_LIVE,
        id: 41,
        tournament_id: 5,
        tournament_name: "Coupe d'été",
        live_url: "https://kick.com/autre",
        pairing: "3:4",
        launch_pairing: "3:4",
        team1_name: "Orques",
        team2_name: "Lynx",
      },
    ]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(2);
    // Chaque affiche garde sa réservation, un seul message part.
    expect(claimsOf(execute)).toEqual([
      [40, "1:2"],
      [41, "3:4"],
    ]);
    expect(pushLiveAnnouncement).toHaveBeenCalledTimes(1);
    expect(pushLiveAnnouncement).toHaveBeenCalledWith(
      "🔴 **Les lives de la soirée**\n\n**21:58** · En direct\nRenards contre Nova — Coupe d'hiver\n{{lien:1}}" +
        "\n\n**21:58** · En direct\nOrques contre Lynx — Coupe d'été\n{{lien:2}}",
      "https://twitch.tv/bluegenji",
      // Deux tournois dans le groupe : tous deux nommés, pas le seul premier.
      "live-announce soiree-3 tournoi-4,5 match-40,41",
    );
    expect(jest.mocked(pushLiveEvening).mock.calls[0][0]).toMatchObject({
      mention: "stream-viewer",
      streamUrls: ["https://twitch.tv/bluegenji", "https://kick.com/autre"],
    });
    // Première annonce de la soirée : aucun message à modifier.
    expect(jest.mocked(pushLiveEvening).mock.calls[0][0].editMessageId).toBeUndefined();
    expect(console.info).toHaveBeenCalledWith(
      "[live-announce] matchs 40, 41 (tournois 4, 5) annoncés dans #live (soirée 3, dans un nouveau message)",
    );
  });

  it("la chaîne officielle (@everyone) et les autres chaînes (StreamViewer) font deux messages", async () => {
    mockDb([
      AUTO_LIVE,
      { ...AUTO_LIVE, id: 41, live_url: "https://kick.com/autre", pairing: "3:4", launch_pairing: "3:4" },
      { ...AUTO_LIVE, id: 42, tournament_id: 5, pairing: "5:6", launch_pairing: "5:6", live_url: "https://TWITCH.tv/BlueGenjiEsport/" },
    ]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(3);
    const calls = jest.mocked(pushLiveEvening).mock.calls.map(([request]) => [request.mention, request.context]);
    expect(calls).toEqual([
      ["stream-viewer", "live-announce soiree-3 tournoi-4 match-40,41"],
      ["everyone", "live-announce soiree-3 tournoi-5 match-42"],
    ]);
  });

  it("réservation impossible à rendre : la trace pm2 nomme les matchs et ne promet pas d'essai", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("unavailable");
    const { execute } = mockDb([AUTO_LIVE]);
    execute.mockImplementation(async (sql) => {
      if (/^(INSERT IGNORE|UPDATE bg_live_)/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error("DB_DOWN");
    });
    await runLiveAnnouncementSweep(NOW);
    expect(String(jest.mocked(console.error).mock.calls[0][0])).toBe(
      "[live-announce] match 40 (tournoi 4) : réservation non rendue, annonce non réessayée",
    );
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("une réservation refusée par la base n'emporte pas les autres affiches du passage", async () => {
    const { execute } = mockDb([AUTO_LIVE, { ...AUTO_LIVE, id: 41, pairing: "3:4", launch_pairing: "3:4", live_url: "https://kick.com/b" }]);
    let first = true;
    execute.mockImplementation(async (sql) => {
      if (sql.startsWith("INSERT IGNORE")) {
        if (first) {
          first = false;
          throw new Error("LOCK_WAIT_TIMEOUT");
        }
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    });
    expect(await runLiveAnnouncementSweep(NOW)).toBe(1);
    expect(pushLiveAnnouncement).toHaveBeenCalledTimes(1);
    expect(jest.mocked(pushLiveAnnouncement).mock.calls[0][2]).toBe("live-announce soiree-3 tournoi-4 match-41");
    expect(String(jest.mocked(console.error).mock.calls[0][0])).toBe(
      "[live-announce] match 40 (tournoi 4) : réservation impossible, réessayée à chaque passage pendant les deux heures qui suivent le début du direct (avertissement répété au plus une fois par heure)",
    );
  });

  it("une panne de réservation qui dure ne remplit pas pm2 : une trace par match et par heure", async () => {
    const { execute } = mockDb([AUTO_LIVE]);
    execute.mockRejectedValue(new Error("DISK_FULL"));
    await runLiveAnnouncementSweep(NOW);
    await runLiveAnnouncementSweep(NOW);
    await runLiveAnnouncementSweep(NOW);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("un match à l'antenne sans aucun lien laisse une trace pm2, une fois par heure", async () => {
    mockDb([{ ...AUTO_LIVE, live_url: null, tournament_live_url: null }]);
    await runLiveAnnouncementSweep(NOW);
    await runLiveAnnouncementSweep(NOW);
    expect(pushLiveAnnouncement).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(String(jest.mocked(console.warn).mock.calls[0][0])).toContain(
      "match 40 (tournoi 4) à l'antenne sans lien de diffusion exploitable",
    );
    // Pas un abandon : un lien ajouté à temps fait partir l'annonce, la poster à la main ferait un doublon.
    expect(String(jest.mocked(console.warn).mock.calls[0][0])).toContain("ne pas la poster à la main");
  });

  it("une très grande ronde garde une étiquette bornée, sans identifiant coupé", async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      ...AUTO_LIVE,
      id: 10_000 + i,
      live_url: null,
      pairing: `${i}:${i + 100}`,
      launch_pairing: `${i}:${i + 100}`,
    }));
    mockDb(rows);
    await runLiveAnnouncementSweep(NOW);
    const context = String(jest.mocked(pushLiveAnnouncement).mock.calls[0][2]);
    expect(context.length).toBeLessThanOrEqual(200);
    const match = /^live-announce soiree-3 tournoi-4 match-([\d,]+),…\+(\d+)$/.exec(context);
    expect(match).not.toBeNull();
    const shown = match![1].split(",");
    expect(shown.every((id, i) => id === String(10_000 + i))).toBe(true);
    expect(shown.length + Number(match![2])).toBe(60);
  });

  it("un report vaut pour les groupes suivants du passage : rendus sans appeler le bot", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("channel-closed");
    const { execute } = mockDb([
      AUTO_LIVE,
      { ...AUTO_LIVE, id: 41, pairing: "3:4", launch_pairing: "3:4", live_url: "https://www.twitch.tv/autre" },
      { ...AUTO_LIVE, id: 42, tournament_id: 5, pairing: "5:6", launch_pairing: "5:6", live_url: OFFICIAL },
    ]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(pushLiveAnnouncement).toHaveBeenCalledTimes(1);
    expect(releasesOf(execute)).toEqual([
      [40, "1:2"],
      [41, "3:4"],
      [42, "5:6"],
    ]);
    // Chaque match reporté garde sa trace pm2, avec la cause constatée.
    const warned = jest.mocked(console.warn).mock.calls.map(([text]) => String(text));
    expect(warned).toHaveLength(2);
    for (const text of warned) expect(text).toContain("salon #live fermé au bot");
  });

  it("Discord muet en lisant le salon vaut pour tout le passage : les groupes suivants sont rendus sans appel", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("discord-unreachable");
    const { execute } = mockDb([AUTO_LIVE, { ...AUTO_LIVE, id: 57, tournament_id: 5, pairing: "5:6", launch_pairing: "5:6", live_url: OFFICIAL }]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(pushLiveAnnouncement).toHaveBeenCalledTimes(1);
    expect(releasesOf(execute)).toEqual([
      [40, "1:2"],
      [57, "5:6"],
    ]);
  });

  it("un refus de Discord propre au message n'empêche pas les autres groupes de partir", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValueOnce("discord-held").mockResolvedValueOnce("posted");
    const { execute } = mockDb([AUTO_LIVE, { ...AUTO_LIVE, id: 57, tournament_id: 5, pairing: "5:6", launch_pairing: "5:6", live_url: OFFICIAL }]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(1);
    expect(pushLiveAnnouncement).toHaveBeenCalledTimes(2);
    expect(releasesOf(execute)).toEqual([[40, "1:2"]]);
  });

  it("un groupe reporté s'accorde au pluriel", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("channel-closed");
    mockDb([AUTO_LIVE, { ...AUTO_LIVE, id: 41, pairing: "3:4", launch_pairing: "3:4" }]);
    await runLiveAnnouncementSweep(NOW);
    expect(String(jest.mocked(console.warn).mock.calls[0][0])).toContain(
      "matchs 40, 41 (tournoi 4) : salon #live fermé au bot (introuvable ou sans permission d'écrire), annonces reportées, réessayées tant que les matchs ont commencé",
    );
  });

  it("un groupe resté sans réponse rend toutes ses réservations", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("unavailable");
    const { execute } = mockDb([
      AUTO_LIVE,
      { ...AUTO_LIVE, id: 41, pairing: "3:4", launch_pairing: "3:4" },
    ]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(releasesOf(execute)).toEqual([
      [40, "1:2"],
      [41, "3:4"],
    ]);
  });

  it("garde la réservation d'une annonce refusée par le bot : la renvoyer ne changerait rien", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("rejected");
    const { execute } = mockDb([AUTO_LIVE]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(releasesOf(execute)).toEqual([]);
  });

  it("ne lit ni ne réserve rien tant que le coupe-circuit du bot est ouvert", async () => {
    jest.mocked(isBotCircuitOpen).mockReturnValue(true);
    const { query, execute } = mockDb([AUTO_LIVE]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(query).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("neutralise le pseudo publié d'un joueur en tournoi individuel", async () => {
    mockDb([
      {
        ...AUTO_LIVE,
        participant_type: "SOLO",
        team1_solo_user_id: 7,
        team2_solo_user_id: 8,
        team1_pseudo: "@everyone",
        team2_pseudo: "[Nitro](https://piege.example)",
      },
    ]);
    await runLiveAnnouncementSweep(NOW);
    const text = String(jest.mocked(pushLiveAnnouncement).mock.calls[0][0]);
    expect(text).not.toMatch(/@everyone|\]\(https:|https:\/\/piege/);
    expect(text).toMatch(/^🔴 \*\*Les lives de la soirée\*\*\n\n\*\*\d\d:\d\d\*\* · En direct\n.+ contre .+ — Coupe d.hiver\n\{\{lien:1\}\}$/);
  });

  it("garde les seuls noms d'équipe pour un match d'équipes", async () => {
    mockDb([{ ...AUTO_LIVE, team1_pseudo: "NePasPublier", team2_pseudo: "NonPlus" }]);
    await runLiveAnnouncementSweep(NOW);
    expect(jest.mocked(pushLiveAnnouncement).mock.calls[0][0]).toBe(single("Renards contre Nova — Coupe d'hiver"));
  });
});

/**
 * Premier passage dont la diffusion est retenue par Discord (pause d'une
 * minute), puis horloge avancée de trois secondes.
 */
async function holdFirstDiffusion() {
  const held = { ...AUTO_LIVE, launched_at: new Date(NOW - 60_000).toISOString() };
  jest.mocked(pushLiveAnnouncement).mockResolvedValueOnce("discord-held");
  const { query } = mockDb([held]);
  await dispatchLiveAnnouncements();
  jest.setSystemTime(NOW + 3_000);
  return { held, query };
}

describe("dispatchLiveAnnouncements", () => {
  it("ne fait rien hors production : ni lecture, ni réservation", async () => {
    jest.replaceProperty(process, "env", { ...process.env, NODE_ENV: "development" });
    const { query } = mockDb([AUTO_LIVE]);
    expect(liveAnnouncementsEnabled()).toBe(false);
    expect(await dispatchLiveAnnouncements()).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ["absente", undefined],
    ["locale (npm start sur un poste)", "http://localhost:3000"],
    ["en https sur localhost", "https://localhost:3000"],
    ["sur 127.0.0.1", "https://127.0.0.1"],
    ["sur un nom .localhost", "https://app.localhost"],
    ["sur un nom .test", "https://bluegenji.test"],
    ["en http", "http://site.example"],
    ["illisible", "site.example"],
    ["sur un réseau privé", "https://192.168.1.20"],
    ["sur une adresse IPv6", "https://[fd00::1]"],
    ["un nom de machine d'un seul mot", "https://poste-dev"],
    ["localhost. avec un point final", "https://localhost."],
    ["sur un nom .lan", "https://bluegenji.lan"],
  ])("ne fait rien en production si APP_URL est %s", async (_label, appUrl) => {
    jest.replaceProperty(process, "env", { ...process.env, NODE_ENV: "production", APP_URL: appUrl });
    const { query } = mockDb([AUTO_LIVE]);
    expect(liveAnnouncementsEnabled()).toBe(false);
    expect(await dispatchLiveAnnouncements()).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("part en production sur le site public", () => {
    expect(liveAnnouncementsEnabled()).toBe(true);
  });

  it.each([
    ["absente", undefined],
    ["vide", ""],
    ["à une autre valeur", "true"],
  ])("ne fait rien sans activation explicite (LIVE_ANNOUNCEMENTS_ENABLED %s), même via un tunnel https", async (_label, flag) => {
    // Un tunnel (ngrok…) donne un vrai nom de domaine en https à un poste de développement.
    jest.replaceProperty(process, "env", {
      ...process.env,
      NODE_ENV: "production",
      APP_URL: "https://abcd.ngrok-free.app",
      LIVE_ANNOUNCEMENTS_ENABLED: flag,
    });
    const { query } = mockDb([AUTO_LIVE]);
    expect(liveAnnouncementsEnabled()).toBe(false);
    expect(await dispatchLiveAnnouncements()).toBe(0);
    expect(query).not.toHaveBeenCalled();
    // Une variable oubliée au déploiement se lit dans pm2, une fois.
    await dispatchLiveAnnouncements();
    const notices = jest.mocked(console.info).mock.calls.filter(([line]) => String(line).includes("désactivées"));
    expect(notices).toHaveLength(1);
  });

  it("purge les soirées finies depuis un jour à chaque évènement, annonces désactivées comprises, une fois par heure", async () => {
    jest.replaceProperty(process, "env", { ...process.env, LIVE_ANNOUNCEMENTS_ENABLED: undefined });
    const { execute } = mockDb([]);
    const purges = () =>
      execute.mock.calls.filter(([sql]) => sql === "DELETE FROM bg_live_evenings WHERE window_end < NOW() - INTERVAL 1 DAY");
    expect(await dispatchLiveAnnouncements()).toBe(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(purges()).toHaveLength(1);
    await dispatchLiveAnnouncements();
    await Promise.resolve();
    await Promise.resolve();
    expect(purges()).toHaveLength(1);
  });

  it("purgeEndedEvenings : un échec se retente cinq minutes plus tard, pas à chaque appel ; un succès attend une heure", async () => {
    const { execute } = mockDb([]);
    const base = execute.getMockImplementation()!;
    execute.mockImplementationOnce(async () => {
      throw new Error("DB_DOWN");
    });
    const deletes = () => execute.mock.calls.filter(([sql]) => sql.startsWith("DELETE FROM bg_live_evenings")).length;
    await expect(purgeEndedEvenings(NOW)).rejects.toThrow("DB_DOWN");
    execute.mockImplementation(base);
    await purgeEndedEvenings(NOW + 1);
    await purgeEndedEvenings(NOW + 4 * 60 * 1000);
    expect(deletes()).toBe(1);
    await purgeEndedEvenings(NOW + 5 * 60 * 1000);
    expect(deletes()).toBe(2);
    await purgeEndedEvenings(NOW + 30 * 60 * 1000);
    expect(deletes()).toBe(2);
    await purgeEndedEvenings(NOW + 66 * 60 * 1000);
    expect(deletes()).toBe(3);
  });

  it("purgeEndedEvenings : deux appels simultanés ne lancent qu'une purge", async () => {
    const { execute } = mockDb([]);
    await Promise.all([purgeEndedEvenings(NOW), purgeEndedEvenings(NOW)]);
    expect(execute.mock.calls.filter(([sql]) => sql.startsWith("DELETE FROM bg_live_evenings"))).toHaveLength(1);
  });

  it("est étranglé : un second appel immédiat ne relit pas la base", async () => {
    const { query } = mockDb([]);
    await dispatchLiveAnnouncements();
    await dispatchLiveAnnouncements();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("après une annonce reportée, attend une minute avant de redemander au bot", async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });
    try {
      jest.mocked(pushLiveAnnouncement).mockResolvedValue("channel-closed");
      const { query } = mockDb([{ ...AUTO_LIVE, launched_at: new Date(NOW - 60_000).toISOString() }]);
      await dispatchLiveAnnouncements();
      expect(pushLiveAnnouncement).toHaveBeenCalledTimes(1);
      // Passé l'étranglement de dix secondes, la pause tient encore.
      jest.setSystemTime(NOW + 30_000);
      expect(await dispatchLiveAnnouncements()).toBe(0);
      expect(query).toHaveBeenCalledTimes(1);
      // À son terme, la relève reprend seule, sans nouvel appel.
      jest.mocked(pushLiveAnnouncement).mockResolvedValue("posted");
      await jest.advanceTimersByTimeAsync(LIVE_ANNOUNCE_RETRY_DELAY_MS);
      expect(query).toHaveBeenCalledTimes(2);
      expect(pushLiveAnnouncement).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("un refus de Discord ne met en pause que ses matchs : un autre tournoi part au passage suivant", async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });
    try {
      const held = { ...AUTO_LIVE, launched_at: new Date(NOW - 60_000).toISOString() };
      const other = { ...held, id: 57, tournament_id: 5, pairing: "5:6", launch_pairing: "5:6", live_url: OFFICIAL };
      jest.mocked(pushLiveAnnouncement).mockResolvedValueOnce("discord-held");
      const { query } = mockDb([held]);
      await dispatchLiveAnnouncements();
      // Dix secondes plus tard, un autre tournoi passe à l'antenne : rien ne le retient.
      jest.setSystemTime(NOW + 11_000);
      query.mockResolvedValue([[held, other]]);
      jest.mocked(pushLiveAnnouncement).mockResolvedValue("posted");
      expect(await dispatchLiveAnnouncements()).toBe(1);
      expect(jest.mocked(pushLiveAnnouncement).mock.calls.map(([, , context]) => context)).toEqual([
        "live-announce soiree-3 tournoi-4 match-40",
        "live-announce soiree-3 tournoi-5 match-57",
      ]);
      // Sa pause échue, le match refusé est réessayé seul, sans nouvel évènement.
      query.mockResolvedValue([[held]]);
      const calls = jest.mocked(pushLiveAnnouncement).mock.calls.length;
      await jest.advanceTimersByTimeAsync(LIVE_ANNOUNCE_RETRY_DELAY_MS);
      expect(jest.mocked(pushLiveAnnouncement).mock.calls).toHaveLength(calls + 1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("un match lancé pendant la pause d'une diffusion refusée attend avec elle : un seul @everyone", async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });
    try {
      const launched = new Date(NOW - 60_000).toISOString();
      const first = { ...AUTO_LIVE, live_url: null, launched_at: launched };
      const joined = { ...first, id: 44, pairing: "7:8", launch_pairing: "7:8" };
      jest.mocked(pushLiveAnnouncement).mockResolvedValueOnce("discord-held");
      const { query } = mockDb([first]);
      await dispatchLiveAnnouncements();
      // Même tournoi, même chaîne officielle, vingt secondes plus tard : il attend.
      jest.setSystemTime(NOW + 20_000);
      query.mockResolvedValue([[first, joined]]);
      jest.mocked(pushLiveAnnouncement).mockResolvedValue("posted");
      expect(await dispatchLiveAnnouncements()).toBe(0);
      expect(pushLiveAnnouncement).toHaveBeenCalledTimes(1);
      // Au terme de la pause, les deux partent ensemble.
      await jest.advanceTimersByTimeAsync(LIVE_ANNOUNCE_RETRY_DELAY_MS);
      expect(pushLiveAnnouncement).toHaveBeenCalledTimes(2);
      expect(jest.mocked(pushLiveAnnouncement).mock.calls[1][2]).toBe("live-announce soiree-3 tournoi-4 match-40,44");
    } finally {
      jest.useRealTimers();
    }
  });

  it("la fin d'une pause d'une minute ne repousse pas la relève à dix secondes d'un autre tournoi", async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });
    try {
      // Trois secondes plus tard, un autre tournoi lance un match : appel étranglé.
      const { held, query } = await holdFirstDiffusion();
      expect(await dispatchLiveAnnouncements()).toBe(0);
      const other = { ...held, id: 57, tournament_id: 5, pairing: "5:6", launch_pairing: "5:6", live_url: OFFICIAL };
      query.mockResolvedValue([[held, other]]);
      jest.mocked(pushLiveAnnouncement).mockResolvedValue("posted");
      // La relève tombe à dix secondes du premier passage, pas à la fin de la pause.
      await jest.advanceTimersByTimeAsync(8_000);
      expect(jest.mocked(pushLiveAnnouncement).mock.calls.map(([, , context]) => context)).toEqual([
        "live-announce soiree-3 tournoi-4 match-40",
        "live-announce soiree-3 tournoi-5 match-57",
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("une fin de pause remplacée par une relève plus proche revient, même si ce passage n'a rien lu", async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });
    try {
      // Un appel étranglé arme une relève plus proche…
      const { query } = await holdFirstDiffusion();
      await dispatchLiveAnnouncements();
      // …dont le passage ne lit rien : coupe-circuit du bot ouvert.
      jest.mocked(isBotCircuitOpen).mockReturnValue(true);
      await jest.advanceTimersByTimeAsync(8_000);
      expect(query).toHaveBeenCalledTimes(1);
      // La fin de la pause est reprogrammée : le match part sans nouvel évènement.
      jest.mocked(isBotCircuitOpen).mockReturnValue(false);
      jest.mocked(pushLiveAnnouncement).mockResolvedValue("posted");
      await jest.advanceTimersByTimeAsync(LIVE_ANNOUNCE_RETRY_DELAY_MS);
      expect(pushLiveAnnouncement).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("une annonce publiée ne met aucune pause : le passage suivant suit l'étranglement seul", async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });
    try {
      const { query } = mockDb([]);
      await dispatchLiveAnnouncements();
      jest.setSystemTime(NOW + 11_000);
      await dispatchLiveAnnouncements();
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("n'échoue jamais : une panne de lecture rend 0", async () => {
    jest.mocked(getDatabase).mockRejectedValue(new Error("DB_DOWN"));
    await expect(dispatchLiveAnnouncements()).resolves.toBe(0);
  });
});

describe("soirées d'annonces", () => {
  it("ouvre une soirée quand aucune ne court, puis garde l'identifiant du message publié", async () => {
    const { execute, evening } = mockDb([AUTO_LIVE]);
    evening.mockImplementation(async (sql) => {
      if (!sql.includes("FROM bg_live_evenings")) return [[AUTO_LIVE]];
      const created = execute.mock.calls.some(([text]) => text.startsWith("INSERT INTO bg_live_evenings"));
      return [created ? [EVENING] : []];
    });
    expect(await runLiveAnnouncementSweep(NOW)).toBe(1);
    const sqls = execute.mock.calls.map(([text]) => text.replace(/\s+/g, " "));
    expect(sqls).toContain(
      "INSERT INTO bg_live_evenings (target, started_at, window_end) VALUES (?, NOW(), NOW() + INTERVAL 4 HOUR)",
    );
    const update = execute.mock.calls.find(([text]) => text.startsWith("UPDATE bg_live_evenings SET discord_message_id"));
    expect(update?.[1]).toEqual(["123456789012345678", 0, 3]);
    // Premier message qui notifie : la fenêtre part de son envoi, pas d'un essai reporté.
    expect(update?.[0]).toContain("window_end = GREATEST(window_end, NOW() + INTERVAL 4 HOUR)");
    // La purge des soirées finies ne passe pas par l'annonce.
    expect(sqls.some((sql) => sql.startsWith("DELETE FROM bg_live_evenings"))).toBe(false);
  });

  it("soirée déjà annoncée : modifie son message, sans nouvelle notification, et le dit dans pm2", async () => {
    const joined = { ...AUTO_LIVE, id: 41, pairing: "3:4", launch_pairing: "3:4" };
    const { evening } = mockDb([joined]);
    const announced = { ...AUTO_LIVE, launched_at: "2026-10-14T19:00:00Z" };
    evening.mockImplementation(async (sql) =>
      sql.includes("FROM bg_live_evenings")
        ? [[{ ...EVENING, discord_message_id: "123456789012345678" }]]
        : [[announced, joined]],
    );
    expect(await runLiveAnnouncementSweep(NOW)).toBe(1);
    const [request] = jest.mocked(pushLiveEvening).mock.calls[0];
    expect(request.editMessageId).toBe("123456789012345678");
    // Message déjà parti : la fenêtre ne bouge plus, la lecture s'arrête à sa fin.
    const read = evening.mock.calls.find(([sql]) => sql.includes("a.sent_at >= ?"));
    expect(read?.[0]).toContain("m.start_at <= ?))");
    // Le match déjà annoncé reste dans le message, à son heure.
    expect(request.message).toContain("**21:00** · En direct\nRenards contre Nova");
    expect(request.message).toContain("**21:58** · En direct\nRenards contre Nova");
    expect(console.info).toHaveBeenCalledWith(
      "[live-announce] match 41 (tournoi 4) annoncé dans #live (soirée 3, ajoutés au message de la soirée)",
    );
  });

  it("liste à leur heure les matchs programmés d'ici la fin de la soirée, du même public seulement", async () => {
    const { evening } = mockDb([AUTO_LIVE]);
    const upcoming = {
      ...AUTO_LIVE,
      id: 70,
      status: "PENDING",
      live_trigger: "START_TIME",
      launched_at: null,
      start_at: "2026-10-14T21:30:00Z",
      team1_name: "Orques",
      team2_name: "Lynx",
    };
    const official = { ...upcoming, id: 71, live_url: OFFICIAL, team1_name: "Hors", team2_name: "Public" };
    evening.mockImplementation(async (sql) =>
      sql.includes("FROM bg_live_evenings") ? [[EVENING]] : [[AUTO_LIVE, upcoming, official]],
    );
    await runLiveAnnouncementSweep(NOW);
    const [request] = jest.mocked(pushLiveEvening).mock.calls[0];
    expect(request.message).toBe(
      "🔴 **Les lives de la soirée**\n\n**21:58** · En direct\nRenards contre Nova — Coupe d'hiver\n{{lien:1}}" +
        "\n\n**23:30**\nOrques contre Lynx — Coupe d'hiver\n{{lien:1}}",
    );
    // La lecture de la soirée prend les annonces depuis son ouverture et les matchs jusqu'à sa fin —
    // sans message encore parti, jusqu'à la fin de la fenêtre qui repartira de cet envoi.
    const read = evening.mock.calls.find(([sql]) => sql.includes("a.sent_at >= ?"));
    expect(read?.[0]).toContain("m.start_at <= GREATEST(?, NOW() + INTERVAL 4 HOUR)");
    expect(read?.[1]).toEqual([expect.any(Number), expect.any(Number), EVENING.started_at, EVENING.window_end, EVENING.window_end]);
  });

  it("soirée marquée notifiée sans message connu : nouveau message sans notification", async () => {
    // Premier envoi d'issue incertaine (délai écoulé) : aucun identifiant gardé,
    // mais le public a peut-être déjà été notifié — jamais deux fois par soirée.
    const joined = { ...AUTO_LIVE, id: 41, pairing: "3:4", launch_pairing: "3:4" };
    const { evening } = mockDb([joined]);
    const announced = { ...AUTO_LIVE, launched_at: "2026-10-14T19:00:00Z" };
    evening.mockImplementation(async (sql) =>
      sql.includes("FROM bg_live_evenings") ? [[{ ...EVENING, notified: 1 }]] : [[announced, joined]],
    );
    expect(await runLiveAnnouncementSweep(NOW)).toBe(1);
    const [request] = jest.mocked(pushLiveEvening).mock.calls[0];
    expect(request.notify).toBe(false);
    expect(request.editMessageId).toBeUndefined();
    expect(console.info).toHaveBeenCalledWith(
      "[live-announce] match 41 (tournoi 4) annoncé dans #live (soirée 3, dans un nouveau message sans notifier, la soirée ayant déjà une annonce)",
    );
  });

  it("notifie quand la soirée n'est pas marquée, même si un match annoncé a changé de public depuis", async () => {
    // Match annoncé sur une chaîne StreamViewer, puis passé sur la chaîne
    // officielle : la soirée officielle n'est pas notifiée pour autant.
    const { evening } = mockDb([AUTO_LIVE]);
    const movedHere = { ...AUTO_LIVE, id: 42, pairing: "5:6", launch_pairing: "5:6", launched_at: "2026-10-14T19:00:00Z" };
    evening.mockImplementation(async (sql) =>
      sql.includes("FROM bg_live_evenings") ? [[EVENING]] : [[AUTO_LIVE, movedHere]],
    );
    await runLiveAnnouncementSweep(NOW);
    const [request] = jest.mocked(pushLiveEvening).mock.calls[0];
    expect(request.notify).toBeUndefined();
  });

  it("soirée au message connu : modification, jamais `notify: false`", async () => {
    const joined = { ...AUTO_LIVE, id: 41, pairing: "3:4", launch_pairing: "3:4" };
    const { evening } = mockDb([joined]);
    evening.mockImplementation(async (sql) =>
      sql.includes("FROM bg_live_evenings")
        ? [[{ ...EVENING, discord_message_id: "123456789012345678" }]]
        : [[AUTO_LIVE, joined]],
    );
    await runLiveAnnouncementSweep(NOW);
    const [request] = jest.mocked(pushLiveEvening).mock.calls[0];
    expect(request.editMessageId).toBe("123456789012345678");
    expect(request.notify).toBeUndefined();
  });

  it("un match fini depuis son annonce reste listé, « Terminé » avec son score, après le match réservé par ce passage", async () => {
    const { evening } = mockDb([AUTO_LIVE]);
    const finished = { ...AUTO_LIVE, id: 39, status: "COMPLETED", team1_name: "Fini", team1_score: 2, team2_score: 1 };
    evening.mockImplementation(async (sql) => (sql.includes("FROM bg_live_evenings") ? [[EVENING]] : [[finished]]));
    await runLiveAnnouncementSweep(NOW);
    const [request] = jest.mocked(pushLiveEvening).mock.calls[0];
    expect(request.message).toContain("· Terminé · 2-1\nFini contre Nova");
    expect(request.message.indexOf("Renards contre Nova")).toBeLessThan(request.message.indexOf("Fini contre Nova"));
  });

  it("message de soirée parti sans mention : gardé `silent`, sa modification n'en écrit pas", async () => {
    // Envoi muet (soirée déjà annoncée sans identifiant) : marqué sans mention.
    const joined = { ...AUTO_LIVE, id: 41, pairing: "3:4", launch_pairing: "3:4" };
    const first = mockDb([joined]);
    first.evening.mockImplementation(async (sql) =>
      sql.includes("FROM bg_live_evenings") ? [[{ ...EVENING, notified: 1 }]] : [[AUTO_LIVE, joined]],
    );
    await runLiveAnnouncementSweep(NOW);
    const quietUpdate = first.execute.mock.calls.find(([text]) => text.startsWith("UPDATE bg_live_evenings SET discord_message_id"));
    expect(quietUpdate?.[1]).toEqual(["123456789012345678", 1, 3]);
    // Premier message gardé, même muet : la fenêtre part de son envoi (elle couvre ce qu'il liste).
    expect(quietUpdate?.[0]).toContain("window_end = GREATEST(window_end, NOW() + INTERVAL 4 HOUR)");

    // Match suivant : le message gardé est muet → `notify: false` avec la modification.
    resetLiveAnnouncementThrottle();
    jest.mocked(pushLiveEvening).mockClear();
    const next = { ...AUTO_LIVE, id: 43, pairing: "7:8", launch_pairing: "7:8" };
    const second = mockDb([next]);
    second.evening.mockImplementation(async (sql) =>
      sql.includes("FROM bg_live_evenings")
        ? [[{ ...EVENING, discord_message_id: "123456789012345678", silent: 1 }]]
        : [[next]],
    );
    await runLiveAnnouncementSweep(NOW);
    const [request] = jest.mocked(pushLiveEvening).mock.calls[0];
    expect(request.editMessageId).toBe("123456789012345678");
    expect(request.notify).toBe(false);
    // Modifié en place (même identifiant) : rien à réécrire.
    expect(second.execute.mock.calls.some(([text]) => text.startsWith("UPDATE bg_live_evenings"))).toBe(false);
  });

  it("suite d'un message disparu : nouvel identifiant gardé `silent`, sans toucher à la fenêtre", async () => {
    const { execute, evening } = mockDb([AUTO_LIVE]);
    evening.mockImplementation(async (sql) =>
      sql.includes("FROM bg_live_evenings") ? [[{ ...EVENING, discord_message_id: "999999999999999999" }]] : [[AUTO_LIVE]],
    );
    await runLiveAnnouncementSweep(NOW);
    expect(jest.mocked(pushLiveEvening).mock.calls[0][0].notify).toBeUndefined();
    const update = execute.mock.calls.find(([text]) => text.startsWith("UPDATE bg_live_evenings"));
    expect(update?.[1]).toEqual(["123456789012345678", 1, 3]);
    expect(update?.[0]).not.toContain("window_end");
    // pm2 dit qu'une suite est partie, pas une modification.
    expect(console.info).toHaveBeenCalledWith(
      "[live-announce] match 40 (tournoi 4) annoncé dans #live (soirée 3, dans une suite sans notifier, le message de la soirée ne se modifiant plus)",
    );
  });

  it("date les réservations du groupe dans la soirée avant de lire ses matchs (réservées avant son ouverture)", async () => {
    // Réservation prise avant l'ouverture de la soirée (autre public envoyé
    // d'abord, seconde franchie) : sans cette date, elle ne compterait pas
    // parmi les annonces de la soirée — sortie du message, seconde notification.
    const { execute, evening } = mockDb([AUTO_LIVE]);
    await runLiveAnnouncementSweep(NOW);
    const stamp = execute.mock.calls.find(([sql]) => sql.startsWith("UPDATE bg_live_announcements SET sent_at"));
    expect(stamp?.[0]).toBe(
      "UPDATE bg_live_announcements SET sent_at = GREATEST(sent_at, ?) WHERE (match_id, pairing) IN ((?, ?))",
    );
    expect(stamp?.[1]).toEqual([EVENING.started_at, 40, "1:2"]);
    const stampOrder = execute.mock.invocationCallOrder[execute.mock.calls.indexOf(stamp!)];
    const readIndex = evening.mock.calls.findIndex(([sql]) => sql.includes("a.sent_at >= ?"));
    expect(stampOrder).toBeLessThan(evening.mock.invocationCallOrder[readIndex]);
  });

  it("réservations non datées dans la soirée : rendues, annonce reportée", async () => {
    const { execute } = mockDb([AUTO_LIVE]);
    const base = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql, params) => {
      if (sql.startsWith("UPDATE bg_live_announcements SET sent_at")) throw new Error("DB_DOWN");
      return base(sql, params);
    });
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(pushLiveEvening).not.toHaveBeenCalled();
    expect(releasesOf(execute)).toEqual([[40, "1:2"]]);
  });

  it("type illisible : un match entre deux invités d'un tournoi qui compte une entrée individuelle reste anonyme", async () => {
    const solo = { ...AUTO_LIVE, participant_type: null, team2_solo_user_id: 8, team2_pseudo: "Bravo" };
    const guests = {
      ...AUTO_LIVE,
      id: 41,
      pairing: "3:4",
      launch_pairing: "3:4",
      participant_type: null,
      team1_name: "Lucas Martin",
      team2_name: "Emma Petit",
    };
    mockDb([solo, guests]);
    await runLiveAnnouncementSweep(NOW);
    const message = jest.mocked(pushLiveAnnouncement).mock.calls[0][0];
    expect(message).toContain("un joueur contre un joueur — Coupe d'hiver");
    expect(message).not.toMatch(/Lucas|Emma/);
  });

  it("premier message qui notifie : la soirée est marquée notifiée, fenêtre repartie, avant l'envoi", async () => {
    const { execute } = mockDb([AUTO_LIVE]);
    await runLiveAnnouncementSweep(NOW);
    const mark = execute.mock.calls.find(([sql]) => sql.startsWith("UPDATE bg_live_evenings SET notified = 1"));
    expect(mark?.[0]).toBe(
      "UPDATE bg_live_evenings SET notified = 1, window_end = GREATEST(window_end, NOW() + INTERVAL 4 HOUR) WHERE id = ? AND notified = 0",
    );
    expect(mark?.[1]).toEqual([3]);
    const markOrder = execute.mock.invocationCallOrder[execute.mock.calls.indexOf(mark!)];
    expect(markOrder).toBeLessThan(jest.mocked(pushLiveEvening).mock.invocationCallOrder[0]);
    expect(jest.mocked(pushLiveEvening).mock.calls[0][0].notify).toBeUndefined();
  });

  it("soirée marquée notifiée sans identifiant gardé (tournoi fini depuis) : nouveau message sans notification", async () => {
    // Premier envoi d'issue incertaine pour un tournoi fini depuis : sa réservation
    // n'est plus lue, la marque de la soirée suffit — jamais deux notifications.
    const { execute, evening } = mockDb([AUTO_LIVE]);
    evening.mockImplementation(async (sql) =>
      sql.includes("FROM bg_live_evenings") ? [[{ ...EVENING, notified: 1 }]] : [[AUTO_LIVE]],
    );
    await runLiveAnnouncementSweep(NOW);
    expect(jest.mocked(pushLiveEvening).mock.calls[0][0].notify).toBe(false);
    expect(execute.mock.calls.some(([sql]) => sql.includes("SET notified"))).toBe(false);
  });

  it("marque déjà prise par un autre envoi (affectedRows 0) : nouveau message sans notification, marque gardée", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("rejected");
    const { execute } = mockDb([AUTO_LIVE]);
    const base = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql, params) => {
      if (sql.startsWith("UPDATE bg_live_evenings SET notified = 1")) return [{ affectedRows: 0 }];
      return base(sql, params);
    });
    await runLiveAnnouncementSweep(NOW);
    expect(jest.mocked(pushLiveEvening).mock.calls[0][0].notify).toBe(false);
    // Refus d'un envoi qui ne notifiait pas : la marque de l'autre envoi reste.
    expect(execute.mock.calls.some(([sql]) => sql.includes("SET notified = 0"))).toBe(false);
  });

  it("marque de la soirée impossible : rien ne part, réservation rendue", async () => {
    const { execute } = mockDb([AUTO_LIVE]);
    const base = execute.getMockImplementation()!;
    execute.mockImplementation(async (sql, params) => {
      if (sql.startsWith("UPDATE bg_live_evenings SET notified = 1")) throw new Error("DB_DOWN");
      return base(sql, params);
    });
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(pushLiveEvening).not.toHaveBeenCalled();
    expect(releasesOf(execute)).toEqual([[40, "1:2"]]);
  });

  it.each(["rejected", "discord-refused"] satisfies LiveAnnouncementOutcome[])(
    "premier envoi refusé (%s) : la soirée n'est plus notifiée et le refus sort de la soirée, réservation gardée",
    async (outcome) => {
      jest.mocked(pushLiveAnnouncement).mockResolvedValue(outcome);
      const { execute } = mockDb([AUTO_LIVE]);
      await runLiveAnnouncementSweep(NOW);
      expect(execute.mock.calls).toContainEqual(["UPDATE bg_live_evenings SET notified = 0 WHERE id = ?", [3]]);
      const refused = execute.mock.calls.find(([sql]) => sql.startsWith("UPDATE bg_live_announcements SET refused = 1"));
      expect(refused?.[0]).toBe("UPDATE bg_live_announcements SET refused = 1 WHERE (match_id, pairing) IN ((?, ?))");
      expect(refused?.[1]).toEqual([40, "1:2"]);
      // La date de la trace (export RGPD) n'est pas réécrite.
      expect(execute.mock.calls.some(([sql]) => sql.includes("INTERVAL 1 SECOND"))).toBe(false);
      expect(releasesOf(execute)).toEqual([]);
    },
  );

  it("premier envoi reporté (bot injoignable) : la soirée n'est plus notifiée, réservation rendue", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("unavailable");
    const { execute } = mockDb([AUTO_LIVE]);
    await runLiveAnnouncementSweep(NOW);
    expect(execute.mock.calls).toContainEqual(["UPDATE bg_live_evenings SET notified = 0 WHERE id = ?", [3]]);
    expect(execute.mock.calls.some(([sql]) => sql.includes("SET refused = 1"))).toBe(false);
    expect(releasesOf(execute)).toEqual([[40, "1:2"]]);
  });

  it("premier envoi d'issue incertaine (délai écoulé) : la soirée reste notifiée", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("timed-out");
    const { execute } = mockDb([AUTO_LIVE]);
    await runLiveAnnouncementSweep(NOW);
    expect(execute.mock.calls.some(([sql]) => sql.includes("SET notified = 0"))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => sql.includes("SET refused = 1"))).toBe(false);
  });

  it("refus d'une modification de la soirée : la marque reste, le refus sort de la soirée", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("rejected");
    const { execute, evening } = mockDb([AUTO_LIVE]);
    evening.mockImplementation(async (sql) =>
      sql.includes("FROM bg_live_evenings")
        ? [[{ ...EVENING, discord_message_id: "123456789012345678", notified: 1 }]]
        : [[AUTO_LIVE]],
    );
    await runLiveAnnouncementSweep(NOW);
    expect(execute.mock.calls.some(([sql]) => sql.includes("SET notified"))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => sql.includes("SET refused = 1"))).toBe(true);
  });

  it("un match annoncé puis rouvert (AUTO) n'est plus listé ; antenne fermée (MANUAL), pas joué : à l'heure de son annonce, sans état", async () => {
    const joined = { ...AUTO_LIVE, id: 41, pairing: "3:4", launch_pairing: "3:4" };
    const { evening } = mockDb([joined]);
    // Annoncé plus tôt, puis rouvert pour une autre affiche : plus de lancement pour la courante.
    const reopened = { ...AUTO_LIVE, pairing: "1:9", launch_pairing: "1:2", team2_name: "Remplaçants" };
    const closed = {
      ...AUTO_LIVE,
      id: 42,
      live_trigger: "MANUAL",
      live_started_at: null,
      announced_at: "2026-10-14T19:30:00Z",
      team1_name: "Fermés",
    };
    evening.mockImplementation(async (sql) =>
      sql.includes("FROM bg_live_evenings")
        ? [[{ ...EVENING, discord_message_id: "123456789012345678" }]]
        : [[reopened, closed, joined]],
    );
    await runLiveAnnouncementSweep(NOW);
    const [request] = jest.mocked(pushLiveEvening).mock.calls[0];
    expect(request.message).not.toContain("Remplaçants");
    // Une coupure n'est pas une fin : ni « En direct » ni « Terminé ».
    expect(request.message).toContain("\n\n**21:30**\nFermés contre Nova");
    expect(request.message).toContain("Renards contre Nova");
  });

  it("ne relit une soirée que par l'annonce de l'affiche courante d'un match (rouvert : l'ancienne ne compte plus)", async () => {
    const { evening } = mockDb([AUTO_LIVE]);
    await runLiveAnnouncementSweep(NOW);
    const read = evening.mock.calls.find(([sql]) => sql.includes("a.sent_at >= ?"));
    expect(read?.[0].replace(/\s+/g, " ")).toContain(
      "a.match_id = m.id AND a.sent_at >= ? AND a.sent_at < ? AND a.refused = 0 AND a.pairing = CONCAT(LEAST(m.team1_id, m.team2_id), ':', GREATEST(m.team1_id, m.team2_id))",
    );
  });

  it("message de la soirée supprimé de #live : la soirée se ferme, réservation gardée et marquée refusée", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("evening-deleted");
    const { execute, evening } = mockDb([AUTO_LIVE]);
    evening.mockImplementation(async (sql) =>
      sql.includes("FROM bg_live_evenings")
        ? [[{ ...EVENING, discord_message_id: "123456789012345678", notified: 1 }]]
        : [[AUTO_LIVE]],
    );
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(execute.mock.calls).toContainEqual(["UPDATE bg_live_evenings SET closed = 1 WHERE id = ?", [3]]);
    expect(execute.mock.calls.some(([sql]) => sql.startsWith("UPDATE bg_live_announcements SET refused = 1"))).toBe(true);
    expect(releasesOf(execute)).toEqual([]);
    expect(String(jest.mocked(console.error).mock.calls[0][0])).toContain("suppression respectée");
  });

  it("soirée close : rien n'est envoyé au bot, réservation gardée", async () => {
    const { execute, evening } = mockDb([AUTO_LIVE]);
    evening.mockImplementation(async (sql) =>
      sql.includes("FROM bg_live_evenings")
        ? [[{ ...EVENING, discord_message_id: "123456789012345678", closed: 1 }]]
        : [[AUTO_LIVE]],
    );
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(pushLiveEvening).not.toHaveBeenCalled();
    expect(releasesOf(execute)).toEqual([]);
    // Non publiée : la réservation est marquée refusée, comme le rend l'export RGPD.
    expect(execute.mock.calls.some(([sql]) => sql.startsWith("UPDATE bg_live_announcements SET refused = 1"))).toBe(true);
    expect(String(jest.mocked(console.warn).mock.calls[0][0])).toContain("soirée 3 close (message supprimé de #live)");
    // Ni datation des réservations ni lecture des matchs : la soirée est close.
    expect(execute.mock.calls.some(([sql]) => sql.startsWith("UPDATE bg_live_announcements SET sent_at"))).toBe(false);
    expect(evening.mock.calls.some(([sql]) => sql.includes("a.sent_at >= ?"))).toBe(false);
  });

  it("soirée illisible : réservation rendue, annonce reportée", async () => {
    const { execute, evening } = mockDb([AUTO_LIVE]);
    evening.mockRejectedValue(new Error("DB_DOWN"));
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(pushLiveEvening).not.toHaveBeenCalled();
    expect(releasesOf(execute)).toEqual([[40, "1:2"]]);
  });

  it("soirée illisible pour un public : l'autre public est annoncé quand même, sans accuser le bot", async () => {
    const official = { ...AUTO_LIVE, id: 42, tournament_id: 5, pairing: "5:6", launch_pairing: "5:6", live_url: OFFICIAL };
    const { execute, evening } = mockDb([AUTO_LIVE, official]);
    evening.mockImplementation(async (sql, params) => {
      if (!sql.includes("FROM bg_live_evenings")) return [[official]];
      if ((params as unknown[])[0] === "stream-viewer") throw new Error("DB_DOWN");
      return [[EVENING]];
    });
    expect(await runLiveAnnouncementSweep(NOW)).toBe(1);
    expect(jest.mocked(pushLiveEvening).mock.calls.map(([request]) => request.mention)).toEqual(["everyone"]);
    expect(releasesOf(execute)).toEqual([[40, "1:2"]]);
    const warnings = jest.mocked(console.warn).mock.calls.map(([text]) => String(text));
    expect(warnings.some((text) => text.includes("bot injoignable"))).toBe(false);
    // Seul le public en cause attend : le passage suivant ne le réserve pas de nouveau.
    execute.mockClear();
    await runLiveAnnouncementSweep(NOW);
    expect(claimsOf(execute)).not.toContainEqual([40, "1:2"]);
  });

  it("la version de logs d'une soirée ôte les pseudos", async () => {
    mockDb([
      { ...AUTO_LIVE, participant_type: "SOLO", team1_solo_user_id: 7, team2_solo_user_id: 8, team1_pseudo: "Kiro", team2_pseudo: "Ayla" },
    ]);
    await runLiveAnnouncementSweep(NOW);
    const [request] = jest.mocked(pushLiveEvening).mock.calls[0];
    expect(request.message).toContain("Kiro contre Ayla");
    expect(request.logMessage).toContain("un joueur contre un joueur");
    expect(request.logMessage).not.toMatch(/Kiro|Ayla/);
  });
});

describe("mise à jour de la soirée aux fins de match", () => {
  /** Soirée ouverte au message publié, public StreamViewer (chaîne du caster). */
  const OPEN = { ...EVENING, target: "stream-viewer", discord_message_id: "123456789012345678", notified: 1 };
  const DONE = { ...AUTO_LIVE, status: "COMPLETED", team1_score: 2, team2_score: 1 };

  /** Soirées lues par la mise à jour, puis matchs de chacune. */
  function mockRefresh(evenings: unknown[], matches: unknown[]): Db {
    const db = mockDb([]);
    db.evening.mockImplementation(async (sql) => (sql.includes("FROM bg_live_evenings") ? [evenings] : [matches]));
    return db;
  }

  it("un match fini : le message de la soirée est modifié, « Terminé » avec le score, sans notification ni nouveau message", async () => {
    const { evening } = mockRefresh([OPEN], [DONE]);
    expect(await refreshLiveEvenings(NOW)).toBe(1);
    expect(pushLiveEvening).toHaveBeenCalledTimes(1);
    const [request] = jest.mocked(pushLiveEvening).mock.calls[0];
    expect(request.editMessageId).toBe("123456789012345678");
    expect(request.refresh).toBe(true);
    expect(request.mention).toBe("stream-viewer");
    // Message qui a notifié : sa mention reste écrite (une modification ne notifie jamais).
    expect(request.notify).toBeUndefined();
    expect(request.message).toContain("**21:58** · Terminé · 2-1\nRenards contre Nova");
    expect(request.message).not.toContain("En direct");
    expect(request.context).toBe("live-refresh soiree-3 tournoi-4 match-40");
    // Fenêtre en cours, message gardé, soirée non close ; le tournoi clos par ce match reste lu.
    const [select] = evening.mock.calls[0];
    expect(select).toContain("window_end > NOW() - INTERVAL 4 HOUR AND closed = 0 AND discord_message_id IS NOT NULL");
    expect(select).toContain("window_end <= NOW() AS ended");
    const read = evening.mock.calls.find(([sql]) => sql.includes("a.sent_at >= ?"));
    expect(read?.[0]).toContain("t.state IN ('RUNNING', 'FINISHED')");
    expect(read?.[0]).toContain("OR (t.state = 'RUNNING' AND m.live_trigger = 'START_TIME'");
  });

  it("forfait ou score en attente : « Terminé » seul", async () => {
    const forfeit = { ...DONE, forfeit_team_id: 2, team1_score: null, team2_score: null };
    const pending = { ...AUTO_LIVE, id: 41, status: "AWAITING_CONFIRMATION", team1_score: 3, team2_score: 0, team1_name: "Attente" };
    mockRefresh([OPEN], [forfeit, pending]);
    await refreshLiveEvenings(NOW);
    const [request] = jest.mocked(pushLiveEvening).mock.calls[0];
    expect(request.message).toContain("**21:58** · Terminé\nRenards contre Nova");
    expect(request.message).toContain("**21:58** · Terminé\nAttente contre Nova");
    expect(request.message).not.toMatch(/\d-\d/);
  });

  it("message de la soirée parti sans mention : la modification n'en écrit pas (`notify: false`)", async () => {
    mockRefresh([{ ...OPEN, silent: 1 }], [DONE]);
    await refreshLiveEvenings(NOW);
    expect(jest.mocked(pushLiveEvening).mock.calls[0][0].notify).toBe(false);
  });

  it("texte inchangé depuis la dernière publication : aucune modification", async () => {
    mockRefresh([OPEN], [DONE]);
    expect(await refreshLiveEvenings(NOW)).toBe(1);
    expect(await refreshLiveEvenings(NOW)).toBe(0);
    expect(pushLiveEvening).toHaveBeenCalledTimes(1);
  });

  it("texte déjà publié par l'annonce d'un direct : la mise à jour ne le renvoie pas", async () => {
    const { evening } = mockDb([AUTO_LIVE]);
    evening.mockImplementation(async (sql) => (sql.includes("FROM bg_live_evenings") ? [[OPEN]] : [[AUTO_LIVE]]));
    await runLiveAnnouncementSweep(NOW);
    expect(pushLiveEvening).toHaveBeenCalledTimes(1);
    expect(await refreshLiveEvenings(NOW)).toBe(0);
    expect(pushLiveEvening).toHaveBeenCalledTimes(1);
  });

  it("fenêtre finie (aucune soirée ouverte lue) : rien n'est modifié", async () => {
    mockRefresh([], [DONE]);
    expect(await refreshLiveEvenings(NOW)).toBe(0);
    expect(pushLiveEvening).not.toHaveBeenCalled();
  });

  it("bot en panne : ni lecture ni envoi, mais une relance ; bot injoignable : aucune exception, une relance programmée", async () => {
    jest.useFakeTimers();
    try {
      jest.mocked(isBotCircuitOpen).mockReturnValue(true);
      const { evening } = mockRefresh([OPEN], [DONE]);
      expect(await refreshLiveEvenings(NOW)).toBe(0);
      expect(evening).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(1);
      resetLiveAnnouncementThrottle();
      jest.mocked(isBotCircuitOpen).mockReturnValue(false);
      pushLiveAnnouncement.mockResolvedValue("unavailable");
      expect(await refreshLiveEvenings(NOW)).toBe(0);
      expect(jest.getTimerCount()).toBe(1);
      // Le texte n'a pas été retenu : la relance le renvoie.
      pushLiveAnnouncement.mockResolvedValue("posted");
      await jest.advanceTimersByTimeAsync(LIVE_EVENING_REFRESH_DELAY_MS);
      expect(pushLiveEvening).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("refus du bot : le même texte n'est pas renvoyé, rien n'est relancé", async () => {
    pushLiveAnnouncement.mockResolvedValue("rejected");
    mockRefresh([OPEN], [DONE]);
    jest.useFakeTimers();
    try {
      await refreshLiveEvenings(NOW);
      expect(jest.getTimerCount()).toBe(0);
      await refreshLiveEvenings(NOW);
      expect(pushLiveEvening).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("mise à jour peut-être partie (incertaine, sans réponse à temps) : la suivante renvoie le texte, sans relance immédiate", async () => {
    const outcomes: LiveAnnouncementOutcome[] = ["uncertain", "timed-out", "interrupted"];
    for (const outcome of outcomes) {
      resetLiveAnnouncementThrottle();
      jest.mocked(pushLiveEvening).mockClear();
      pushLiveAnnouncement.mockResolvedValue(outcome);
      jest.useFakeTimers();
      try {
        // Soirée finie au texte publié par ce processus, puis une fin de match.
        pushLiveAnnouncement.mockResolvedValueOnce("posted");
        mockRefresh([OPEN], [AUTO_LIVE]);
        await refreshLiveEvenings(NOW);
        mockRefresh([{ ...OPEN, ended: 1 }], [DONE]);
        expect(await refreshLiveEvenings(NOW)).toBe(0);
        expect(jest.getTimerCount()).toBe(0);
        pushLiveAnnouncement.mockResolvedValue("posted");
        expect(await refreshLiveEvenings(NOW)).toBe(1);
        expect(pushLiveEvening).toHaveBeenCalledTimes(3);
        expect(jest.mocked(pushLiveEvening).mock.calls[2][0].message).toContain("· Terminé · 2-1");
      } finally {
        jest.useRealTimers();
      }
    }
  });

  it("message supprimé de #live : la soirée est close, rien n'est reposté", async () => {
    pushLiveAnnouncement.mockResolvedValue("evening-deleted");
    const { execute } = mockRefresh([OPEN], [DONE]);
    await refreshLiveEvenings(NOW);
    expect(execute.mock.calls.some(([sql]) => sql === "UPDATE bg_live_evenings SET closed = 1 WHERE id = ?")).toBe(true);
  });

  it("suite postée (message plus modifiable) : son identifiant remplace l'ancien, marquée sans mention", async () => {
    jest.mocked(pushLiveEvening).mockResolvedValue({ outcome: "posted", messageId: "223456789012345678" });
    const { execute } = mockRefresh([OPEN], [DONE]);
    await refreshLiveEvenings(NOW);
    const update = execute.mock.calls.find(([sql]) => sql.startsWith("UPDATE bg_live_evenings SET discord_message_id"));
    expect(update?.[1]).toEqual(["223456789012345678", 1, 3]);
  });

  it("fenêtre finie depuis peu, texte publié par ce processus : le match fini après la fenêtre passe « Terminé »", async () => {
    const LIVE = { ...AUTO_LIVE };
    mockRefresh([OPEN], [LIVE]);
    expect(await refreshLiveEvenings(NOW)).toBe(1);
    // La fenêtre s'est fermée pendant le match ; il se termine ensuite.
    const { evening } = mockRefresh([{ ...OPEN, ended: 1 }], [DONE]);
    expect(await refreshLiveEvenings(NOW)).toBe(1);
    expect(jest.mocked(pushLiveEvening).mock.calls[1][0].message).toContain("· Terminé · 2-1");
    // Réservations de la fenêtre seulement : la soirée suivante n'y est pas reprise.
    const read = evening.mock.calls.find(([sql]) => sql.includes("a.sent_at >= ?"));
    expect(read?.[0]).toContain("a.sent_at >= ? AND a.sent_at < ?");
  });

  it("fenêtre finie sans texte publié par ce processus (redémarrage) : rien n'est modifié", async () => {
    const { evening } = mockRefresh([{ ...OPEN, ended: 1 }], [DONE]);
    expect(await refreshLiveEvenings(NOW)).toBe(0);
    expect(pushLiveEvening).not.toHaveBeenCalled();
    expect(evening.mock.calls.some(([sql]) => sql.includes("a.sent_at >= ?"))).toBe(false);
  });

  it("rafale de fins de match : une seule mise à jour par public au bout d'une minute", async () => {
    const viewer = { ...AUTO_LIVE, status: "COMPLETED", team1_score: 1, team2_score: 0 };
    const official = { ...DONE, id: 50, live_url: OFFICIAL };
    mockRefresh([OPEN, { ...OPEN, id: 4, target: "everyone" }], [viewer, official]);
    jest.useFakeTimers();
    try {
      for (let i = 0; i < 5; i++) requestLiveEveningRefresh();
      expect(jest.getTimerCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(LIVE_EVENING_REFRESH_DELAY_MS - 1);
      expect(pushLiveEvening).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(pushLiveEvening).toHaveBeenCalledTimes(2);
      const mentions = jest.mocked(pushLiveEvening).mock.calls.map(([request]) => request.mention);
      expect(mentions).toEqual(["stream-viewer", "everyone"]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("annonces désactivées : aucune mise à jour programmée", () => {
    jest.replaceProperty(process, "env", { ...process.env, LIVE_ANNOUNCEMENTS_ENABLED: undefined });
    jest.useFakeTimers();
    try {
      requestLiveEveningRefresh();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("mise à jour de la soirée — reprises", () => {
  const OPEN = { ...EVENING, target: "stream-viewer", discord_message_id: "123456789012345678", notified: 1 };
  const DONE = { ...AUTO_LIVE, status: "COMPLETED", team1_score: 2, team2_score: 1 };

  it("match MANUAL terminé, antenne fermée : l'heure de son annonce, stable d'une lecture à l'autre", async () => {
    const manual = {
      ...DONE,
      live_trigger: "MANUAL",
      live_started_at: null,
      launched_at: null,
      announced_at: "2026-10-14T19:30:00Z",
    };
    const { evening } = mockDb([]);
    evening.mockImplementation(async (sql) => (sql.includes("FROM bg_live_evenings") ? [[OPEN]] : [[manual]]));
    await refreshLiveEvenings(NOW);
    expect(await refreshLiveEvenings(NOW + 5 * 60_000)).toBe(0);
    expect(pushLiveEvening).toHaveBeenCalledTimes(1);
    expect(jest.mocked(pushLiveEvening).mock.calls[0][0].message).toContain("**21:30** · Terminé · 2-1");
    const read = evening.mock.calls.find(([sql]) => sql.includes("a.sent_at >= ?"));
    expect(read?.[0]).toContain("SELECT MAX(a.sent_at) FROM bg_live_announcements a");
  });

  it("soirée en pause (refus récent de Discord) : relancée plus tard, pas oubliée", async () => {
    jest.useFakeTimers();
    try {
      // Une modification refusée par Discord met la soirée de ce public en pause.
      pushLiveAnnouncement.mockResolvedValue("discord-held");
      const { evening } = mockDb([AUTO_LIVE]);
      evening.mockImplementation(async (sql) => (sql.includes("FROM bg_live_evenings") ? [[OPEN]] : [[DONE]]));
      await runLiveAnnouncementSweep(NOW);
      jest.clearAllTimers();
      jest.mocked(pushLiveEvening).mockClear();
      expect(await refreshLiveEvenings(NOW)).toBe(0);
      expect(pushLiveEvening).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("bot injoignable : l'autre public n'est pas essayé pour rien", async () => {
    pushLiveAnnouncement.mockResolvedValue("unavailable");
    const official = { ...DONE, id: 50, live_url: OFFICIAL };
    const { evening } = mockDb([]);
    evening.mockImplementation(async (sql) =>
      sql.includes("FROM bg_live_evenings") ? [[OPEN, { ...OPEN, id: 4, target: "everyone" }]] : [[DONE, official]],
    );
    await refreshLiveEvenings(NOW);
    expect(pushLiveEvening).toHaveBeenCalledTimes(1);
  });

  it("une soirée illisible n'empêche pas la mise à jour de l'autre", async () => {
    const official = { ...DONE, id: 50, live_url: OFFICIAL };
    const { evening } = mockDb([]);
    let reads = 0;
    evening.mockImplementation(async (sql) => {
      if (sql.includes("FROM bg_live_evenings")) return [[OPEN, { ...OPEN, id: 4, target: "everyone" }]];
      reads += 1;
      if (reads === 1) throw new Error("base indisponible");
      return [[DONE, official]];
    });
    expect(await refreshLiveEvenings(NOW)).toBe(1);
    expect(jest.mocked(pushLiveEvening).mock.calls[0][0].mention).toBe("everyone");
  });

  it("relances épuisées : une nouvelle fin de match en redonne", async () => {
    jest.useFakeTimers();
    try {
      pushLiveAnnouncement.mockResolvedValue("unavailable");
      mockRefresh0([OPEN], [DONE]);
      requestLiveEveningRefresh();
      // Premier essai puis une relance par minute pendant une demi-heure (un
      // redémarrage du bot passe) ; ensuite plus rien.
      expect(LIVE_EVENING_REFRESH_MAX_RETRIES).toBe(30);
      const attempts = LIVE_EVENING_REFRESH_MAX_RETRIES + 1;
      for (let i = 0; i < attempts + 2; i++) await jest.advanceTimersByTimeAsync(LIVE_EVENING_REFRESH_DELAY_MS);
      expect(pushLiveEvening).toHaveBeenCalledTimes(attempts);
      expect(jest.getTimerCount()).toBe(0);
      requestLiveEveningRefresh();
      await jest.advanceTimersByTimeAsync(LIVE_EVENING_REFRESH_DELAY_MS);
      expect(pushLiveEvening).toHaveBeenCalledTimes(attempts + 1);
      expect(jest.getTimerCount()).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  /** Soirées lues par la mise à jour, puis matchs de chacune. */
  function mockRefresh0(evenings: unknown[], matches: unknown[]): void {
    const { evening } = mockDb([]);
    evening.mockImplementation(async (sql) => (sql.includes("FROM bg_live_evenings") ? [evenings] : [matches]));
  }
});

describe("eveningTextKey (texte retenu en mémoire)", () => {
  it("ne retient qu'une empreinte, jamais le texte ni le pseudo qu'il porte", () => {
    const key = eveningTextKey("**21:00** Pseudo_Solo vs Autre_Joueur", ["https://twitch.tv/bluegenjiesport"]);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("Pseudo_Solo");
  });

  it("distingue un texte ou des liens changés, et rend la même clé pour le même texte", () => {
    const base = eveningTextKey("texte", ["https://a.example"]);
    expect(eveningTextKey("texte", ["https://a.example"])).toBe(base);
    expect(eveningTextKey("texte modifié", ["https://a.example"])).not.toBe(base);
    expect(eveningTextKey("texte", ["https://b.example"])).not.toBe(base);
    // Le séparateur entre texte et liens ne laisse pas deux découpages se confondre.
    expect(eveningTextKey("texte", [])).not.toBe(eveningTextKey("texte\n", []));
  });
});
