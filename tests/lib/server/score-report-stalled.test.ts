import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/tournaments/scoring");
jest.mock("@/lib/server/tournaments/bot-logs");

import { resolveExpiredScoreReports } from "@/lib/server/tournaments/finalization";
import { finalizeMatch } from "@/lib/server/tournaments/scoring";
import {
  claimRefereeAlert,
  queueBotLog,
  releaseRefereeAlert,
} from "@/lib/server/tournaments/bot-logs";

type Queued = { kind: string } & Record<string, unknown>;

function queued(): Queued[] {
  return (queueBotLog as jest.Mock).mock.calls.map((call) => call[1] as Queued);
}

/** Connexion factice : `rows` répond aux SELECT, les écritures sont comptées. */
function fakeConnection(options: {
  rows?: (sql: string) => unknown[] | null;
  affectedRows?: number;
  /** Requêtes vues, pour vérifier ce que la transaction a réellement écrit. */
  seen?: string[];
}): PoolConnection {
  return {
    execute: async (sql: string) => {
      const q = sql.replace(/\s+/g, " ").trim();
      options.seen?.push(q);
      if (q.startsWith("UPDATE") || q.startsWith("INSERT") || q.startsWith("DELETE")) {
        return [{ affectedRows: options.affectedRows ?? 1, insertId: 1 }, []];
      }
      return [options.rows?.(q) ?? [], []];
    },
  } as unknown as PoolConnection;
}

/** Une manche au report expiré, dont on ne décrit que ce qui varie. */
function expiredRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 40,
    tournament_id: 12,
    team1_id: 101,
    team2_id: 102,
    team1_report_score: 2,
    team1_report_opponent_score: 1,
    team2_report_score: 3,
    team2_report_opponent_score: 2,
    conflict_stalled: 1,
    next_winner_match_id: null,
    next_winner_slot: null,
    next_loser_match_id: null,
    next_loser_slot: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // `queueBotLog` rend un booléen : « l'évènement est-il retenu ? ». Le défaut
  // est le cas nominal ; les tests qui éprouvent le plafond le remplacent.
  (queueBotLog as jest.Mock).mockReturnValue(true);
});

