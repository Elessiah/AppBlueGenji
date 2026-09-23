import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/bot-integration");
jest.mock("@/lib/server/database");
jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/stats-service");

import { createOrGetGoogleUser, type GoogleProfilePayload } from "@/lib/server/users-service";
import { sendBotLog } from "@/lib/server/bot-integration";
import { getDatabase } from "@/lib/server/database";
import { ensureUniquePseudo } from "@/lib/server/auth";

// Un compte créé annonce sa naissance au journal Discord
// (`tests/lib/server/player-signup-log.test.ts`). Rien à mesurer ici, mais
// l'envoi est bien tenté : sans promesse en retour, l'auto-mock ferait échouer
// la création. `clearAllMocks` ne défait pas les implémentations.
(sendBotLog as jest.Mock).mockResolvedValue(undefined as never);

/**
 * **Une identité Google ne revendique plus aucun compte du site.**
 *
 * `createOrGetGoogleUser` liait une identité Google neuve à un compte existant
 * sur la seule **égalité de chaîne** de l'adresse e-mail. Contrôler
 * `email_verified` avait rendu ce rattachement honnête ; il restait que le site
 * décidait qu'une adresse *est* une personne, sur la foi d'un fournisseur dont
 * il n'est pas l'émetteur — et qu'il devait pour cela collecter et conserver une
 * colonne d'adresses, exactement ce qu'une fuite fait le plus regretter.
 *
 * Le geste que ce rattachement rendait — « j'entre par Discord, je veux aussi
 * entrer par Google » — existe toujours, mais à l'endroit où il se prouve tout
 * seul : `/profil`, section « Applications connectées », où le joueur est
 * **déjà connecté** quand il rattache (`lib/server/account-identities.ts`).
 *
 * Ce qui est vérifié ici est donc la propriété inverse de celle d'avant : un
 * `sub` inconnu **crée un compte**, quoi que dise l'adresse, et plus aucune
 * adresse n'est ni lue ni écrite. Voir `docs/AUTHORIZATION_RULES.md` §1.2.
 */

type Statement = { sql: string; params: unknown[] };

/** Base factice : une table de comptes, adressée par `google_sub` ou `email`. */
function fakeDb(
  rows: { id: number; google_sub: string | null; email: string | null }[],
  currentAvatar: string | null | undefined = undefined,
) {
  const statements: Statement[] = [];

  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    statements.push({ sql: q, params });

    if (q.startsWith("SELECT id FROM bg_users WHERE google_sub = ?")) {
      const found = rows.filter((row) => row.google_sub === params[0]);
      return [found.map(({ id }) => ({ id })), []];
    }

    // **Aucune branche pour `SELECT … WHERE email = ?`**, et c'est le propos :
    // la requête n'est plus émise. Si elle revenait, elle tomberait sur le repli
    // « aucune ligne » ci-dessous, et les assertions qui la cherchent dans le
    // journal des instructions la verraient.

    if (q.startsWith("INSERT INTO bg_users")) {
      return [{ insertId: 4242 }, []];
    }

    // Lecture de l'avatar en place, faite juste avant de décider si la photo
    // Google doit être copiée. `undefined` = le compte n'est pas trouvé, donc
    // rien n'est tenté : c'est le défaut, et il garde les cas ci-dessous hors
    // du réseau.
    if (q.startsWith("SELECT avatar_url FROM bg_users WHERE id = ?")) {
      return [currentAvatar === undefined ? [] : [{ avatar_url: currentAvatar }], []];
    }

    return [[], []];
  });

  (getDatabase as jest.Mock).mockResolvedValue({ execute } as never);
  (ensureUniquePseudo as jest.Mock).mockImplementation(async (source: unknown) => String(source));
  return { execute, statements };
}

const profile = (overrides: Partial<GoogleProfilePayload> = {}): GoogleProfilePayload => ({
  sub: "google-sub-neuf",
  name: "Nova",
  ...overrides,
});

const find = (statements: Statement[], prefix: string) =>
  statements.find(({ sql }) => sql.startsWith(prefix));

