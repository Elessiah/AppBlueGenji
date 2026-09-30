import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");

import { withConnection } from "@/lib/server/database";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { setRefereeScheduling } from "@/lib/server/tournaments/referee-scheduling";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";

function world(tournament: { state: string; referee_scheduling?: number } | null, moved = 2) {
  const connection = connectionMock();
  connection.rollback.mockResolvedValue(undefined);
  const statements: { sql: string; params: unknown[] }[] = [];
  connection.execute.mockImplementation(async (raw: string, params?: unknown) => {
    const sql = raw.replace(/\s+/g, " ").trim();
    statements.push({ sql, params: (params as unknown[]) ?? [] });
    if (sql.startsWith("SELECT name, state, referee_scheduling FROM bg_tournaments")) {
      return [tournament ? [{ name: "Coupe", referee_scheduling: 0, ...tournament }] : []];
    }
    if (sql.startsWith("UPDATE bg_matches")) return [{ affectedRows: moved }];
    return [{ affectedRows: 1 }];
  });
  jest.mocked(withConnection).mockImplementation(async (run) => run(fakeConnection(connection)));
  return { connection, statements };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("setRefereeScheduling", () => {
  it("verrouille la ligne du tournoi en toute première instruction", async () => {
    const { statements } = world({ state: "RUNNING" });
    await setRefereeScheduling(7, true);
    expect(statements[0].sql).toMatch(/^SELECT name, state, referee_scheduling FROM bg_tournaments .*FOR UPDATE$/);
    expect(statements[0].params).toEqual([7]);
  });

  it("allume l'option en cours de tournoi et défait le lancement des matchs sans date", async () => {
    const { connection, statements } = world({ state: "RUNNING" }, 3);

    const result = await setRefereeScheduling(7, true);

    expect(result).toEqual({
      tournamentId: 7,
      tournamentName: "Coupe",
      enabled: true,
      changed: true,
      movedToPlanning: 3,
    });
    const flag = statements.find((s) => s.sql.startsWith("UPDATE bg_tournaments"));
    expect(flag?.params).toEqual([1, 7]);
    const reset = statements.find(
      (s) => s.sql.startsWith("UPDATE bg_matches") && s.sql.includes("lobby_opened_at = NULL"),
    );
    // Mêmes conditions que la phase `TO_PLAN` : jouable, sans date, non lancé
    // (ou lancé pour un autre appariement).
    expect(reset?.sql).toContain("status = 'READY'");
    expect(reset?.sql).toContain("start_at IS NULL");
    expect(reset?.sql).toContain("team1_id IS NOT NULL AND team2_id IS NOT NULL");
    expect(reset?.sql).toContain("launched_at IS NULL");
    expect(reset?.sql).toContain("NOT (launch_pairing <=> CONCAT(team1_id, ':', team2_id))");
    expect(reset?.sql).toContain("lobby_opened_at = NULL");
    expect(reset?.sql).toContain("team1_ready_at = NULL");
    expect(reset?.params).toEqual([7]);
    // Une rencontre déjà notée n'est jamais renvoyée à planifier.
    expect(reset?.sql).toContain("NOT (team1_score IS NOT NULL OR team2_score IS NOT NULL)");
    expect(connection.commit).toHaveBeenCalled();
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("tient pour lancé un match en lancement dont un score est déjà noté", async () => {
    const { statements } = world({ state: "RUNNING" });
    await setRefereeScheduling(7, true);
    const launch = statements.find(
      (s) => s.sql.startsWith("UPDATE bg_matches") && s.sql.includes("launched_at = NOW()"),
    );
    expect(launch?.sql).toContain("(team1_score IS NOT NULL OR team2_score IS NOT NULL)");
    expect(launch?.sql).toContain("launch_pairing = CONCAT(team1_id, ':', team2_id)");
    expect(launch?.sql).toContain("start_at IS NULL");
    // Ordre : les rencontres notées d'abord, sans quoi le second `UPDATE` les
    // aurait déjà défaites.
    const indexOf = (needle: string) => statements.findIndex((s) => s.sql.includes(needle));
    expect(indexOf("launched_at = NOW()")).toBeLessThan(indexOf("lobby_opened_at = NULL"));
  });

  it("réarme la notification de départ des matchs renvoyés à planifier", async () => {
    const { statements } = world({ state: "RUNNING" });
    await setRefereeScheduling(7, true);
    const notices = statements.find((s) => s.sql.startsWith("DELETE FROM bg_match_start_notices"));
    expect(notices?.sql).toContain("start_at IS NULL");
    expect(notices?.sql).toContain("NOT (team1_score IS NOT NULL OR team2_score IS NOT NULL)");
    expect(notices?.params).toEqual([7]);
  });

  it("ne touche à aucune notification quand on éteint l'option", async () => {
    const { statements } = world({ state: "RUNNING", referee_scheduling: 1 });
    await setRefereeScheduling(7, false);
    expect(statements.some((s) => s.sql.startsWith("DELETE"))).toBe(false);
  });

  it("dit si l'option a réellement changé", async () => {
    world({ state: "RUNNING", referee_scheduling: 1 });
    expect((await setRefereeScheduling(7, true)).changed).toBe(false);
    world({ state: "RUNNING", referee_scheduling: 0 });
    expect((await setRefereeScheduling(7, false)).changed).toBe(false);
    world({ state: "RUNNING", referee_scheduling: 1 });
    expect((await setRefereeScheduling(7, false)).changed).toBe(true);
  });

  it("éteint l'option sans rien réécrire des matchs : la phase se dérive", async () => {
    const { statements } = world({ state: "RUNNING", referee_scheduling: 1 });

    const result = await setRefereeScheduling(7, false);

    expect(result.movedToPlanning).toBe(0);
    expect(statements.find((s) => s.sql.startsWith("UPDATE bg_tournaments"))?.params).toEqual([0, 7]);
    expect(statements.some((s) => s.sql.startsWith("UPDATE bg_matches"))).toBe(false);
  });

  it.each(["UPCOMING", "REGISTRATION"])("se règle avant le coup d'envoi (%s)", async (state) => {
    world({ state }, 0);
    await expect(setRefereeScheduling(7, true)).resolves.toMatchObject({ enabled: true, movedToPlanning: 0 });
  });

  it("refuse un tournoi terminé, sans rien écrire", async () => {
    const { connection, statements } = world({ state: "FINISHED" });
    await expect(setRefereeScheduling(7, true)).rejects.toThrow("TOURNAMENT_FINISHED");
    expect(statements.some((s) => s.sql.startsWith("UPDATE"))).toBe(false);
    expect(connection.rollback).toHaveBeenCalled();
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("refuse un tournoi introuvable", async () => {
    world(null);
    await expect(setRefereeScheduling(99, true)).rejects.toThrow("TOURNAMENT_NOT_FOUND");
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("défait la transaction quand une écriture échoue", async () => {
    const { connection } = world({ state: "RUNNING" });
    connection.execute.mockImplementationOnce(async () => [[{ name: "Coupe", state: "RUNNING" }]]);
    connection.execute.mockRejectedValueOnce(new Error("ER_LOCK_DEADLOCK"));
    await expect(setRefereeScheduling(7, true)).rejects.toThrow("ER_LOCK_DEADLOCK");
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});
