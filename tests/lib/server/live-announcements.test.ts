import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration", () => ({
  isBotCircuitOpen: jest.fn(),
  pushLiveAnnouncement: jest.fn(),
}));

import { getDatabase } from "@/lib/server/database";
import { isBotCircuitOpen, pushLiveAnnouncement, type LiveAnnouncementOutcome } from "@/lib/server/bot-integration";
import {
  LIVE_ANNOUNCE_MAX_AGE_MINUTES,
  LIVE_ANNOUNCE_RETRY_DELAY_MS,
  dispatchLiveAnnouncements,
  liveAnnouncementsEnabled,
  liveEntrantName,
  resetLiveAnnouncementThrottle,
  runLiveAnnouncementSweep,
} from "@/lib/server/tournaments/live-announcements";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

const NOW = Date.parse("2026-10-14T20:00:00Z");

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

type Db = { query: jest.Mock<SqlQuery>; execute: jest.Mock<SqlQuery> };

/** `query` rend les candidats ; `execute` rejoue les réservations (`claims`) et les rendus. */
function mockDb(candidates: unknown[], claims: boolean[] = []): Db {
  const queue = [...claims];
  const query = jest.fn<SqlQuery>().mockResolvedValue([candidates]);
  const execute = jest.fn<SqlQuery>(async (sql) => {
    if (sql.startsWith("INSERT IGNORE INTO bg_live_announcements")) {
      return [{ affectedRows: (queue.length > 0 ? queue.shift() : true) ? 1 : 0 }];
    }
    if (sql.startsWith("DELETE FROM bg_live_announcements WHERE (match_id, pairing) IN (")) return [{ affectedRows: 1 }];
    throw new Error(`requête inattendue : ${sql}`);
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute }));
  return { query, execute };
}

function claimsOf(execute: Db["execute"]): unknown[] {
  return execute.mock.calls.filter(([sql]) => sql.startsWith("INSERT IGNORE")).map(([, params]) => params);
}

