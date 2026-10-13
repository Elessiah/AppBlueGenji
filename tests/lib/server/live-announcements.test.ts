import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration", () => ({
  isBotCircuitOpen: jest.fn(),
  pushLiveAnnouncement: jest.fn(),
}));

import { getDatabase } from "@/lib/server/database";
import { isBotCircuitOpen, pushLiveAnnouncement } from "@/lib/server/bot-integration";
import {
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
    if (sql.startsWith("DELETE FROM bg_live_announcements")) return [{ affectedRows: 1 }];
    throw new Error(`requête inattendue : ${sql}`);
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ query, execute }));
  return { query, execute };
}

function claimsOf(execute: Db["execute"]): unknown[] {
  return execute.mock.calls.filter(([sql]) => sql.startsWith("INSERT IGNORE")).map(([, params]) => params);
}

function releasesOf(execute: Db["execute"]): unknown[] {
  return execute.mock.calls.filter(([sql]) => sql.startsWith("DELETE")).map(([, params]) => params);
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

  it("rend la réservation quand rien n'est parti, pour réessayer au passage suivant", async () => {
    jest.mocked(pushLiveAnnouncement).mockResolvedValue("unavailable");
    const { execute } = mockDb([AUTO_LIVE]);
    expect(await runLiveAnnouncementSweep(NOW)).toBe(0);
    expect(releasesOf(execute)).toEqual([[40, "1:2"]]);
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
