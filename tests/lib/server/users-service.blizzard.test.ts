import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/terms-acceptance", () =>
  jest.requireActual<typeof import("../../helpers/terms-acceptance-double")>("../../helpers/terms-acceptance-double").termsAcceptanceDouble(),
);
jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/database");
jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/stats-service");

import { sendBotLog } from "@/lib/server/bot-integration";
import { getDatabase } from "@/lib/server/database";
import { ensureUniquePseudo } from "@/lib/server/auth";
import { createOrGetBlizzardUser, normalizeBattletag } from "@/lib/server/users-service";
import { fakePool } from "../../helpers/sql-double";

/**
 * **Le BattleTag n'a pas de colonne à lui.**
 *
 * Il *est* `bg_users.overwatch_battletag`, le champ que `/profil` propose déjà
 * de saisir à la main pour que les autres joueurs puissent s'ajouter en jeu. En
 * ouvrir une seconde donnerait deux BattleTags pour un joueur, dont un faux, et
 * l'écran devrait choisir.
 *
 * **Et Blizzard l'écrase à chaque connexion**, y compris par-dessus une saisie.
 * C'est tout le sens de ce rattachement : entre ce que Blizzard affirme et ce
 * qu'un joueur a tapé, la source fait foi — un BattleTag mal recopié ne se voit
 * pas, il se constate le jour où l'ajout en jeu échoue. Ce qui n'est **pas**
 * écrasé, c'est le réglage de visibilité : la connexion corrige une donnée, elle
 * ne publie rien.
 */

type Statement = { sql: string; params: unknown[] };

function fakeDb(rows: { id: number; blizzard_sub: string | null }[]) {
  const statements: Statement[] = [];

  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    statements.push({ sql: q, params });

    if (q.startsWith("SELECT id FROM bg_users WHERE blizzard_sub = ?")) {
      return [rows.filter((row) => row.blizzard_sub === params[0]).map(({ id }) => ({ id })), []];
    }
    if (q.startsWith("INSERT INTO bg_users")) return [{ insertId: 4242 }, []];
    return [{ affectedRows: 1 }, []];
  });

  jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
  return { statements };
}

const find = (statements: Statement[], fragment: string) =>
  statements.find(({ sql }) => sql.includes(fragment));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(ensureUniquePseudo).mockImplementation(async (source: unknown) => String(source));
  jest.mocked(sendBotLog).mockResolvedValue(undefined);
});

describe("normalizeBattletag", () => {
  it("rend `null` sur du vide, pour ne pas détruire une saisie avec rien", () => {
    expect(normalizeBattletag(null)).toBeNull();
    expect(normalizeBattletag(undefined)).toBeNull();
    expect(normalizeBattletag("   ")).toBeNull();
  });

  it("borne à la largeur de la colonne", () => {
    expect(normalizeBattletag(`${"a".repeat(100)}#1234`)).toHaveLength(64);
  });

  it("garde le discriminant, qui fait partie du tag", () => {
    expect(normalizeBattletag(" Nova#2143 ")).toBe("Nova#2143");
  });
});

describe("createOrGetBlizzardUser", () => {
  it("crée un compte nommé d'après le BattleTag, discriminant retiré", () => {
    // Le discriminant est un détail de Blizzard : il n'a rien à faire dans une
    // URL de profil ni sur une feuille de match.
    const { statements } = fakeDb([]);

    return createOrGetBlizzardUser("bz-1", "Nova#2143", { termsAccepted: true }).then((userId) => {
      expect(userId).toBe(4242);
      expect(ensureUniquePseudo).toHaveBeenCalledWith("Nova");
      const insert = find(statements, "INSERT INTO bg_users")!;
      expect(insert.params).toEqual(["Nova", "bz-1", "Nova#2143"]);
    });
  });

  it("écrase le BattleTag à chaque connexion suivante", async () => {
    const { statements } = fakeDb([{ id: 7, blizzard_sub: "bz-1" }]);

    await expect(createOrGetBlizzardUser("bz-1", "Nova#9999", { termsAccepted: true })).resolves.toBe(7);

    const update = find(statements, "UPDATE bg_users SET overwatch_battletag")!;
    expect(update.params).toEqual(["Nova#9999", 7]);
    expect(find(statements, "INSERT INTO bg_users")).toBeUndefined();
  });

  it("ne touche à aucun réglage de visibilité", async () => {
    // Corriger une donnée n'est pas la publier : `visible_overwatch` reste ce
    // que le joueur en a fait.
    const { statements } = fakeDb([{ id: 7, blizzard_sub: "bz-1" }]);

    await createOrGetBlizzardUser("bz-1", "Nova#9999", { termsAccepted: true });

    expect(find(statements, "visible_overwatch")).toBeUndefined();
  });

  it("n'efface rien quand le compte Battle.net n'a pas de BattleTag", async () => {
    const { statements } = fakeDb([{ id: 7, blizzard_sub: "bz-1" }]);

    await expect(createOrGetBlizzardUser("bz-1", null, { termsAccepted: true })).resolves.toBe(7);

    expect(find(statements, "UPDATE bg_users SET overwatch_battletag")).toBeUndefined();
  });

  it("fabrique un pseudo de repli quand il n'y a pas de BattleTag du tout", async () => {
    // Un compte sans pseudo n'existe pas : la création doit aboutir.
    const { statements } = fakeDb([]);

    await createOrGetBlizzardUser("bz-1", null, { termsAccepted: true });

    const insert = find(statements, "INSERT INTO bg_users")!;
    expect(String(insert.params[0])).toMatch(/^player\d+$/);
    expect(insert.params[2]).toBeNull();
  });

  it("annonce le compte neuf au journal, et lui seul", async () => {
    fakeDb([]);
    await createOrGetBlizzardUser("bz-1", "Nova#2143", { termsAccepted: true });
    expect(sendBotLog).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    jest.mocked(sendBotLog).mockResolvedValue(undefined);
    fakeDb([{ id: 7, blizzard_sub: "bz-1" }]);
    await createOrGetBlizzardUser("bz-1", "Nova#2143", { termsAccepted: true });
    expect(sendBotLog).not.toHaveBeenCalled();
  });
});
