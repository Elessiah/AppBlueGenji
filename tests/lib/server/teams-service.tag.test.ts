import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createTeam, softDeleteTeam, updateTeamMeta } from "@/lib/server/teams-service";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

jest.mock("@/lib/server/terms-acceptance", () =>
  jest.requireActual<typeof import("../../helpers/terms-acceptance-double")>("../../helpers/terms-acceptance-double").termsAcceptanceDouble(),
);
jest.mock("@/lib/server/database");

/**
 * Écriture du sigle par le service : validation de forme avant toute requête,
 * unicité vérifiée dans la transaction, et collision d'index traduite.
 *
 * Le point qui compte : rien n'est écrit tant que le sigle n'est pas acceptable.
 * Un refus qui arriverait après l'insertion de l'équipe laisserait une ligne
 * derrière lui.
 */

type Exec = jest.Mock<(sql: string, params?: unknown[]) => Promise<unknown>>;

async function mockDb() {
  const { getDatabase } = await import("@/lib/server/database");
  const poolExecute = jest.fn<SqlQuery>() as Exec;
  const connectionExecute = jest.fn<SqlQuery>() as Exec;
  const connection = {
    execute: connectionExecute,
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
  jest.mocked(getDatabase).mockResolvedValue(fakePool({
    execute: poolExecute,
    getConnection: jest.fn(async () => connection),
  }));
  return { poolExecute, connectionExecute, connection };
}

/**
 * Les deux premières instructions de la transaction de `createTeam` : verrou de
 * la ligne du joueur, puis relecture de son appartenance (aucune équipe active).
 */
function lockedAndFree(connectionExecute: Exec) {
  connectionExecute
    .mockResolvedValueOnce([[{ id: 1 }], []])
    .mockResolvedValueOnce([[], []]);
}

/** SQL des appels d'un mock, concaténé — pratique pour affirmer une absence. */
function sqlOf(execute: Exec): string {
  return execute.mock.calls.map((call) => String(call[0])).join("\n");
}

describe("createTeam — sigle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("normalise le sigle et l'écrit avec l'équipe", async () => {
    const { connectionExecute } = await mockDb();
    lockedAndFree(connectionExecute); // compte verrouillé, aucune équipe active
    connectionExecute
      .mockResolvedValueOnce([[], []]) // sigle libre
      .mockResolvedValueOnce([{ insertId: 5 }, []]) // insertion de l'équipe
      .mockResolvedValueOnce([{ insertId: 9 }, []]); // insertion du membre

    await expect(createTeam(1, "Dragon Squad", null, "  drgn ")).resolves.toBe(5);

    const insert = connectionExecute.mock.calls[3] as [string, unknown[]];
    expect(insert[0]).toMatch(/INSERT INTO bg_teams \(name, tag, logo_url, description\)/);
    expect(insert[1]).toEqual(["Dragon Squad", "DRGN", null]);
  });

  it("écrit NULL quand aucun sigle n'est demandé", async () => {
    const { connectionExecute } = await mockDb();
    lockedAndFree(connectionExecute);
    connectionExecute
      .mockResolvedValueOnce([{ insertId: 5 }, []])
      .mockResolvedValueOnce([{ insertId: 9 }, []]);

    await createTeam(1, "Dragon Squad");

    const insert = connectionExecute.mock.calls[2] as [string, unknown[]];
    expect(insert[1]).toEqual(["Dragon Squad", null, null]);
    // Aucun contrôle d'unicité : il n'y a pas de sigle à réserver.
    expect(sqlOf(connectionExecute)).not.toMatch(/SELECT id FROM bg_teams WHERE tag/);
  });

  it("refuse un sigle mal formé avant d'ouvrir la moindre transaction", async () => {
    const { poolExecute, connectionExecute, connection } = await mockDb();
    poolExecute.mockResolvedValue([[], []]);

    await expect(createTeam(1, "Dragon Squad", null, "D")).rejects.toThrow("TEAM_TAG_TOO_SHORT");
    expect(connectionExecute).not.toHaveBeenCalled();
    expect(connection.beginTransaction).not.toHaveBeenCalled();
    // Le contrôle précède même la lecture de l'équipe active.
    expect(poolExecute).not.toHaveBeenCalled();
  });

  it("refuse un sigle déjà pris et défait la transaction", async () => {
    const { connectionExecute, connection } = await mockDb();
    lockedAndFree(connectionExecute);
    connectionExecute.mockResolvedValueOnce([[{ id: 8 }], []]); // sigle occupé

    await expect(createTeam(1, "Dragon Squad", null, "DRGN")).rejects.toThrow(
      "TEAM_TAG_ALREADY_USED",
    );
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(sqlOf(connectionExecute)).not.toMatch(/INSERT INTO bg_teams/);
  });

  it("traduit la course perdue contre une création simultanée", async () => {
    const { connectionExecute, connection } = await mockDb();
    lockedAndFree(connectionExecute);
    connectionExecute
      .mockResolvedValueOnce([[], []]) // libre au moment du contrôle…
      .mockRejectedValueOnce(
        Object.assign(new Error("Duplicate entry 'DRGN' for key 'bg_teams.uniq_bg_teams_tag'"), {
          code: "ER_DUP_ENTRY",
          sqlMessage: "Duplicate entry 'DRGN' for key 'bg_teams.uniq_bg_teams_tag'",
        }),
      ); // …pris à l'insertion

    await expect(createTeam(1, "Dragon Squad", null, "DRGN")).rejects.toThrow(
      "TEAM_TAG_ALREADY_USED",
    );
    expect(connection.rollback).toHaveBeenCalled();
  });
});

