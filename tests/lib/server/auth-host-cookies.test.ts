import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/connection-logs");
jest.mock("@/lib/server/account-suspensions", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/account-suspensions")>(
    "@/lib/server/account-suspensions",
  );
  return {
    ...actual,
    assertNotSuspended: jest.fn(async () => undefined),
    purgeEndedSuspensions: jest.fn(async () => undefined),
  };
});
jest.mock("next/headers", () => ({ cookies: jest.fn(), redirect: jest.fn() }));

import { cookies } from "next/headers";
import { getDatabase } from "@/lib/server/database";
import { createSession, expireSessionCookies, getCurrentUser } from "@/lib/server/auth";
import { consumeOAuthState, saveOAuthState } from "@/lib/server/oauth-state";
import { type SqlQuery, fakePool } from "../../helpers/sql-double";
import { fakeCookieStore } from "../../helpers/cookie-store";

/**
 * En production, la session et l'état OAuth ne vivent plus que sous
 * `__Host-…` : un cookie nu — posé par un sous-domaine voisin pour le domaine
 * parent — n'est plus lu (fixation de session, état OAuth forgé).
 */

/** Magasin qui ne rend que le cookie nommé, comme le vrai. */
function storeWith(name: string, value: string) {
  const store = {
    get: jest.fn((asked: string) => (asked === name ? { value } : undefined)),
    set: jest.fn(),
  };
  jest.mocked(cookies).mockResolvedValue(fakeCookieStore(store));
  return store;
}

const encode = (payload: unknown) => Buffer.from(JSON.stringify(payload)).toString("base64url");
const OAUTH_PAYLOAD = {
  provider: "GOOGLE",
  state: "s",
  redirectTo: "/tournois",
  intent: "LOGIN",
  termsAccepted: false,
  termsAcceptedNow: false,
  localeFromPage: false,
} as const;

beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(process, "env", { ...process.env, NODE_ENV: "production" });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("session — production", () => {
  it("createSession_production_setsHostPrefixedSecureCookie", async () => {
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: jest.fn<SqlQuery>().mockResolvedValue([]) }));
    const store = storeWith("none", "");

    await createSession(9, "LOGIN_GOOGLE");

    const [name, , options] = store.set.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(name).toBe("__Host-bg_session");
    expect(options).toMatchObject({ secure: true, path: "/", httpOnly: true });
    expect(options).not.toHaveProperty("domain");
  });

  it("getCurrentUser_production_ignoresBareSessionCookie", async () => {
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], []]);
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute }));
    storeWith("bg_session", "planted");

    expect(await getCurrentUser()).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("getCurrentUser_production_readsHostPrefixedCookie", async () => {
    const row = {
      id: 3, pseudo: "P", avatar_url: null, discord_id: null, google_sub: null,
      is_adult: 1, is_admin: 0, platform_roles_json: null,
    };
    jest.mocked(getDatabase).mockResolvedValue(fakePool({ execute: jest.fn<SqlQuery>().mockResolvedValue([[row], []]) }));
    storeWith("__Host-bg_session", "tok");

    expect((await getCurrentUser())?.id).toBe(3);
  });

  it("expireSessionCookies_production_expiresHostPrefixedCookie", async () => {
    const store = storeWith("__Host-bg_session", "tok");

    await expireSessionCookies();

    expect(store.set).toHaveBeenCalledWith(
      "__Host-bg_session",
      "",
      expect.objectContaining({ maxAge: 0, secure: true, path: "/" }),
    );
  });
});

describe("état OAuth — production", () => {
  it("saveOAuthState_production_usesHostPrefixedName", async () => {
    const store = storeWith("none", "");

    await saveOAuthState(OAUTH_PAYLOAD);

    const [name, , options] = store.set.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(name).toBe("__Host-bg_oauth");
    expect(options).toMatchObject({ secure: true, path: "/" });
    expect(options).not.toHaveProperty("domain");
  });

  it("consumeOAuthState_production_readsAndClearsHostPrefixedName", async () => {
    const store = storeWith("__Host-bg_oauth", encode(OAUTH_PAYLOAD));

    expect(await consumeOAuthState()).toMatchObject({ state: "s", redirectTo: "/tournois" });
    expect(store.set).toHaveBeenCalledWith("__Host-bg_oauth", "", expect.objectContaining({ maxAge: 0 }));
  });

  it("consumeOAuthState_production_ignoresBareOauthCookie", async () => {
    storeWith("bg_oauth", encode({ ...OAUTH_PAYLOAD, termsAccepted: true }));

    expect(await consumeOAuthState()).toBeNull();
  });
});