describe("createOrGetGoogleUser — aucune revendication par l'adresse", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("ne cherche **jamais** un compte par son adresse", async () => {
    // Le cœur de la règle. Un membre existe, son adresse est celle que Google
    // annonce : cela ne suffit plus, et la question n'est même plus posée.
    const { statements } = fakeDb([{ id: 7, google_sub: null, email: "nova@exemple.test" }]);

    const userId = await createOrGetGoogleUser(profile());

    expect(userId).not.toBe(7);
    expect(find(statements, "SELECT id FROM bg_users WHERE email = ?")).toBeUndefined();
    expect(find(statements, "UPDATE bg_users SET google_sub = ?")).toBeUndefined();
  });

  it("crée un compte neuf, **sans colonne d'adresse**", async () => {
    const { statements } = fakeDb([{ id: 7, google_sub: null, email: "nova@exemple.test" }]);

    await expect(createOrGetGoogleUser(profile())).resolves.toBe(4242);

    const insert = find(statements, "INSERT INTO bg_users")!;
    // Deux paramètres : le pseudo et le `sub`. Ni adresse — elle n'est plus
    // demandée à Google —, ni photo : la colonne d'avatar naît à `NULL` et ne
    // reçoit qu'un fichier copié chez nous, le nom du fichier portant
    // l'identifiant du compte, qui n'existe pas encore.
    expect(insert.params).toEqual(["Nova", "google-sub-neuf"]);
    expect(insert.sql).not.toContain("email");
    expect(insert.sql).toContain("NULL");
  });

  it("n'écrit aucune adresse sur un compte déjà rattaché", async () => {
    const { statements } = fakeDb([
      { id: 7, google_sub: "google-sub-neuf", email: "ancienne@exemple.test" },
    ]);

    await expect(createOrGetGoogleUser(profile())).resolves.toBe(7);

    expect(find(statements, "UPDATE bg_users SET email")).toBeUndefined();
    expect(find(statements, "INSERT INTO bg_users")).toBeUndefined();
  });

  it("passe par le `google_sub`, qui est ce qui identifie", async () => {
    const { statements } = fakeDb([
      { id: 7, google_sub: "google-sub-neuf", email: "nova@exemple.test" },
    ]);

    await expect(createOrGetGoogleUser(profile())).resolves.toBe(7);
    expect(find(statements, "INSERT INTO bg_users")).toBeUndefined();
  });

  it("se passe d'un nom d'affichage sans échouer", async () => {
    // Google n'en promet aucun. Le pseudo retombe alors sur une valeur
    // fabriquée, et la création aboutit — un compte sans pseudo n'existe pas.
    const { statements } = fakeDb([]);

    await createOrGetGoogleUser({ sub: "google-sub-neuf" });

    const insert = find(statements, "INSERT INTO bg_users")!;
    expect(String(insert.params[0])).toMatch(/^player\d+$/);
    expect(insert.params[1]).toBe("google-sub-neuf");
  });
});

/**
 * **La photo de profil ne vient plus de chez Google au moment de l'affichage.**
 *
 * `createOrGetGoogleUser` rangeait l'URL de `picture` telle quelle : chaque
 * page portant cet avatar faisait partir une requête du navigateur du
 * **visiteur** vers `lh3.googleusercontent.com` — l'IP de qui regarde, pas
 * celle du titulaire du compte, et à chaque vue.
 *
 * Elle est désormais copiée à la connexion, et seulement quand il y a lieu.
 */
describe("createOrGetGoogleUser — photo de profil", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    // L'import ne doit pas aboutir : ce qui est vérifié ici est **s'il est
    // tenté**, pas ce qu'il écrit. Un échec laisse la colonne intacte, ce qui
    // est justement le comportement attendu d'un CDN indisponible.
    globalThis.fetch = jest.fn(async () => {
      throw new Error("réseau coupé");
    }) as never;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("va chercher la photo quand le compte n'a pas encore d'avatar", async () => {
    fakeDb([{ id: 7, google_sub: "google-sub-neuf", email: "nova@exemple.test" }], null);

    await createOrGetGoogleUser(profile({ picture: "https://exemple.test/a.png" }));

    expect(globalThis.fetch).toHaveBeenCalled();
  });

  // Les comptes d'avant la correction se réparent d'eux-mêmes : leur URL
  // Google n'est pas un fichier à nous, donc elle est traitée comme une absence.
  it("rapatrie une URL Google restée en base", async () => {
    fakeDb(
      [{ id: 7, google_sub: "google-sub-neuf", email: "nova@exemple.test" }],
      "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c",
    );

    await createOrGetGoogleUser(profile({ picture: "https://exemple.test/a.png" }));

    expect(globalThis.fetch).toHaveBeenCalled();
  });

  /**
   * Le défaut préexistant que cette correction referme : l'ancien
   * `avatar_url = COALESCE(?, avatar_url)` remplaçait à **chaque** connexion
   * Google la photo choisie sur `/profil`. Il ne pouvait pas survivre au
   * passage à une copie — resservir Google à chaque connexion aurait laissé un
   * fichier orphelin par connexion, et l'effacer aurait détruit la photo
   * choisie.
   */
  it("ne touche pas à un avatar téléversé, et ne va même pas le chercher", async () => {
    const { statements } = fakeDb(
      [{ id: 7, google_sub: "google-sub-neuf", email: "nova@exemple.test" }],
      "/api/uploads/avatars/7-ab.webp",
    );

    await createOrGetGoogleUser(profile({ picture: "https://exemple.test/a.png" }));

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(find(statements, "UPDATE bg_users SET avatar_url = ?")).toBeUndefined();
  });

  it("ne tente rien quand Google ne donne aucune photo", async () => {
    fakeDb([{ id: 7, google_sub: "google-sub-neuf", email: "nova@exemple.test" }], null);

    await createOrGetGoogleUser(profile({ picture: undefined }));

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
