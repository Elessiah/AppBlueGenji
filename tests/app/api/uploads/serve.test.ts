import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("node:fs/promises");

import { readFile } from "node:fs/promises";
import { GET } from "@/app/api/uploads/[...path]/route";

function params(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

describe("GET /api/uploads/[...path]", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("serves an existing webp from disk with the right content-type", async () => {
    (readFile as jest.Mock).mockResolvedValue(Buffer.from([0x52, 0x49, 0x46, 0x46]) as never);
    const res = await GET(new Request("http://localhost"), params(["sponsors", "a.webp"]));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toContain("max-age");
  });

  it("returns 404 when the file is missing", async () => {
    (readFile as jest.Mock).mockRejectedValue(new Error("ENOENT") as never);
    const res = await GET(new Request("http://localhost"), params(["sponsors", "missing.webp"]));
    expect(res.status).toBe(404);
    expect(readFile).toHaveBeenCalled();
  });

  it("rejects path traversal without touching the disk", async () => {
    const res = await GET(new Request("http://localhost"), params(["sponsors", "..", "secret.webp"]));
    expect(res.status).toBe(404);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("rejects a non-image extension without touching the disk", async () => {
    const res = await GET(new Request("http://localhost"), params(["sponsors", "config.txt"]));
    expect(res.status).toBe(404);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("returns 404 for an empty path", async () => {
    const res = await GET(new Request("http://localhost"), params([]));
    expect(res.status).toBe(404);
    expect(readFile).not.toHaveBeenCalled();
  });
});
