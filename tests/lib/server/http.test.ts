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
  });
});
