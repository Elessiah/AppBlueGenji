import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/tournaments/scoring");
jest.mock("@/lib/server/tournaments/bot-logs");
jest.mock("@/lib/server/tournaments/match-maps");
jest.mock("@/lib/server/tournaments/auto-validated-notices");

import { resolveExpiredScoreReports } from "@/lib/server/tournaments/finalization";
import { finalizeMatch } from "@/lib/server/tournaments/scoring";
import { queueBotLog, queueRefereeAlert } from "@/lib/server/tournaments/bot-logs";
import { promoteReportedMaps } from "@/lib/server/tournaments/match-maps";
import { queueAutoValidatedNotice } from "@/lib/server/tournaments/auto-validated-notices";
import {
  ACTIONABLE_EXPIRED_REPORT_SQL,
  AUTO_VALIDATION_PAUSED_SQL,
  AUTO_VALIDATION_RUNNING_SQL,
  SINGLE_REPORT_SQL,
  STALLED_ALERT_KEY,
} from "@/lib/server/tournaments/score-report-sql";

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
  jest.mocked(queueBotLog).mockReturnValue(true);
  // `queueRefereeAlert` réserve puis met en file, et rend « l'alerte partira-t-elle ? ».
  jest.mocked(queueRefereeAlert).mockResolvedValue(true);
});

