import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/shared/i18n-routes", () => ({
  MIGRATED_ROUTES: ["/", "/regles", "/connexion", "/recrutement"],
}));

import { NextRequest } from "next/server";
import { LEGACY_SUSPENSION_NOTICE_PATH, config, middleware } from "@/middleware";
import { CSP_HEADER, CSP_NONCE_HEADER, PATHNAME_HEADER } from "@/lib/shared/csp";
import { LOCALE_HEADER } from "@/lib/shared/locales";
import { SUSPENSION_NOTICE_COOKIE, SUSPENSION_NOTICE_HEADER } from "@/lib/shared/account-suspension";

const ORIGIN = "https://bluegenji.test";

function call(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return middleware(new NextRequest(`${ORIGIN}${path}`, init));
}

/** L'en-tête de requête tel que le middleware le remet au rendu. */
const forwarded = (response: Response, name: string) => response.headers.get(`x-middleware-request-${name}`);
const rewrittenTo = (response: Response) => response.headers.get("x-middleware-rewrite");

describe("middleware — adresses anglaises réécrites", () => {
  it("réécrit /en/regles vers /regles, langue en, chemin sans préfixe", () => {
    const response = call("/en/regles?mode=swiss");
    expect(rewrittenTo(response)).toBe(`${ORIGIN}/regles?mode=swiss`);
    expect(forwarded(response, LOCALE_HEADER)).toBe("en");
    expect(forwarded(response, PATHNAME_HEADER)).toBe("/regles");
  });

  it("réécrit /en vers l'accueil", () => {
    const response = call("/en");
    expect(rewrittenTo(response)).toBe(`${ORIGIN}/`);
    expect(forwarded(response, LOCALE_HEADER)).toBe("en");
  });

  it("garde la politique et son nonce sur une page anglaise comme française", () => {
    for (const path of ["/en/regles", "/regles"]) {
      const response = call(path);
      const nonce = forwarded(response, CSP_NONCE_HEADER);
      expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(response.headers.get(CSP_HEADER)).toContain(`'nonce-${nonce}'`);
    }
  });

  it("pose fr sur une adresse sans préfixe, sans réécriture", () => {
    const response = call("/regles");
    expect(rewrittenTo(response)).toBeNull();
    expect(forwarded(response, LOCALE_HEADER)).toBe("fr");
    expect(forwarded(response, PATHNAME_HEADER)).toBe("/regles");
  });

  it("remplace la langue qu'un client prétendrait", () => {
    expect(forwarded(call("/regles", { headers: { [LOCALE_HEADER]: "en" } }), LOCALE_HEADER)).toBe("fr");
    expect(forwarded(call("/en/regles", { headers: { [LOCALE_HEADER]: "fr" } }), LOCALE_HEADER)).toBe("en");
  });

  it("ne redirige jamais selon Accept-Language", () => {
    const response = call("/regles", { headers: { "accept-language": "en-US,en;q=0.9" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(forwarded(response, LOCALE_HEADER)).toBe("fr");
  });

  it("transmet /recrutement sans préfixe à la mise en page (mise en avant tue)", () => {
    expect(forwarded(call("/en/recrutement"), PATHNAME_HEADER)).toBe("/recrutement");
  });
});

describe("middleware — adresses préfixées refusées ou renvoyées", () => {
  it("répond 404 à /en/api/… quelle que soit la méthode, sans réécrire", () => {
    for (const method of ["GET", "POST", "DELETE"]) {
      const response = call("/en/api/teams/1/leave", { method, headers: { origin: "https://evil.test" } });
      expect(response.status).toBe(404);
      expect(rewrittenTo(response)).toBeNull();
      expect(response.headers.get("location")).toBeNull();
    }
    expect(call("/en/api").status).toBe(404);
    expect(call("/fr/api/x", { method: "POST" }).status).toBe(404);
  });

  it("redirige /fr/… en 308 vers l'adresse sans préfixe", () => {
    const response = call("/fr/regles?x=1");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("/regles?x=1");
  });

  it("redirige en 307 une route pas encore traduite, requête conservée", () => {
    const response = call("/en/classement?saison=2");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/classement?saison=2");
  });

  it("ne confond pas /enquete avec une adresse anglaise", () => {
    const response = call("/enquete");
    expect(response.status).toBe(200);
    expect(forwarded(response, LOCALE_HEADER)).toBe("fr");
  });
});

describe("middleware — préchargements de /en", () => {
  it("réécrit et marque anglais un préchargement, langue du client ignorée", () => {
    const response = call("/en/regles", { headers: { purpose: "prefetch", [LOCALE_HEADER]: "fr" } });
    expect(rewrittenTo(response)).toBe(`${ORIGIN}/regles`);
    expect(forwarded(response, LOCALE_HEADER)).toBe("en");
    expect(forwarded(response, PATHNAME_HEADER)).toBe("/regles");
  });

  it("redirige aussi le préchargement d'une route pas encore traduite", () => {
    expect(call("/en/classement", { headers: { purpose: "prefetch" } }).status).toBe(307);
  });

  it("déclare /en/:path* au matcher, sans l'exclusion des préchargements", () => {
    expect(config.matcher).toContain("/en/:path*");
  });
});

describe("middleware — avis de suspension sous /en/connexion", () => {
  it("remet l'avis et efface le cookie sur /en/connexion comme sur /connexion", () => {
    for (const path of ["/connexion?error=suspended", "/en/connexion?error=suspended"]) {
      const response = call(path, { headers: { cookie: `${SUSPENSION_NOTICE_COOKIE}=abc` } });
      expect(forwarded(response, SUSPENSION_NOTICE_HEADER)).toBe("abc");
      const setCookie = response.headers.get("set-cookie") ?? "";
      expect(setCookie).toMatch(new RegExp(`^${SUSPENSION_NOTICE_COOKIE}=;`));
      expect(setCookie).toMatch(/Path=\/(;|$)/i);
    }
  });

  it("efface aussi le cookie resté sous l'ancien chemin /connexion, sans perdre les autres effacements", () => {
    const response = call("/connexion?error=suspended", {
      headers: { cookie: `${SUSPENSION_NOTICE_COOKIE}=abc; g_state=0` },
    });
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(3);
    expect(cookies.some((c) => /^g_state=;/.test(c))).toBe(true);
    const notices = cookies.filter((c) => c.startsWith(`${SUSPENSION_NOTICE_COOKIE}=;`));
    expect(notices.map((c) => /Path=([^;]+)/i.exec(c)?.[1]).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([
      "/",
      LEGACY_SUSPENSION_NOTICE_PATH,
    ]);
    for (const notice of notices) expect(notice).toMatch(/Max-Age=0/i);
  });

  it("ne consomme pas l'avis sur un fetch du routeur (préchargement de /en/connexion)", () => {
    const response = call("/en/connexion", {
      headers: { cookie: `${SUSPENSION_NOTICE_COOKIE}=abc`, "sec-fetch-dest": "empty" },
    });
    expect(forwarded(response, SUSPENSION_NOTICE_HEADER)).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    // La réécriture, elle, a bien lieu.
    expect(forwarded(response, LOCALE_HEADER)).toBe("en");
  });

  it("le consomme sur le document que charge le retour OAuth", () => {
    const response = call("/en/connexion?error=suspended", {
      headers: { cookie: `${SUSPENSION_NOTICE_COOKIE}=abc`, "sec-fetch-dest": "document" },
    });
    expect(forwarded(response, SUSPENSION_NOTICE_HEADER)).toBe("abc");
  });

  it("ne lit pas le cookie ailleurs que sur la page de connexion", () => {
    const response = call("/en/regles", { headers: { cookie: `${SUSPENSION_NOTICE_COOKIE}=abc` } });
    expect(forwarded(response, SUSPENSION_NOTICE_HEADER)).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
