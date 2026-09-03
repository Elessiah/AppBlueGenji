import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/bot-integration");

import type { PoolConnection } from "mysql2/promise";
import {
  discardBotLogs,
  flushBotLogs,
  queueBotLog,
  resolveBotLogs,
} from "@/lib/server/tournaments/bot-logs";
import { sendBotLog } from "@/lib/server/bot-integration";
import { getDatabase } from "@/lib/server/database";

/** Une connexion ne sert ici que de clé : la file est indexée par identité. */
function fakeConnection(): PoolConnection {
  return {} as PoolConnection;
}

const TOURNAMENT_ROW = {
  id: 12,
  name: "Coupe BlueGenji",
  format: "SWISS",
  game: "OW2",
  max_teams: 16,
  participant_type: "TEAM",
  start_at: new Date("2026-03-14T18:00:00.000Z"),
  organizer_pseudo: "Kiro",
  registered_teams: 3,
  champion_name: null,
};

const MATCH_ROW = {
  id: 31,
  bracket: "UPPER",
  round_number: 2,
  team1_score: 2,
  team2_score: 1,
  forfeit_team_id: null,
  is_bye: 0,
  team1_name: "Les Renards",
  team2_name: "Team Nova",
  tournament_id: 12,
  tournament_name: "Coupe BlueGenji",
};

/**
 * Câble la base : chaque requête rend la première ligne restante.
 * L'ordre suffit — les résolutions sont séquentielles, une entrée à la fois.
 */
function mockDb(rows: unknown[][]): jest.Mock {
  const execute = jest.fn<() => Promise<unknown>>();
  for (const result of rows) execute.mockResolvedValueOnce([result]);
  execute.mockResolvedValue([[]]);
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
  return execute as unknown as jest.Mock;
}

beforeEach(() => {
  jest.clearAllMocks();
  (sendBotLog as jest.Mock).mockResolvedValue(undefined as never);
});