describe("resolveExpiredScoreReports", () => {
  // Un seul report : le silence de l'adversaire vaut accord, le moteur
  // tranche seul. Rien à arbitrer, donc aucune alerte.
  it("résout un report expiré quand seul team1 a saisi le score", async () => {
    const connection = fakeConnection({
      rows: (q) => {
        if (q.includes("FROM bg_matches")) {
          return [
            {
              id: 31,
              tournament_id: 12,
              team1_id: 101,
              team2_id: 102,
              team1_report_score: 2,
              team1_report_opponent_score: 1,
              team2_report_score: null,
              team2_report_opponent_score: null,
              next_winner_match_id: null,
              next_winner_slot: null,
              next_loser_match_id: null,
              next_loser_slot: null,
            },
          ];
        }
        return [];
      },
    });

    await resolveExpiredScoreReports(connection, 12);

    // finalizeMatch est appelé avec le report de team1
    expect(finalizeMatch).toHaveBeenCalledWith(
      connection,
      12,
      expect.objectContaining({
        id: 31,
        team1_id: 101,
        team2_id: 102,
      }),
      expect.objectContaining({
        team1Score: 2,
        team2Score: 1,
        winnerTeamId: 101,
      }),
    );

    // Aucune alerte n'est réservée
    expect(claimRefereeAlert).not.toHaveBeenCalled();
    expect(queueBotLog).not.toHaveBeenCalled();
  });

  // Symétrique, côté team2 : la règle ne dépend pas de qui a parlé.
  it("résout un report expiré quand seul team2 a saisi le score", async () => {
    const connection = fakeConnection({
      rows: (q) => {
        if (q.includes("FROM bg_matches")) {
          return [
            {
              id: 32,
              tournament_id: 12,
              team1_id: 101,
              team2_id: 102,
              team1_report_score: null,
              team1_report_opponent_score: null,
              team2_report_score: 3,
              team2_report_opponent_score: 2,
              next_winner_match_id: null,
              next_winner_slot: null,
              next_loser_match_id: null,
              next_loser_slot: null,
            },
          ];
        }
        return [];
      },
    });

    await resolveExpiredScoreReports(connection, 12);

    // finalizeMatch est appelé avec le report de team2
    expect(finalizeMatch).toHaveBeenCalledWith(
      connection,
      12,
      expect.objectContaining({
        id: 32,
        team1_id: 101,
        team2_id: 102,
      }),
      expect.objectContaining({
        team1Score: 2,
        team2Score: 3,
        winnerTeamId: 102,
      }),
    );

    // Aucune alerte n'est réservée
    expect(claimRefereeAlert).not.toHaveBeenCalled();
    expect(queueBotLog).not.toHaveBeenCalled();
  });

  // Les deux ont reporté et se contredisent : le délai ne débloque rien —
  // départager deux affirmations opposées est une décision, pas une règle.
  it("alerte l'arbitre quand les deux équipes ont reporté des scores contradictoires", async () => {
    const connection = fakeConnection({
      rows: (q) => {
        if (q.includes("FROM bg_matches")) {
          return [
            {
              id: 33,
              tournament_id: 12,
              team1_id: 101,
              team2_id: 102,
              team1_report_score: 2,
              team1_report_opponent_score: 1,
              team2_report_score: 3,
              team2_report_opponent_score: 2,
              conflict_stalled: 1,
              next_winner_match_id: null,
              next_winner_slot: null,
              next_loser_match_id: null,
              next_loser_slot: null,
            },
          ];
        }
        return [];
      },
    });

    (claimRefereeAlert as jest.Mock).mockResolvedValue(true);

    await resolveExpiredScoreReports(connection, 12);

    // finalizeMatch n'est PAS appelé
    expect(finalizeMatch).not.toHaveBeenCalled();

    // claimRefereeAlert est appelé avec les bons paramètres
    expect(claimRefereeAlert).toHaveBeenCalledWith(connection, 33, "SCORE_REPORT_STALLED");

    // L'alerte est réservée au bot
    expect(queued()).toEqual([{ kind: "score_report_stalled", matchId: 33 }]);
  });

  // L'entretien repasse à chaque lecture de la page : sans la réservation,
  // l'arbitre recevrait la même alerte toutes les quelques secondes.
  it("n'envoie pas d'alerte si la réservation est déjà prise", async () => {
    const connection = fakeConnection({
      rows: (q) => {
        if (q.includes("FROM bg_matches")) {
          return [
            {
              id: 34,
              tournament_id: 12,
              team1_id: 101,
              team2_id: 102,
              team1_report_score: 2,
              team1_report_opponent_score: 1,
              team2_report_score: 2,
              team2_report_opponent_score: 1,
              conflict_stalled: 1,
              next_winner_match_id: null,
              next_winner_slot: null,
              next_loser_match_id: null,
              next_loser_slot: null,
            },
          ];
        }
        return [];
      },
    });

    // claimRefereeAlert retourne false = réservation déjà prise
    (claimRefereeAlert as jest.Mock).mockResolvedValue(false);

    await resolveExpiredScoreReports(connection, 12);

    // claimRefereeAlert est appelé
    expect(claimRefereeAlert).toHaveBeenCalledWith(connection, 34, "SCORE_REPORT_STALLED");

    // Mais queueBotLog n'est PAS appelé
    expect(queueBotLog).not.toHaveBeenCalled();
  });

  // Une case vide n'est pas un adversaire : rien à trancher, rien à nommer.
  it("ignore une manche où un adversaire manque", async () => {
    const connection = fakeConnection({
      rows: (q) => {
        if (q.includes("FROM bg_matches")) {
          return [
            {
              id: 35,
              tournament_id: 12,
              team1_id: null, // Adversaire manquant
              team2_id: 102,
              team1_report_score: null,
              team1_report_opponent_score: null,
              team2_report_score: 2,
              team2_report_opponent_score: 1,
              next_winner_match_id: null,
              next_winner_slot: null,
              next_loser_match_id: null,
              next_loser_slot: null,
            },
          ];
        }
        return [];
      },
    });

    await resolveExpiredScoreReports(connection, 12);

    // Aucun appel du tout
    expect(finalizeMatch).not.toHaveBeenCalled();
    expect(claimRefereeAlert).not.toHaveBeenCalled();
    expect(queueBotLog).not.toHaveBeenCalled();
  });

  // Le cas nominal, de loin le plus fréquent : rien n'a expiré.
  it("n'effectue aucune action quand il n'y a pas de report expiré", async () => {
    const connection = fakeConnection({
      rows: (q) => {
        if (q.includes("FROM bg_matches")) {
          return []; // Aucune ligne
        }
        return [];
      },
    });

    await resolveExpiredScoreReports(connection, 12);

    // Aucun appel du tout
    expect(finalizeMatch).not.toHaveBeenCalled();
    expect(claimRefereeAlert).not.toHaveBeenCalled();
    expect(queueBotLog).not.toHaveBeenCalled();
  });

  // Un désaccord qui vient de naître est déjà annoncé par l'alerte de conflit,
  // souvent dans cette transaction même : l'escalader dans la seconde ferait
  // deux messages pour un blocage d'une seconde, dont un qui ment sur la durée.
  it("n'escalade pas un désaccord plus jeune que le délai", async () => {
    const connection = fakeConnection({
      rows: (q) => (q.includes("FROM bg_matches") ? [expiredRow({ conflict_stalled: 0 })] : []),
    });

    await resolveExpiredScoreReports(connection, 12);

    expect(finalizeMatch).not.toHaveBeenCalled();
    expect(claimRefereeAlert).not.toHaveBeenCalled();
    expect(queueBotLog).not.toHaveBeenCalled();
  });

  // La file est plafonnée : un balayage chargé peut abandonner l'entrée. La
  // réservation serait alors consommée sans qu'aucune alerte ne parte, et aucun
  // passage ultérieur ne réessaierait — elle doit être rendue.
  it("rend la réservation quand la file de journal refuse l'entrée", async () => {
    const seen: string[] = [];
    const connection = fakeConnection({
      seen,
      rows: (q) => (q.includes("FROM bg_matches") ? [expiredRow({ id: 41 })] : []),
    });

    (claimRefereeAlert as jest.Mock).mockResolvedValue(true);
    (queueBotLog as jest.Mock).mockReturnValue(false);

    await resolveExpiredScoreReports(connection, 12);

    expect(releaseRefereeAlert).toHaveBeenCalledWith(connection, 41, "SCORE_REPORT_STALLED");
  });

  // Le chemin nominal ne rend jamais la réservation.
  it("garde la réservation quand l'entrée est bien mise en file", async () => {
    const connection = fakeConnection({
      rows: (q) => (q.includes("FROM bg_matches") ? [expiredRow({ id: 42 })] : []),
    });

    (claimRefereeAlert as jest.Mock).mockResolvedValue(true);
    (queueBotLog as jest.Mock).mockReturnValue(true);

    await resolveExpiredScoreReports(connection, 12);

    expect(releaseRefereeAlert).not.toHaveBeenCalled();
  });

  // Même garde, de l'autre côté de l'affiche.
  it("ignore une manche où team2_id est null", async () => {
    const connection = fakeConnection({
      rows: (q) => {
        if (q.includes("FROM bg_matches")) {
          return [
            {
              id: 36,
              tournament_id: 12,
              team1_id: 101,
              team2_id: null, // Adversaire manquant
              team1_report_score: 2,
              team1_report_opponent_score: 1,
              team2_report_score: null,
              team2_report_opponent_score: null,
              next_winner_match_id: null,
              next_winner_slot: null,
              next_loser_match_id: null,
              next_loser_slot: null,
            },
          ];
        }
        return [];
      },
    });

    await resolveExpiredScoreReports(connection, 12);

    // Aucun appel du tout
    expect(finalizeMatch).not.toHaveBeenCalled();
    expect(claimRefereeAlert).not.toHaveBeenCalled();
    expect(queueBotLog).not.toHaveBeenCalled();
  });
});
