import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/tournaments/state");
jest.mock("@/lib/server/tournaments/registration");
jest.mock("@/lib/server/tournaments/admin");

import { forfeitOwnMatch } from "@/lib/server/tournaments/player-forfeit";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { resolveUserEntrant } from "@/lib/server/tournaments/registration";
import { adminResolveMatch } from "@/lib/server/tournaments/admin";
import { tournamentRow } from "../../helpers/tournament-rows";

type MatchLine = { team1_id: number | null; team2_id: number | null; status: string };

/** Connexion factice : la seule lecture du service est la ligne du match, verrouillée. */
function connection(match: MatchLine | null): { conn: PoolConnection; queries: string[] } {
  const queries: string[] = [];
  const conn = {
    execute: async (sql: string) => {
      queries.push(sql.replace(/\s+/g, " ").trim());
      return [match ? [match] : [], []];
    },
  } as unknown as PoolConnection;
  return { conn, queries };
}

const readyMatch: MatchLine = { team1_id: 10, team2_id: 20, status: "READY" };

function tournament(state: "RUNNING" | "FINISHED" = "RUNNING") {
  jest.mocked(syncTournamentState).mockResolvedValue({
    row: tournamentRow({ id: 1, state }),
    stateChanged: false,
    contentChanged: false,
    launchesChanged: false,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  tournament();
  jest.mocked(resolveUserEntrant).mockResolvedValue({ teamId: 20, canActForEntrant: true, canConductMatch: true });
  jest.mocked(adminResolveMatch).mockResolvedValue(undefined);
});

describe("forfeitOwnMatch", () => {
  it("tranche le match au forfait de l'équipe du joueur, par le chemin de l'arbitrage", async () => {
    const { conn } = connection(readyMatch);
    await expect(forfeitOwnMatch(conn, 1, 42, 7)).resolves.toEqual({ forfeitTeamId: 20 });
    expect(adminResolveMatch).toHaveBeenCalledWith(conn, 42, undefined, undefined, 20);
  });

  it("verrouille la ligne du match, sans jointure (MariaDB)", async () => {
    const { conn, queries } = connection(readyMatch);
    await forfeitOwnMatch(conn, 1, 42, 7);
    const lock = queries.find((q) => q.includes("FROM bg_matches"))!;
    expect(lock).toMatch(/FOR UPDATE$/);
    expect(lock).not.toMatch(/JOIN/);
  });

  it("n'exige pas que le match soit lancé : l'équipe absente le sait avant", async () => {
    const { conn } = connection({ ...readyMatch, status: "READY" });
    await expect(forfeitOwnMatch(conn, 1, 42, 7)).resolves.toBeDefined();
  });

  it("accepte un match en attente de confirmation", async () => {
    const { conn } = connection({ ...readyMatch, status: "AWAITING_CONFIRMATION" });
    await expect(forfeitOwnMatch(conn, 1, 42, 7)).resolves.toBeDefined();
  });

  it.each<[string, () => void, MatchLine | null]>([
    ["TOURNAMENT_NOT_RUNNING", () => tournament("FINISHED"), readyMatch],
    [
      "NO_ACTIVE_TEAM",
      () => jest.mocked(resolveUserEntrant).mockResolvedValue({ teamId: null, canActForEntrant: false, canConductMatch: false }),
      readyMatch,
    ],
    [
      "NOT_TEAM_MANAGER",
      () => jest.mocked(resolveUserEntrant).mockResolvedValue({ teamId: 20, canActForEntrant: false, canConductMatch: false }),
      readyMatch,
    ],
    ["MATCH_NOT_FOUND", () => undefined, null],
    ["MATCH_ALREADY_COMPLETED", () => undefined, { ...readyMatch, status: "COMPLETED" }],
    ["MATCH_NOT_READY", () => undefined, { ...readyMatch, team1_id: null }],
    [
      "NOT_IN_MATCH",
      () => jest.mocked(resolveUserEntrant).mockResolvedValue({ teamId: 99, canActForEntrant: true, canConductMatch: true }),
      readyMatch,
    ],
  ])("refuse %s sans rien écrire", async (code, arrange, match) => {
    arrange();
    const { conn } = connection(match);
    await expect(forfeitOwnMatch(conn, 1, 42, 7)).rejects.toThrow(code);
    expect(adminResolveMatch).not.toHaveBeenCalled();
  });

  it("rend TOURNAMENT_NOT_FOUND sur un tournoi inconnu", async () => {
    jest.mocked(syncTournamentState).mockResolvedValue({
      row: null,
      stateChanged: false,
      contentChanged: false,
      launchesChanged: false,
    });
    const { conn } = connection(readyMatch);
    await expect(forfeitOwnMatch(conn, 1, 42, 7)).rejects.toThrow("TOURNAMENT_NOT_FOUND");
  });
});
