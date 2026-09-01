import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("useResourceLoader", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("exports ResourceState type", () => {
    // Verify that the hook module exports the expected types
    // This test verifies that the hook can be imported and has correct types
    const module = require("@/lib/shared/hooks/useResourceLoader");
    expect(module.useResourceLoader).toBeDefined();
  });

  it("useResourceLoader is a function", () => {
    const module = require("@/lib/shared/hooks/useResourceLoader");
    expect(typeof module.useResourceLoader).toBe("function");
  });

  /**
   * Le harnais tourne en environnement `node` : un hook React n'y est pas
   * montable. Ce que gardent ces cas est donc lu à la source — mais c'est un
   * invariant réel : un 404 peut porter de quoi rebondir (une entrée solo mène
   * au profil du joueur, cf. `tests/app/api/teams/solo-entry-detail.test.ts`),
   * et ce corps se perdait tant que la branche 404 ne le lisait pas.
   */
  describe("corps d'un 404", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "lib/shared/hooks/useResourceLoader.ts"),
      "utf8",
    );

    it("lit le corps avant de prévenir l'appelant", () => {
      const branch = source.slice(source.indexOf("res.status === 404"));
      expect(branch).toContain("await res.json().catch(() => ({}))");
      expect(branch).toContain("onNotFoundRedirect?.(body)");
      // Lu avant l'appel, sinon le rappel ne recevrait rien d'utile.
      expect(branch.indexOf("res.json()")).toBeLessThan(branch.indexOf("onNotFoundRedirect?."));
    });

    it("survit à un 404 sans corps JSON", () => {
      // `.catch(() => ({}))` : un 404 nu (page HTML, corps vide) ne doit pas
      // faire tomber la page dans la branche « erreur réseau ».
      expect(source).toContain("catch(() => ({}))");
    });

    it("passe le corps au rappel, dans sa signature", () => {
      expect(source).toContain("onNotFoundRedirect?: (payload: NotFoundPayload) => void");
    });
  });
});

describe("useTeamDetail — un identifiant d'entrée solo", () => {
  const source = readFileSync(
    join(__dirname, "..", "..", "app/(secured)/equipes/[id]/_hooks/useTeamDetail.ts"),
    "utf8",
  );

  it("mène au profil du joueur au lieu d'annoncer une équipe manquante", () => {
    expect(source).toContain("router.replace(`/joueurs/${soloUserId}`)");
    // Le lien était valide : afficher « TEAM_NOT_FOUND » au passage serait un
    // clignotement d'erreur sur un chemin nominal.
    const branch = source.slice(
      source.indexOf("const soloUserId"),
      source.indexOf('showError("TEAM_NOT_FOUND")'),
    );
    expect(branch).toContain("return;");
  });

  it("garde le message et le repli pour une vraie équipe manquante", () => {
    expect(source).toContain('showError("TEAM_NOT_FOUND")');
    expect(source).toContain('router.push("/equipes")');
  });

  it("n'accepte un identifiant de joueur que s'il en est un", () => {
    // Le corps d'un 404 est de la donnée serveur non typée : un `soloUserId`
    // absent ou textuel construirait `/joueurs/undefined`.
    expect(source).toContain('typeof soloUserId === "number"');
  });
});