describe("createTeam — une seule équipe active (§3.1)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("verrouille la ligne du joueur en toute première instruction, puis relit son appartenance", async () => {
    // Le verrou d'`acceptIntoTeam` : deux créations simultanées, ou une
    // création et une acceptation, se sérialisent au lieu de passer toutes
    // deux le contrôle. Sous REPEATABLE READ, rien ne se lit avant lui.
    const { poolExecute, connectionExecute } = await mockDb();
    lockedAndFree(connectionExecute);
    connectionExecute
      .mockResolvedValueOnce([{ insertId: 5 }, []])
      .mockResolvedValueOnce([{ insertId: 9 }, []]);

    await createTeam(1, "Dragon Squad");

    const [lockSql, lockParams] = connectionExecute.mock.calls[0] as [string, unknown[]];
    expect(lockSql).toMatch(/SELECT id FROM bg_users WHERE id = \? FOR UPDATE/);
    expect(lockParams).toEqual([1]);
    const [membershipSql, membershipParams] = connectionExecute.mock.calls[1] as [string, unknown[]];
    expect(membershipSql).toMatch(/FROM bg_team_members[\s\S]*WHERE user_id = \?[\s\S]*left_at IS NULL/);
    expect(membershipParams).toEqual([1]);
    // Plus aucune lecture sur le pool, hors de la transaction.
    expect(poolExecute).not.toHaveBeenCalled();
  });

  it("refuse un joueur déjà dans une équipe active, sans rien écrire", async () => {
    const { connectionExecute, connection } = await mockDb();
    connectionExecute
      .mockResolvedValueOnce([[{ id: 1 }], []])
      .mockResolvedValueOnce([[{ id: 40 }], []]); // équipe active (vue sous le verrou)

    await expect(createTeam(1, "Dragon Squad")).rejects.toThrow("USER_ALREADY_IN_TEAM");
    expect(sqlOf(connectionExecute)).not.toMatch(/INSERT/);
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it("refuse un compte introuvable", async () => {
    const { connectionExecute, connection } = await mockDb();
    connectionExecute.mockResolvedValueOnce([[], []]);

    await expect(createTeam(1, "Dragon Squad")).rejects.toThrow("PROFILE_NOT_FOUND");
    expect(connectionExecute).toHaveBeenCalledTimes(1);
    expect(connection.rollback).toHaveBeenCalled();
  });
});