/** Réservations rendues, une paire `[match, affiche]` par ligne (une requête par groupe). */
function releasesOf(execute: Db["execute"]): unknown[] {
  return execute.mock.calls
    .filter(([sql]) => sql.startsWith("DELETE"))
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
  jest.mocked(pushLiveAnnouncement).mockResolvedValue("posted");
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
      "🔴 En direct : Renards contre Nova — Coupe d'hiver",
      "https://www.twitch.tv/caster",
      "live-announce tournoi-4 match-40",
    );
    expect(releasesOf(execute)).toEqual([]);
    // Trace pm2 : identifiants, aucun nom.
    expect(console.info).toHaveBeenCalledWith("[live-announce] match 40 (tournoi 4) annoncé dans #live");
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
    expect(jest.mocked(pushLiveAnnouncement).mock.calls[0][0]).toBe("🔴 En direct : Alpha contre Bravo — Coupe d'hiver");
    // Le pseudo vient du compte vivant de l'entrée solo, jamais d'un compte supprimé.
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/LEFT JOIN bg_users u1 ON u1\.id = t1\.solo_user_id AND u1\.is_deleted = 0/);
    expect(sql).toMatch(/LEFT JOIN bg_users u2 ON u2\.id = t2\.solo_user_id AND u2\.is_deleted = 0/);
  });

  it("écrit « un joueur » pour une entrée individuelle dont le compte est supprimé", async () => {
    mockDb([{ ...AUTO_LIVE, team1_name: "Anonyme-1", team2_name: "Bravo", team1_solo_user_id: 7, team2_solo_user_id: 8, team2_pseudo: "Bravo" }]);
    await runLiveAnnouncementSweep(NOW);
    expect(jest.mocked(pushLiveAnnouncement).mock.calls[0][0]).toBe("🔴 En direct : un joueur contre Bravo — Coupe d'hiver");
  });

  it("tournoi individuel : un invité sans compte (fantôme nommé par le staff) s'écrit « un joueur », jamais son nom", async () => {
    mockDb([
      { ...AUTO_LIVE, participant_type: "SOLO", team1_name: "Lucas Martin", team2_name: "Bravo (2)", team2_solo_user_id: 8, team2_pseudo: "Bravo" },
    ]);
    await runLiveAnnouncementSweep(NOW);
    const message = jest.mocked(pushLiveAnnouncement).mock.calls[0][0];
    expect(message).toBe("🔴 En direct : un joueur contre Bravo — Coupe d'hiver");
    expect(message).not.toContain("Lucas");
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
    mockDb([AUTO_LIVE, { ...AUTO_LIVE, id: 55, tournament_id: 7, pairing: "5:6", launch_pairing: "5:6" }]);
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
      "[live-announce] match 40 (tournoi 4) annoncé dans #live sans notifier (permission de mentionner @everyone absente)",
    );
  });

  it("un seul @everyone pour les matchs d'un tournoi à l'antenne ensemble sur le même lien", async () => {
    const { execute } = mockDb([
      { ...AUTO_LIVE, live_url: null },
      { ...AUTO_LIVE, id: 41, live_url: null, pairing: "3:4", launch_pairing: "3:4", team1_name: "Orques", team2_name: "Lynx" },
    ]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(2);
    // Chaque affiche garde sa réservation, un seul message part.
    expect(claimsOf(execute)).toEqual([
      [40, "1:2"],
      [41, "3:4"],
    ]);
    expect(pushLiveAnnouncement).toHaveBeenCalledTimes(1);
    expect(pushLiveAnnouncement).toHaveBeenCalledWith(
      "🔴 En direct — Coupe d'hiver :\n• Renards contre Nova\n• Orques contre Lynx",
      "https://twitch.tv/bluegenji",
      "live-announce tournoi-4 match-40,41",
    );
    expect(console.info).toHaveBeenCalledWith("[live-announce] matchs 40, 41 (tournoi 4) annoncés dans #live");
  });

  it("des liens différents, ou des tournois différents, font des messages différents", async () => {
    mockDb([
      AUTO_LIVE,
      { ...AUTO_LIVE, id: 41, live_url: "https://kick.com/autre", pairing: "3:4", launch_pairing: "3:4" },
      { ...AUTO_LIVE, id: 42, tournament_id: 5, pairing: "5:6", launch_pairing: "5:6" },
    ]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(3);
    expect(pushLiveAnnouncement).toHaveBeenCalledTimes(3);
  });

  it("réservation impossible à rendre : la trace pm2 nomme les matchs et ne promet pas d'essai", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("unavailable");
    const { execute } = mockDb([AUTO_LIVE]);
    execute.mockImplementation(async (sql) => {
      if (sql.startsWith("INSERT IGNORE")) return [{ affectedRows: 1 }];
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
    expect(jest.mocked(pushLiveAnnouncement).mock.calls[0][2]).toBe("live-announce tournoi-4 match-41");
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
    const match = /^live-announce tournoi-4 match-([\d,]+),…\+(\d+)$/.exec(context);
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
      { ...AUTO_LIVE, id: 42, tournament_id: 5, pairing: "5:6", launch_pairing: "5:6" },
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
    expect(warned).toHaveLength(3);
    for (const text of warned) expect(text).toContain("salon #live fermé au bot");
  });

  it("Discord muet en lisant le salon vaut pour tout le passage : les groupes suivants sont rendus sans appel", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("discord-unreachable");
    const { execute } = mockDb([AUTO_LIVE, { ...AUTO_LIVE, id: 57, tournament_id: 5, pairing: "5:6", launch_pairing: "5:6" }]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(pushLiveAnnouncement).toHaveBeenCalledTimes(1);
    expect(releasesOf(execute)).toEqual([
      [40, "1:2"],
      [57, "5:6"],
    ]);
  });

  it("un refus de Discord propre au message n'empêche pas les autres groupes de partir", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValueOnce("discord-held").mockResolvedValueOnce("posted");
    const { execute } = mockDb([AUTO_LIVE, { ...AUTO_LIVE, id: 57, tournament_id: 5, pairing: "5:6", launch_pairing: "5:6" }]);
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
    expect(text).toMatch(/^🔴 En direct : .+ contre .+ — Coupe d'hiver$/);
  });

  it("garde les seuls noms d'équipe pour un match d'équipes", async () => {
    mockDb([{ ...AUTO_LIVE, team1_pseudo: "NePasPublier", team2_pseudo: "NonPlus" }]);
    await runLiveAnnouncementSweep(NOW);
    expect(jest.mocked(pushLiveAnnouncement).mock.calls[0][0]).toBe("🔴 En direct : Renards contre Nova — Coupe d'hiver");
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
      const other = { ...held, id: 57, tournament_id: 5, pairing: "5:6", launch_pairing: "5:6" };
      jest.mocked(pushLiveAnnouncement).mockResolvedValueOnce("discord-held");
      const { query } = mockDb([held]);
      await dispatchLiveAnnouncements();
      // Dix secondes plus tard, un autre tournoi passe à l'antenne : rien ne le retient.
      jest.setSystemTime(NOW + 11_000);
      query.mockResolvedValue([[held, other]]);
      jest.mocked(pushLiveAnnouncement).mockResolvedValue("posted");
      expect(await dispatchLiveAnnouncements()).toBe(1);
      expect(jest.mocked(pushLiveAnnouncement).mock.calls.map(([, , context]) => context)).toEqual([
        "live-announce tournoi-4 match-40",
        "live-announce tournoi-5 match-57",
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
      expect(jest.mocked(pushLiveAnnouncement).mock.calls[1][2]).toBe("live-announce tournoi-4 match-40,44");
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
      const other = { ...held, id: 57, tournament_id: 5, pairing: "5:6", launch_pairing: "5:6" };
      query.mockResolvedValue([[held, other]]);
      jest.mocked(pushLiveAnnouncement).mockResolvedValue("posted");
      // La relève tombe à dix secondes du premier passage, pas à la fin de la pause.
      await jest.advanceTimersByTimeAsync(8_000);
      expect(jest.mocked(pushLiveAnnouncement).mock.calls.map(([, , context]) => context)).toEqual([
        "live-announce tournoi-4 match-40",
        "live-announce tournoi-5 match-57",
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
