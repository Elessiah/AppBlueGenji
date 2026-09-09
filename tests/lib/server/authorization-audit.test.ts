import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

/**
 * Les trous refermés par la passe de sécurité (tâche 21 de `TODO.md`), tenus
 * chacun par le cas qui les révélait.
 *
 * Ils n'ont rien en commun sinon d'être des règles de `docs/AUTHORIZATION_RULES.md`
 * que le code ne tenait pas ; les regrouper ici les rend relisibles ensemble le
 * jour où la passe sera refaite.
 */

jest.mock("@/lib/server/teams-service");
jest.mock("@/lib/server/tournaments/state");
jest.mock("@/lib/server/tournaments/byes");

import { reportMatchScore } from "@/lib/server/tournaments/scoring";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";
import { sanitizeRoles } from "@/lib/server/users-service";
import { visibleAvatarUrl } from "@/lib/shared/avatar";

// ───────────────────────── §4.3 — écraser un résultat validé ─────────────────

type MatchOverrides = { status?: string; winner_team_id?: number | null };

/**
 * Connexion factice servant un match de « BlueGenji Survie », seul mode où
 * l'égalité est enregistrable (`lib/server/tournaments/validation.ts`).
 */
function fakeConnection(overrides: MatchOverrides = {}): {
  conn: PoolConnection;
  writes: string[];
} {
  const writes: string[] = [];
  const match = {
    id: 10,
    tournament_id: 1,
    round_number: 1,
    team1_id: 100,
    team2_id: 200,
    team1_report_score: null,
    team1_report_opponent_score: null,
    team1_reported_at: null,
    team2_report_score: null,
    team2_report_opponent_score: null,
    team2_reported_at: null,
    score_deadline_at: null,
    next_winner_match_id: null,
    next_winner_slot: null,
    next_loser_match_id: null,
    next_loser_slot: null,
    winner_team_id: null,
    status: "READY",
    ...overrides,
  };

  const conn = {
    execute: async (sql: string) => {
      const q = sql.replace(/\s+/g, " ").trim();
      if (q.startsWith("UPDATE")) {
        writes.push(q);
        return [{ affectedRows: 1 }, []];
      }
      if (q.includes("FROM bg_tournaments")) {
        return [
          [
            {
              format: "BG_SURVIE",
              match_format_type: "BO",
              match_format_value: 5,
              match_format_max_maps: 4,
              match_format_draws: 1,
              endurance_playoff_format_type: null,
              endurance_playoff_format_value: null,
            },
          ],
          [],
        ];
      }
      if (q.includes("FROM bg_matches")) return [[{ ...match }], []];
      return [[], []];
    },
  } as unknown as PoolConnection;

  return { conn, writes };
}

function mockRunningTournament(): void {
  (syncTournamentState as jest.Mock).mockResolvedValue({
    row: { id: 1, state: "RUNNING", format: "BG_SURVIE", participant_type: "TEAM" },
    stateChanged: false,
  } as never);
}

describe("§4.3 — un engagé ne peut pas écraser un résultat déjà validé", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getUserActiveTeam as jest.Mock).mockResolvedValue({ teamId: 100, roles: ["OWNER"] } as never);
    (tryAutoResolveByes as jest.Mock).mockResolvedValue(undefined as never);
    mockRunningTournament();
  });

  it("refuse le report sur une rencontre close par un match nul", async () => {
    // Le cœur du trou : un nul est `COMPLETED` **sans** vainqueur. Le refus se
    // lisait sur `winner_team_id`, donc il ne se déclenchait pas — le statut
    // repassait en `AWAITING_CONFIRMATION`, et deux reports concordants
    // réécrivaient le score d'une rencontre finie.
    const { conn, writes } = fakeConnection({ status: "COMPLETED", winner_team_id: null });

    await expect(reportMatchScore(conn, 1, 10, 42, 2, 2)).rejects.toThrow(
      "MATCH_ALREADY_COMPLETED",
    );
    expect(writes).toHaveLength(0);
  });

  it("refuse aussi sur une rencontre close avec un vainqueur", async () => {
    const { conn, writes } = fakeConnection({ status: "COMPLETED", winner_team_id: 100 });

    await expect(reportMatchScore(conn, 1, 10, 42, 3, 1)).rejects.toThrow(
      "MATCH_ALREADY_COMPLETED",
    );
    expect(writes).toHaveLength(0);
  });

  it("laisse passer le report d'une rencontre encore ouverte", async () => {
    // Le garde-fou ne doit pas se refermer sur le cas nominal.
    const { conn, writes } = fakeConnection();

    await expect(reportMatchScore(conn, 1, 10, 42, 2, 2)).resolves.toBeUndefined();
    expect(writes.some((q) => q.includes("team1_report_score"))).toBe(true);
  });
});

// ───────────────────────── §3.1 — le repli de `sanitizeRoles` ────────────────

describe("§3.1 — `sanitizeRoles` n'invente jamais de rôle", () => {
  it("rend une liste vide plutôt que `OWNER` sur une entrée vide", () => {
    // Le repli historique était `["OWNER"]`. Ses appelants le filtraient tous,
    // si bien qu'il n'a jamais rien accordé — mais il attendait le premier qui
    // oublierait le filtre pour faire d'un corps de requête vide une prise de
    // propriété.
    expect(sanitizeRoles([])).toEqual([]);
  });

  it("écarte les valeurs inconnues sans rien mettre à la place", () => {
    expect(sanitizeRoles(["PRESIDENT", "", null] as never)).toEqual([]);
  });

  it("garde les rôles connus, dédupliqués", () => {
    expect(sanitizeRoles(["DPS", "DPS", "HEAL"])).toEqual(["DPS", "HEAL"]);
  });

  it("ne retire pas `OWNER` : c'est aux appelants de le filtrer", () => {
    // La fonction normalise, elle n'arbitre pas. Les deux appelants qui
    // écrivent des rôles retirent `OWNER` juste après, chacun pour sa raison
    // (`MISSING_ROLE` d'un côté, repli `DPS` de l'autre).
    expect(sanitizeRoles(["OWNER", "TANK"])).toEqual(["OWNER", "TANK"]);
  });
});

// ───────────────────────── §2.3 — visibilité de l'avatar ─────────────────────

describe("§2.3 — l'avatar masqué ne sort pas du compte", () => {
  it("masque l'avatar d'un tiers qui l'a rendu privé", () => {
    expect(visibleAvatarUrl("/uploads/avatars/1.webp", false)).toBeNull();
  });

  it("laisse le propriétaire voir le sien", () => {
    expect(visibleAvatarUrl("/uploads/avatars/1.webp", false, true)).toBe(
      "/uploads/avatars/1.webp",
    );
  });

  it("laisse passer un avatar public", () => {
    expect(visibleAvatarUrl("/uploads/avatars/1.webp", true)).toBe("/uploads/avatars/1.webp");
  });

  it("rend `null` — jamais une chaîne vide — quand il n'y a pas d'avatar", () => {
    // Le repli d'affichage est la pastille à initiale, qui se déclenche sur
    // `null` : une chaîne vide produirait une image cassée.
    expect(visibleAvatarUrl(null, true, true)).toBeNull();
    expect(visibleAvatarUrl("", true, true)).toBeNull();
    expect(visibleAvatarUrl(undefined, false)).toBeNull();
  });
});
