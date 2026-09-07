import { describe, expect, it } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";
import { checkDownstreamMatchesHaveNoScores } from "@/lib/server/tournaments/admin";
import type { MatchRow } from "@/lib/server/tournaments/_internal";

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

describe("checkDownstreamMatchesHaveNoScores — formats sans liens de bracket", () => {
  // BlueGenji Survie a la même absence de liens de bracket : ses play-offs
  // s'enchaînent par le numéro de tour. Sans lui dans cette liste, le serveur
  // retombait sur `next_winner_match_id` — que son moteur ne renseigne jamais —
  // et n'opposait donc aucun verrou, quand l'interface, elle, masquait bien le
  // bouton d'édition.
  it("interroge les rounds ultérieurs plutôt que les liens de bracket", async () => {
    for (const format of ["SURVIVAL", "SWISS", "BG_SURVIE"]) {
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

  it("refuse la correction d'un quart de finale dont la demie est déjà jouée", async () => {
    const { conn } = fakeConnection({
      format: "BG_SURVIE",
      dependents: [{ ...EMPTY_MATCH, id: 6, team1_score: 3, team2_score: 1, winner_team_id: 10 }],
    });
    await expect(checkDownstreamMatchesHaveNoScores(conn, editedMatch)).rejects.toThrow(
      "CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES",
    );
  });

  it("laisse corriger un quart de finale tant que la demie n'est pas jouée", async () => {
    // Le cas nominal du mode : la demie existe (elle a été posée dès les quarts
    // terminés) mais reste vierge — c'est `repairPlayoffBracket` qui la
    // réapparie ensuite.
    const { conn } = fakeConnection({
      format: "BG_SURVIE",
      dependents: [{ ...EMPTY_MATCH, id: 6 }],
    });
    await expect(checkDownstreamMatchesHaveNoScores(conn, editedMatch)).resolves.toBeUndefined();
  });
});
