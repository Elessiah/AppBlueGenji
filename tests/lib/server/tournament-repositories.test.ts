import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/bot-logs");

import { queueBotLog } from "@/lib/server/tournaments/bot-logs";
import {
  createMatch,
  deleteAllMatches,
  deletePhaseMatches,
  finishTournament,
  getMatchRows,
  getRegistrationRows,
  getTournamentListRow,
  hasExistingMatches,
  loadRegisteredTeamIds,
  reopenTournament,
  resetRegistrationRanks,
  setMatchParticipants,
  updateTournamentBracketSize,
  updateTournamentState,
} from "@/lib/server/tournaments/repository";
import {
  insertPhaseTeams,
  loadPhaseTeamIds,
  savePhaseResults,
  setCurrentPhase,
  setPhaseState,
  updatePhaseResolution,
} from "@/lib/server/tournaments/phases-repository";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";
import { tournamentListRow } from "../../helpers/tournament-rows";

/**
 * Les deux dépôts SQL du moteur de tournois (`repository.ts`,
 * `phases-repository.ts`) : ce que chaque écriture **cible**, et ce que chaque
 * lecture rend.
 *
 * Les orchestrations qui les appellent sont testées avec des dépôts simulés ;
 * restait à prouver que les instructions elles-mêmes visent la bonne portée —
 * un `DELETE` de phase qui oublierait sa phase effacerait tout le plateau d'un
 * tournoi multi-phases — et que les paramètres sont liés dans l'ordre de leurs
 * `?`, que rien d'autre ne vérifie avant la base.
 */

let connection: ReturnType<typeof connectionMock>;

beforeEach(() => {
  jest.clearAllMocks();
  connection = connectionMock();
  connection.execute.mockResolvedValue([[], undefined]);
});

const conn = () => fakeConnection(connection);

/** Dernière instruction émise, aplatie, et ses paramètres. */
function lastCall(): { sql: string; params: unknown[] } {
  const call = connection.execute.mock.calls.at(-1);
  if (!call) throw new Error("aucune instruction");
  return { sql: call[0].replace(/\s+/g, " ").trim(), params: (call[1] ?? []) as unknown[] };
}

/**
 * Lie les paramètres à leurs `?`, dans l'ordre — ce que fait le serveur. Seule
 * façon de lire ce qu'une instruction à placeholders construits dit vraiment.
 */
function bound({ sql, params }: { sql: string; params: unknown[] }): string {
  let index = 0;
  const text = sql.replace(/\?/g, () => {
    const value = params[index++];
    return typeof value === "string" ? `'${value}'` : String(value);
  });
  expect(index).toBe(params.length);
  return text;
}

describe("repository — lectures", () => {
  it("rend les inscrites dans l'ordre des têtes de série, les non classées à la fin", async () => {
    connection.execute.mockResolvedValue([[{ team_id: "4" }, { team_id: 9 }], undefined]);

    await expect(loadRegisteredTeamIds(conn(), 5)).resolves.toEqual([4, 9]);

    const { sql, params } = lastCall();
    expect(sql).toContain("ORDER BY COALESCE(seed, 1000000), registered_at ASC");
    expect(params).toEqual([5]);
  });

  it("rend les lignes d'inscription avec le nom de l'équipe, même ordre", async () => {
    const rows = [{ team_id: 4, team_name: "Alpha" }];
    connection.execute.mockResolvedValue([rows, undefined]);

    await expect(getRegistrationRows(conn(), 5)).resolves.toBe(rows);
    expect(lastCall().sql).toContain("JOIN bg_teams t ON t.id = r.team_id");
    expect(lastCall().sql).toContain("ORDER BY COALESCE(r.seed, 1000000), r.registered_at ASC");
  });

  it("ordonne les matchs par phase, tableau, manche et numéro", async () => {
    await getMatchRows(conn(), 5);

    const { sql, params } = lastCall();
    expect(sql).toContain(
      "ORDER BY COALESCE(p.position, 0) ASC, FIELD(m.bracket, 'UPPER', 'LOWER', 'GRAND', 'THIRD_PLACE') ASC, m.round_number ASC, m.match_number ASC",
    );
    expect(sql).toContain("WHERE m.tournament_id = ?");
    expect(params).toEqual([5]);
  });

  it("rend la ligne de liste d'un tournoi, ou null s'il n'existe pas", async () => {
    const row = tournamentListRow({ id: 5 });
    connection.execute.mockResolvedValueOnce([[row], undefined]).mockResolvedValueOnce([[], undefined]);

    await expect(getTournamentListRow(conn(), 5)).resolves.toBe(row);
    await expect(getTournamentListRow(conn(), 6)).resolves.toBeNull();
    expect(lastCall().params).toEqual([6]);
  });

  it("dit si un tournoi a déjà des matchs", async () => {
    connection.execute
      .mockResolvedValueOnce([[{ c: "3" }], undefined])
      .mockResolvedValueOnce([[{ c: 0 }], undefined])
      .mockResolvedValueOnce([[], undefined]);

    await expect(hasExistingMatches(conn(), 5)).resolves.toBe(true);
    await expect(hasExistingMatches(conn(), 5)).resolves.toBe(false);
    await expect(hasExistingMatches(conn(), 5)).resolves.toBe(false);
  });
});

