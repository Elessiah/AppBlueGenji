import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/solo-entries-service");
jest.mock("@/lib/server/stats-service");
jest.mock("next/headers");

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createOrGetGoogleUser } from "@/lib/server/users-service";
import { getDatabase } from "@/lib/server/database";
import { buildGoogleAuthorizationUrl } from "@/lib/server/google-oauth";

/**
 * **L'authentification ne dépend d'aucune adresse e-mail.**
 *
 * La question se pose parce qu'elle s'est posée : supprimer `bg_users.email`
 * casserait-il la connexion Google ? Non — et c'est vérifiable à trois niveaux,
 * qu'on fige ici pour que la réponse n'ait pas à être redécouverte à la main.
 *
 * 1. **Le site ne demande pas l'adresse.** Le scope est `openid profile` : Google
 *    ne la renvoie même pas.
 * 2. **Un compte s'identifie par son `sub`.** Le rattachement par égalité
 *    d'adresse a disparu au profit d'« Applications connectées », où le joueur
 *    est déjà connecté quand il ajoute une porte.
 * 3. **Aucune requête du chemin d'authentification ne nomme la colonne.**
 *
 * Le troisième point est le seul que les tests unitaires ne pourraient pas
 * attraper autrement : `mysql2` est simulé, si bien qu'un `SELECT` demandant une
 * colonne absente passerait ici et n'échouerait qu'en production, sur **toutes**
 * les sessions à la fois.
 */
const ROOT = join(__dirname, "..", "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

type Query = { sql: string; params: unknown[] };

function fakeDb(handler?: (sql: string) => unknown) {
  const queries: Query[] = [];
  const execute = jest.fn(async (sql: string, params: unknown[] = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    queries.push({ sql: q, params });
    const handled = handler?.(q);
    if (handled !== undefined) return handled;
    return [[]];
  });
  (getDatabase as jest.Mock).mockResolvedValue({ execute } as never);
  return { queries };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Le site ne demande jamais l'adresse à Google", () => {
  it("n'inclut pas le scope `email` dans l'URL d'autorisation", () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_REDIRECT_URI = "https://exemple.test/api/auth/google/callback";

    const url = buildGoogleAuthorizationUrl("state");

    expect(url).toContain("scope=openid+profile");
    expect(url).not.toMatch(/scope=[^&]*email/);
  });

  it("ne déclare pas l'adresse dans ce qu'il lit de l'`userinfo`", () => {
    const client = read("lib/server/google-oauth.ts");
    const type = client.slice(
      client.indexOf("export type GoogleUserInfo"),
      client.indexOf("function requireGoogleEnv"),
    );
    expect(type).not.toContain("email");
  });
});

describe("createOrGetGoogleUser — l'identité est le `sub`, jamais l'adresse", () => {
  it("retrouve un compte existant sur `google_sub`", async () => {
    const { queries } = fakeDb((sql) =>
      sql.startsWith("SELECT id FROM bg_users WHERE google_sub") ? [[{ id: 7 }]] : undefined,
    );

    expect(await createOrGetGoogleUser({ sub: "google-sub" })).toBe(7);
    expect(queries[0].sql).toContain("WHERE google_sub = ?");
    expect(queries.every((q) => !q.sql.includes("email"))).toBe(true);
  });

  it("ne cherche jamais un compte par adresse — ce serait une session ouverte sur une chaîne", async () => {
    const { queries } = fakeDb((sql) =>
      sql.startsWith("INSERT INTO bg_users") ? [{ insertId: 12 }] : undefined,
    );

    await createOrGetGoogleUser({ sub: "google-sub-neuf", name: "Nova" });

    expect(queries.some((q) => q.sql.includes("WHERE email"))).toBe(false);
  });

  it("n'écrit aucune adresse à la création", async () => {
    const { queries } = fakeDb((sql) =>
      sql.startsWith("INSERT INTO bg_users") ? [{ insertId: 12 }] : undefined,
    );

    await createOrGetGoogleUser({ sub: "google-sub-neuf", name: "Nova" });

    const insert = queries.find((q) => q.sql.startsWith("INSERT INTO bg_users"))!;
    expect(insert.sql).toContain("(pseudo, avatar_url, google_sub)");
    expect(insert.sql).not.toContain("email");
  });
});

describe("Aucune requête du chemin d'authentification ne nomme la colonne", () => {
  // `mysql2` est simulé : un `SELECT` demandant une colonne absente passerait
  // tous les tests et n'échouerait qu'en production, sur toutes les sessions.
  it.each([
    "lib/server/auth.ts",
    "lib/server/users-service.ts",
    "lib/server/account-identities.ts",
    "lib/server/oauth-flow.ts",
    "lib/server/google-oauth.ts",
  ])("%s", (file) => {
    const source = read(file);
    // Les commentaires expliquent *pourquoi* la colonne n'est plus là : on ne
    // lit que le code.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("email");
  });
});
