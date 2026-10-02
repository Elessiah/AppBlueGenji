import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { transferTeamOwnership } from "@/lib/server/teams/roster";
import { assertTermsAccepted } from "@/lib/server/terms-acceptance";
import { type SqlQuery, connectionMock, fakePool } from "../../helpers/sql-double";

jest.mock("@/lib/server/terms-acceptance", () =>
  jest.requireActual<typeof import("../../helpers/terms-acceptance-double")>("../../helpers/terms-acceptance-double").termsAcceptanceDouble(),
);
jest.mock("@/lib/server/database");

const TEAM_ID = 7;
const REQUESTER_ID = 1;
const TARGET_ID = 2;

type Scenario = {
  /** Rôles en cours par joueur ; absent = pas (ou plus) membre. */
  roster: Record<number, string[]>;
  /** Compte du destinataire : vivant, anonymisé, ou introuvable. */
  targetAccount?: "alive" | "deleted" | "missing";
  /** Lignes appariées par chaque `UPDATE`, dans l'ordre (défaut : 1). */
  affected?: number[];
  /** Erreur levée par le n-ième `UPDATE` (0 = le premier). */
  failUpdateAt?: number;
};

/**
 * Base simulée : tout `transferTeamOwnership` se joue sur la connexion de la
 * transaction, dont `execute` répond selon la requête — compte du
 * destinataire, ligne de l'équipe, rôles d'un membre, écritures.
 */
async function mockDb(scenario: Scenario) {
  const { getDatabase } = await import("@/lib/server/database");
  const poolExecute = jest.fn<SqlQuery>();
  const connection = connectionMock();
  let updateIndex = 0;
  connection.execute.mockImplementation(async (sql, params) => {
    const args = params as unknown[];
    if (/FROM bg_users WHERE id = \? FOR UPDATE/.test(sql)) {
      const state = scenario.targetAccount ?? "alive";
      return [state === "missing" ? [] : [{ is_deleted: state === "deleted" ? 1 : 0 }], []];
    }
    if (/FROM bg_teams WHERE id = \? FOR UPDATE/.test(sql)) return [[{ id: TEAM_ID }], []];
    if (/SELECT roles_json/.test(sql)) {
      const roles = scenario.roster[Number(args[1])];
      return [roles ? [{ roles_json: JSON.stringify(roles) }] : [], []];
    }
    if (/UPDATE bg_team_members/.test(sql)) {
      const index = updateIndex++;
      if (scenario.failUpdateAt === index) throw new Error("DB_DOWN");
      return [{ affectedRows: scenario.affected?.[index] ?? 1 }, []];
    }
    throw new Error(`requête inattendue : ${sql}`);
  });
  jest.mocked(getDatabase).mockResolvedValue(fakePool({
    execute: poolExecute,
    getConnection: jest.fn(async () => connection),
  }));
  const sqls = () => connection.execute.mock.calls.map(([sql]) => String(sql));
  const updates = () =>
    (connection.execute.mock.calls as [string, unknown[]][]).filter(([sql]) => /UPDATE bg_team_members/.test(sql));
  return { connection, poolExecute, sqls, updates };
}