describe("repository — écritures", () => {
  it("crée un match hors phase par défaut, et rend son identifiant", async () => {
    connection.execute.mockResolvedValue([{ insertId: 88 }, undefined]);

    await expect(createMatch(conn(), 5, "UPPER", 2, 3)).resolves.toBe(88);
    expect(lastCall().params).toEqual([5, "UPPER", 2, 3, 0]);
  });

  it("crée un match dans sa phase", async () => {
    connection.execute.mockResolvedValue([{ insertId: 89 }, undefined]);

    await createMatch(conn(), 5, "LOWER", 1, 1, 12);
    expect(lastCall().params).toEqual([5, "LOWER", 1, 1, 12]);
  });

  it("pose les deux engagés d'un match et son statut", async () => {
    await setMatchParticipants(conn(), 70, 4, null, "PENDING");

    expect(bound(lastCall())).toBe(
      "UPDATE bg_matches SET team1_id = 4, team2_id = null, status = 'PENDING' WHERE id = 70",
    );
  });

  it("écrit l'état et la taille du plateau sur le seul tournoi visé", async () => {
    await updateTournamentState(conn(), 5, "RUNNING");
    expect(bound(lastCall())).toBe("UPDATE bg_tournaments SET state = 'RUNNING' WHERE id = 5");

    await updateTournamentBracketSize(conn(), 5, 16);
    expect(bound(lastCall())).toBe("UPDATE bg_tournaments SET bracket_size = 16 WHERE id = 5");
  });

  it("efface tous les matchs d'un tournoi, et de lui seul", async () => {
    await deleteAllMatches(conn(), 5);
    expect(bound(lastCall())).toBe("DELETE FROM bg_matches WHERE tournament_id = 5");
  });

  it("n'efface que les matchs de la phase visée", async () => {
    await deletePhaseMatches(conn(), 5, 12);
    expect(bound(lastCall())).toBe("DELETE FROM bg_matches WHERE tournament_id = 5 AND phase_id = 12");
  });

  it("efface le classement final d'un tournoi", async () => {
    await resetRegistrationRanks(conn(), 5);
    expect(bound(lastCall())).toBe(
      "UPDATE bg_tournament_registrations SET final_rank = NULL WHERE tournament_id = 5",
    );
  });
});

describe("finishTournament — une clôture à effet unique", () => {
  it("clôt un tournoi en cours et réserve sa ligne de journal", async () => {
    connection.execute.mockResolvedValue([{ affectedRows: 1 }, undefined]);

    await finishTournament(conn(), 5);

    expect(lastCall().sql).toContain("WHERE id = ? AND state <> 'FINISHED'");
    expect(queueBotLog).toHaveBeenCalledWith(expect.anything(), { kind: "tournament_finished", tournamentId: 5 });
  });

  it("n'annonce pas une seconde fois un tournoi déjà clos", async () => {
    connection.execute.mockResolvedValue([{ affectedRows: 0 }, undefined]);

    await finishTournament(conn(), 5);

    expect(queueBotLog).not.toHaveBeenCalled();
  });
});

describe("reopenTournament", () => {
  it("rouvre un tournoi terminé et efface son classement", async () => {
    connection.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

    await expect(reopenTournament(conn(), 5)).resolves.toBe(true);

    const [reopen, reset] = connection.execute.mock.calls.map(([sql]) => sql.replace(/\s+/g, " ").trim());
    expect(reopen).toContain("SET state = 'RUNNING', finished_at = NULL WHERE id = ? AND state = 'FINISHED'");
    expect(reset).toContain("SET final_rank = NULL");
  });

  it("ne touche pas au classement d'un tournoi qui n'était pas terminé", async () => {
    connection.execute.mockResolvedValueOnce([{ affectedRows: 0 }, undefined]);

    await expect(reopenTournament(conn(), 5)).resolves.toBe(false);
    expect(connection.execute).toHaveBeenCalledTimes(1);
  });

  it("tient un résultat sans en-tête pour un refus", async () => {
    connection.execute.mockResolvedValueOnce([undefined, undefined]);

    await expect(reopenTournament(conn(), 5)).resolves.toBe(false);
  });
});

