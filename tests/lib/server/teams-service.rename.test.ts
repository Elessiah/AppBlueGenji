import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/terms-acceptance", () =>
  jest.requireActual<typeof import("../../helpers/terms-acceptance-double")>("../../helpers/terms-acceptance-double").termsAcceptanceDouble(),
);
jest.mock("@/lib/server/database");

import { updateTeamMeta } from "@/lib/server/teams/identity";
import { assertTeamNameAvailable, isTeamNameConflict } from "@/lib/server/team-tags";
import { getDatabase } from "@/lib/server/database";
import { type SqlMock, fakeConnection, fakePool } from "../../helpers/sql-double";
import { clearCache } from "@/lib/server/cache";
import { LANDING_TTL_MS, cachedLanding } from "@/lib/server/landing-cache";

/**
 * Renommer une équipe : mêmes bornes qu'à la création, unicité dite en
 * français.
 *
 * Le renommage ne contrôlait rien. Un nom vide s'enregistrait ; un nom trop
 * long ou déjà pris partait en erreur MySQL brute jusqu'à la notification.
 */

const owner = [[{ roles_json: JSON.stringify(["OWNER"]) }]];
/** Ligne de l'équipe sous verrou, en tête de la transaction : son nom actuel y est relu. */
const locked = (name: string, extra: Partial<{ deleted_at: Date | null; is_ghost: 0 | 1 }> = {}) => [
  [{ name, deleted_at: null, is_ghost: 0, ...extra }],
];
const neverRegistered = [[]];
const registered = [[{ 1: 1 }]];

function dupError(key: string) {
  const message = `Duplicate entry 'X' for key '${key}'`;
  return Object.assign(new Error(message), { code: "ER_DUP_ENTRY", sqlMessage: message });
}

let execute: SqlMock;
let connection: {
  beginTransaction: jest.Mock<() => Promise<void>>;
  commit: jest.Mock<() => Promise<void>>;
  rollback: jest.Mock<() => Promise<void>>;
  release: jest.Mock<() => void>;
};

/** Pool et connexion de transaction partagent le même `execute` : la séquence se lit d'un trait. */
beforeEach(() => {
  jest.clearAllMocks();
  execute = jest.fn();
  connection = {
    beginTransaction: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    release: jest.fn(),
  };
  jest.mocked(getDatabase).mockResolvedValue(
    fakePool({ execute, getConnection: jest.fn(async () => fakeConnection({ execute, ...connection })) }),
  );
});

const wrote = () => execute.mock.calls.some(([sql]) => /UPDATE bg_teams/.test(String(sql)));

describe("updateTeamMeta — nom", () => {
  it.each([
    ["vide", ""],
    ["fait d'espaces", "   "],
    ["de deux caractères", "ab"],
    ["de 61 caractères", "a".repeat(61)],
  ])("refuse un nom %s sans rien écrire", async (_label, name) => {
    execute.mockResolvedValueOnce(owner);

    await expect(updateTeamMeta(1, 7, { name })).rejects.toThrow("INVALID_TEAM_NAME");
    expect(wrote()).toBe(false);
  });

  it("refuse un nom déjà porté par une autre équipe, avant d'écrire", async () => {
    execute
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce(locked("Ancien Nom"))
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce([[{ id: 9 }]]); // nom pris

    await expect(updateTeamMeta(1, 7, { name: "Dragon Squad" })).rejects.toThrow("TEAM_NAME_ALREADY_USED");
    expect(wrote()).toBe(false);
  });

  it("laisse l'équipe garder son propre nom (casse comprise)", async () => {
    execute
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce(locked("rolex")) // nom actuel, autre casse
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce(neverRegistered);

    await updateTeamMeta(1, 7, { name: "  Rolex  " });

    const [sql, params] = execute.mock.calls[3] as [string, unknown[]];
    expect(sql).toMatch(/WHERE name = \? AND id <> \?/);
    expect(params).toEqual(["Rolex", 7]);
    const [, updateParams] = execute.mock.calls[4] as [string, unknown[]];
    // Le nom écrit est rogné.
    expect(updateParams).toEqual(["Rolex", 7]);
  });

  it("traduit la course entre deux renommages vers le même nom", async () => {
    execute
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce(locked("Ancien Nom"))
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce([[]])
      .mockRejectedValueOnce(dupError("bg_teams.name"));

    await expect(updateTeamMeta(1, 7, { name: "Dragon Squad" })).rejects.toThrow("TEAM_NAME_ALREADY_USED");
  });

  it("garde la traduction du sigle quand c'est lui qui entre en collision", async () => {
    execute
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce(locked("Ancien Nom"))
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce([[]]) // tag libre au SELECT
      .mockRejectedValueOnce(dupError("uniq_bg_teams_tag"));

    await expect(updateTeamMeta(1, 7, { tag: "BG" })).rejects.toThrow("TEAM_TAG_ALREADY_USED");
  });

  it("vérifie les droits avant la forme : un intrus n'apprend rien du nom", async () => {
    execute.mockResolvedValueOnce([[]]);
    await expect(updateTeamMeta(99, 7, { name: "" })).rejects.toThrow("FORBIDDEN");
  });

  it("ne touche pas au nom quand le patch ne le porte pas", async () => {
    execute
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce(locked("Ancien Nom"))
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await updateTeamMeta(1, 7, { description: "Nouvelle description" });

    const sqls = execute.mock.calls.map(([sql]) => String(sql));
    expect(sqls.some((sql) => /WHERE name = \?/.test(sql))).toBe(false);
    expect(sqls.at(-1)).toMatch(/UPDATE bg_teams SET description = \?/);
  });
});

