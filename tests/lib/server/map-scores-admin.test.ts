import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/tournaments/scoring");
jest.mock("@/lib/server/tournaments/byes");

import {
  adminResolveMatch,
  adminSaveMatchScores,
  type AdminResolveEntry,
  type AdminScoreEntry,
} from "@/lib/server/tournaments/admin";
import { finalizeMatch } from "@/lib/server/tournaments/scoring";
import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";

/**
 * Connexion factice de l'arbitrage (`docs/features/MAP_SCORES.md`) : un match
 * prêt à deux équipes, le format demandé, et le journal de ce qui touche
 * `bg_match_maps`.
 */
function fakeConnection(matchFormat: { type: string; value: number }) {
  const updates: unknown[][] = [];
  const maps: { sql: string; params: unknown }[] = [];
  const conn = {
    execute: async (sql: string, params: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      // Un détail existe déjà : l'effacement a lieu (`clearMatchMaps`).
      if (q.startsWith("SELECT 1 FROM bg_match_maps")) return [[{ found: 1 }], []];
      if (q.includes("bg_match_maps")) {
        maps.push({ sql: q, params });
        return [[], []];
      }
      if (q.startsWith("UPDATE")) {
        updates.push(params);
        return [{ affectedRows: 1 }, []];
      }
      if (q.includes("FROM bg_matches m JOIN bg_tournaments t")) {
        return [[{ round_number: 1, status: "READY", winner_team_id: null, format: "SINGLE" }], []];
      }
      if (q.includes("match_format_type")) {
        return [[{ format: "SINGLE", game: "OW", match_format_type: matchFormat.type, match_format_value: matchFormat.value }], []];
      }
      if (q.includes("FROM bg_matches")) {
        return [[{
          id: 10,
          tournament_id: 1,
          team1_id: 100,
          team2_id: 200,
          next_winner_match_id: null,
          next_winner_slot: null,
          next_loser_match_id: null,
          next_loser_slot: null,
          winner_team_id: null,
        }], []];
      }
      return [[], []];
    },
  } as unknown as PoolConnection;
  return { conn, updates, maps };
}

const CLEAR_FINAL = "DELETE FROM bg_match_maps WHERE match_id = ? AND source = ?";
const CLEAR_FINAL_SET = "DELETE FROM bg_match_maps WHERE match_id IN (?) AND source IN (?)";

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(finalizeMatch).mockResolvedValue(undefined);
  jest.mocked(tryAutoResolveByes).mockResolvedValue(undefined);
});

describe("arbitrage — détail map par map", () => {
  it("« Enregistrer » avec des maps écrit le score dérivé et le détail retenu", async () => {
    const { conn, updates, maps } = fakeConnection({ type: "BO", value: 5 });
    await adminSaveMatchScores(conn, 10, {
      maps: [
        { replayCode: "AAA111", team1Score: 2, team2Score: 0 },
        { replayCode: "BBB222", team1Score: 1, team2Score: 1 },
      ],
      userId: 3,
    });
    expect(updates.at(-1)).toEqual([1, 0, 10]);
    expect(maps.some((m) => m.sql.startsWith("INSERT INTO bg_match_maps"))).toBe(true);
  });

  it("un forfait enregistré efface le détail, même sans maps envoyées", async () => {
    const { conn, maps } = fakeConnection({ type: "BO", value: 1 });
    await adminSaveMatchScores(conn, 10, { forfeitTeamId: 200 });
    expect(maps.at(-1)).toEqual({ sql: CLEAR_FINAL_SET, params: [10, "FINAL"] });
    expect(maps[0].sql).not.toMatch(/FOR UPDATE/);
  });

  it("des maps enregistrées remplacent le détail retenu, sans aucun autre jeu touché", async () => {
    const { conn, maps } = fakeConnection({ type: "BO", value: 5 });
    await adminSaveMatchScores(conn, 10, { maps: [{ replayCode: "AAA111", team1Score: 2, team2Score: 0 }], userId: 3 });
    expect(maps.map((m) => m.sql)).toEqual([CLEAR_FINAL, expect.stringMatching(/^INSERT INTO bg_match_maps/)]);
    expect(maps[0].params).toEqual([10, "FINAL"]);
  });

  it("un forfait tranché efface le détail, même déclaré par une engagée", async () => {
    const { conn, maps } = fakeConnection({ type: "BO", value: 1 });
    await adminResolveMatch(conn, 10, { forfeitTeamId: 200 });
    expect(maps.map((m) => m.sql)).toContain(CLEAR_FINAL_SET);
    expect(maps.some((m) => m.sql.startsWith("INSERT"))).toBe(false);
  });

  it("un double forfait efface aussi le détail, sans rien insérer", async () => {
    const { conn, maps } = fakeConnection({ type: "BO", value: 3 });
    await adminResolveMatch(conn, 10, { doubleForfeit: true });
    expect(maps.at(-1)).toEqual({ sql: CLEAR_FINAL_SET, params: [10, "FINAL"] });
    expect(maps.some((m) => m.sql.startsWith("INSERT"))).toBe(false);
  });

  it("« Valider le résultat » avec des maps tranche sur le score dérivé", async () => {
    const { conn } = fakeConnection({ type: "BO", value: 3 });
    await adminResolveMatch(conn, 10, {
      maps: [
        { replayCode: "AAA111", team1Score: 0, team2Score: 2 },
        { replayCode: "BBB222", team1Score: 3, team2Score: 1 },
        { replayCode: "CCC333", team1Score: 2, team2Score: 0 },
      ],
      userId: 3,
    });
    expect(finalizeMatch).toHaveBeenCalledWith(
      conn,
      1,
      expect.anything(),
      { team1Score: 2, team2Score: 1, winnerTeamId: 100, loserTeamId: 200 },
    );
  });

  it("refuse des maps invalides avec leur code, sans rien écrire", async () => {
    const { conn, updates } = fakeConnection({ type: "BO", value: 5 });
    await expect(
      adminResolveMatch(conn, 10, {
        maps: [{ replayCode: "AB12", team1Score: 1, team2Score: 0 }],
        userId: 3,
      }),
    ).rejects.toThrow("MAP_REPLAY_CODE_INVALID");
    expect(updates).toHaveLength(0);
  });
});