describe("phases-repository — updatePhaseResolution", () => {
  it("n'écrit que les métriques fournies", async () => {
    await updatePhaseResolution(conn(), 12, { entrants: 16, maxRounds: undefined, state: "RUNNING" });

    expect(bound(lastCall())).toBe(
      "UPDATE bg_tournament_phases SET entrants = 16, state = 'RUNNING' WHERE id = 12",
    );
  });

  it("écrit un null explicite, qui efface la métrique", async () => {
    await updatePhaseResolution(conn(), 12, { qualifiers: null, maxRounds: 4 });

    expect(bound(lastCall())).toBe("UPDATE bg_tournament_phases SET qualifiers = null, max_rounds = 4 WHERE id = 12");
  });

  it("n'émet rien quand il n'y a rien à écrire", async () => {
    await updatePhaseResolution(conn(), 12, {});
    expect(connection.execute).not.toHaveBeenCalled();
  });
});

describe("phases-repository — état et phase courante", () => {
  it("pose l'état d'une phase avec son horodatage", async () => {
    await setPhaseState(conn(), 12, "FINISHED", "finished_at");
    expect(bound(lastCall())).toBe(
      "UPDATE bg_tournament_phases SET state = 'FINISHED', finished_at = NOW() WHERE id = 12",
    );
  });

  it("pose l'état d'une phase sans horodatage", async () => {
    await setPhaseState(conn(), 12, "SKIPPED");
    expect(bound(lastCall())).toBe("UPDATE bg_tournament_phases SET state = 'SKIPPED' WHERE id = 12");
  });

  it("désigne la phase courante, ou n'en désigne aucune", async () => {
    await setCurrentPhase(conn(), 5, 12);
    expect(bound(lastCall())).toBe("UPDATE bg_tournaments SET current_phase_id = 12 WHERE id = 5");

    await setCurrentPhase(conn(), 5, null);
    expect(bound(lastCall())).toBe("UPDATE bg_tournaments SET current_phase_id = null WHERE id = 5");
  });
});

describe("phases-repository — engagées d'une phase", () => {
  it("inscrit toutes les engagées en une instruction, têtes de série mises à jour", async () => {
    await insertPhaseTeams(conn(), 5, 12, [
      { teamId: 4, seed: 1 },
      { teamId: 9, seed: 2 },
    ]);

    const text = bound(lastCall());
    expect(text).toContain("VALUES (12, 5, 4, 1), (12, 5, 9, 2)");
    expect(text).toContain("ON DUPLICATE KEY UPDATE seed = VALUES(seed)");
  });

  it("n'émet rien pour une liste vide", async () => {
    await insertPhaseTeams(conn(), 5, 12, []);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("relit les engagées par tête de série", async () => {
    connection.execute.mockResolvedValue([[{ team_id: "9" }, { team_id: 4 }], undefined]);

    await expect(loadPhaseTeamIds(conn(), 12)).resolves.toEqual([9, 4]);
    expect(lastCall().sql).toContain("WHERE phase_id = ? ORDER BY seed ASC");
  });
});

describe("phases-repository — savePhaseResults", () => {
  it("écrit le rang et la qualification d'une engagée", async () => {
    await savePhaseResults(conn(), 12, [{ teamId: 4, rank: 1, qualified: true }]);

    const text = bound(lastCall());
    expect(text).toContain("`rank` = CASE team_id WHEN 4 THEN 1 ELSE `rank` END");
    expect(text).toContain("qualified = CASE team_id WHEN 4 THEN 1 ELSE qualified END");
    expect(text).toContain("WHERE phase_id = 12");
  });

  it("lie chaque rang et chaque qualification à sa propre équipe", async () => {
    await savePhaseResults(conn(), 12, [
      { teamId: 4, rank: 1, qualified: true },
      { teamId: 9, rank: 2, qualified: true },
      { teamId: 7, rank: 3, qualified: false },
    ]);

    const text = bound(lastCall());
    expect(text).toContain("`rank` = CASE team_id WHEN 4 THEN 1 WHEN 9 THEN 2 WHEN 7 THEN 3 ELSE `rank` END");
    expect(text).toContain("qualified = CASE team_id WHEN 4 THEN 1 WHEN 9 THEN 1 WHEN 7 THEN 0 ELSE qualified END");
  });

  it("n'émet rien sans classement", async () => {
    await savePhaseResults(conn(), 12, []);
    expect(connection.execute).not.toHaveBeenCalled();
  });
});