describe("assertTeamNameAvailable", () => {
  it("exclut l'équipe elle-même quand on le lui demande", async () => {
    const exec = jest.fn(async (_sql: string, _params: unknown[]) => [[], []]);
    await assertTeamNameAvailable({ execute: exec } as never, "Rolex", 7);
    expect(exec).toHaveBeenCalledWith(expect.stringMatching(/AND id <> \?/), ["Rolex", 7]);
  });

  it("interroge sans exclusion à la création", async () => {
    const exec = jest.fn(async (_sql: string, _params: unknown[]) => [[], []]);
    await assertTeamNameAvailable({ execute: exec } as never, "Rolex");
    expect(exec).toHaveBeenCalledWith(expect.not.stringMatching(/id <>/), ["Rolex"]);
  });

  it("lève TEAM_NAME_ALREADY_USED sur un nom pris", async () => {
    const exec = jest.fn(async () => [[{ id: 3 }], []]);
    await expect(assertTeamNameAvailable({ execute: exec } as never, "Rolex", 7)).rejects.toThrow(
      "TEAM_NAME_ALREADY_USED",
    );
  });
});

describe("isTeamNameConflict", () => {
  it("reconnaît la violation de l'unicité du nom", () => {
    expect(isTeamNameConflict(dupError("bg_teams.name"))).toBe(true);
    expect(isTeamNameConflict(dupError("name"))).toBe(true);
  });

  it("ne confond ni le sigle ni l'entrée solo avec le nom", () => {
    expect(isTeamNameConflict(dupError("bg_teams.uniq_bg_teams_tag"))).toBe(false);
    expect(isTeamNameConflict(dupError("bg_teams.uniq_bg_teams_solo_user"))).toBe(false);
  });

  it("ignore toute autre erreur", () => {
    expect(isTeamNameConflict(new Error("boom"))).toBe(false);
    expect(isTeamNameConflict(null)).toBe(false);
  });
});

