import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import type { IncomingMessage } from "node:http";
import { NextRequest } from "next/server";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { matchHas, prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination";

import nextConfig from "@/next.config";
import { middleware } from "@/middleware";
import { LOCALE_REWRITES } from "@/lib/shared/locale-rewrites";
import { LOCALE_HEADER } from "@/lib/shared/locales";

/**
 * Réécriture `/en/…` → `/…` par `next.config.ts` (incident du 2026-10-06 :
 * toute page anglaise en 500 derrière le mandataire TLS).
 *
 * Les règles sont passées au **vrai** moteur de Next (`getPathMatch`,
 * `matchHas`, `prepareDestination`, mêmes options que
 * `next/dist/server/lib/router-utils/filesystem.js`) : un motif mal rédigé
 * (barres, casse, exclusion de `/api`) échouerait ici, pas en production.
 */
function rewrite(pathname: string, headers: Record<string, string> = {}): string | null {
  const req = { headers } as unknown as IncomingMessage;
  for (const rule of LOCALE_REWRITES) {
    const params = getPathMatch(rule.source, { strict: true, removeUnnamedParams: true })(pathname);
    if (!params) continue;
    const hasParams = matchHas(req, {}, rule.has);
    if (!hasParams) continue;
    const { parsedDestination } = prepareDestination({
      appendParamsToQuery: false,
      destination: rule.destination,
      params: { ...params, ...hasParams },
      query: {},
    });
    return parsedDestination.pathname ?? null;
  }
  return null;
}

const english = { [LOCALE_HEADER]: "en" };

describe("rewrites — adresses anglaises", () => {
  it("sont déclarées en beforeFiles, seules", async () => {
    const rules = await nextConfig.rewrites!();
    expect(rules).toEqual({ beforeFiles: [...LOCALE_REWRITES], afterFiles: [], fallback: [] });
  });

  it("ne portent qu'un chemin, jamais une origine (rien à relayer)", () => {
    for (const rule of LOCALE_REWRITES) expect(rule.destination.startsWith("/")).toBe(true);
    for (const rule of LOCALE_REWRITES) expect(rule.destination).not.toMatch(/^\/\//);
  });

  it.each([
    ["/en", "/"],
    ["/en/regles", "/regles"],
    ["/en/regles/ronde-suisse", "/regles/ronde-suisse"],
    ["/en/apiculture", "/apiculture"],
  ])("réécrivent %s vers %s quand le middleware l'a marqué anglais", (from, to) => {
    expect(rewrite(from, english)).toBe(to);
  });

  it("ne réécrivent rien sans la marque du middleware", () => {
    expect(rewrite("/en/regles")).toBeNull();
    expect(rewrite("/en/regles", { [LOCALE_HEADER]: "fr" })).toBeNull();
    expect(rewrite("/en", { [LOCALE_HEADER]: "english" })).toBeNull();
  });

  it("ne mènent jamais à /api, même marquées anglaises, casse comprise", () => {
    for (const path of ["/en/api", "/en/api/", "/en/api/teams/1/leave", "/en/API/visits", "/EN/Api/x"]) {
      expect(rewrite(path, english)).toBeNull();
    }
  });

  it("ne confondent pas /enquete ni /fr/… avec une adresse anglaise", () => {
    expect(rewrite("/enquete", english)).toBeNull();
    expect(rewrite("/fr/regles", english)).toBeNull();
  });
});

/**
 * Le cas de production : `next start -H 127.0.0.1`, nginx devant
 * (`Host: bluegenji-esport.fr`, `X-Forwarded-Proto: https`). Next remet au
 * middleware `https://localhost:3000/…` — protocole relayé, hôte d'écoute
 * récrit en `localhost` par `NextURL` — quand son routeur garde
 * `https://127.0.0.1:3000` : toute adresse absolue rédigée ici serait jugée
 * externe et relayée en HTTPS vers un serveur HTTP (`EPROTO`).
 */
describe("middleware — derrière le mandataire TLS", () => {
  const previousAppUrl = process.env.APP_URL;
  beforeAll(() => {
    process.env.APP_URL = "https://bluegenji-esport.fr";
  });
  afterAll(() => {
    process.env.APP_URL = previousAppUrl;
  });

  const proxied = (url: string) =>
    middleware(
      new NextRequest(url, {
        headers: { host: "bluegenji-esport.fr", "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.9" },
      }),
    );

  it.each(["https://127.0.0.1:3000", "https://localhost:3000", "https://[::1]:3000"])(
    "ne rédige aucune réécriture absolue depuis %s, et marque anglais",
    (origin) => {
      for (const path of ["/en", "/en/regles", "/en/regles/ronde-suisse?tournoi=4"]) {
        const response = proxied(`${origin}${path}`);
        expect(response.status).toBe(200);
        expect(response.headers.get("x-middleware-rewrite")).toBeNull();
        expect(response.headers.get("x-middleware-next")).toBe("1");
        expect(response.headers.get(`x-middleware-request-${LOCALE_HEADER}`)).toBe("en");
      }
    },
  );

  it("garde les renvois sur la racine publique et le 404 de /en/api", () => {
    expect(proxied("https://127.0.0.1:3000/en/route-jamais-traduite").headers.get("location")).toBe(
      "https://bluegenji-esport.fr/route-jamais-traduite",
    );
    expect(proxied("https://127.0.0.1:3000/fr/regles").status).toBe(308);
    expect(proxied("https://127.0.0.1:3000/en/api/visits").status).toBe(404);
  });

  it("chaîne complète : la marque posée par le middleware déclenche la réécriture de configuration", () => {
    const response = proxied("https://127.0.0.1:3000/en/regles");
    const locale = response.headers.get(`x-middleware-request-${LOCALE_HEADER}`) ?? "";
    expect(rewrite("/en/regles", { [LOCALE_HEADER]: locale })).toBe("/regles");
  });
});
