import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/stats-service");

import { createOrGetGoogleUser, type GoogleProfilePayload } from "@/lib/server/users-service";
import { getDatabase } from "@/lib/server/database";
import { ensureUniquePseudo } from "@/lib/server/auth";

/**
 * **Rattacher un `sub` Google à un compte du site, et sur quelle preuve.**
 *
 * La branche de rattachement lie une identité Google neuve à un compte existant
 * sur la seule **égalité de chaîne** de l'adresse e-mail. Sans consulter
 * `email_verified` — que `userinfo` renvoie et qu'on jetait —, il suffisait
 * d'obtenir une identité Google affirmant l'adresse d'un membre pour ouvrir sa
 * session en un clic : ni code, ni plafond, ni courriel de confirmation. C'est
 * le chemin d'entrée le plus court du site, et il n'était pas gardé.
 *
 * Le symétrique compte autant : `bg_users.email` est **unique**, donc y écrire
 * une adresse non vérifiée que quelqu'un d'autre détient ne la volait pas — elle
 * faisait échouer l'insertion, `ER_DUP_ENTRY` avalé en `?error=oauth` à chaque
 * essai. Voir `docs/AUTHORIZATION_RULES.md` §1.2.
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

    if (q.startsWith("SELECT id FROM bg_users WHERE email = ?")) {
      const found = rows.filter((row) => row.email !== null && row.email === params[0]);
      return [found.map(({ id }) => ({ id })), []];
    }

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
  email: "nova@exemple.test",
  emailVerified: true,
  name: "Nova",
  ...overrides,
});

const find = (statements: Statement[], prefix: string) =>
  statements.find(({ sql }) => sql.startsWith(prefix));

describe("createOrGetGoogleUser — rattachement d'un compte existant", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rattache sur une adresse **vérifiée**", async () => {
    const { statements } = fakeDb([{ id: 7, google_sub: null, email: "nova@exemple.test" }]);

    await expect(createOrGetGoogleUser(profile())).resolves.toBe(7);

    const link = find(statements, "UPDATE bg_users SET google_sub = ?")!;
    expect(link.params).toEqual(["google-sub-neuf", 7]);
  });

  it("**refuse** de rattacher sur une adresse non vérifiée", async () => {
    // Le cœur de la règle : sans elle, une identité Google qui se contente
    // d'affirmer l'adresse d'un membre ouvrait sa session.
    const { statements } = fakeDb([{ id: 7, google_sub: null, email: "nova@exemple.test" }]);

    const userId = await createOrGetGoogleUser(profile({ emailVerified: false }));

    expect(userId).not.toBe(7);
    expect(find(statements, "UPDATE bg_users SET google_sub = ?")).toBeUndefined();
    // La ligne du membre n'est même pas cherchée : rien à comparer.
    expect(find(statements, "SELECT id FROM bg_users WHERE email = ?")).toBeUndefined();
  });

  it("crée quand même un compte, mais **sans adresse**", async () => {
    // `bg_users.email` est unique : y écrire l'adresse d'autrui ne la volait pas,
    // elle faisait échouer l'insertion — compte inatteignable par Google, pour
    // toujours, sur une erreur générique. Une identité non vérifiée entre donc,
    // sans rien revendiquer.
    const { statements } = fakeDb([{ id: 7, google_sub: null, email: "nova@exemple.test" }]);

    await expect(createOrGetGoogleUser(profile({ emailVerified: false }))).resolves.toBe(4242);

    const insert = find(statements, "INSERT INTO bg_users")!;
    expect(insert.params).toEqual(["Nova", "google-sub-neuf", null]);
  });

  it("écrit l'adresse à la création quand elle est vérifiée", async () => {
    const { statements } = fakeDb([]);

    await createOrGetGoogleUser(profile({ picture: "https://exemple.test/a.png" }));

    const insert = find(statements, "INSERT INTO bg_users")!;
    // La photo **n'est pas** un paramètre de l'insertion : la colonne naît à
    // `NULL` et ne reçoit qu'un fichier copié chez nous, jamais l'URL de
    // Google. Le nom du fichier portant l'identifiant du compte, il faut de
    // toute façon que la ligne existe d'abord.
    expect(insert.params).toEqual(["Nova", "google-sub-neuf", "nova@exemple.test"]);
    expect(insert.sql).toContain("NULL");
  });

  it("ne met pas à jour l'adresse d'un compte connu sur une identité non vérifiée", async () => {
    // Même colonne unique, même panne : une adresse non vérifiée qui appartient
    // à un autre compte casserait la connexion d'un habitué du site.
    const { statements } = fakeDb([
      { id: 7, google_sub: "google-sub-neuf", email: "nova@exemple.test" },
    ]);

    await expect(
      createOrGetGoogleUser(profile({ emailVerified: false, email: "autre@exemple.test" })),
    ).resolves.toBe(7);

    const update = find(statements, "UPDATE bg_users SET email = COALESCE")!;
    expect(update.params[0]).toBeNull();
  });

  it("met à jour l'adresse d'un compte connu quand elle est vérifiée", async () => {
    const { statements } = fakeDb([
      { id: 7, google_sub: "google-sub-neuf", email: "ancienne@exemple.test" },
    ]);

    await expect(createOrGetGoogleUser(profile())).resolves.toBe(7);

    const update = find(statements, "UPDATE bg_users SET email = COALESCE")!;
    expect(update.params[0]).toBe("nova@exemple.test");
  });

  it("passe par le `google_sub` avant tout : c'est lui qui identifie", async () => {
    // Et il passe **avant** la question de la vérification : un compte déjà
    // rattaché se reconnaît à son `sub`, pas à son adresse.
    const { statements } = fakeDb([
      { id: 7, google_sub: "google-sub-neuf", email: "nova@exemple.test" },
    ]);

    await expect(createOrGetGoogleUser(profile({ emailVerified: false }))).resolves.toBe(7);
    expect(find(statements, "INSERT INTO bg_users")).toBeUndefined();
  });

  it("crée un compte sans adresse du tout quand Google n'en donne pas", async () => {
    const { statements } = fakeDb([]);

    await createOrGetGoogleUser({
      sub: "google-sub-neuf",
      emailVerified: false,
      name: "Nova",
    });

    const insert = find(statements, "INSERT INTO bg_users")!;
    expect(insert.params[2]).toBeNull();
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