describe("transferTeamOwnership", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("déplace OWNER vers la cible et conserve les autres rôles de chacun", async () => {
    const { connection, updates } = await mockDb({
      roster: { [REQUESTER_ID]: ["OWNER", "CAPITAINE", "TANK"], [TARGET_ID]: ["DPS"] },
    });

    await transferTeamOwnership(REQUESTER_ID, TEAM_ID, TARGET_ID);

    // L'ancien propriétaire perd OWNER mais garde CAPITAINE et TANK.
    expect(updates()[0][1]).toEqual([JSON.stringify(["CAPITAINE", "TANK"]), TEAM_ID, REQUESTER_ID]);
    // Le nouveau propriétaire reçoit OWNER en tête, sans perdre son rôle de jeu.
    expect(updates()[1][1]).toEqual([JSON.stringify(["OWNER", "DPS"]), TEAM_ID, TARGET_ID]);

    expect(connection.commit).toHaveBeenCalled();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it("laisse l'ancien propriétaire dans l'équipe avec un rôle par défaut", async () => {
    // Un membre sans aucun rôle n'existe pas côté modèle : OWNER seul retombe
    // sur DPS, comme à l'arrivée d'un membre (`acceptIntoTeam`).
    const { updates } = await mockDb({ roster: { [REQUESTER_ID]: ["OWNER"], [TARGET_ID]: ["HEAL"] } });

    await transferTeamOwnership(REQUESTER_ID, TEAM_ID, TARGET_ID);

    expect(updates()[0][1]).toEqual([JSON.stringify(["DPS"]), TEAM_ID, REQUESTER_ID]);
  });

  it("ne duplique pas OWNER si la cible le porte déjà", async () => {
    const { updates } = await mockDb({
      roster: { [REQUESTER_ID]: ["OWNER"], [TARGET_ID]: ["OWNER", "TANK"] },
    });

    await transferTeamOwnership(REQUESTER_ID, TEAM_ID, TARGET_ID);

    expect(updates()[1][1]).toEqual([JSON.stringify(["OWNER", "TANK"]), TEAM_ID, TARGET_ID]);
  });

  it("refuse un transfert vers soi-même sans toucher à la base", async () => {
    const { connection, poolExecute } = await mockDb({ roster: {} });

    await expect(transferTeamOwnership(5, TEAM_ID, 5)).rejects.toThrow("TRANSFER_TO_SELF");
    expect(poolExecute).not.toHaveBeenCalled();
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("refuse un demandeur étranger à l'équipe, sans rien écrire", async () => {
    const { connection, updates } = await mockDb({ roster: { [TARGET_ID]: ["DPS"] } });

    await expect(transferTeamOwnership(REQUESTER_ID, TEAM_ID, TARGET_ID)).rejects.toThrow("FORBIDDEN");
    expect(updates()).toHaveLength(0);
    expect(connection.rollback).toHaveBeenCalled();
  });

  it.each([["MANAGER"], ["CAPITAINE"], ["DPS"]])(
    "refuse un demandeur %s : seul le propriétaire transfère",
    async (role) => {
      const { updates } = await mockDb({ roster: { [REQUESTER_ID]: [role], [TARGET_ID]: ["DPS"] } });

      await expect(transferTeamOwnership(REQUESTER_ID, TEAM_ID, TARGET_ID)).rejects.toThrow("FORBIDDEN");
      expect(updates()).toHaveLength(0);
    },
  );

  it("vérifie les conditions du demandeur sur la connexion de la transaction", async () => {
    const { connection } = await mockDb({ roster: { [REQUESTER_ID]: ["OWNER"], [TARGET_ID]: ["DPS"] } });

    await transferTeamOwnership(REQUESTER_ID, TEAM_ID, TARGET_ID);

    expect(assertTermsAccepted).toHaveBeenCalledWith(REQUESTER_ID, connection);
  });

  it("refuse une cible qui n'est pas membre de l'équipe", async () => {
    const { updates } = await mockDb({ roster: { [REQUESTER_ID]: ["OWNER"] } });

    await expect(transferTeamOwnership(REQUESTER_ID, TEAM_ID, TARGET_ID)).rejects.toThrow("MEMBER_NOT_FOUND");
    expect(updates()).toHaveLength(0);
  });

  it.each([["deleted" as const], ["missing" as const]])(
    "refuse une cible dont le compte est %s",
    async (targetAccount) => {
      // L'anonymisation ne détache pas de l'équipe : sans ce contrôle, l'équipe
      // passait à un compte qui ne peut plus ouvrir de session — et, seul le
      // propriétaire transférant ou dissolvant, l'état devenait définitif.
      const { connection, updates } = await mockDb({
        roster: { [REQUESTER_ID]: ["OWNER"], [TARGET_ID]: ["DPS"] },
        targetAccount,
      });

      await expect(transferTeamOwnership(REQUESTER_ID, TEAM_ID, TARGET_ID)).rejects.toThrow(
        "MEMBER_ACCOUNT_DELETED",
      );
      expect(updates()).toHaveLength(0);
      expect(connection.rollback).toHaveBeenCalled();
      expect(connection.commit).not.toHaveBeenCalled();
    },
  );

  it("verrouille le compte cible puis l'équipe, avant toute lecture des rôles", async () => {
    // Ordre établi par `acceptIntoTeam` : ligne du joueur, puis équipe. Sous
    // REPEATABLE READ, la première lecture ordinaire fige l'instantané : les
    // rôles ne se lisent qu'après les verrous, et eux-mêmes sous verrou.
    const { sqls, poolExecute } = await mockDb({
      roster: { [REQUESTER_ID]: ["OWNER"], [TARGET_ID]: ["DPS"] },
    });

    await transferTeamOwnership(REQUESTER_ID, TEAM_ID, TARGET_ID);

    expect(sqls()[0]).toMatch(/SELECT is_deleted FROM bg_users WHERE id = \? FOR UPDATE/);
    expect(sqls()[1]).toMatch(/SELECT id FROM bg_teams WHERE id = \? FOR UPDATE/);
    const roleReads = sqls().filter((sql) => /SELECT roles_json/.test(sql));
    expect(roleReads).toHaveLength(2);
    for (const sql of roleReads) expect(sql).toMatch(/FOR UPDATE/);
    // Plus aucune lecture des rôles sur le pool, hors de la transaction.
    expect(poolExecute).not.toHaveBeenCalled();
  });

  it.each([
    ["l'ancien propriétaire", [0, 1]],
    ["le destinataire, parti entre-temps", [1, 0]],
  ])("défait tout si l'écriture sur %s n'apparie aucune ligne", async (_label, affected) => {
    // Sans ce contrôle, l'ancien propriétaire perdait OWNER pendant que
    // l'`UPDATE` du destinataire parti n'appariait rien : équipe sans OWNER.
    const { connection } = await mockDb({
      roster: { [REQUESTER_ID]: ["OWNER"], [TARGET_ID]: ["DPS"] },
      affected,
    });

    await expect(transferTeamOwnership(REQUESTER_ID, TEAM_ID, TARGET_ID)).rejects.toThrow("MEMBER_NOT_FOUND");
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it("refuse sur une équipe fantôme, qui n'a aucun membre", async () => {
    // Une fantôme s'attribue (`claimGhostTeam`), elle ne se transfère pas :
    // faute de ligne `bg_team_members`, le demandeur n'est jamais OWNER.
    await mockDb({ roster: {} });

    await expect(transferTeamOwnership(REQUESTER_ID, TEAM_ID, TARGET_ID)).rejects.toThrow("FORBIDDEN");
  });

  it("annule la transaction si une écriture échoue", async () => {
    const { connection } = await mockDb({
      roster: { [REQUESTER_ID]: ["OWNER", "TANK"], [TARGET_ID]: ["DPS"] },
      failUpdateAt: 1,
    });

    await expect(transferTeamOwnership(REQUESTER_ID, TEAM_ID, TARGET_ID)).rejects.toThrow("DB_DOWN");
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it("ne touche qu'aux adhésions actives des deux joueurs", async () => {
    const { updates } = await mockDb({ roster: { [REQUESTER_ID]: ["OWNER"], [TARGET_ID]: ["DPS"] } });

    await transferTeamOwnership(REQUESTER_ID, TEAM_ID, TARGET_ID);

    expect(updates()).toHaveLength(2);
    for (const [sql] of updates()) {
      expect(sql).toMatch(/WHERE team_id = \?/);
      expect(sql).toMatch(/AND user_id = \?/);
      expect(sql).toMatch(/AND left_at IS NULL/);
    }
  });
});
