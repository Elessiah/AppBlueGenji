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
import { pushRefereeAlert, sendBotLog } from "@/lib/server/bot-integration";
import { getDatabase } from "@/lib/server/database";

/** Une connexion ne sert ici que de clé : la file est indexée par identité. */
function fakeConnection(): PoolConnection {
  return {} as PoolConnection;
}

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

/**
 * Le contrat nominal de `pushRefereeAlert` est de rendre un bilan, pas
 * `undefined` : rendre `null` signifierait « bot injoignable » et ferait rendre
 * la réservation. Les tests qui éprouvent l'échec le remplacent.
 */
const DELIVERED = { sent: 1, unresolved: [], failed: [] };

beforeEach(() => {
  jest.clearAllMocks();
  (sendBotLog as jest.Mock).mockResolvedValue(undefined as never);
  (pushRefereeAlert as jest.Mock).mockResolvedValue(DELIVERED as never);
});

describe("routage vers deux transports", () => {
  // Conflit de score → alerte arbitre seulement, jamais journal.
  it("route score_conflict vers pushRefereeAlert, pas sendBotLog", async () => {
    const connection = fakeConnection();
    mockDb([[MATCH_ROW]]);

    queueBotLog(connection, { kind: "score_conflict", matchId: 31 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(pushRefereeAlert).toHaveBeenCalledTimes(1);
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  // Report expiré sans réponse → alerte arbitre seulement.
  it("route score_report_stalled vers pushRefereeAlert, pas sendBotLog", async () => {
    const connection = fakeConnection();
    mockDb([[MATCH_ROW]]);

    queueBotLog(connection, { kind: "score_report_stalled", matchId: 31, claimId: 77 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(pushRefereeAlert).toHaveBeenCalledTimes(1);
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  // Coup d'envoi → journal seulement, jamais alerte arbitre.
  it("route tournament_started vers sendBotLog, pas pushRefereeAlert", async () => {
    const connection = fakeConnection();
    mockDb([[TOURNAMENT_ROW]]);

    queueBotLog(connection, { kind: "tournament_started", tournamentId: 12 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendBotLog).toHaveBeenCalledTimes(1);
    expect(pushRefereeAlert).not.toHaveBeenCalled();
  });

  // Fin de match → journal seulement.
  it("route match_finished vers sendBotLog, pas pushRefereeAlert", async () => {
    const connection = fakeConnection();
    mockDb([[MATCH_ROW]]);

    queueBotLog(connection, { kind: "match_finished", matchId: 31 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendBotLog).toHaveBeenCalledTimes(1);
    expect(pushRefereeAlert).not.toHaveBeenCalled();
  });

  // File mixte : un évènement REFEREE, un évènement JOURNAL → chaque transport exactement une fois.
  it("appelle chaque transport exactement une fois sur une file mixte", async () => {
    const connection = fakeConnection();
    // Une requête par évènement : loadRefereeAlertContext pour score_conflict, loadMatch pour match_finished.
    mockDb([[MATCH_ROW], [MATCH_ROW]]);

    queueBotLog(connection, { kind: "score_conflict", matchId: 31 });
    queueBotLog(connection, { kind: "match_finished", matchId: 31 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(pushRefereeAlert).toHaveBeenCalledTimes(1);
    expect(sendBotLog).toHaveBeenCalledTimes(1);
  });

  // L'alerte arbitre est appelée avec le coupe-circuit activé.
  it("appelle pushRefereeAlert avec { honourCircuit: true }", async () => {
    const connection = fakeConnection();
    mockDb([[MATCH_ROW]]);

    queueBotLog(connection, { kind: "score_conflict", matchId: 31 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(pushRefereeAlert).toHaveBeenCalledWith(
      expect.any(String),
      "referee-alert",
      { honourCircuit: true },
    );
  });

  // Annulation de transaction : ni journal ni alerte arbitre ne partent.
  it("n'envoie rien quand la transaction est annulée", async () => {
    const connection = fakeConnection();
    mockDb([[MATCH_ROW]]);

    queueBotLog(connection, { kind: "score_conflict", matchId: 31 });
    discardBotLogs(connection);
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(pushRefereeAlert).not.toHaveBeenCalled();
    expect(sendBotLog).not.toHaveBeenCalled();
  });

  // Bot injoignable : flushBotLogs ne lève pas, même si pushRefereeAlert rejette.
  it("ne lève pas quand pushRefereeAlert rejette (bot injoignable)", async () => {
    const connection = fakeConnection();
    mockDb([[MATCH_ROW]]);
    (pushRefereeAlert as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED") as never);

    queueBotLog(connection, { kind: "score_conflict", matchId: 31 });
    expect(() => flushBotLogs(connection)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    expect(pushRefereeAlert).toHaveBeenCalled();
  });

  // Bot injoignable, second visage : `pushRefereeAlert` rend `null` plutôt que
  // de rejeter — c'est son contrat nominal. La ligne suivante de la file doit
  // partir quand même.
  it("poursuit la file quand pushRefereeAlert rend null (bot injoignable)", async () => {
    const connection = fakeConnection();
    mockDb([[MATCH_ROW], [TOURNAMENT_ROW]]);
    (pushRefereeAlert as jest.Mock).mockResolvedValue(null as never);

    queueBotLog(connection, { kind: "score_conflict", matchId: 31 });
    queueBotLog(connection, { kind: "tournament_started", tournamentId: 12 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(pushRefereeAlert).toHaveBeenCalledTimes(1);
    expect(sendBotLog).toHaveBeenCalledTimes(1);
  });

  // Rôle arbitre non configuré : le bot répond 200 avec `sent: 0` — il s'est
  // contenté du log de son côté. Rien de particulier à prévoir ici, et surtout
  // pas une erreur : l'alerte a bien été remise.
  it("traite un rôle arbitre non configuré comme un envoi réussi", async () => {
    const connection = fakeConnection();
    mockDb([[MATCH_ROW]]);
    (pushRefereeAlert as jest.Mock).mockResolvedValue({
      sent: 0,
      unresolved: [],
      failed: [],
    });

    queueBotLog(connection, { kind: "score_conflict", matchId: 31 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(pushRefereeAlert).toHaveBeenCalled();
  });
});

describe("réservation rendue quand l'alerte n'est pas remise", () => {
  /** Les requêtes d'écriture vues sur le pool, après le flush. */
  function writes(execute: jest.Mock): { sql: string; params: unknown[] }[] {
    return execute.mock.calls
      .map((call) => ({ sql: String(call[0]), params: (call[1] ?? []) as unknown[] }))
      .filter((call) => call.sql.trim().startsWith("DELETE"));
  }

  // Bot injoignable : la réservation posée en base doit être rendue, sinon la
  // manche reste bloquée et plus aucun balayage ne réessaiera.
  it("libère la réservation quand l'escalade n'est pas remise", async () => {
    const connection = fakeConnection();
    const execute = mockDb([[MATCH_ROW]]);
    (pushRefereeAlert as jest.Mock).mockResolvedValue(null as never);

    queueBotLog(connection, { kind: "score_report_stalled", matchId: 31, claimId: 77 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    const deletes = writes(execute);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].sql).toContain("bg_referee_alerts");
    expect(deletes[0].params).toEqual([77]);
  });

  // Même chose quand le transport rejette plutôt que de rendre `null`.
  it("libère aussi la réservation quand le transport rejette", async () => {
    const connection = fakeConnection();
    const execute = mockDb([[MATCH_ROW]]);
    (pushRefereeAlert as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED") as never);

    queueBotLog(connection, { kind: "score_report_stalled", matchId: 31, claimId: 77 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(writes(execute)).toHaveLength(1);
  });

  // Remise réussie : la réservation reste, c'est elle qui interdit le doublon.
  it("garde la réservation quand l'escalade est bien remise", async () => {
    const connection = fakeConnection();
    const execute = mockDb([[MATCH_ROW]]);
    (pushRefereeAlert as jest.Mock).mockResolvedValue({
      sent: 2,
      unresolved: [],
      failed: [],
    } as never);

    queueBotLog(connection, { kind: "score_report_stalled", matchId: 31, claimId: 77 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(writes(execute)).toHaveLength(0);
  });

  // Le conflit de score réserve lui aussi : sa réservation se rend de la même
  // façon, avec sa propre clé.
  it("libère la réservation d'un conflit non remis", async () => {
    const connection = fakeConnection();
    const execute = mockDb([[MATCH_ROW]]);
    (pushRefereeAlert as jest.Mock).mockResolvedValue(null as never);

    queueBotLog(connection, { kind: "score_conflict", matchId: 31, claimId: 88 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    const deletes = writes(execute);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].params).toEqual([88]);
  });

  // Une entrée qui ne se **résout** pas — ligne effacée entre-temps, engagé sans
  // nom, erreur MySQL passagère — n'atteint jamais le transport. Sa réservation
  // doit être rendue quand même, sans quoi elle serait consommée en silence.
  it("libère la réservation d'une entrée qui ne se résout pas", async () => {
    const connection = fakeConnection();
    // Aucune ligne : `loadMatch` ne trouve rien, l'entrée est ignorée.
    const execute = mockDb([[]]);

    queueBotLog(connection, { kind: "score_report_stalled", matchId: 31, claimId: 77 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(pushRefereeAlert).not.toHaveBeenCalled();
    const deletes = writes(execute);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].params).toEqual([77]);
  });

  // Une alerte mise en file sans réservation — le cas d'une entrée posée à la
  // main, hors de `queueRefereeAlert` — n'a pas d'identifiant à effacer.
  it("ne libère rien pour une alerte sans réservation", async () => {
    const connection = fakeConnection();
    const execute = mockDb([[MATCH_ROW]]);
    (pushRefereeAlert as jest.Mock).mockResolvedValue(null as never);

    queueBotLog(connection, { kind: "score_conflict", matchId: 31 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(writes(execute)).toHaveLength(0);
  });

  // Une ligne de journal ne réserve rien : il n'y a rien à rendre.
  it("ne libère rien pour un évènement de journal", async () => {
    const connection = fakeConnection();
    const execute = mockDb([[TOURNAMENT_ROW]]);
    (sendBotLog as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED") as never);

    queueBotLog(connection, { kind: "tournament_started", tournamentId: 12 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(writes(execute)).toHaveLength(0);
  });
});

describe("conflit et escalade dans la même transaction", () => {
  /**
   * Les deux évènements peuvent naître du même report tardif, et dans un ordre
   * ou dans l'autre selon le passage d'entretien qui les produit : la règle est
   * donc posée sur la file entière, une fois, au moment de l'envoi.
   */
  it("n'envoie pas l'escalade quand le conflit part dans la même file", async () => {
    const connection = fakeConnection();
    const execute = mockDb([[MATCH_ROW]]);

    queueBotLog(connection, { kind: "score_report_stalled", matchId: 31, claimId: 77 });
    queueBotLog(connection, { kind: "score_conflict", matchId: 31, claimId: 88 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    // Un seul message : celui du conflit.
    expect(pushRefereeAlert).toHaveBeenCalledTimes(1);
    expect((pushRefereeAlert as jest.Mock).mock.calls[0][0]).toContain("contradictoires");
    // Et l'escalade écartée rend sa réservation, pour repasser plus tard.
    const deletes = execute.mock.calls
      .map((call) => ({ sql: String(call[0]), params: (call[1] ?? []) as unknown[] }))
      .filter((call) => call.sql.trim().startsWith("DELETE"));
    expect(deletes).toHaveLength(1);
    expect(deletes[0].params).toEqual([77]);
  });

  // L'ordre inverse doit donner le même résultat.
  it("écarte l'escalade quel que soit l'ordre des deux évènements", async () => {
    const connection = fakeConnection();
    mockDb([[MATCH_ROW]]);

    queueBotLog(connection, { kind: "score_conflict", matchId: 31, claimId: 88 });
    queueBotLog(connection, { kind: "score_report_stalled", matchId: 31, claimId: 77 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(pushRefereeAlert).toHaveBeenCalledTimes(1);
  });

  // Une escalade sur **une autre** manche n'est pas écartée pour autant.
  it("n'écarte pas l'escalade d'une autre manche", async () => {
    const connection = fakeConnection();
    mockDb([[MATCH_ROW], [{ ...MATCH_ROW, id: 32 }]]);

    queueBotLog(connection, { kind: "score_conflict", matchId: 31, claimId: 88 });
    queueBotLog(connection, { kind: "score_report_stalled", matchId: 32, claimId: 77 });
    flushBotLogs(connection);
    await new Promise((resolve) => setImmediate(resolve));

    expect(pushRefereeAlert).toHaveBeenCalledTimes(2);
  });
});

describe("resolveBotLogs pour le routage", () => {
  // Les conflits de score sont classés comme alerte arbitre.
  it("assigne channel === 'REFEREE' aux conflits de score", async () => {
    mockDb([[MATCH_ROW]]);

    const logs = await resolveBotLogs([{ kind: "score_conflict", matchId: 31 }]);

    expect(logs).toHaveLength(1);
    expect(logs[0].channel).toBe("REFEREE");
    expect(logs[0].message).toContain("Arbitrage requis");
  });

  // Les rapports expirés sont des alertes arbitre.
  it("assigne channel === 'REFEREE' aux reports expirés", async () => {
    mockDb([[MATCH_ROW]]);

    const logs = await resolveBotLogs([{ kind: "score_report_stalled", matchId: 31 }]);

    expect(logs).toHaveLength(1);
    expect(logs[0].channel).toBe("REFEREE");
  });

  // Les coups d'envoi vont au journal.
  it("assigne channel === 'JOURNAL' aux coups d'envoi", async () => {
    mockDb([[TOURNAMENT_ROW]]);

    const logs = await resolveBotLogs([{ kind: "tournament_started", tournamentId: 12 }]);

    expect(logs).toHaveLength(1);
    expect(logs[0].channel).toBe("JOURNAL");
  });

  // Les fins de match vont au journal.
  it("assigne channel === 'JOURNAL' aux fins de match", async () => {
    mockDb([[MATCH_ROW]]);

    const logs = await resolveBotLogs([{ kind: "match_finished", matchId: 31 }]);

    expect(logs).toHaveLength(1);
    expect(logs[0].channel).toBe("JOURNAL");
  });
});
