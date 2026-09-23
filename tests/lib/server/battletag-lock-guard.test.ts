import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/stats-service");

import { updateOwnProfile } from "@/lib/server/users-service";
import { getDatabase } from "@/lib/server/database";

/**
 * **La moitié serveur du verrou du BattleTag** (`lib/shared/battletag-lock.ts`).
 *
 * L'écran met le champ en lecture seule, mais un champ grisé n'est pas une
 * garde : il suffit d'un `curl`. Et la garde a deux formes qui ne font pas
 * double emploi — le `SELECT` préalable donne le **refus lisible**, le `CASE`
 * de l'`UPDATE` porte la **borne** : une lecture puis une écriture laissent un
 * `await` entre elles, et le rattachement Battle.net peut tomber dans cet
 * intervalle.
 *
 * Deux différences avec le verrou du tag Discord, et ce sont elles qui comptent
 * ici : le BattleTag **ne peut pas non plus être effacé** (ce qui le publie est
 * la case « BattleTag OW », et la prochaine connexion Blizzard réécrirait le
 * champ de toute façon), et le champ n'est **pas** relu quand le patch n'en
 * parle pas — le formulaire ne le soumet que s'il a changé.
 */

type Query = { sql: string; params: unknown[] };

function fakeDb(row: { blizzard_sub: string | null; overwatch_battletag: string | null } | null) {
  const queries: Query[] = [];
  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    queries.push({ sql: q, params });
    if (q.startsWith("SELECT blizzard_sub, overwatch_battletag")) {
      return [row ? [row] : [], []];
    }
    if (q.startsWith("UPDATE bg_users")) return [{ affectedRows: 1 }, []];
    return [[], []];
  });
  (getDatabase as jest.Mock).mockResolvedValue({ execute } as never);
  return { queries };
}

const find = (queries: Query[], fragment: string) =>
  queries.find(({ sql }) => sql.includes(fragment));

const linked = (tag: string | null) => fakeDb({ blizzard_sub: "bz-1", overwatch_battletag: tag });
const free = (tag: string | null) => fakeDb({ blizzard_sub: null, overwatch_battletag: tag });

describe("updateOwnProfile — le BattleTag d'un compte rattaché", () => {
  it("refuse une réécriture, sans rien écrire", async () => {
    const { queries } = linked("Nova#2143");

    await expect(updateOwnProfile(7, { overwatchBattletag: "Autre#9999" })).rejects.toThrow(
      "BATTLETAG_LOCKED",
    );
    expect(find(queries, "UPDATE bg_users")).toBeUndefined();
  });

  it("refuse aussi l'**effacement**, et c'est là qu'il s'écarte du tag Discord", async () => {
    // Effacer son tag Discord *est* l'annulation d'une exposition, et le seul
    // geste offert. Le BattleTag n'atteste rien : ce qui le publie est un
    // réglage à part que le joueur garde en main, et l'effacer serait de toute
    // façon défait à la prochaine connexion Battle.net.
    const { queries } = linked("Nova#2143");

    await expect(updateOwnProfile(7, { overwatchBattletag: null })).rejects.toThrow(
      "BATTLETAG_LOCKED",
    );
    expect(find(queries, "UPDATE bg_users")).toBeUndefined();
  });

  it("laisse passer la **même** valeur : le formulaire n'est pas pris en otage", async () => {
    // C'est le point qui fait tout tenir. Refuser sur la seule présence du champ
    // rendrait tout le profil inenregistrable dès qu'un compte est rattaché.
    const { queries } = linked("Nova#2143");

    await updateOwnProfile(7, { pseudo: "Nova", overwatchBattletag: "Nova#2143" });

    expect(find(queries, "UPDATE bg_users")).toBeDefined();
  });

  it("refuse une différence de **casse** plutôt que de rendre un 200 qui n'écrit rien", async () => {
    // Le client ne soumet ce champ que s'il a changé : une telle différence ne
    // peut venir que d'un appel direct. Or le `CASE` de l'`UPDATE` garde la
    // valeur stockée dès qu'un `blizzard_sub` est posé — accepter rendrait un
    // succès qui ne change rien, et Blizzard fixe la casse d'un BattleTag.
    const { queries } = linked("Nova#2143");

    await expect(updateOwnProfile(7, { overwatchBattletag: "nova#2143" })).rejects.toThrow(
      "BATTLETAG_LOCKED",
    );
    expect(find(queries, "UPDATE bg_users")).toBeUndefined();
  });

  it("ignore les espaces de bord, qui ne changent aucun BattleTag", async () => {
    const { queries } = linked("Nova#2143");

    await updateOwnProfile(7, { overwatchBattletag: "  Nova#2143  " });

    expect(find(queries, "UPDATE bg_users")).toBeDefined();
  });

  it("porte la borne **dans l'écriture**, pas seulement dans la lecture", async () => {
    // Le rattachement peut tomber entre le `SELECT` et l'`UPDATE` : c'est le
    // `CASE` qui garantit qu'aucune saisie ne passe alors par-dessus Blizzard.
    const { queries } = free("Nova#2143");

    await updateOwnProfile(7, { overwatchBattletag: "Autre#9999" });

    const update = find(queries, "UPDATE bg_users")!;
    expect(update.sql).toContain("WHEN blizzard_sub IS NOT NULL THEN overwatch_battletag");
  });
});

describe("updateOwnProfile — le BattleTag d'un compte libre", () => {
  it("s'écrit normalement", async () => {
    const { queries } = free(null);

    await updateOwnProfile(7, { overwatchBattletag: "Nova#2143" });

    const update = find(queries, "UPDATE bg_users")!;
    expect(update.params[1]).toBe(true);
    expect(update.params[2]).toBe("Nova#2143");
  });

  it("s'efface normalement", async () => {
    const { queries } = free("Nova#2143");

    await updateOwnProfile(7, { overwatchBattletag: "" });

    const update = find(queries, "UPDATE bg_users")!;
    // La chaîne vide et `null` sont le **même** geste, et aucune chaîne vide ne
    // part en base.
    expect(update.params[1]).toBe(true);
    expect(update.params[2]).toBeNull();
  });
});

describe("updateOwnProfile — un patch qui ne parle pas du BattleTag", () => {
  it("ne le relit même pas", async () => {
    // La lecture ne se fait que lorsqu'elle peut changer la réponse. Le
    // formulaire omet la clé dès que la valeur n'a pas bougé, donc c'est le cas
    // le plus courant.
    const { queries } = linked("Nova#2143");

    await updateOwnProfile(7, { pseudo: "Nova" });

    expect(find(queries, "SELECT blizzard_sub, overwatch_battletag")).toBeUndefined();
    expect(find(queries, "UPDATE bg_users")).toBeDefined();
  });
});

describe("updateOwnProfile — le BattleTag doit être du texte", () => {
  /**
   * Le corps du `PATCH` n'est qu'**annoté**, jamais validé. La valeur doit
   * désormais être *lue* pour être comparée à celle de Blizzard, d'où un refus
   * nommé plutôt qu'un `TypeError` dont le message interne ressortirait dans le
   * corps du 400.
   */
  it.each([[123], [true], [{}], [[]]])("refuse %p sans rien écrire", async (value) => {
    const { queries } = free(null);

    await expect(
      updateOwnProfile(7, { overwatchBattletag: value as never }),
    ).rejects.toThrow("INVALID_OVERWATCH_BATTLETAG");
    expect(find(queries, "UPDATE bg_users")).toBeUndefined();
  });
});
