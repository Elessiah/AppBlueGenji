import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));

import { cookies } from "next/headers";
import { consumeOAuthState, saveOAuthState } from "@/lib/server/oauth-state";

/**
 * **Le cookie qui traverse un aller-retour OAuth.**
 *
 * Il n'est **pas signé** — c'est assumé —, si bien que rien de ce qu'il porte ne
 * fait foi : le `state` ne vaut que par son égalité avec celui de l'URL, la
 * destination est refiltrée à la sortie, et l'`intent` est le seul champ qui n'a
 * nulle part ailleurs où être lu. D'où la seule chose que ce module doit
 * garantir : **ce qu'on en tire est du type attendu, ou rien**.
 *
 * Et la seconde : il se consomme, toujours. Un état qui ne sert pas est un état
 * qui a échoué, et le laisser en place le rendrait rejouable dix minutes durant.
 */

const originalEnv = { ...process.env };

type CookieStore = {
  get: jest.Mock;
  set: jest.Mock;
};

function fakeCookies(stored?: string): CookieStore {
  const store: CookieStore = {
    get: jest.fn(() => (stored === undefined ? undefined : { value: stored })),
    set: jest.fn(),
  };
  (cookies as jest.Mock).mockResolvedValue(store as never);
  return store;
}

const encode = (payload: unknown) => Buffer.from(JSON.stringify(payload)).toString("base64url");

beforeEach(() => {
  process.env = { ...originalEnv };
  jest.clearAllMocks();
});

afterEach(() => {
  process.env = originalEnv;
});

describe("saveOAuthState", () => {
  it("écrit un cookie httpOnly, borné à dix minutes", () => {
    // Dix minutes : le temps de l'écran de consentement, pas une seconde de
    // plus.
    const store = fakeCookies();

    return saveOAuthState({
      provider: "DISCORD",
      state: "abc",
      redirectTo: "/tournois",
      intent: "LINK",
    }).then(() => {
      const [name, value, options] = store.set.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(name).toBe("bg_oauth");
      expect(JSON.parse(Buffer.from(value, "base64url").toString("utf8"))).toEqual({
        provider: "DISCORD",
        state: "abc",
        redirectTo: "/tournois",
        intent: "LINK",
      });
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe("lax");
      expect(options.maxAge).toBe(600);
    });
  });

  it("pose `secure` en production, et pas en développement", async () => {
    process.env.NODE_ENV = "production";
    let store = fakeCookies();
    await saveOAuthState({ provider: "GOOGLE", state: "a", redirectTo: "/", intent: "LOGIN" });
    expect((store.set.mock.calls[0][2] as Record<string, unknown>).secure).toBe(true);

    process.env.NODE_ENV = "development";
    store = fakeCookies();
    await saveOAuthState({ provider: "GOOGLE", state: "a", redirectTo: "/", intent: "LOGIN" });
    expect((store.set.mock.calls[0][2] as Record<string, unknown>).secure).toBe(false);
  });
});

describe("consumeOAuthState", () => {
  it("rend l'état et l'efface dans le même geste", async () => {
    const store = fakeCookies(
      encode({ provider: "BLIZZARD", state: "abc", redirectTo: "/tournois", intent: "LOGIN" }),
    );

    await expect(consumeOAuthState()).resolves.toEqual({
      provider: "BLIZZARD",
      state: "abc",
      redirectTo: "/tournois",
      intent: "LOGIN",
    });
    expect(store.set).toHaveBeenCalledWith(
      "bg_oauth",
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
  });

  it("efface le cookie même quand il est inexploitable", async () => {
    const store = fakeCookies("pas-du-base64-json");

    await expect(consumeOAuthState()).resolves.toBeNull();
    expect(store.set).toHaveBeenCalledWith("bg_oauth", "", expect.objectContaining({ maxAge: 0 }));
  });

  it("rend `null` quand il n'y a pas de cookie", async () => {
    fakeCookies();
    await expect(consumeOAuthState()).resolves.toBeNull();
  });

  it.each([
    ["fournisseur inconnu", { provider: "FACEBOOK", state: "a", redirectTo: "/", intent: "LOGIN" }],
    ["fournisseur absent", { state: "a", redirectTo: "/", intent: "LOGIN" }],
    ["état vide", { provider: "GOOGLE", state: "", redirectTo: "/", intent: "LOGIN" }],
    ["état non textuel", { provider: "GOOGLE", state: 42, redirectTo: "/", intent: "LOGIN" }],
    ["destination absente", { provider: "GOOGLE", state: "a", intent: "LOGIN" }],
  ])("refuse un contenu trafiqué : %s", async (_label, payload) => {
    fakeCookies(encode(payload));
    await expect(consumeOAuthState()).resolves.toBeNull();
  });

  it("retombe sur `LOGIN` devant une intention inconnue", async () => {
    // Le repli doit être le **moins** puissant des deux : `LINK` écrit une porte
    // d'entrée sur un compte, `LOGIN` ne fait qu'ouvrir une session pour
    // l'identité qu'on vient de prouver.
    fakeCookies(encode({ provider: "GOOGLE", state: "a", redirectTo: "/", intent: "ADMIN" }));

    await expect(consumeOAuthState()).resolves.toEqual(
      expect.objectContaining({ intent: "LOGIN" }),
    );
  });
});
