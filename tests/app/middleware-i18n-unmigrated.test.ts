import { describe, expect, it } from "@jest/globals";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

/**
 * Avec la **vraie** liste blanche : une route jamais traduite ne doit pas être
 * servie en français sous une adresse anglaise (doublon pour les moteurs).
 */
describe("middleware — route non traduite sous /en", () => {
  it("redirige en 307 vers l'adresse française, sans rien rendre", () => {
    const response = middleware(new NextRequest("https://bluegenji.test/en/route-jamais-traduite?x=1"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://bluegenji.test/route-jamais-traduite?x=1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
