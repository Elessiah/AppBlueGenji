import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration", () => ({
  isBotCircuitOpen: jest.fn(),
  pushLiveAnnouncement: jest.fn(),
}));

import { getDatabase } from "@/lib/server/database";
import { isBotCircuitOpen, pushLiveAnnouncement } from "@/lib/server/bot-integration";
import {
  LIVE_ANNOUNCE_MAX_AGE_MINUTES,
  dispatchLiveAnnouncements,
  liveAnnouncementsEnabled,
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
  jest.replaceProperty(process, "env", { ...process.env, NODE_ENV: "production" });
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
      "live-announce match-40",
    );
    expect(releasesOf(execute)).toEqual([]);
    // Trace pm2 : identifiants, aucun nom.
    expect(console.info).toHaveBeenCalledWith("[live-announce] match 40 (tournoi 4) annoncé dans #live");
  });

  it("écrit « un joueur » pour une entrée individuelle même si le type du tournoi est illisible", async () => {
    mockDb([{ ...AUTO_LIVE, participant_type: null, team1_name: "PseudoA", team2_name: "PseudoB", team1_solo_user_id: 7, team2_solo_user_id: 8 }]);
    await runLiveAnnouncementSweep(NOW);
    expect(jest.mocked(pushLiveAnnouncement).mock.calls[0][0]).toBe(
      "🔴 En direct : un joueur contre un joueur — Coupe d'hiver",
    );
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
    expect(sql).toContain("m.live_trigger = 'START_TIME' AND (m.start_at > NOW() - INTERVAL 120 MINUTE");
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

  it("Discord a retenu l'annonce : rend la réservation, sans accuser les permissions du bot", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("discord-held");
    const { execute } = mockDb([AUTO_LIVE]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(releasesOf(execute)).toEqual([[40, "1:2"]]);
    const warning = String(jest.mocked(console.warn).mock.calls[0][0]);
    expect(warning).toContain("Discord a retenu l'annonce");
    expect(warning).not.toContain("permission");
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

  it("délai dépassé : garde la réservation, pas de second @everyone si le bot a publié", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("uncertain");
    const { execute } = mockDb([AUTO_LIVE]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(releasesOf(execute)).toEqual([]);
    expect(String(jest.mocked(console.error).mock.calls[0][0])).toBe(
      "[live-announce] match 40 (tournoi 4) : bot sans réponse à temps, annonce peut-être publiée, non réessayée",
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
      "live-announce match-40,41",
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
    expect(jest.mocked(pushLiveAnnouncement).mock.calls[0][2]).toBe("live-announce match-41");
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
    const match = /^live-announce match-([\d,]+),…\+(\d+)$/.exec(context);
    expect(match).not.toBeNull();
    const shown = match![1].split(",");
    expect(shown.every((id, i) => id === String(10_000 + i))).toBe(true);
    expect(shown.length + Number(match![2])).toBe(60);
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

  it("ne réserve rien tant que le coupe-circuit du bot est ouvert", async () => {
    jest.mocked(isBotCircuitOpen).mockReturnValue(true);
    const { execute } = mockDb([AUTO_LIVE]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it("n'écrit jamais le pseudo d'un joueur en tournoi individuel", async () => {
    mockDb([{ ...AUTO_LIVE, participant_type: "SOLO", team1_name: "PseudoA", team2_name: "PseudoB" }]);
    await runLiveAnnouncementSweep(NOW);
    expect(jest.mocked(pushLiveAnnouncement).mock.calls[0][0]).toBe(
      "🔴 En direct : un joueur contre un joueur — Coupe d'hiver",
    );
  });
});

describe("dispatchLiveAnnouncements", () => {
  it("ne fait rien hors production : ni lecture, ni réservation", async () => {
    jest.replaceProperty(process, "env", { ...process.env, NODE_ENV: "development" });
    const { query } = mockDb([AUTO_LIVE]);
    expect(liveAnnouncementsEnabled()).toBe(false);
    expect(await dispatchLiveAnnouncements()).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("est étranglé : un second appel immédiat ne relit pas la base", async () => {
    const { query } = mockDb([]);
    await dispatchLiveAnnouncements();
    await dispatchLiveAnnouncements();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("n'échoue jamais : une panne de lecture rend 0", async () => {
    jest.mocked(getDatabase).mockRejectedValue(new Error("DB_DOWN"));
    await expect(dispatchLiveAnnouncements()).resolves.toBe(0);
  });
});
