import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { withConnection } from "@/lib/server/database";
import { loadRefereePanel } from "@/lib/server/tournaments/referee-panel";
import { fakeConnection, type SqlQuery } from "../../helpers/sql-double";

/**
 * Fenêtre « Arbitrage » d'un match (`lib/server/tournaments/referee-panel.ts`,
 * `docs/features/MATCH_REFEREE.md`) : l'arbitre nommé, et les comptes du staff
 * qui peuvent arbitrer — rôles relus en base.
 */

const STAMP = new Date("2026-10-27T18:00:00Z");

function staffUser(id: number, pseudo: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    pseudo,
    discord_verified_at: STAMP,
    discord_pseudo: pseudo.toLowerCase(),
    blizzard_sub: "sub",
    overwatch_battletag: `${pseudo}#1`,
    is_deleted: 0,
    is_admin: 0,
    platform_roles_json: JSON.stringify(["ARBITRE"]),
    ...overrides,
  };
}

let match: Record<string, unknown> | null;
let users: Record<string, unknown>[];
let execute: jest.Mock<SqlQuery>;

beforeEach(() => {
  jest.clearAllMocks();
  match = { id: 42, phase_id: 0, round_number: 2, bracket: "UPPER", self_managed: 0, first_map: null, referee_user_id: null };
  users = [];
  execute = jest.fn<SqlQuery>(async (sql) => {
    if (sql.includes("FROM bg_matches")) return [match ? [match] : [], []];
    if (sql.includes("FROM bg_users")) return [users, []];
    throw new Error(`requête inattendue : ${sql}`);
  });
  jest.mocked(withConnection).mockImplementation((run) => run(fakeConnection({ execute })));
});

describe("loadRefereePanel", () => {
  it("`null` pour un match inconnu", async () => {
    match = null;
    await expect(loadRefereePanel(42)).resolves.toBeNull();
  });

  it("ne propose que les comptes qui peuvent arbitrer, triés par pseudo", async () => {
    users = [
      staffUser(3, "Zoé"),
      staffUser(4, "Ana"),
      staffUser(5, "Caster", { platform_roles_json: JSON.stringify(["CASTER"]) }),
      staffUser(6, "SansTag", { discord_verified_at: null }),
      staffUser(7, "Admin", { is_admin: 1, platform_roles_json: null }),
    ];
    const panel = await loadRefereePanel(42);
    expect(panel?.candidates).toEqual([
      { userId: 7, pseudo: "Admin" },
      { userId: 4, pseudo: "Ana" },
      { userId: 3, pseudo: "Zoé" },
    ]);
    expect(panel).toMatchObject({ referee: null, selfManaged: false, firstMap: null, round: { phaseId: 0, roundNumber: 2, bracket: "UPPER" } });
  });

  it("nomme l'arbitre en place et dit s'il peut encore arbitrer ; la carte en texte visible", async () => {
    match = { ...match, referee_user_id: 5, self_managed: 0, first_map: " Ilios​ " };
    users = [staffUser(5, "Ancien", { platform_roles_json: JSON.stringify(["CASTER"]) })];
    const panel = await loadRefereePanel(42);
    expect(panel?.referee).toEqual({ userId: 5, pseudo: "Ancien", eligible: false });
    expect(panel?.firstMap).toBe("Ilios");
    // L'arbitre en place est relu même sans rôle (paramètre de la lecture).
    expect(execute.mock.calls[1][1]).toEqual([5]);
  });

  it("un arbitre disparu se lit « — », inéligible", async () => {
    match = { ...match, referee_user_id: 9 };
    const panel = await loadRefereePanel(42);
    expect(panel?.referee).toEqual({ userId: 9, pseudo: "—", eligible: false });
  });
});