describe("file par transaction", () => {
  it("n'envoie rien tant que la transaction n'a pas abouti", async () => {
    const connection = fakeConnection();
    mockDb([[TOURNAMENT_ROW]]);

    queueBotLog(connection, { kind: "tournament_started", tournamentId: 12 });
    await Promise.resolve();

    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("jette les lignes d'une transaction annulée", async () => {
    const connection = fakeConnection();
    mockDb([[TOURNAMENT_ROW]]);

    queueBotLog(connection, { kind: "tournament_started", tournamentId: 12 });
    discardBotLogs(connection);
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("envoie les lignes réservées une fois la transaction validée", async () => {
    const connection = fakeConnection();
    mockDb([[TOURNAMENT_ROW]]);

    queueBotLog(connection, { kind: "tournament_started", tournamentId: 12 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendBotLog).toHaveBeenCalledTimes(1);
    expect((sendBotLog as jest.Mock).mock.calls[0][0]).toContain("Coup d'envoi");
  });

  it("ne vide la file qu'une fois : deux flushs ne dupliquent pas la ligne", async () => {
    const connection = fakeConnection();
    mockDb([[TOURNAMENT_ROW]]);

    queueBotLog(connection, { kind: "tournament_started", tournamentId: 12 });
    flushBotLogs(connection);
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendBotLog).toHaveBeenCalledTimes(1);
  });

  it("ne retient qu'une fois un évènement réservé deux fois dans la même transaction", async () => {
    const connection = fakeConnection();
    mockDb([[TOURNAMENT_ROW]]);

    queueBotLog(connection, { kind: "tournament_finished", tournamentId: 12 });
    queueBotLog(connection, { kind: "tournament_finished", tournamentId: 12 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendBotLog).toHaveBeenCalledTimes(1);
  });

  it("sépare les files de deux transactions concurrentes", async () => {
    const first = fakeConnection();
    const second = fakeConnection();
    mockDb([[TOURNAMENT_ROW]]);

    queueBotLog(first, { kind: "tournament_started", tournamentId: 12 });
    flushBotLogs(second);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendBotLog).not.toHaveBeenCalled();
  });

  it("plafonne la file, pour qu'un rejeu massif ne la fasse pas enfler", () => {
    const connection = fakeConnection();

    for (let matchId = 1; matchId <= 200; matchId += 1) {
      queueBotLog(connection, { kind: "match_finished", matchId });
    }

    mockDb([]);
    flushBotLogs(connection);
    // La file est plafonnée à 32 entrées : au-delà, rien n'est retenu.
    expect(sendBotLog.mock.calls.length).toBeLessThanOrEqual(32);
  });

  it("n'échoue jamais quand le bot est injoignable", async () => {
    const connection = fakeConnection();
    mockDb([[TOURNAMENT_ROW]]);
    (sendBotLog as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED") as never);

    queueBotLog(connection, { kind: "tournament_started", tournamentId: 12 });
    expect(() => flushBotLogs(connection)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe("resolveBotLogs", () => {
  it("relit les noms après coup, plutôt que de les faire porter au moteur", async () => {
    const execute = mockDb([[{ ...TOURNAMENT_ROW, champion_name: "Les Renards" }]]);

    const [entry] = await resolveBotLogs([{ kind: "tournament_finished", tournamentId: 12 }]);

    expect(entry.message).toContain("Les Renards l'emporte");
    // Le renvoi ne portait que l'identifiant : tout le reste vient de la base.
    expect(execute.mock.calls[0][1]).toEqual([12]);
  });

  it("décrit une inscription avec l'effectif atteint", async () => {
    mockDb([[TOURNAMENT_ROW], [{ name: "Les Renards" }]]);

    const [entry] = await resolveBotLogs([
      { kind: "registration", tournamentId: 12, teamId: 101, byStaff: false },
    ]);

    expect(entry.message).toContain("Les Renards");
    expect(entry.message).toContain("3/16 équipes");
  });

  it("décrit un match tranché avec son score", async () => {
    mockDb([[MATCH_ROW]]);

    const [entry] = await resolveBotLogs([{ kind: "match_finished", matchId: 31 }]);

    expect(entry.message).toContain("Les Renards 2–1 Team Nova");
  });

  it("ignore les byes, dont le score est posé par le moteur", async () => {
    mockDb([[{ ...MATCH_ROW, is_bye: 1 }]]);

    const messages = await resolveBotLogs([{ kind: "match_finished", matchId: 31 }]);

    expect(messages).toEqual([]);
  });

  it("décrit un forfait arbitré, qui ne porte aucun score", async () => {
    mockDb([[{ ...MATCH_ROW, team1_score: null, team2_score: null, forfeit_team_id: 102 }]]);

    const [entry] = await resolveBotLogs([{ kind: "match_finished", matchId: 31 }]);

    expect(entry.message).toContain("Les Renards vs Team Nova");
    expect(entry.message).toContain("(forfait)");
  });

  it("ignore un match sans score enregistré", async () => {
    mockDb([[{ ...MATCH_ROW, team1_score: null, team2_score: null }]]);

    const messages = await resolveBotLogs([{ kind: "match_finished", matchId: 31 }]);

    expect(messages).toEqual([]);
  });

  it("ignore un match dont un engagé manque", async () => {
    mockDb([[{ ...MATCH_ROW, team2_name: null }]]);

    const messages = await resolveBotLogs([{ kind: "match_finished", matchId: 31 }]);

    expect(messages).toEqual([]);
  });

  it("ignore une entrée dont la ligne a disparu entre-temps", async () => {
    mockDb([[]]);

    const messages = await resolveBotLogs([{ kind: "tournament_started", tournamentId: 12 }]);

    expect(messages).toEqual([]);
  });

  it("perd la ligne fautive, pas les suivantes", async () => {
    const execute = jest.fn<() => Promise<unknown>>();
    execute.mockRejectedValueOnce(new Error("ER_LOCK_WAIT_TIMEOUT") as never);
    execute.mockResolvedValueOnce([[TOURNAMENT_ROW]]);
    (getDatabase as jest.Mock).mockResolvedValue({ execute });

    const messages = await resolveBotLogs([
      { kind: "tournament_started", tournamentId: 12 },
      { kind: "tournament_started", tournamentId: 13 },
    ]);

    expect(messages).toHaveLength(1);
  });

  it("nomme un organisateur inconnu plutôt que d'écrire « null »", async () => {
    mockDb([[{ ...TOURNAMENT_ROW, organizer_pseudo: null }]]);

    const [entry] = await resolveBotLogs([{ kind: "tournament_created", tournamentId: 12 }]);

    expect(entry.message).toContain("créé par le staff");
    expect(entry.message).not.toContain("null");
  });

  it("retombe sur le vocabulaire d'équipe quand le type de participant est douteux", async () => {
    mockDb([[{ ...TOURNAMENT_ROW, participant_type: null }], [{ name: "Les Renards" }]]);

    const [entry] = await resolveBotLogs([
      { kind: "registration", tournamentId: 12, teamId: 101, byStaff: true },
    ]);

    expect(entry.message).toContain("3/16 équipes");
    expect(entry.message).toContain("(ajout du staff)");
  });
});
