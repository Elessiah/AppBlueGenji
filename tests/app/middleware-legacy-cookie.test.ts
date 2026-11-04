import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { NextRequest } from "next/server";
import { LEGACY_GOOGLE_ONE_TAP_COOKIE, middleware } from "@/middleware";
import { CSP_HEADER } from "@/lib/shared/csp";
import { SUSPENSION_NOTICE_COOKIE, SUSPENSION_NOTICE_HEADER } from "@/lib/shared/account-suspension";

function request(cookie?: string): NextRequest {
  return new NextRequest("https://bluegenji.test/tournois", {
    headers: cookie ? { cookie } : {},
  });
}

describe("middleware — cookie de l'invite Google One Tap retirée", () => {
  it("efface g_state chez qui le porte encore, sur n'importe quelle page", () => {
    const response = middleware(request(`${LEGACY_GOOGLE_ONE_TAP_COOKIE}=0_l:0; bg_session=abc`));
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^g_state=;/);
    expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970/i);
    expect(setCookie).toMatch(/Path=\//i);
    // Les autres cookies ne sont pas touchés.
    expect(setCookie).not.toMatch(/bg_session/);
  });

  it("ne pose aucun cookie quand g_state est absent", () => {
    expect(middleware(request("bg_session=abc")).headers.get("set-cookie")).toBeNull();
  });
});

describe("middleware — exposé d'une suspension lu une seule fois", () => {
  const onPath = (path: string, cookie: string) =>
    middleware(new NextRequest(`https://bluegenji.test${path}`, { headers: { cookie } }));

  it("efface le cookie dans la réponse de /connexion, sans le retirer de la requête lue par la page", () => {
    const response = onPath("/connexion?error=suspended", `${SUSPENSION_NOTICE_COOKIE}=abc`);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(new RegExp(`^${SUSPENSION_NOTICE_COOKIE}=;`));
    expect(setCookie).toMatch(/Max-Age=0/i);
    // Même chemin que celui de la pose (`oauth-flow.ts`), sans quoi
    // l'effacement viserait un autre cookie.
    expect(setCookie).toMatch(/Path=\/(;|$)/i);
    // La page le reçoit par un en-tête de requête, que l'effacement ne touche pas.
    expect(response.headers.get(`x-middleware-request-${SUSPENSION_NOTICE_HEADER}`)).toBe("abc");
  });

  it("retire l'en-tête qu'un client aurait posé lui-même", () => {
    const response = middleware(
      new NextRequest("https://bluegenji.test/connexion?error=suspended", {
        headers: { [SUSPENSION_NOTICE_HEADER]: "contrefait" },
      }),
    );
    expect(response.headers.get(`x-middleware-request-${SUSPENSION_NOTICE_HEADER}`)).toBeNull();
  });

  it("ne touche à rien ailleurs, ni sans le cookie", () => {
    expect(onPath("/tournois", `${SUSPENSION_NOTICE_COOKIE}=abc`).headers.get("set-cookie")).toBeNull();
    expect(onPath("/connexion", "bg_session=abc").headers.get("set-cookie")).toBeNull();
  });
});

describe("middleware — cookies d'authentification d'avant le préfixe __Host-", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });
  const inProduction = () => jest.replaceProperty(process, "env", { ...process.env, NODE_ENV: "production" });

  it("middleware_production_clearsBareSessionCookie", () => {
    inProduction();
    const setCookie = middleware(request("bg_session=abc")).headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^bg_session=;/);
    expect(setCookie).toMatch(/Max-Age=0/i);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).toMatch(/Secure/i);
  });

  it("middleware_production_clearsBareOauthCookie", () => {
    inProduction();
    const setCookie = middleware(request("bg_oauth=xyz")).headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^bg_oauth=;/);
    expect(setCookie).toMatch(/Max-Age=0/i);
  });

  it("middleware_production_keepsHostPrefixedCookie", () => {
    inProduction();
    expect(middleware(request("__Host-bg_session=abc")).headers.get("set-cookie")).toBeNull();
  });

  it("middleware_production_clearsLegacyAlongsideSuspensionLegacyPath", () => {
    inProduction();
    const response = middleware(
      new NextRequest("https://bluegenji.test/connexion", {
        headers: { cookie: `${SUSPENSION_NOTICE_COOKIE}=abc; bg_session=old` },
      }),
    );
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/bg_session=;/);
    expect(setCookie).toContain("Path=/connexion");
  });
});