describe("resolveExpiredScoreReports", () => {
  // Un seul report : le silence de l'adversaire vaut accord, le moteur
  // tranche seul. Rien à arbitrer, donc aucune alerte.
  // Validation d'office (`SCORE_DISPUTE_LOCK.md`) : un seul `UPDATE`
  // conditionnel tranche, son `affectedRows` dit qui l'a fait.
  it("ne clôt pas une manche que l'UPDATE conditionnel n'a pas réclamée (balayage concurrent, confirmation tardive)", async () => {
    const seen: string[] = [];
    const connection = fakeConnection({
      seen,
      affectedRows: 0,
      rows: (q) =>
        q.includes("FROM bg_matches")
          ? [expiredRow({ id: 31, team2_report_score: null, team2_report_opponent_score: null })]
          : [],
    });

    expect(await resolveExpiredScoreReports(connection, 12)).toBe(0);

    expect(seen.filter((q) => q.startsWith("UPDATE bg_matches"))).toHaveLength(1);
    expect(promoteReportedMaps).not.toHaveBeenCalled();
    expect(finalizeMatch).not.toHaveBeenCalled();
    expect(queueAutoValidatedNotice).not.toHaveBeenCalled();
  });

  it("réclame la manche en une instruction : même saisie, adversaire muet, échéance passée", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const connection = {
      execute: async (sql: string, params: unknown[] = []) => {
        const q = sql.replace(/\s+/g, " ").trim();
        calls.push({ sql: q, params });
        if (q.startsWith("UPDATE")) return [{ affectedRows: 1 }, []];
        if (q.includes("FROM bg_matches")) {
          return [[expiredRow({
            id: 31,
            team1_reported_at: "2026-10-20 20:00:00",
            team2_report_score: null,
            team2_report_opponent_score: null,
            team2_reported_at: null,
          })], []];
        }
        return [[], []];
      },
    } as unknown as PoolConnection;

    expect(await resolveExpiredScoreReports(connection, 12)).toBe(1);

    const claim = calls.find((c) => c.sql.startsWith("UPDATE bg_matches"));
    expect(claim?.sql).toContain("status = 'COMPLETED'");
    // Un forfait noté par l'arbitre (« Enregistrer ») ne survit pas au score retenu :
    // sinon la ligne close porterait le score du déclarant et un drapeau de forfait.
    expect(claim?.sql).toContain("forfeit_team_id = NULL");
    expect(claim?.sql).toContain("AND status = 'AWAITING_CONFIRMATION'");
    expect(claim?.sql).toContain("AND score_deadline_at <= NOW()");
    expect(claim?.sql).toContain("AND team1_reported_at <=> ?");
    expect(claim?.sql).toContain("AND team1_report_score <=> ?");
    expect(claim?.sql).toContain("AND team2_report_score IS NULL");
    expect(claim?.sql).toContain("AND team2_reported_at IS NULL");
    // Suspendue par un « Enregistrer » d'arbitrage : la même instruction relit
    // la suspension, si bien que l'arbitre qui enregistre pendant le balayage
    // gagne la course ou la perd — jamais le score du déclarant ne l'écrase.
    expect(claim?.sql).toContain("AND score_validation_paused_at IS NULL");
    // Pas de jointure ni de verrou sur deux tables (MariaDB).
    expect(claim?.sql).not.toMatch(/JOIN|FOR UPDATE/);
    expect(claim?.params).toEqual([2, 1, 101, 102, 31, "2026-10-20 20:00:00", 2, 1]);
    // Aucune autre lecture verrouillante de la ligne : l'instruction suffit.
    expect(calls.some((c) => c.sql.startsWith("SELECT status,"))).toBe(false);
    // Même suite qu'une confirmation, le résultat déjà écrit.
    expect(finalizeMatch).toHaveBeenCalledWith(
      connection,
      12,
      expect.objectContaining({ id: 31 }),
      { team1Score: 2, team2Score: 1, winnerTeamId: 101, loserTeamId: 102 },
      { resultWritten: true },
    );
    expect(queueAutoValidatedNotice).toHaveBeenCalledWith(connection, 31, { team1Score: 2, team2Score: 1 });
  });

  it("est idempotente : un second passage ne réclame plus rien", async () => {
    let claimed = false;
    const connection = {
      execute: async (sql: string) => {
        const q = sql.replace(/\s+/g, " ").trim();
        if (q.startsWith("UPDATE")) {
          const first = !claimed;
          claimed = true;
          return [{ affectedRows: first ? 1 : 0 }, []];
        }
        if (q.includes("FROM bg_matches")) {
          return [[expiredRow({ id: 31, team2_report_score: null, team2_report_opponent_score: null })], []];
        }
        return [[], []];
      },
    } as unknown as PoolConnection;

    expect(await resolveExpiredScoreReports(connection, 12)).toBe(1);
    expect(await resolveExpiredScoreReports(connection, 12)).toBe(0);
    expect(finalizeMatch).toHaveBeenCalledTimes(1);
    expect(queueAutoValidatedNotice).toHaveBeenCalledTimes(1);
  });

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
      { resultWritten: true },
    );

    expect(promoteReportedMaps).toHaveBeenCalledWith(connection, expect.any(Number), "TEAM1");
    // Aucune alerte n'est réservée
    expect(queueRefereeAlert).not.toHaveBeenCalled();
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
      { resultWritten: true },
    );

    // Le détail map par map du report qui fait foi devient le résultat retenu.
    expect(promoteReportedMaps).toHaveBeenCalledWith(connection, 32, "TEAM2");
    // Aucune alerte n'est réservée
    expect(queueRefereeAlert).not.toHaveBeenCalled();
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

    await resolveExpiredScoreReports(connection, 12);

    // finalizeMatch n'est PAS appelé : rien ici n'est tranchable par une règle.
    expect(finalizeMatch).not.toHaveBeenCalled();

    // L'alerte passe par le chemin réservé, qui pose la marque en base.
    expect(queueRefereeAlert).toHaveBeenCalledWith(connection, {
      kind: "score_report_stalled",
      matchId: 33,
    });
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

    // La marque est déjà posée : le chemin réservé le dit en rendant `false`,
    // et rien d'autre ne doit se produire — l'alerte est déjà partie.
    jest.mocked(queueRefereeAlert).mockResolvedValue(false);

    await resolveExpiredScoreReports(connection, 12);

    expect(queueRefereeAlert).toHaveBeenCalledWith(connection, {
      kind: "score_report_stalled",
      matchId: 34,
    });
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
    expect(queueRefereeAlert).not.toHaveBeenCalled();
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
    expect(queueRefereeAlert).not.toHaveBeenCalled();
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
    expect(queueRefereeAlert).not.toHaveBeenCalled();
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
    expect(queueRefereeAlert).not.toHaveBeenCalled();
  });
});

/**
 * Le compte rendu de la fonction — et non `void`.
 *
 * C'est la seule information qui distingue un balayage sans effet d'un balayage
 * qui vient d'écrire un résultat. `syncTournamentState` s'en sert pour rappeler
 * le moteur du format : les modes à classement et le multi-phases ne posent leur
 * manche suivante qu'en réconciliant, et une manche close par le délai ne
 * traverse aucun de leurs chemins d'entrée.
 */
