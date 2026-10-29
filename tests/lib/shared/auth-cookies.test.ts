import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  hostCookieName,
  legacyAuthCookieNames,
  oauthCookieName,
  sessionCookieName,
} from "@/lib/shared/auth-cookies";

/**
 * Préfixe `__Host-` des cookies d'authentification (décision 15) : en
 * production seulement — un `__Host-` exige `Secure`, que le serveur de
 * développement, en `http://127.0.0.1`, ne pose pas.
 */
describe("hostCookieName", () => {
  it("hostCookieName_production_prefixesWithHost", () => {
    expect(hostCookieName("bg_session", true)).toBe("__Host-bg_session");
  });

  it("hostCookieName_notProduction_keepsBareName", () => {
    expect(hostCookieName("bg_session", false)).toBe("bg_session");
  });
});

describe("sessionCookieName / oauthCookieName", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("sessionCookieName_nodeEnvProduction_readsEnvAtCallTime", () => {
    jest.replaceProperty(process, "env", { ...process.env, NODE_ENV: "production" });
    expect(sessionCookieName()).toBe("__Host-bg_session");
    expect(oauthCookieName()).toBe("__Host-bg_oauth");
  });

  it("sessionCookieName_nodeEnvDevelopment_keepsBareNames", () => {
    jest.replaceProperty(process, "env", { ...process.env, NODE_ENV: "development" });
    expect(sessionCookieName()).toBe("bg_session");
    expect(oauthCookieName()).toBe("bg_oauth");
  });
});

describe("legacyAuthCookieNames", () => {
  it("legacyAuthCookieNames_production_listsBareSessionAndOauth", () => {
    expect(legacyAuthCookieNames(true)).toEqual(["bg_session", "bg_oauth"]);
  });

  it("legacyAuthCookieNames_notProduction_isEmpty", () => {
    // Hors production, le nom nu est le cookie en service : l'effacer
    // déconnecterait à chaque page.
    expect(legacyAuthCookieNames(false)).toEqual([]);
  });
});
