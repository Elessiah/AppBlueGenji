import { describe, it, expect, jest } from "@jest/globals";
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
      const response = fail("SOMETHING_WENT_WRONG");
      const body = await response.json();
      expect(body).toEqual({ error: "SOMETHING_WENT_WRONG" });
    });

    // Une cinquantaine de routes écrivent `fail(error.message || …)` : tout
    // message d'exception imprévu partait tel quel, routes anonymes comprises.
    describe("messages d'exception", () => {
      it("remplace un message mysql2 par un code générique, sans rien en dire", async () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        const response = fail("Table 'bluegenji.bg_users' doesn't exist", 500);
        const text = await response.text();

        expect(response.status).toBe(500);
        expect(JSON.parse(text)).toEqual({ error: "INTERNAL_ERROR" });
        expect(text).not.toContain("bluegenji");
        // Le message reste lisible côté serveur, pour le diagnostic.
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining("INTERNAL_ERROR"),
          "Table 'bluegenji.bg_users' doesn't exist",
        );
        errorSpy.mockRestore();
      });

      it("rend INVALID_REQUEST sur un refus client", async () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        const response = fail("Unexpected end of JSON input", 400);

        expect(await response.json()).toEqual({ error: "INVALID_REQUEST" });
        errorSpy.mockRestore();
      });

      it("ne journalise rien quand le message est déjà un code", async () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        fail("TEAM_NOT_FOUND", 404);

        expect(errorSpy).not.toHaveBeenCalled();
        errorSpy.mockRestore();
      });
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
        expect(await fail("XY", 400, undefined).json()).toEqual({ error: "XY" });
      });

      it("ne laisse pas un complément écraser le message", async () => {
        // `error` est la clé que tous les appelants lisent, et le seul champ
        // filtré : un complément homonyme la remplaçait silencieusement, et
        // contournait du même coup le filtre des messages non publics.
        const body = await fail("REAL", 400, { error: "USURPATEUR" } as never).json();
        expect(body.error).toBe("REAL");
      });
    });
  });
});
