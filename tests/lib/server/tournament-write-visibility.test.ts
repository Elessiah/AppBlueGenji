import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import { canActOnTournament } from "@/lib/server/tournaments/write-visibility";
import { authUser } from "../../helpers/auth-user";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";

/**
 * Garde de visibilité des routes d'écriture d'un joueur : un tournoi non publié
 * et un identifiant inexistant doivent rendre la **même** réponse, sans quoi les
 * codes d'erreur servent d'oracle d'existence.
 */

const DAY = 24 * 60 * 60 * 1000;

function withRows(rows: unknown[]) {
  const execute = jest.fn<SqlQuery>(async () => [rows, []]);
  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return execute;
}

const player = authUser({ id: 7, isAdmin: false, roles: [] });

describe("canActOnTournament", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("laisse passer un tournoi publié", async () => {
    const execute = withRows([{ start_visibility_at: new Date(Date.now() - DAY) }]);
    await expect(canActOnTournament(5, player)).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("start_visibility_at"), [5]);
  });

  it("refuse un tournoi pas encore publié", async () => {
    withRows([{ start_visibility_at: new Date(Date.now() + DAY) }]);
    await expect(canActOnTournament(5, player)).resolves.toBe(false);
  });

  it("refuse un identifiant inexistant de la même façon", async () => {
    withRows([]);
    await expect(canActOnTournament(5, player)).resolves.toBe(false);
  });

  it("refuse une date illisible (la garde se ferme quand elle ne sait pas)", async () => {
    withRows([{ start_visibility_at: "pas une date" }]);
    await expect(canActOnTournament(5, player)).resolves.toBe(false);
  });

  it("laisse passer la permission `tournaments` sans lire la base", async () => {
    await expect(canActOnTournament(5, authUser({ id: 9, roles: ["ARBITRE"] }))).resolves.toBe(true);
    await expect(canActOnTournament(5, authUser({ id: 1, isAdmin: true }))).resolves.toBe(true);
    expect(getDatabase).not.toHaveBeenCalled();
  });

  it("n'ouvre rien au cast (`casting`) : il ne voit pas non plus ces tournois en liste", async () => {
    withRows([{ start_visibility_at: new Date(Date.now() + DAY) }]);
    await expect(canActOnTournament(5, authUser({ id: 3, roles: ["CASTER"] }))).resolves.toBe(false);
  });
});