describe("resolveExpiredScoreReports — ce qu'elle rapporte", () => {
  function oneSidedRow(id: number): Record<string, unknown> {
    return expiredRow({
      id,
      team1_report_score: 2,
      team1_report_opponent_score: 1,
      team2_report_score: null,
      team2_report_opponent_score: null,
    });
  }

  it("compte les manches réellement closes", async () => {
    const connection = fakeConnection({
      rows: (q) => (q.includes("FROM bg_matches") ? [oneSidedRow(31), oneSidedRow(32)] : []),
    });

    expect(await resolveExpiredScoreReports(connection, 12)).toBe(2);
  });

  it("rend zéro quand aucun délai n'a expiré", async () => {
    const connection = fakeConnection({ rows: () => [] });

    expect(await resolveExpiredScoreReports(connection, 12)).toBe(0);
  });

  it("ne compte pas un désaccord : il est escaladé, pas tranché", async () => {
    // Les deux engagés se contredisent — le délai ne débloque rien, l'arbitrage
    // prend la main. Le compter reviendrait à réconcilier pour rien à chaque
    // balayage, sur un tournoi qui n'a pas bougé.
    const connection = fakeConnection({
      rows: (q) => (q.includes("FROM bg_matches") ? [expiredRow({ id: 33 })] : []),
    });

    expect(await resolveExpiredScoreReports(connection, 12)).toBe(0);
    expect(queueRefereeAlert).toHaveBeenCalled();
  });

  it("ne compte pas une manche sans adversaire", async () => {
    const connection = fakeConnection({
      rows: (q) =>
        q.includes("FROM bg_matches") ? [expiredRow({ id: 34, team2_id: null })] : [],
    });

    expect(await resolveExpiredScoreReports(connection, 12)).toBe(0);
  });
  it("lit le format une fois par ronde, pas une fois par match expiré", async () => {
    const seen: string[] = [];
    const single = { team2_report_score: null, team2_report_opponent_score: null, team2_reported_at: null };
    const connection = fakeConnection({
      seen,
      rows: (q) =>
        q.includes("FROM bg_matches")
          ? [
              expiredRow({ id: 31, round_number: 1, ...single }),
              expiredRow({ id: 32, round_number: 1, ...single }),
              expiredRow({ id: 33, round_number: 2, ...single }),
            ]
          : [],
    });

    expect(await resolveExpiredScoreReports(connection, 12)).toBe(3);

    expect(seen.filter((q) => q.includes("FROM bg_tournaments"))).toHaveLength(2);
    expect(queueAutoValidatedNotice).toHaveBeenCalledTimes(3);
  });
  // Un litige déjà escaladé attend un arbitre : la sélection ne le relit plus à
  // chaque écriture d'un joueur du tournoi, ni sa réservation d'alerte.
  it("ne sélectionne que les reports que la résolution peut faire avancer", async () => {
    const seen: string[] = [];
    await resolveExpiredScoreReports(fakeConnection({ seen, rows: () => [] }), 12);

    const select = seen.find((q) => q.startsWith("SELECT") && q.includes("FROM bg_matches m"));
    expect(select).toContain(ACTIONABLE_EXPIRED_REPORT_SQL.replace(/\s+/g, " "));
    expect(select).toContain(`a.alert_key = '${STALLED_ALERT_KEY}'`);
  });
});

/** Suspension par l'arbitrage (`SCORE_DISPUTE_LOCK.md` § Arbitre et report seul). */
describe("validation d'office suspendue par l'arbitrage", () => {
  it("la sélection n'en retient plus le report seul, mais garde l'escalade des litiges", () => {
    const sql = ACTIONABLE_EXPIRED_REPORT_SQL.replace(/\s+/g, " ");
    expect(sql).toContain(`(${SINGLE_REPORT_SQL} AND ${AUTO_VALIDATION_RUNNING_SQL})`);
    expect(AUTO_VALIDATION_RUNNING_SQL).toBe("m.score_validation_paused_at IS NULL");
    // La branche du litige ne lit pas la suspension.
    expect(sql.slice(sql.indexOf(" OR ("))).not.toContain("score_validation_paused_at");
  });

  it("l'écran ne la dit suspendue que sur un report seul en attente", () => {
    const sql = AUTO_VALIDATION_PAUSED_SQL.replace(/\s+/g, " ");
    expect(sql).toContain("m.status = 'AWAITING_CONFIRMATION'");
    expect(sql).toContain("m.score_validation_paused_at IS NOT NULL");
    expect(sql).toContain(SINGLE_REPORT_SQL);
  });

  it("course perdue : l'arbitre a suspendu entre la lecture et la réclamation, rien n'est clos", async () => {
    const seen: string[] = [];
    // La lecture (sans verrou) voyait encore le report actionnable ; la
    // réclamation, qui relit la suspension, ne touche plus aucune ligne.
    const connection = fakeConnection({
      seen,
      affectedRows: 0,
      rows: (q) =>
        q.includes("FROM bg_matches")
          ? [expiredRow({ id: 31, team2_report_score: null, team2_report_opponent_score: null })]
          : [],
    });

    expect(await resolveExpiredScoreReports(connection, 12)).toBe(0);
    const claim = seen.find((q) => q.startsWith("UPDATE bg_matches"));
    expect(claim).toContain("AND score_validation_paused_at IS NULL");
    expect(finalizeMatch).not.toHaveBeenCalled();
    expect(queueAutoValidatedNotice).not.toHaveBeenCalled();
  });
});
