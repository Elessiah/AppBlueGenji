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
