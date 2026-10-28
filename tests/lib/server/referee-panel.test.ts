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
    referee_objection_at: null,
    ...overrides,
  };
}

let match: Record<string, unknown> | null;
let users: Record<string, unknown>[];
let players: number[];
let roundSlotsJson: string | null;
let execute: jest.Mock<SqlQuery>;

beforeEach(() => {
  jest.clearAllMocks();
  match = {
    id: 42,
    tournament_id: 7,
    phase_id: 0,
    round_number: 2,
    bracket: "UPPER",
    self_managed: 0,
    first_map: null,
    referee_user_id: null,
    team1_id: 10,
    team2_id: 11,
    status: "READY",
    launched_at: null,
  };
  users = [];
  players = [];
  roundSlotsJson = null;
  execute = jest.fn<SqlQuery>(async (sql) => {
    if (sql.includes("FROM bg_matches")) return [match ? [match] : [], []];
    if (sql.includes("FROM bg_users")) return [users, []];
    if (sql.includes("FROM bg_team_members")) return [players.map((user_id) => ({ user_id })), []];
    if (sql.includes("FROM bg_tournament_round_maps")) return [roundSlotsJson === null ? [] : [{ slots_json: roundSlotsJson }], []];
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

  it("loadRefereePanel_roundWithMaps_returnsRoundSlots", async () => {
    roundSlotsJson = '[["Ilios"],["Busan","Nepal"]]';
    const panel = await loadRefereePanel(42);
    expect(panel?.roundSlots).toEqual([["Ilios"], ["Busan", "Nepal"]]);
    const roundQuery = execute.mock.calls.find(([sql]) => sql.includes("FROM bg_tournament_round_maps"));
    expect(roundQuery?.[1]).toEqual([7, 0, "UPPER", 2]);
  });

  it("loadRefereePanel_roundWithoutMaps_returnsNoSlot", async () => {
    await expect(loadRefereePanel(42)).resolves.toMatchObject({ roundSlots: [] });
  });

  it("un arbitre disparu se lit « — », inéligible", async () => {
    match = { ...match, referee_user_id: 9 };
    const panel = await loadRefereePanel(42);
    expect(panel?.referee).toEqual({ userId: 9, pseudo: "—", eligible: false });
  });

  it("ne propose pas un compte qui joue le match (membre d'une engagée ou engagé solo)", async () => {
    users = [staffUser(3, "Joueur"), staffUser(4, "Libre")];
    players = [3];
    const panel = await loadRefereePanel(42);
    expect(panel?.candidates).toEqual([{ userId: 4, pseudo: "Libre" }]);
    const playersCall = execute.mock.calls.find(([sql]) => sql.includes("FROM bg_team_members"));
    expect(playersCall?.[1]).toEqual([10, 11, 10, 11]);
  });

  it("l'arbitre qui joue désormais le match, avant le départ, ne peut plus arbitrer — comme dans l'instantané", async () => {
    match = { ...match, referee_user_id: 3 };
    users = [staffUser(3, "Joueur")];
    players = [3];
    await expect(loadRefereePanel(42)).resolves.toMatchObject({ referee: { userId: 3, eligible: false } });
  });

  it("une fois le match lancé, l'arbitre qui en est joueur reste désigné", async () => {
    match = { ...match, referee_user_id: 3, launched_at: STAMP };
    users = [staffUser(3, "Joueur")];
    players = [3];
    await expect(loadRefereePanel(42)).resolves.toMatchObject({ referee: { userId: 3, eligible: true } });
  });

  it("sans adversaire connu, aucun joueur à relire", async () => {
    match = { ...match, team1_id: null, team2_id: null };
    users = [staffUser(4, "Libre")];
    await loadRefereePanel(42);
    expect(execute.mock.calls.some(([sql]) => sql.includes("FROM bg_team_members"))).toBe(false);
  });

  it("loadRefereePanel_objectedStaff_listedInObjectionsNotCandidates_stillObjectable", async () => {
    users = [staffUser(3, "Zoé"), staffUser(4, "Ana", { referee_objection_at: STAMP })];
    const panel = await loadRefereePanel(42);
    expect(panel?.candidates).toEqual([{ userId: 3, pseudo: "Zoé" }]);
    expect(panel?.objections).toEqual([{ userId: 4, pseudo: "Ana" }]);
    // Une opposition retenue reste proposée : la retenir de nouveau rejoue le retrait.
    expect(panel?.objectable).toEqual([
      { userId: 4, pseudo: "Ana" },
      { userId: 3, pseudo: "Zoé" },
    ]);
  });

  it("loadRefereePanel_objectionOnAccountThatNoLongerReferees_stillListedForLift_notObjectable", async () => {
    users = [staffUser(5, "Caster", { platform_roles_json: JSON.stringify(["CASTER"]), referee_objection_at: STAMP })];
    const panel = await loadRefereePanel(42);
    expect(panel).toMatchObject({ objections: [{ userId: 5, pseudo: "Caster" }], objectable: [] });
  });

  it("loadRefereePanel_readsEveryObjectedAccount_evenWithoutRoles", async () => {
    await loadRefereePanel(42);
    const [sql] = execute.mock.calls.find(([query]) => query.includes("FROM bg_users")) ?? [""];
    expect(sql).toContain("OR referee_objection_at IS NOT NULL");
  });

  it("loadRefereePanel_currentRefereeObjected_notEligible", async () => {
    match = { ...match, referee_user_id: 4 };
    users = [staffUser(4, "Ana", { referee_objection_at: STAMP })];
    const panel = await loadRefereePanel(42);
    expect(panel?.referee).toEqual({ userId: 4, pseudo: "Ana", eligible: false });
  });
});
