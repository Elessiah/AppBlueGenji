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
  /**
   * Lignes dépendantes telles que la relecture **verrouillante** les voit
   * (report commité après l'image de la transaction). Par défaut, les mêmes.
   */
  freshDependents?: Row[];
}): { conn: PoolConnection; dependentQuery: () => string | null; dependentQueries: () => string[] } {
  let dependentSql: string | null = null;
  const dependentSqls: string[] = [];
  const fresh = () => options.freshDependents ?? options.dependents;

  const conn = {
    execute: async (sql: string) => {
      if (sql.includes("JOIN bg_tournaments")) {
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
              format: options.format,
            },
          ],
          [],
        ];
      }
      dependentSql = sql;
      dependentSqls.push(sql);
      // Modes sans lien de bracket : le prédicat de saisie est en SQL
      // (`HAS_SCORE_INPUT_SQL`) — le double rend les seules lignes qu'il garde.
      if (sql.startsWith("SELECT id FROM bg_matches")) {
        const rows = sql.includes("FOR UPDATE") ? fresh() : options.dependents;
        return [rows.filter(carriesScoreInput).map((row) => ({ id: row.id })), []];
      }
      return [options.dependents, []];
    },
    // Délai de verrou court (`withShortLockWait`), puis relecture verrouillante
    // des dépendants par identifiant.
    query: async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("SET SESSION")) return [[], []];
      dependentSqls.push(sql);
      const ids = (params?.[0] as number[]) ?? [];
      return [fresh().filter((row) => ids.includes(Number(row.id))), []];
    },
  } as unknown as PoolConnection;

  return { conn, dependentQuery: () => dependentSql, dependentQueries: () => [...dependentSqls] };
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

  // ERREUR.txt (revue #542) : un report écrit sous le verrou du match aval et
  // commité après l'image de la transaction n'apparaît qu'à la relecture
  // verrouillante — qui refuse alors la correction.
  it("checkDownstream_bracketReportCommittedAfterSnapshot_refuses", async () => {
    const { conn, dependentQueries } = fakeConnection({
      format: "SINGLE",
      nextWinnerMatchId: 5,
      dependents: [EMPTY_MATCH],
      freshDependents: [{ ...EMPTY_MATCH, team2_reported_at: "2026-11-12 10:00:00" }],
    });

    await expect(checkDownstreamMatchesHaveNoScores(conn, editedMatch)).rejects.toThrow(
      "CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES",
    );
    expect(dependentQueries().at(-1)).toMatch(/WHERE id IN \(\?\) FOR UPDATE$/);
  });

  it("checkDownstream_bracketWithoutDependents_noLockedRead", async () => {
    const { conn, dependentQueries } = fakeConnection({ format: "SINGLE", dependents: [] });

    await checkDownstreamMatchesHaveNoScores(conn, editedMatch);

    expect(dependentQueries()).toHaveLength(0);
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

  // ERREUR.txt EF-15 (revue) : la lecture ordinaire du match a déjà figé
  // l'image ; un `FOR UPDATE` ici serait refusé sous MariaDB (`ER_CHECKREAD`).
  // ERREUR.txt (revue #542) : l'image de la transaction d'abord, puis une
  // relecture verrouillante si elle ne voit aucune saisie.
  it("checkDownstream_laterRoundsBlankInSnapshot_rereadsLocked", async () => {
    const { conn, dependentQueries } = fakeConnection({ format: "SURVIVAL", dependents: [] });

    await checkDownstreamMatchesHaveNoScores(conn, editedMatch);

    const reads = dependentQueries();
    expect(reads).toHaveLength(2);
    expect(reads[0]).not.toContain("FOR UPDATE");
    expect(reads[1]).toContain("FOR UPDATE");
  });

  it("checkDownstream_laterRoundsInputInSnapshot_refusesWithoutLocking", async () => {
    const { conn, dependentQueries } = fakeConnection({
      format: "SURVIVAL",
      dependents: [{ ...EMPTY_MATCH, id: 6, team1_score: 2, team2_score: 1 }],
    });

    await expect(checkDownstreamMatchesHaveNoScores(conn, editedMatch)).rejects.toThrow(
      "CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES",
    );
    expect(dependentQueries().some((sql) => sql.includes("FOR UPDATE"))).toBe(false);
  });

  it("checkDownstream_laterRoundReportCommittedAfterSnapshot_refuses", async () => {
    const { conn } = fakeConnection({
      format: "SWISS",
      dependents: [EMPTY_MATCH],
      freshDependents: [{ ...EMPTY_MATCH, team1_reported_at: "2026-11-12 10:00:00" }],
    });

    await expect(checkDownstreamMatchesHaveNoScores(conn, editedMatch)).rejects.toThrow(
      "CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES",
    );
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
