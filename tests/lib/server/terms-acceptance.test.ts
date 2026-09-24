import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import { clearCache } from "@/lib/server/cache";
import {
  assertTermsAccepted,
  hasAcceptedCurrentTerms,
  listTermsAcceptances,
  needsTermsForTeamManagement,
  recordTermsAcceptance,
  recordTermsAcceptanceIfBehind,
} from "@/lib/server/terms-acceptance";
import { TERMS_VERSION } from "@/lib/shared/terms-of-use";
import { fakeConnection, fakePool, type SqlQuery } from "../../helpers/sql-double";

const execute = jest.fn<SqlQuery>();

beforeEach(() => {
  clearCache();
  execute.mockReset();
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
});

describe("recordTermsAcceptance", () => {
  it("retient la version courante sans jamais la faire reculer, puis écrit la preuve", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([{ insertId: 1 }]);

    await expect(recordTermsAcceptance(7, "TEAM_CREATION")).resolves.toBe(true);

    const [update, updateParams] = execute.mock.calls[0];
    expect(update).toMatch(/GREATEST\(COALESCE\(terms_version, 0\), \?\)/);
    expect(update).toMatch(/is_deleted = 0/);
    expect(updateParams).toEqual([TERMS_VERSION, 7]);
    expect(execute.mock.calls[1]).toEqual([
      expect.stringMatching(/INSERT INTO bg_terms_acceptances/),
      [7, TERMS_VERSION, "TEAM_CREATION"],
    ]);
  });

  it("n'écrit aucune preuve pour un compte supprimé ou absent", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 0 }]);
    await expect(recordTermsAcceptance(7, "LOGIN")).resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("écrit sur la connexion de l'appelant quand on la lui passe (transaction)", async () => {
    const connection = { execute: jest.fn<SqlQuery>() };
    connection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([{}]);
    await recordTermsAcceptance(3, "TEAM_CREATION", fakeConnection(connection));
    expect(connection.execute).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("hasAcceptedCurrentTerms / assertTermsAccepted", () => {
  it.each<[unknown[], boolean]>([
    [[], false],
    [[{ terms_version: null }], false],
    [[{ terms_version: TERMS_VERSION - 1 }], false],
    [[{ terms_version: TERMS_VERSION }], true],
    [[{ terms_version: TERMS_VERSION + 1 }], true],
  ])("lit %j comme %s", async (rows, expected) => {
    execute.mockResolvedValue([rows]);
    await expect(hasAcceptedCurrentTerms(4)).resolves.toBe(expected);
  });

  it("refuse le geste de gestion tant que les conditions ne sont pas acceptées", async () => {
    execute.mockResolvedValue([[{ terms_version: null }]]);
    await expect(assertTermsAccepted(4)).rejects.toThrow("TERMS_ACCEPTANCE_REQUIRED");
    execute.mockResolvedValue([[{ terms_version: TERMS_VERSION }]]);
    await expect(assertTermsAccepted(4)).resolves.toBeUndefined();
  });
});

describe("recordTermsAcceptanceIfBehind", () => {
  it("n'écrit rien quand la version courante est déjà acceptée", async () => {
    execute.mockResolvedValueOnce([[{ terms_version: TERMS_VERSION }]]);
    await recordTermsAcceptanceIfBehind(4, "LOGIN");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("écrit l'acceptation d'un compte en retard", async () => {
    execute
      .mockResolvedValueOnce([[{ terms_version: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);
    await recordTermsAcceptanceIfBehind(4, "LOGIN");
    expect(execute).toHaveBeenLastCalledWith(expect.stringMatching(/INSERT INTO bg_terms_acceptances/), [
      4,
      TERMS_VERSION,
      "LOGIN",
    ]);
  });
});

describe("needsTermsForTeamManagement", () => {
  const row = (terms_version: number | null, roles_json: unknown, team_id: number | null) => ({
    terms_version,
    roles_json,
    team_id,
  });

  it("ne demande rien à un compte absent ou supprimé", async () => {
    execute.mockResolvedValueOnce([[]]);
    await expect(needsTermsForTeamManagement(40)).resolves.toBe(false);
  });

  it("ne demande rien à qui a déjà accepté", async () => {
    execute.mockResolvedValueOnce([[row(TERMS_VERSION, '["OWNER"]', 3)]]);
    await expect(needsTermsForTeamManagement(41)).resolves.toBe(false);
  });

  it("demande à un gérant qui n'a pas accepté, en une seule requête", async () => {
    execute.mockResolvedValueOnce([[row(null, '["DPS","MANAGER"]', 3)]]);
    await expect(needsTermsForTeamManagement(42)).resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql] = execute.mock.calls[0];
    // Équipe vivante, appartenance en cours, jamais une entrée solo.
    expect(sql).toMatch(/tm.left_at IS NULL/);
    expect(sql).toMatch(/t.deleted_at IS NULL/);
    expect(sql).toMatch(/t.solo_user_id IS NULL/);
  });

  it("ne compte ni un simple joueur, ni le rôle d'une équipe dissoute", async () => {
    execute.mockResolvedValueOnce([[row(null, ["TANK", "CAPITAINE"], 3), row(null, '["OWNER"]', null)]]);
    await expect(needsTermsForTeamManagement(43)).resolves.toBe(false);
  });

  it("garde sa réponse un moment, et l'oublie dès que le compte accepte", async () => {
    execute.mockResolvedValueOnce([[row(null, '["OWNER"]', 3)]]);
    await expect(needsTermsForTeamManagement(44)).resolves.toBe(true);
    await expect(needsTermsForTeamManagement(44)).resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);

    execute.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([{}]);
    await recordTermsAcceptance(44, "TEAM_MANAGEMENT");
    execute.mockResolvedValueOnce([[row(TERMS_VERSION, '["OWNER"]', 3)]]);
    await expect(needsTermsForTeamManagement(44)).resolves.toBe(false);
  });
});

describe("listTermsAcceptances", () => {
  it("rend la preuve des acceptations pour l'export", async () => {
    execute.mockResolvedValueOnce([
      [{ version: 1, context: "SIGNUP", accepted_at: new Date("2026-09-24T10:00:00Z") }],
    ]);
    await expect(listTermsAcceptances(4)).resolves.toEqual([
      { version: 1, context: "SIGNUP", acceptedAt: "2026-09-24T10:00:00.000Z" },
    ]);
  });
});