describe("middleware — politique CSP selon le serveur de développement", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });
  // Sous Jest, le middleware n'est pas compilé par Next : `process.env.TURBOPACK`
  // se lit tel quel, et `Boolean("1")` vaut ce que Next y aurait inscrit.
  const withEnv = (env: { NODE_ENV: NodeJS.ProcessEnv["NODE_ENV"]; TURBOPACK?: string }) => {
    const { TURBOPACK: _ignored, APP_URL: _appUrl, ...rest } = process.env;
    jest.replaceProperty(process, "env", { ...rest, ...env });
  };
  const scriptSrc = () =>
    (middleware(request()).headers.get(CSP_HEADER) ?? "")
      .split("; ")
      .find((part) => part.startsWith("script-src ")) ?? "";

  it("middleware_turbopackDev_dropsStrictDynamic", () => {
    withEnv({ NODE_ENV: "development", TURBOPACK: "1" });

    expect(scriptSrc()).not.toContain("'strict-dynamic'");
  });

  it("middleware_webpackDev_keepsStrictDynamic", () => {
    withEnv({ NODE_ENV: "development" });

    expect(scriptSrc()).toContain("'strict-dynamic'");
  });

  // Forme compilée : Next inscrit un booléen (`define-env`), pas une chaîne.
  it("middleware_inlinedTrueTurbopackFlag_dropsStrictDynamic", () => {
    withEnv({ NODE_ENV: "development" });
    Reflect.set(process.env, "TURBOPACK", true);

    expect(scriptSrc()).not.toContain("'strict-dynamic'");
  });

  it("middleware_inlinedFalseTurbopackFlag_keepsStrictDynamic", () => {
    withEnv({ NODE_ENV: "development" });
    Reflect.set(process.env, "TURBOPACK", false);

    expect(scriptSrc()).toContain("'strict-dynamic'");
  });

  // Les hôtes viennent de `siteHosts` (`Host`, `X-Forwarded-Host`, URL) et non
  // du seul `nextUrl.origin`, que `next dev` réécrit en `localhost`.
  const scriptSrcWithHeaders = (headers: Record<string, string>) =>
    (middleware(new NextRequest("https://bluegenji.test/tournois", { headers })).headers.get(CSP_HEADER) ?? "")
      .split("; ")
      .find((part) => part.startsWith("script-src ")) ?? "";

  it("middleware_turbopackDevPlainHost_listsHostAndRequestHost", () => {
    withEnv({ NODE_ENV: "development", TURBOPACK: "1" });

    const actual = scriptSrcWithHeaders({ host: "127.0.0.1:3457" });

    expect(actual.startsWith("script-src 127.0.0.1:3457/_next/ bluegenji.test/_next/ 'nonce-")).toBe(true);
    expect(actual).not.toContain("'self'");
  });

  it("middleware_turbopackDevForwardedHost_addsTunnelHost", () => {
    withEnv({ NODE_ENV: "development", TURBOPACK: "1" });

    const actual = scriptSrcWithHeaders({ host: "localhost:3000", "x-forwarded-host": "abc.ngrok.app" });

    expect(actual).toContain(" abc.ngrok.app/_next/ ");
  });

  it("middleware_turbopackDevDuplicateHosts_listsEachOnce", () => {
    withEnv({ NODE_ENV: "development", TURBOPACK: "1" });

    expect(scriptSrcWithHeaders({ host: "bluegenji.test" }).startsWith("script-src bluegenji.test/_next/ 'nonce-")).toBe(true);
  });

  it("middleware_turbopackDevHostWithDirectiveInjection_keepsSelf", () => {
    withEnv({ NODE_ENV: "development", TURBOPACK: "1" });

    const actual = scriptSrcWithHeaders({ host: "evil.test; script-src *" });

    expect(actual.startsWith("script-src 'self' ")).toBe(true);
    expect(actual).not.toContain("evil.test");
  });

  it("middleware_turbopackDevIpv6Host_keepsSelf", () => {
    withEnv({ NODE_ENV: "development", TURBOPACK: "1" });

    expect(scriptSrcWithHeaders({ host: "[::1]:3000" }).startsWith("script-src 'self' ")).toBe(true);
  });

  it("middleware_turbopackDevMissingHost_listsRequestHost", () => {
    withEnv({ NODE_ENV: "development", TURBOPACK: "1" });

    expect(scriptSrcWithHeaders({}).startsWith("script-src bluegenji.test/_next/ 'nonce-")).toBe(true);
  });

  it("middleware_turbopackProduction_keepsSelfSource", () => {
    withEnv({ NODE_ENV: "production", TURBOPACK: "1" });

    const actual = scriptSrc();

    expect(actual.startsWith("script-src 'self' ")).toBe(true);
    expect(actual).not.toContain("/_next/");
  });

  it("middleware_turbopackProduction_keepsStrictDynamic", () => {
    withEnv({ NODE_ENV: "production", TURBOPACK: "1" });

    expect(scriptSrc()).toContain("'strict-dynamic'");
  });
});
