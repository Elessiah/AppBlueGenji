import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import {
  healRecruitmentModalOff,
  recordRecruitmentModalOff,
  recruitmentModalOff,
} from "@/lib/server/users/recruitment-modal-preference";
import { readSource } from "../../helpers/read-source";
import { fakePool, type SqlQuery } from "../../helpers/sql-double";

/** « Ne plus afficher » de la modale du recrutement, gardé sur le compte (`bg_users.recruitment_modal_off`). */

beforeEach(() => {
  jest.clearAllMocks();
});

describe("recruitmentModalOff", () => {
  it("lit 1 comme posé, 0 et l'absence comme non posé", () => {
    expect(recruitmentModalOff(1)).toBe(true);
    expect(recruitmentModalOff("1")).toBe(true);
    expect(recruitmentModalOff(0)).toBe(false);
    expect(recruitmentModalOff(null)).toBe(false);
    expect(recruitmentModalOff(undefined)).toBe(false);
  });
});

describe("recordRecruitmentModalOff", () => {
  function mockExecute(affectedRows: number) {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    return execute;
  }

  it("pose le choix en une instruction, sur un compte vivant seulement", async () => {
    const execute = mockExecute(1);
    expect(await recordRecruitmentModalOff(7)).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]).toEqual([
      "UPDATE bg_users SET recruitment_modal_off = 1 WHERE id = ? AND is_deleted = 0",
      [7],
    ]);
  });

  it("rend false sur un compte supprimé (aucune ligne vivante)", async () => {
    mockExecute(0);
    expect(await recordRecruitmentModalOff(7)).toBe(false);
  });

  it("refuse un identifiant invalide sans toucher la base", async () => {
    const execute = mockExecute(1);
    expect(await recordRecruitmentModalOff(0)).toBe(false);
    expect(await recordRecruitmentModalOff(-3)).toBe(false);
    expect(await recordRecruitmentModalOff(1.5)).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("schéma — les deux endroits", () => {
  it("déclare la colonne dans le CREATE TABLE et parmi les changements récents, avec le même défaut", () => {
    const definition = "recruitment_modal_off TINYINT(1) NOT NULL DEFAULT 0";
    expect(readSource("lib/server/database/schema/accounts.ts")).toContain(definition);
    expect(readSource("lib/server/database/recent-schema-changes.ts")).toContain(
      `ALTER TABLE bg_users ADD COLUMN ${definition}`,
    );
  });
});

describe("healRecruitmentModalOff — le compte rattrape le cookie du navigateur", () => {
  it("écrit le compte connecté dont le cookie porte le choix et le drapeau non", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    expect(healRecruitmentModalOff({ userId: 7, accountOff: false, browserCookie: "1" })).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("SET recruitment_modal_off = 1"), [7]);
  });

  it("ne fait rien sans session, déjà posé, ou sans cookie valide", () => {
    expect(healRecruitmentModalOff({ userId: undefined, accountOff: undefined, browserCookie: "1" })).toBe(false);
    expect(healRecruitmentModalOff({ userId: 7, accountOff: true, browserCookie: "1" })).toBe(false);
    expect(healRecruitmentModalOff({ userId: 7, accountOff: false, browserCookie: undefined })).toBe(false);
    expect(healRecruitmentModalOff({ userId: 7, accountOff: false, browserCookie: "0" })).toBe(false);
  });

  it("n'est jamais bloquant : une panne de base est seulement journalisée", async () => {
    jest.mocked(getDatabase).mockRejectedValue(new Error("down"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(healRecruitmentModalOff({ userId: 7, accountOff: false, browserCookie: "1" })).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