/** Code de replay de chaque ligne insérée (`replaceMatchMaps` : 7 valeurs par map, le code en 4ᵉ). */
function insertedReplayCodes(maps: { sql: string; params: unknown }[]): unknown[] {
  const insert = maps.find((m) => m.sql.startsWith("INSERT INTO bg_match_maps"));
  if (!insert || !Array.isArray(insert.params)) return [];
  const params: unknown[] = insert.params;
  return params.filter((_value, index) => index % 7 === 3);
}

describe("arbitrage — code de replay facultatif", () => {
  it("« Enregistrer » accepte une map sans code et la stocke avec un code vide", async () => {
    const { conn, updates, maps } = fakeConnection({ type: "BO", value: 5 });
    await adminSaveMatchScores(conn, 10, {
      maps: [
        { replayCode: "", team1Score: 2, team2Score: 0 },
        { replayCode: "BBB222", team1Score: 0, team2Score: 2 },
      ],
      userId: 3,
    });
    expect(updates.at(-1)).toEqual([1, 1, 10]);
    expect(insertedReplayCodes(maps)).toEqual(["", "BBB222"]);
  });

  it("« Valider le résultat » tranche sur des maps toutes sans code", async () => {
    const { conn, maps } = fakeConnection({ type: "BO", value: 3 });
    await adminResolveMatch(conn, 10, {
      maps: [
        { replayCode: "", team1Score: 0, team2Score: 2 },
        { replayCode: "", team1Score: 2, team2Score: 1 },
        { replayCode: "", team1Score: 0, team2Score: 3 },
      ],
      userId: 3,
    });
    expect(finalizeMatch).toHaveBeenCalledWith(
      conn,
      1,
      expect.anything(),
      { team1Score: 1, team2Score: 2, winnerTeamId: 200, loserTeamId: 100 },
    );
    // Plusieurs codes vides ne se heurtent pas : seul un code saisi est unique.
    expect(insertedReplayCodes(maps)).toEqual(["", "", ""]);
  });

  it("refuse toujours un code saisi hors du motif du jeu, sans rien écrire (enregistrement)", async () => {
    const { conn, updates, maps } = fakeConnection({ type: "BO", value: 5 });
    await expect(
      adminSaveMatchScores(conn, 10, {
        maps: [
          { replayCode: "", team1Score: 2, team2Score: 0 },
          { replayCode: "AB12", team1Score: 2, team2Score: 0 },
        ],
        userId: 3,
      }),
    ).rejects.toThrow("MAP_REPLAY_CODE_INVALID");
    expect(updates).toHaveLength(0);
    expect(maps).toHaveLength(0);
  });

  it("refuse toujours un code saisi en double dans le match", async () => {
    const { conn, updates } = fakeConnection({ type: "BO", value: 3 });
    await expect(
      adminResolveMatch(conn, 10, {
        maps: [
          { replayCode: "AAA111", team1Score: 2, team2Score: 0 },
          { replayCode: "AAA111", team1Score: 2, team2Score: 0 },
        ],
        userId: 3,
      }),
    ).rejects.toThrow("MAP_REPLAY_CODE_DUPLICATE");
    expect(updates).toHaveLength(0);
  });
});

describe("arbitrage — garde d'exécution sur la saisie", () => {
  // Un corps non typé (appelant JS, conversion) : le type ne le voit pas, la garde si.
  const untyped = <T,>(json: string): T => JSON.parse(json) as T;

  it.each(['{}', '{"doubleForfeit": false}', '{"maps": "x", "userId": 3}', '{"maps": []}'])(
    "« Valider » refuse %s en INVALID_REQUEST, sans rien écrire",
    async (json) => {
      const { conn, updates, maps } = fakeConnection({ type: "BO", value: 3 });
      await expect(adminResolveMatch(conn, 10, untyped<AdminResolveEntry>(json))).rejects.toThrow("INVALID_REQUEST");
      expect(updates).toHaveLength(0);
      expect(maps).toHaveLength(0);
      expect(finalizeMatch).not.toHaveBeenCalled();
    },
  );

  it.each(['{}', '{"doubleForfeit": true}', '{"maps": [], "userId": "3"}'])(
    "« Enregistrer » refuse %s en INVALID_REQUEST, sans rien écrire",
    async (json) => {
      const { conn, updates, maps } = fakeConnection({ type: "BO", value: 3 });
      await expect(adminSaveMatchScores(conn, 10, untyped<AdminScoreEntry>(json))).rejects.toThrow("INVALID_REQUEST");
      expect(updates).toHaveLength(0);
      expect(maps).toHaveLength(0);
    },
  );
});
