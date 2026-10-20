import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import {
  RECRUITMENT_MODAL_HEAL_MAX_TRACKED,
  RECRUITMENT_MODAL_HEAL_WINDOW_MS,
  carryRecruitmentModalOffFromBrowser,
  healRecruitmentModalOff,
  recordRecruitmentModalBackOn,
  recordRecruitmentModalOff,
  recruitmentModalBackOn,
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

  it("lit 2 (réaffichée depuis « Mon profil ») comme non posé", () => {
    expect(recruitmentModalOff(2)).toBe(false);
    expect(recruitmentModalBackOn(2)).toBe(true);
    expect(recruitmentModalBackOn(1)).toBe(false);
    expect(recruitmentModalBackOn(0)).toBe(false);
    expect(recruitmentModalBackOn(null)).toBe(false);
  });
});

describe("recordRecruitmentModalBackOn — réafficher depuis « Mon profil »", () => {
  it("passe le compte vivant à 2 en une instruction", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    expect(await recordRecruitmentModalBackOn(7)).toBe(true);
    expect(execute.mock.calls).toEqual([
      ["UPDATE bg_users SET recruitment_modal_off = 2 WHERE id = ? AND is_deleted = 0", [7]],
    ]);
  });

  it("rend false sur un compte supprimé, et ne touche pas la base pour un identifiant invalide", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    expect(await recordRecruitmentModalBackOn(7)).toBe(false);
    expect(await recordRecruitmentModalBackOn(0)).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("carryRecruitmentModalOffFromBrowser — un cookie ne recouvre jamais un choix du compte", () => {
  it("n'écrit que sur un compte jamais décidé (condition dans l'instruction)", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 0 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    await carryRecruitmentModalOffFromBrowser(9);
    expect(String(execute.mock.calls[0][0]).replace(/\s+/g, " ")).toBe(
      "UPDATE bg_users SET recruitment_modal_off = 1 WHERE id = ? AND is_deleted = 0 AND recruitment_modal_off = 0",
    );
    expect(execute.mock.calls[0][1]).toEqual([9]);
  });

  it("ignore un identifiant invalide", async () => {
    const execute = jest.fn<SqlQuery>();
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    await carryRecruitmentModalOffFromBrowser(-1);
    expect(execute).not.toHaveBeenCalled();
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
    expect(healRecruitmentModalOff({ userId: 7, accountOff: false, accountBackOn: false, browserCookie: "1" })).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("SET recruitment_modal_off = 1"), [7]);
    expect(String(execute.mock.calls[0][0])).toContain("AND recruitment_modal_off = 0");
  });

  it("vieux cookie d'un autre navigateur après un « réafficher » : aucune écriture", () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    expect(healRecruitmentModalOff({ userId: 41, accountOff: false, accountBackOn: true, browserCookie: "1" })).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("ne fait rien sans session, déjà posé, ou sans cookie valide", () => {
    expect(healRecruitmentModalOff({ userId: undefined, accountOff: undefined, accountBackOn: false, browserCookie: "1" })).toBe(false);
    expect(healRecruitmentModalOff({ userId: 7, accountOff: true, accountBackOn: false, browserCookie: "1" })).toBe(false);
    expect(healRecruitmentModalOff({ userId: 7, accountOff: false, accountBackOn: false, browserCookie: undefined })).toBe(false);
    expect(healRecruitmentModalOff({ userId: 7, accountOff: false, accountBackOn: false, browserCookie: "0" })).toBe(false);
  });

  it("n'est jamais bloquant : une panne de base est seulement journalisée", async () => {
    jest.mocked(getDatabase).mockRejectedValue(new Error("down"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(healRecruitmentModalOff({ userId: 8, accountOff: false, accountBackOn: false, browserCookie: "1" })).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("au plus une tentative par compte et par fenêtre, même pages et onglets en rafale", async () => {
    const execute = jest.fn<SqlQuery>().mockRejectedValue(new Error("Lock wait timeout exceeded"));
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const heal = (userId: number, now: number) =>
      healRecruitmentModalOff({ userId, accountOff: false, accountBackOn: false, browserCookie: "1" }, now);
    const t0 = 1_000_000_000_000;

    expect(heal(21, t0)).toBe(true);
    // Onglets restaurés au démarrage, rechargements : l'écriture en échec n'est pas relancée.
    expect(heal(21, t0)).toBe(false);
    expect(heal(21, t0 + RECRUITMENT_MODAL_HEAL_WINDOW_MS - 1)).toBe(false);
    // Un autre compte n'attend pas celui-ci.
    expect(heal(22, t0)).toBe(true);
    // La fenêtre passée, une nouvelle tentative part.
    expect(heal(21, t0 + RECRUITMENT_MODAL_HEAL_WINDOW_MS)).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(execute).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });

  it("ne compte pas comme tentative un appel qui n'écrivait rien", () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    const t0 = 2_000_000_000_000;
    expect(healRecruitmentModalOff({ userId: 31, accountOff: true, accountBackOn: false, browserCookie: "1" }, t0)).toBe(false);
    expect(healRecruitmentModalOff({ userId: 31, accountOff: false, accountBackOn: false, browserCookie: "1" }, t0)).toBe(true);
  });

  it("garde sa mémoire bornée : pleine de tentatives récentes, elle diffère le rattrapage sans grossir", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([{ affectedRows: 1 }, []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    const heal = (userId: number, now: number) =>
      healRecruitmentModalOff({ userId, accountOff: false, accountBackOn: false, browserCookie: "1" }, now);
    // Bien après les tentatives des tests précédents : elles sont toutes échues.
    const t0 = 3_000_000_000_000;
    const base = 100_000;
    for (let i = 0; i < RECRUITMENT_MODAL_HEAL_MAX_TRACKED; i += 1) expect(heal(base + i, t0)).toBe(true);
    // Plein : un compte de plus attend, sans écriture.
    expect(heal(base - 1, t0 + 1)).toBe(false);
    // La fenêtre passée, les anciennes sortent et il passe.
    expect(heal(base - 1, t0 + RECRUITMENT_MODAL_HEAL_WINDOW_MS)).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(execute).toHaveBeenCalledTimes(RECRUITMENT_MODAL_HEAL_MAX_TRACKED + 1);
  });

  it("compte la fenêtre sur une horloge monotone, pas sur l'heure système", () => {
    const source = readSource("lib/server/users/recruitment-modal-preference.ts");
    expect(source).toContain("now: number = performance.now(),");
    expect(source).not.toContain("Date.now()");
  });

  it("colonne absente : s'éteint sans rien journaliser, jusqu'au redémarrage", async () => {
    await jest.isolateModulesAsync(async () => {
      const database = await import("@/lib/server/database");
      const preference = await import("@/lib/server/users/recruitment-modal-preference");
      const execute = jest.fn<SqlQuery>().mockRejectedValue(
        Object.assign(new Error("Unknown column 'recruitment_modal_off'"), { code: "ER_BAD_FIELD_ERROR" }),
      );
      jest.mocked(database.getDatabase).mockResolvedValue(fakePool({ execute }));
      const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);

      expect(preference.healRecruitmentModalOff({ userId: 41, accountOff: false, accountBackOn: false, browserCookie: "1" })).toBe(true);
      await new Promise((resolve) => setImmediate(resolve));
      // Un autre compte, la fenêtre de 41 passée : plus aucune écriture vouée à l'échec.
      expect(preference.healRecruitmentModalOff({ userId: 42, accountOff: false, accountBackOn: false, browserCookie: "1" })).toBe(false);
      expect(
        preference.healRecruitmentModalOff(
          { userId: 41, accountOff: false, accountBackOn: false, browserCookie: "1" },
          performance.now() + preference.RECRUITMENT_MODAL_HEAL_WINDOW_MS,
        ),
      ).toBe(false);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