// EF-24 : `/classement` et l'accueil servent le nom depuis le cache de la vitrine.
describe("updateTeamMeta — vues de l'accueil", () => {
  beforeEach(() => {
    clearCache();
  });

  it("updateTeamMeta_renamedRegistered_clearsLandingLeaderboard", async () => {
    execute
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce(locked("Ancien Nom"))
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce(registered);
    const loader = jest.fn(async () => "rangs");
    await cachedLanding("leaderboard:all", LANDING_TTL_MS, loader);

    await updateTeamMeta(1, 7, { name: "Nouveau Nom" });
    await cachedLanding("leaderboard:all", LANDING_TTL_MS, loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("updateTeamMeta_unchangedNameResent_keepsLandingLeaderboard", async () => {
    execute
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce(locked("Nouveau Nom"))
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const loader = jest.fn(async () => "rangs");
    await cachedLanding("leaderboard:all", LANDING_TTL_MS, loader);

    await updateTeamMeta(1, 7, { name: "Nouveau Nom", description: "Texte" });
    await cachedLanding("leaderboard:all", LANDING_TTL_MS, loader);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("updateTeamMeta_unchangedNameResent_skipsNameCheckAndWrite", async () => {
    execute
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce(locked("Nouveau Nom"))
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await updateTeamMeta(1, 7, { name: "Nouveau Nom", description: "Texte" });

    const sqls = execute.mock.calls.map(([sql]) => String(sql));
    expect(sqls.some((sql) => /WHERE name = \?/.test(sql))).toBe(false);
    expect(sqls.at(-1)).toMatch(/UPDATE bg_teams SET description = \? WHERE id = \?/);
  });

  it("updateTeamMeta_descriptionOnly_keepsLandingLeaderboard", async () => {
    execute
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce(locked("Ancien Nom"))
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const loader = jest.fn(async () => "rangs");
    await cachedLanding("leaderboard:all", LANDING_TTL_MS, loader);

    await updateTeamMeta(1, 7, { description: "Texte" });
    await cachedLanding("leaderboard:all", LANDING_TTL_MS, loader);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("updateTeamMeta_nameRefused_keepsLandingLeaderboard", async () => {
    execute.mockResolvedValueOnce(owner);
    const loader = jest.fn(async () => "rangs");
    await cachedLanding("leaderboard:all", LANDING_TTL_MS, loader);

    await expect(updateTeamMeta(1, 7, { name: "" })).rejects.toThrow("INVALID_TEAM_NAME");
    await cachedLanding("leaderboard:all", LANDING_TTL_MS, loader);

    expect(loader).toHaveBeenCalledTimes(1);
  });
});

// TEAMS-LOT (ERREUR.txt) : nom relu et droit rejugé sous le verrou de l'équipe,
// vues vidées seulement pour une équipe qui a déjà joué.
describe("updateTeamMeta — sous le verrou de l'équipe", () => {
  beforeEach(() => {
    clearCache();
  });

  it("updateTeamMeta_lockFirst_selectForUpdateIsFirstTransactionStatement", async () => {
    execute
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce(locked("Ancien Nom"))
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await updateTeamMeta(1, 7, { description: "Texte" });

    // Appel 0 : droit lu sur le pool ; appel 1 : première instruction de la transaction.
    expect(String(execute.mock.calls[1][0])).toMatch(/SELECT name, deleted_at, is_ghost FROM bg_teams WHERE id = \? FOR UPDATE/);
    expect(connection.commit).toHaveBeenCalled();
  });

  it("updateTeamMeta_teamDeletedUnderLock_throwsForbiddenAndRollsBack", async () => {
    execute.mockResolvedValueOnce(owner).mockResolvedValueOnce(locked("Ancien Nom", { deleted_at: new Date() }));

    await expect(updateTeamMeta(1, 7, { name: "Nouveau Nom" })).rejects.toThrow("FORBIDDEN");

    expect(wrote()).toBe(false);
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("updateTeamMeta_ownerLostUnderLock_throwsForbidden", async () => {
    execute
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce(locked("Ancien Nom"))
      .mockResolvedValueOnce([[{ roles_json: JSON.stringify(["MANAGER"]) }]]);

    await expect(updateTeamMeta(1, 7, { name: "Nouveau Nom" })).rejects.toThrow("FORBIDDEN");

    expect(wrote()).toBe(false);
  });

  it("updateTeamMeta_renamedNeverRegistered_keepsLandingLeaderboard", async () => {
    execute
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce(locked("Ancien Nom"))
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce(neverRegistered);
    const loader = jest.fn(async () => "rangs");
    await cachedLanding("leaderboard:all", LANDING_TTL_MS, loader);

    await updateTeamMeta(1, 7, { name: "Nouveau Nom" });
    await cachedLanding("leaderboard:all", LANDING_TTL_MS, loader);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("updateTeamMeta_emptyPatch_opensNoTransaction", async () => {
    execute.mockResolvedValueOnce(owner);

    await updateTeamMeta(1, 7, {});

    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });
});
