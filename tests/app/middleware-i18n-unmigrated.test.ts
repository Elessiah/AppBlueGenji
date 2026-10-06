import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

/**
 * Avec la **vraie** liste blanche : une route jamais traduite ne doit pas être
 * servie en français sous une adresse anglaise (doublon pour les moteurs).
 */
const PUBLIC = "https://bluegenji.test";

describe("middleware — route non traduite sous /en", () => {
  const previousAppUrl = process.env.APP_URL;
  beforeAll(() => {
    process.env.APP_URL = PUBLIC;
  });
  afterAll(() => {
    process.env.APP_URL = previousAppUrl;
  });

  it("redirige en 307 vers l'adresse française, sans rien rendre", () => {
    const response = middleware(new NextRequest("https://bluegenji.test/en/route-jamais-traduite?x=1"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${PUBLIC}/route-jamais-traduite?x=1`);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("rédige le renvoi sur la racine publique, jamais sur l'origine interne du mandataire", () => {
    const response = middleware(new NextRequest("https://localhost:3000/en/route-jamais-traduite"));
    // Absolue : l'adaptateur de Next la relit par `new URL` sans base.
    expect(response.headers.get("location")).toBe(`${PUBLIC}/route-jamais-traduite`);
  });

  it("sans APP_URL (développement, E2E), renvoie sur l'origine de la requête", () => {
    delete process.env.APP_URL;
    try {
      const response = middleware(new NextRequest("http://localhost:3100/en/route-jamais-traduite"));
      expect(response.headers.get("location")).toBe("http://localhost:3100/route-jamais-traduite");
    } finally {
      process.env.APP_URL = PUBLIC;
    }
  });

  it("préfère la racine figée à la compilation (BG_PUBLIC_ORIGIN), seule lisible sous next start", () => {
    delete process.env.APP_URL;
    process.env.BG_PUBLIC_ORIGIN = "https://compile.example/";
    try {
      const response = middleware(new NextRequest("http://localhost:3000/en/route-jamais-traduite"));
      expect(response.headers.get("location")).toBe("https://compile.example/route-jamais-traduite");
    } finally {
      delete process.env.BG_PUBLIC_ORIGIN;
      process.env.APP_URL = PUBLIC;
    }
  });

  it.each(["/en//evil.example/x", "/en/%5Cevil.example", "/fr//evil.example"])(
    "ne sort jamais du site (%s)",
    (path) => {
      const location = middleware(new NextRequest(`https://localhost:3000${path}`)).headers.get("location") ?? "";
      expect(new URL(location).origin).toBe(PUBLIC);
    },
  );

  it("redirige /fr/… en 308 vers l'adresse sans préfixe, sur la racine publique", () => {
    const response = middleware(new NextRequest("https://localhost:3000/fr/regles"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`${PUBLIC}/regles`);
  });
});

/** Lot 3 : les règles sont la première route réellement traduite. */
describe("middleware — règles traduites (vraie liste)", () => {
  const previousAppUrl = process.env.APP_URL;
  beforeAll(() => {
    process.env.APP_URL = PUBLIC;
  });
  afterAll(() => {
    process.env.APP_URL = previousAppUrl;
  });

  it.each(["/en/regles", "/en/regles/survie", "/en/regles/ronde-suisse?tournoi=4"])("laisse passer %s, marqué anglais", (path) => {
    const response = middleware(new NextRequest(`https://localhost:3000${path}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-bg-locale")).toBe("en");
  });

  it("ne traduit pas pour autant ce qui touche aux règles sans en être (`/reglesx`)", () => {
    expect(middleware(new NextRequest("https://localhost:3000/en/reglesx")).status).toBe(307);
  });
});
