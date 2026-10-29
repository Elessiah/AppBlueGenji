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
/** Le membre du staff qui ouvre la fenêtre. */
const VIEWER = 1;

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
let roundState: Record<string, unknown>;
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
  roundState = { open: 1, self_managed: 0, refereed: 0 };
  execute = jest.fn<SqlQuery>(async (sql) => {
    if (sql.includes("COUNT(*) AS open")) return [[roundState], []];
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
    await expect(loadRefereePanel(42, VIEWER)).resolves.toBeNull();
  });

  it("ne propose que les comptes qui peuvent arbitrer, triés par pseudo", async () => {
    users = [
      staffUser(3, "Zoé"),
      staffUser(4, "Ana"),
      staffUser(5, "Caster", { platform_roles_json: JSON.stringify(["CASTER"]) }),
      staffUser(6, "SansTag", { discord_verified_at: null }),
      staffUser(7, "Admin", { is_admin: 1, platform_roles_json: null }),
    ];
    const panel = await loadRefereePanel(42, VIEWER);
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
    const panel = await loadRefereePanel(42, VIEWER);
    expect(panel?.referee).toEqual({ userId: 5, pseudo: "Ancien", eligible: false, reason: "NOT_REFEREE" });
    expect(panel?.firstMap).toBe("Ilios");
    // L'arbitre en place est relu même sans rôle (paramètre de la lecture).
    expect(execute.mock.calls[1][1]).toEqual([5, VIEWER]);
  });

  it("loadRefereePanel_roundWithMaps_returnsRoundSlots", async () => {
    roundSlotsJson = '[["Ilios"],["Busan","Nepal"]]';
    const panel = await loadRefereePanel(42, VIEWER);
    expect(panel?.roundSlots).toEqual([["Ilios"], ["Busan", "Nepal"]]);
    const roundQuery = execute.mock.calls.find(([sql]) => sql.includes("FROM bg_tournament_round_maps"));
    expect(roundQuery?.[1]).toEqual([7, 0, "UPPER", 2]);
  });

  it("loadRefereePanel_roundWithoutMaps_returnsNoSlot", async () => {
    await expect(loadRefereePanel(42, VIEWER)).resolves.toMatchObject({ roundSlots: [] });
  });

  it("un arbitre disparu se lit « — », inéligible", async () => {
    match = { ...match, referee_user_id: 9 };
    const panel = await loadRefereePanel(42, VIEWER);
    expect(panel?.referee).toEqual({ userId: 9, pseudo: "—", eligible: false, reason: "ACCOUNT_GONE" });
  });

  it("ne propose pas un compte qui joue le match (membre d'une engagée ou engagé solo)", async () => {
    users = [staffUser(3, "Joueur"), staffUser(4, "Libre")];
    players = [3];
    const panel = await loadRefereePanel(42, VIEWER);
    expect(panel?.candidates).toEqual([{ userId: 4, pseudo: "Libre" }]);
    const playersCall = execute.mock.calls.find(([sql]) => sql.includes("FROM bg_team_members"));
    expect(playersCall?.[1]).toEqual([10, 11, 10, 11]);
  });

  it("l'arbitre qui joue désormais le match, avant le départ, ne peut plus arbitrer — comme dans l'instantané", async () => {
    match = { ...match, referee_user_id: 3 };
    users = [staffUser(3, "Joueur")];
    players = [3];
    await expect(loadRefereePanel(42, VIEWER)).resolves.toMatchObject({ referee: { userId: 3, eligible: false, reason: "REFEREE_IS_PLAYER" } });
  });

  it("une fois le match lancé, l'arbitre qui en est joueur reste désigné", async () => {
    match = { ...match, referee_user_id: 3, launched_at: STAMP };
    users = [staffUser(3, "Joueur")];
    players = [3];
    await expect(loadRefereePanel(42, VIEWER)).resolves.toMatchObject({ referee: { userId: 3, eligible: true, reason: null } });
  });

  it("sans adversaire connu, aucun joueur à relire", async () => {
    match = { ...match, team1_id: null, team2_id: null };
    users = [staffUser(4, "Libre")];
    await loadRefereePanel(42, VIEWER);
    expect(execute.mock.calls.some(([sql]) => sql.includes("FROM bg_team_members"))).toBe(false);
  });

  it("loadRefereePanel_objectedStaff_listedInObjectionsNotCandidates_stillObjectable", async () => {
    users = [staffUser(3, "Zoé"), staffUser(4, "Ana", { referee_objection_at: STAMP })];
    const panel = await loadRefereePanel(42, VIEWER);
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
    const panel = await loadRefereePanel(42, VIEWER);
    expect(panel).toMatchObject({ objections: [{ userId: 5, pseudo: "Caster" }], objectable: [] });
  });

  it("loadRefereePanel_readsEveryObjectedAccount_evenWithoutRoles", async () => {
    await loadRefereePanel(42, VIEWER);
    const [sql] = execute.mock.calls.find(([query]) => query.includes("FROM bg_users")) ?? [""];
    expect(sql).toContain("OR referee_objection_at IS NOT NULL");
  });

  it("loadRefereePanel_currentRefereeObjected_notEligible", async () => {
    match = { ...match, referee_user_id: 4 };
    users = [staffUser(4, "Ana", { referee_objection_at: STAMP })];
    const panel = await loadRefereePanel(42, VIEWER);
    expect(panel?.referee).toEqual({ userId: 4, pseudo: "Ana", eligible: false, reason: "REFEREE_OBJECTION" });
  });

  it("loadRefereePanel_viewerEligible_viewerBlockNull", async () => {
    users = [staffUser(VIEWER, "Moi")];
    await expect(loadRefereePanel(42, VIEWER)).resolves.toMatchObject({ viewerBlock: null });
  });

  it("loadRefereePanel_viewerPlaysMatch_viewerBlockIsPlayer_evenAfterLaunch", async () => {
    match = { ...match, launched_at: STAMP };
    users = [staffUser(VIEWER, "Moi")];
    players = [VIEWER];
    await expect(loadRefereePanel(42, VIEWER)).resolves.toMatchObject({ viewerBlock: "REFEREE_IS_PLAYER" });
  });

  it("loadRefereePanel_viewerUncertified_viewerBlockIdentity", async () => {
    users = [staffUser(VIEWER, "Moi", { blizzard_sub: null, overwatch_battletag: null })];
    await expect(loadRefereePanel(42, VIEWER)).resolves.toMatchObject({ viewerBlock: "REFEREE_IDENTITY_REQUIRED" });
  });

  it("loadRefereePanel_viewerObjected_viewerBlockObjection", async () => {
    users = [staffUser(VIEWER, "Moi", { referee_objection_at: STAMP })];
    await expect(loadRefereePanel(42, VIEWER)).resolves.toMatchObject({ viewerBlock: "REFEREE_OBJECTION" });
  });

  it("loadRefereePanel_roundState_readsCountsOfOpenMatches", async () => {
    roundState = { open: "4", self_managed: "1", refereed: "2" };
    const panel = await loadRefereePanel(42, VIEWER);
    expect(panel?.round).toEqual({ phaseId: 0, roundNumber: 2, bracket: "UPPER", open: 4, selfManaged: 1, refereed: 2 });
    const [sql, params] = execute.mock.calls.find(([query]) => query.includes("COUNT(*) AS open")) ?? ["", []];
    expect(sql).toContain("status <> 'COMPLETED' AND is_bye = 0");
    expect(params).toEqual([7, 0, 2, "UPPER"]);
  });

  it("loadRefereePanel_roundStateNullSums_zero", async () => {
    roundState = { open: 0, self_managed: null, refereed: null };
    const panel = await loadRefereePanel(42, VIEWER);
    expect(panel?.round).toMatchObject({ open: 0, selfManaged: 0, refereed: 0 });
  });
});
