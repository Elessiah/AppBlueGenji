import { describe, expect, it } from "@jest/globals";
import { NextRequest } from "next/server";

import { config, middleware } from "@/middleware";
import { CSP_HEADER } from "@/lib/shared/csp";

/**
 * Toute écriture sous `/api/` prouve sa provenance.
 *
 * `SameSite=Lax` ne refuse le cookie de session qu'à un site **tiers** : un
 * sous-domaine voisin est *same-site*, et son formulaire faisait agir la
 * session d'un membre sur n'importe quelle route authentifiée — plusieurs
 * n'ont pas de corps, aucun contrôle de type n'y aurait rien vu.
 */

const SITE = "https://bluegenji.example";

function request(path: string, method: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`${SITE}${path}`, { method, headers });
}

/** Le middleware a-t-il laissé passer la requête jusqu'à la route ? */
function passedThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

describe("middleware — provenance des écritures sous /api/", () => {
  it.each([["POST"], ["PUT"], ["PATCH"], ["DELETE"]])(
    "refuse en 403 une écriture %s venue d'un sous-domaine voisin",
    async (method) => {
      const response = middleware(
        request("/api/tournaments/12/register", method, {
          "sec-fetch-site": "same-site",
          origin: "https://voisin.bluegenji.example",
        }),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "CROSS_SITE_REQUEST" });
    },
  );

  it("refuse une écriture d'un site tiers, route d'administration comprise", () => {
    const response = middleware(
      request("/api/admin/users/7/roles", "PUT", { "sec-fetch-site": "cross-site" }),
    );
    expect(response.status).toBe(403);
  });

  it("refuse sur `Origin` quand le navigateur ne pose pas `Sec-Fetch-Site`", () => {
    const response = middleware(
      request("/api/teams/3/leave", "POST", { origin: "https://voisin.bluegenji.example" }),
    );
    expect(response.status).toBe(403);
  });

  it("laisse passer une écriture du site lui-même", () => {
    expect(
      passedThrough(middleware(request("/api/teams/3/leave", "POST", { "sec-fetch-site": "same-origin" }))),
    ).toBe(true);
    expect(passedThrough(middleware(request("/api/teams/3/leave", "POST", { origin: SITE })))).toBe(true);
  });

  it("laisse passer un client hors navigateur, qui n'a pas de cookie de victime", () => {
    expect(passedThrough(middleware(request("/api/teams/3/leave", "POST")))).toBe(true);
  });

  it.each([
    ["/api/auth/google/callback?code=x&state=y"],
    ["/api/auth/discord/callback?code=x&state=y"],
    ["/api/tournaments/12/stream"],
    ["/api/uploads/avatars/a.webp"],
  ])("laisse passer une lecture — %s — sans rien regarder", (path) => {
    const response = middleware(request(path, "GET", { "sec-fetch-site": "cross-site" }));
    expect(passedThrough(response)).toBe(true);
    // Aucune politique de sécurité sur une réponse d'API.
    expect(response.headers.get(CSP_HEADER)).toBeNull();
  });

  it.each([["/api/csp-report"], ["/api/visits"]])(
    "n'exige rien de l'écriture anonyme %s",
    (path) => {
      expect(passedThrough(middleware(request(path, "POST", { "sec-fetch-site": "cross-site" })))).toBe(true);
    },
  );

  it("couvre `/api/` dans son périmètre, sans changer celui des pages", () => {
    expect(config.matcher).toContain("/api/:path*");
    expect(config.matcher[0]).toMatchObject({ source: expect.stringContaining("(?!api") });
  });
});
