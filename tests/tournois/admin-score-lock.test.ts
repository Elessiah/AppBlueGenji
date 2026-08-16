import { describe, expect, it } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";
import { checkDownstreamMatchesHaveNoScores } from "@/lib/server/tournaments/admin";
import type { MatchRow } from "@/lib/server/tournaments/_internal";
import { scoreFormStateFor } from "@/app/(secured)/tournois/[id]/_lib/score-form";
import type { BracketMatch } from "@/lib/shared/types";

type Row = Record<string, unknown>;

const EMPTY_MATCH: Row = {
  id: 5,
  round_number: 2,
  team1_id: 10,
  team2_id: 20,
  team1_score: null,
  team2_score: null,
  winner_team_id: null,
  forfeit_team_id: null,
  team1_reported_at: null,
  team2_reported_at: null,
};

// Connexion factice : la première requête décrit le match édité (jointe au
// format du tournoi), la seconde renvoie les matchs dépendants.
function fakeConnection(options: {
  format: string;
  winnerTeamId?: number | null;
  nextWinnerMatchId?: number | null;
  nextLoserMatchId?: number | null;
  dependents: Row[];
}): { conn: PoolConnection; dependentQuery: () => string | null } {
  let dependentSql: string | null = null;

  const conn = {
    execute: async (sql: string) => {
      if (sql.includes("JOIN bg_tournaments")) {
        return [
          [
            {
              round_number: 1,
              winner_team_id: options.winnerTeamId === undefined ? 10 : options.winnerTeamId,
              next_winner_match_id: options.nextWinnerMatchId ?? null,
              next_loser_match_id: options.nextLoserMatchId ?? null,
              tournament_id: 42,
              format: options.format,
            },
          ],
          [],
        ];
      }
      dependentSql = sql;
      return [options.dependents, []];
    },
  } as unknown as PoolConnection;

  return { conn, dependentQuery: () => dependentSql };
}

const editedMatch = { id: 1 } as MatchRow;

describe("checkDownstreamMatchesHaveNoScores — élimination", () => {
  it("laisse passer quand la manche suivante est vierge", async () => {
    const { conn } = fakeConnection({
      format: "SINGLE",
      nextWinnerMatchId: 5,
      dependents: [EMPTY_MATCH],
    });
    await expect(checkDownstreamMatchesHaveNoScores(conn, editedMatch)).resolves.toBeUndefined();
  });

  it("refuse quand la manche suivante a un score", async () => {
    const { conn } = fakeConnection({
      format: "SINGLE",
      nextWinnerMatchId: 5,
      dependents: [{ ...EMPTY_MATCH, team1_score: 2, team2_score: 1 }],
    });
    await expect(checkDownstreamMatchesHaveNoScores(conn, editedMatch)).rejects.toThrow(
      "CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES",
    );
  });

  it("refuse sur un score 0-0 saisi par un arbitre", async () => {
    const { conn } = fakeConnection({
      format: "SINGLE",
      nextWinnerMatchId: 5,
      dependents: [{ ...EMPTY_MATCH, team1_score: 0, team2_score: 0 }],
    });
    await expect(checkDownstreamMatchesHaveNoScores(conn, editedMatch)).rejects.toThrow(
      "CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES",
    );
  });

  it("refuse quand une seule équipe a reporté (score en attente)", async () => {
    const { conn } = fakeConnection({
      format: "DOUBLE",
      nextLoserMatchId: 6,
      dependents: [{ ...EMPTY_MATCH, id: 6, team1_reported_at: "2026-08-16 10:00:00" }],
    });
    await expect(checkDownstreamMatchesHaveNoScores(conn, editedMatch)).rejects.toThrow(
      "CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES",
    );
  });

  it("refuse quand la manche suivante est un forfait", async () => {
    const { conn } = fakeConnection({
      format: "DOUBLE",
      nextWinnerMatchId: 5,
      dependents: [{ ...EMPTY_MATCH, forfeit_team_id: 20 }],
    });
    await expect(checkDownstreamMatchesHaveNoScores(conn, editedMatch)).rejects.toThrow(
      "CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES",
    );
  });

  it("ignore un bye de la manche suivante", async () => {
    const { conn } = fakeConnection({
      format: "SINGLE",
      nextWinnerMatchId: 5,
      dependents: [{ ...EMPTY_MATCH, team2_id: null, team1_score: 1, team2_score: 0, winner_team_id: 10 }],
    });
    await expect(checkDownstreamMatchesHaveNoScores(conn, editedMatch)).resolves.toBeUndefined();
  });

  it("laisse passer la toute première saisie (match encore indécis)", async () => {
    const { conn } = fakeConnection({
      format: "SINGLE",
      winnerTeamId: null,
      nextWinnerMatchId: 5,
      dependents: [{ ...EMPTY_MATCH, team1_score: 2, team2_score: 1 }],
    });
    await expect(checkDownstreamMatchesHaveNoScores(conn, editedMatch)).resolves.toBeUndefined();
  });

  it("n'interroge personne quand le match n'a pas de suite", async () => {
    const { conn, dependentQuery } = fakeConnection({ format: "SINGLE", dependents: [] });
    await checkDownstreamMatchesHaveNoScores(conn, editedMatch);
    expect(dependentQuery()).toBeNull();
  });
});

describe("checkDownstreamMatchesHaveNoScores — survie et ronde suisse", () => {
  it("interroge les rounds ultérieurs plutôt que les liens de bracket", async () => {
    for (const format of ["SURVIVAL", "SWISS"]) {
      const { conn, dependentQuery } = fakeConnection({ format, dependents: [] });
      await checkDownstreamMatchesHaveNoScores(conn, editedMatch);
      expect(dependentQuery()).toContain("round_number > ?");
    }
  });

  it("refuse la correction d'un round dont la suite a déjà un score", async () => {
    const { conn } = fakeConnection({
      format: "SURVIVAL",
      dependents: [EMPTY_MATCH, { ...EMPTY_MATCH, id: 6, team1_score: 2, team2_score: 1, winner_team_id: 10 }],
    });
    await expect(checkDownstreamMatchesHaveNoScores(conn, editedMatch)).rejects.toThrow(
      "CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES",
    );
  });

  it("autorise la correction tant que le round suivant est vierge", async () => {
    const { conn } = fakeConnection({
      format: "SURVIVAL",
      dependents: [EMPTY_MATCH, { ...EMPTY_MATCH, id: 6 }],
    });
    await expect(checkDownstreamMatchesHaveNoScores(conn, editedMatch)).resolves.toBeUndefined();
  });
});

describe("dialogue d'édition — valeurs d'ouverture", () => {
  const base = {
    id: 7,
    team1Score: null,
    team2Score: null,
    forfeitTeamId: null,
  } as unknown as BracketMatch;

  it("ouvre à 0-0 quand aucun score n'a été saisi", () => {
    expect(scoreFormStateFor(base)).toEqual({ score1: "0", score2: "0", forfeitTeamId: undefined });
  });

  it("ouvre sur le score du match, y compris un zéro", () => {
    expect(scoreFormStateFor({ ...base, team1Score: 2, team2Score: 0 })).toEqual({
      score1: "2",
      score2: "0",
      forfeitTeamId: undefined,
    });
  });

  it("reporte le forfait déjà déclaré", () => {
    expect(scoreFormStateFor({ ...base, forfeitTeamId: 20 }).forfeitTeamId).toBe(20);
  });

  it("retombe à 0-0 sans match (dialogue fermé)", () => {
    expect(scoreFormStateFor(null)).toEqual({ score1: "0", score2: "0", forfeitTeamId: undefined });
  });
});
