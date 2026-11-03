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
/** `HAS_SCORE_INPUT_SQL`, rejoué sur une ligne factice. */
function carriesScoreInput(row: Row): boolean {
  if (row.team1_id == null || row.team2_id == null) return false;
  return (
    row.team1_score != null ||
    row.team2_score != null ||
    row.winner_team_id != null ||
    row.forfeit_team_id != null ||
    row.double_forfeit === 1 ||
    row.status === "AWAITING_CONFIRMATION" ||
    row.team1_reported_at != null ||
    row.team2_reported_at != null
  );
}

function fakeConnection(options: {
  format: string;
  /**
   * Statut du match édité. C'est lui — et non la présence d'un vainqueur — qui
   * dit si le résultat a été propagé : un match nul est terminé sans vainqueur.
   */
  status?: "PENDING" | "READY" | "AWAITING_CONFIRMATION" | "COMPLETED";
  /**
   * Vainqueur du match édité, servi **en plus** du statut.
   *
   * La ligne factice doit ressembler à celle que rend la base, pas à ce dont la
   * version courante du code a besoin : en ne servant que `status`, ces tests
   * passaient aussi contre l'ancien garde-fou, qui lisait alors
   * `winner_team_id === undefined` — jamais `null`, donc jamais de sortie
   * anticipée, et l'erreur attendue levée pour la mauvaise raison. Un nul le
   * laisse à `null` tout en étant `COMPLETED` : c'est **cette** paire qui
   * distingue les deux lectures.
   */
  winnerTeamId?: number | null;
  nextWinnerMatchId?: number | null;
  nextLoserMatchId?: number | null;
  dependents: Row[];
}): { conn: PoolConnection; dependentQuery: () => string | null; statements: string[] } {
  let dependentSql: string | null = null;
  const statements: string[] = [];

  const conn = {
    execute: async (sql: string) => {
      statements.push(sql.replace(/\s+/g, " ").trim());
      // Format du tournoi, lu à part sous son verrou (table seule).
      if (sql.startsWith("SELECT format FROM bg_tournaments")) return [[{ format: options.format }], []];
      // Le match édité, relu sous le verrou que l'appelant tient déjà.
      if (sql.startsWith("SELECT round_number, status, next_winner_match_id")) {
        return [
          [
            {
              round_number: 1,
              status: options.status ?? "COMPLETED",
              // Par défaut un match tranché **avec** vainqueur ; les cas de nul
              // passent explicitement `winnerTeamId: null`.
              winner_team_id: options.winnerTeamId === undefined ? 10 : options.winnerTeamId,
              next_winner_match_id: options.nextWinnerMatchId ?? null,
              next_loser_match_id: options.nextLoserMatchId ?? null,
              tournament_id: 42,
            },
          ],
          [],
        ];
      }
      dependentSql = sql;
      // Modes sans lien de bracket : le prédicat de saisie est en SQL
      // (`HAS_SCORE_INPUT_SQL`) — le double rend les seules lignes qu'il garde.
      if (sql.startsWith("SELECT id FROM bg_matches")) {
        return [options.dependents.filter(carriesScoreInput).map((row) => ({ id: row.id })), []];
      }
      return [options.dependents, []];
    },
  } as unknown as PoolConnection;

  return { conn, dependentQuery: () => dependentSql, statements };
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
      status: "READY",
      winnerTeamId: null,
      nextWinnerMatchId: 5,
      dependents: [{ ...EMPTY_MATCH, team1_score: 2, team2_score: 1 }],
    });
    await expect(checkDownstreamMatchesHaveNoScores(conn, editedMatch)).resolves.toBeUndefined();
  });

  it("verrouille un match nul comme n'importe quel match tranché", async () => {
    // Un nul est `COMPLETED` **sans** vainqueur. Lu sur `winner_team_id`, le
    // garde-fou le prenait pour un match encore indécis et sortait aussitôt :
    // l'arbitrage pouvait réécrire un 2-2 dont la suite était déjà jouée, alors
    // que l'interface annonçait le score verrouillé.
    const { conn } = fakeConnection({
      format: "SINGLE",
      status: "COMPLETED",
      // Les deux traits conjoints d'un nul : clos, sans vainqueur.
      winnerTeamId: null,
      nextWinnerMatchId: 5,
      dependents: [{ ...EMPTY_MATCH, team1_score: 2, team2_score: 1 }],
    });
    await expect(checkDownstreamMatchesHaveNoScores(conn, editedMatch)).rejects.toThrow(
      "CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES",
    );
  });

  it("verrouille un match nul aussi dans les formats à classement", async () => {
    const { conn } = fakeConnection({
      format: "SWISS",
      status: "COMPLETED",
      winnerTeamId: null,
      dependents: [{ ...EMPTY_MATCH, round_number: 3, team1_score: 2, team2_score: 1 }],
    });
    await expect(checkDownstreamMatchesHaveNoScores(conn, editedMatch)).rejects.toThrow(
      "CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES",
    );
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

  // ERREUR.txt EF-15 (revue) : un report de la manche suivante écrit au même
  // moment ne doit pas échapper au verrou — et sous MariaDB, aucune lecture
  // d'image ne doit précéder ce `FOR UPDATE` (`ER_CHECKREAD`).
  it("checkDownstream_laterRounds_lockedRead", async () => {
    const { conn, dependentQuery } = fakeConnection({ format: "SURVIVAL", dependents: [] });

    await checkDownstreamMatchesHaveNoScores(conn, editedMatch);

    expect(dependentQuery()).toMatch(/FOR UPDATE$/);
  });

  it("checkDownstream_readsBeforeLaterRounds_allLockingWithoutJoin", async () => {
    const { conn, statements } = fakeConnection({ format: "SWISS", dependents: [] });

    await checkDownstreamMatchesHaveNoScores(conn, editedMatch);

    expect(statements).toHaveLength(3);
    for (const statement of statements) {
      expect(statement).toMatch(/FOR UPDATE$/);
      expect(statement).not.toContain("JOIN");
    }
    expect(statements[1]).toBe("SELECT format FROM bg_tournaments WHERE id = ? LIMIT 1 FOR UPDATE");
  });

  it("checkDownstream_undecidedMatch_neverLocksTournament", async () => {
    const { conn, statements } = fakeConnection({ format: "SWISS", status: "READY", dependents: [] });

    await checkDownstreamMatchesHaveNoScores(conn, editedMatch);

    expect(statements).toHaveLength(1);
    expect(statements[0]).not.toContain("bg_tournaments");
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
