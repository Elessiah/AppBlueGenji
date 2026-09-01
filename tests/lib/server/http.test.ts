import { describe, it, expect } from "@jest/globals";
import { ok, fail } from "@/lib/server/http";

describe("http", () => {
  describe("ok", () => {
    it("returns 200 status by default", async () => {
      const response = ok({ message: "success" });
      expect(response.status).toBe(200);
    });

    it("accepts custom status code", async () => {
      const response = ok({ message: "created" }, 201);
      expect(response.status).toBe(201);
    });

    it("returns data as JSON", async () => {
      const data = { id: 1, name: "test" };
      const response = ok(data);
      const body = await response.json();
      expect(body).toEqual(data);
    });

    it("works with primitive data", async () => {
      const response = ok("string-data", 200);
      const body = await response.json();
      expect(body).toBe("string-data");
    });

    it("works with array data", async () => {
      const data = [1, 2, 3];
      const response = ok(data);
      const body = await response.json();
      expect(body).toEqual(data);
    });

    it("sets Content-Type header to application/json", async () => {
      const response = ok({ test: true });
      expect(response.headers.get("content-type")).toContain("application/json");
    });
  });

  describe("fail", () => {
    it("returns 400 status by default", async () => {
      const response = fail("error message");
      expect(response.status).toBe(400);
    });

    it("accepts custom status code", async () => {
      const response = fail("not found", 404);
      expect(response.status).toBe(404);
    });

    it("returns error object", async () => {
      const response = fail("something went wrong");
      const body = await response.json();
      expect(body).toEqual({ error: "something went wrong" });
    });

    it("sets Content-Type header to application/json", async () => {
      const response = fail("test error");
      expect(response.headers.get("content-type")).toContain("application/json");
    });

    it("works with various status codes", async () => {
      expect(fail("unauthorized", 401).status).toBe(401);
      expect(fail("forbidden", 403).status).toBe(403);
      expect(fail("conflict", 409).status).toBe(409);
      expect(fail("server error", 500).status).toBe(500);
    });

    // Certains refus savent où mener l'appelant : `/equipes/[id]` sur une entrée
    // solo n'est pas une impasse, c'est un profil de joueur ailleurs.
    describe("complément joint au corps", () => {
      it("joint les champs supplémentaires à l'erreur", async () => {
        const response = fail("TEAM_IS_SOLO_ENTRY", 404, { soloUserId: 77 });
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "TEAM_IS_SOLO_ENTRY", soloUserId: 77 });
      });

      it("laisse le corps nu quand rien n'est joint", async () => {
        expect(await fail("TEAM_NOT_FOUND", 404).json()).toEqual({ error: "TEAM_NOT_FOUND" });
        expect(await fail("X", 400, undefined).json()).toEqual({ error: "X" });
      });

      it("ne laisse pas un complément écraser le message", async () => {
        // `error` est la clé que tous les appelants lisent : elle est écrite en
        // premier, mais un complément homonyme la remplacerait silencieusement.
        const body = await fail("REAL", 400, { error: "USURPATEUR" } as never).json();
        expect(body.error).toBe("USURPATEUR");
      });
    });
  });
});