describe("updateTeamMeta — sigle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** L'auteur est OWNER de l'équipe : première lecture du service. */
  function asOwner(poolExecute: Exec) {
    poolExecute.mockResolvedValueOnce([[{ roles_json: JSON.stringify(["OWNER"]) }], []]);
  }

  it("met le sigle à jour en excluant l'équipe elle-même du contrôle", async () => {
    const { poolExecute } = await mockDb();
    asOwner(poolExecute);
    poolExecute.mockResolvedValueOnce([[], []]); // sigle libre
    poolExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    await updateTeamMeta(1, 12, { tag: "bg" });

    const check = poolExecute.mock.calls[1] as [string, unknown[]];
    expect(check[1]).toEqual(["BG", 12]);
    const update = poolExecute.mock.calls[2] as [string, unknown[]];
    expect(update[0]).toMatch(/UPDATE bg_teams SET tag = \? WHERE id = \?/);
    expect(update[1]).toEqual(["BG", 12]);
  });

  it("retire le sigle sur une saisie vidée, sans le déclarer pris", async () => {
    const { poolExecute } = await mockDb();
    asOwner(poolExecute);
    poolExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    await updateTeamMeta(1, 12, { tag: "" });

    const update = poolExecute.mock.calls[1] as [string, unknown[]];
    expect(update[0]).toMatch(/SET tag = \?/);
    expect(update[1]).toEqual([null, 12]);
  });

  it("ne touche pas au sigle quand le patch ne le mentionne pas", async () => {
    const { poolExecute } = await mockDb();
    asOwner(poolExecute);
    poolExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    await updateTeamMeta(1, 12, { name: "Nouveau nom" });

    expect(sqlOf(poolExecute)).not.toMatch(/tag/);
  });

  it("refuse un sigle déjà porté par une autre équipe", async () => {
    const { poolExecute } = await mockDb();
    asOwner(poolExecute);
    poolExecute.mockResolvedValueOnce([[{ id: 99 }], []]);

    await expect(updateTeamMeta(1, 12, { tag: "BG" })).rejects.toThrow("TEAM_TAG_ALREADY_USED");
    expect(sqlOf(poolExecute)).not.toMatch(/UPDATE bg_teams/);
  });

  it("refuse un sigle mal formé sans rien écrire", async () => {
    const { poolExecute } = await mockDb();
    asOwner(poolExecute);

    await expect(updateTeamMeta(1, 12, { tag: "TROP-LONG" })).rejects.toThrow(
      "TEAM_TAG_NOT_ALPHANUMERIC",
    );
    expect(sqlOf(poolExecute)).not.toMatch(/UPDATE bg_teams/);
  });

  it("refuse la modification à qui n'administre pas l'équipe", async () => {
    const { poolExecute } = await mockDb();
    poolExecute.mockResolvedValue([[], []]); // ni OWNER, ni équipe fantôme

    await expect(updateTeamMeta(1, 12, { tag: "BG" })).rejects.toThrow("FORBIDDEN");
    expect(sqlOf(poolExecute)).not.toMatch(/UPDATE bg_teams/);
  });
});

describe("softDeleteTeam — sigle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("libère le sigle en même temps que le nom", async () => {
    const { poolExecute, connectionExecute, connection } = await mockDb();
    poolExecute
      .mockResolvedValueOnce([[{ deleted_at: null }], []]) // pas déjà dissoute
      .mockResolvedValueOnce([[{ roles_json: JSON.stringify(["OWNER"]) }], []]); // OWNER
    connectionExecute
      .mockResolvedValueOnce([[{ logo_url: null, deleted_at: null, is_ghost: 0 }], []]) // équipe sous verrou
      .mockResolvedValueOnce([[{ roles_json: JSON.stringify(["OWNER"]) }], []]) // OWNER, relu sous verrou
      .mockResolvedValue([{ affectedRows: 1 }, []]);

    await softDeleteTeam(1, 12);

    const [anonymize] = connectionExecute.mock.calls[2] as [string, unknown[]];
    // Une équipe dissoute garde sa ligne pour ses statistiques : sans cette
    // remise à NULL, son sigle resterait pris à jamais sur tout le site.
    expect(anonymize).toMatch(/SET deleted_at = NOW\(\)/);
    expect(anonymize).toMatch(/tag = NULL/);
    expect(connection.commit).toHaveBeenCalled();
  });
});
