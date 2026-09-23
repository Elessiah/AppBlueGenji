import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/tournaments/scoring");
jest.mock("@/lib/server/tournaments/byes");
jest.mock("@/lib/server/tournaments/bracket-cascade");
jest.mock("@/lib/server/tournaments/repository");

import { adminResolveMatch } from "@/lib/server/tournaments/admin";
import { detachDownstreamOutcome } from "@/lib/server/tournaments/bracket-cascade";
import { reopenTournament } from "@/lib/server/tournaments/repository";

/**
 * Corriger un double forfait qui avait **clos** le tournoi : la cascade rouvre
 * l'exemption d'aval (la finale), et le tournoi doit repartir avec elle — sans
 * quoi il resterait « terminé » sur une finale que plus personne ne peut saisir.
 */
function fakeConnection(phaseId = 0, phaseState = "FINISHED") {
  const writes: { sql: string; params: unknown[] }[] = [];
  const conn = {
    execute: async (sql: string, params: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      if (q.startsWith("UPDATE")) {
        writes.push({ sql: q, params });
        return [{ affectedRows: 1 }, []];
      }
      if (q.includes("FROM bg_tournament_phases")) {
        return [[{ state: phaseState }], []];
      }
      if (q.includes("FROM bg_matches m JOIN bg_tournaments t")) {
        return [[{ round_number: 1, status: "READY", winner_team_id: null, format: "SINGLE" }], []];
      }
      if (q.includes("FROM bg_matches")) {
        return [
          [
            {
              id: 10,
              tournament_id: 1,
              round_number: 1,
              team1_id: 100,
              team2_id: 200,
              next_winner_match_id: 11,
              next_winner_slot: 1,
              next_loser_match_id: null,
              next_loser_slot: null,
              winner_team_id: null,
              phase_id: phaseId,
            },
          ],
          [],
        ];
      }
      return [[], []];
    },
  } as unknown as PoolConnection;
  return { conn, writes };
}

const phaseReopen = (writes: { sql: string }[]) =>
  writes.find((w) => w.sql.startsWith("UPDATE bg_tournament_phases SET state = 'RUNNING'"));

describe("adminResolveMatch — correction qui rouvre une exemption", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rouvre le tournoi quand la cascade a rouvert une rencontre close", async () => {
    (detachDownstreamOutcome as jest.Mock).mockResolvedValue(1 as never);
    (reopenTournament as jest.Mock).mockResolvedValue(true as never);
    const { conn, writes } = fakeConnection();

    await adminResolveMatch(conn, 10, 3, 0);

    expect(reopenTournament).toHaveBeenCalledWith(conn, 1);
    // Hors multi-phases, aucune phase à rouvrir.
    expect(phaseReopen(writes)).toBeUndefined();
  });

  it("rouvre aussi la phase d'un tournoi multi-phases clos", async () => {
    (detachDownstreamOutcome as jest.Mock).mockResolvedValue(2 as never);
    (reopenTournament as jest.Mock).mockResolvedValue(true as never);
    const { conn, writes } = fakeConnection(42);

    await adminResolveMatch(conn, 10, 3, 0);

    expect(phaseReopen(writes)?.params).toEqual([42]);
  });

  it("ne touche pas à la phase courante d'un tournoi encore en cours", async () => {
    (detachDownstreamOutcome as jest.Mock).mockResolvedValue(1 as never);
    (reopenTournament as jest.Mock).mockResolvedValue(false as never);
    const { conn, writes } = fakeConnection(42, "RUNNING");

    await adminResolveMatch(conn, 10, 3, 0);

    expect(phaseReopen(writes)).toBeUndefined();
  });

  it("refuse de rouvrir une rencontre d'une phase close d'un tournoi en cours", async () => {
    // La phase suivante a été lancée sur ses qualifiées : une rencontre rouverte
    // ici ne serait plus jamais relue, et les qualifiées ne suivraient pas.
    (detachDownstreamOutcome as jest.Mock).mockResolvedValue(1 as never);
    (reopenTournament as jest.Mock).mockResolvedValue(false as never);
    const { conn, writes } = fakeConnection(42, "FINISHED");

    await expect(adminResolveMatch(conn, 10, 3, 0)).rejects.toThrow(
      "CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES",
    );
    expect(phaseReopen(writes)).toBeUndefined();
  });

  it("ne rouvre rien quand la cascade n'a rien rouvert", async () => {
    (detachDownstreamOutcome as jest.Mock).mockResolvedValue(0 as never);
    const { conn } = fakeConnection();

    await adminResolveMatch(conn, 10, undefined, undefined, undefined, true);

    expect(reopenTournament).not.toHaveBeenCalled();
  });
});
