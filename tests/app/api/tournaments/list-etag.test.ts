import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { GET } from "@/app/api/tournaments/route";
import { getCurrentUser } from "@/lib/server/auth";
import * as service from "@/lib/server/tournaments-service";
import type { TournamentBuckets } from "@/lib/shared/types";

type User = Awaited<ReturnType<typeof getCurrentUser>>;
const player = { id: 4, isAdmin: false, roles: [] } as unknown as User;
const arbitre = { id: 2, isAdmin: false, roles: ["ARBITRE"] } as unknown as User;

function buckets(): TournamentBuckets {
  return { upcoming: [], registration: [], running: [], finished: [] };
}

function get(headers: Record<string, string> = {}, url = "/api/tournaments") {
  return GET(new Request(`http://localhost${url}`, { headers }));
}

describe("GET /api/tournaments — empreinte et 304", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(service.listTournamentBuckets).mockResolvedValue(buckets());
  });

  it("rend la liste avec une empreinte et un cache privé à revalider", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ buckets: buckets() });
  });

  it("rend 304 sans corps quand l'empreinte reçue est celle de la liste", async () => {
    const etag = (await get()).headers.get("etag") ?? "";

    const res = await get({ "If-None-Match": etag });

    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get("etag")).toBe(etag);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("accepte une empreinte faible, une liste d'empreintes et le joker", async () => {
    const etag = (await get()).headers.get("etag") ?? "";

    expect((await get({ "If-None-Match": `W/${etag}` })).status).toBe(304);
    expect((await get({ "If-None-Match": `"autre", ${etag}` })).status).toBe(304);
    expect((await get({ "If-None-Match": "*" })).status).toBe(304);
  });

  it("rend la liste entière quand l'empreinte reçue n'est plus la bonne", async () => {
    const res = await get({ "If-None-Match": '"périmée"' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ buckets: buckets() });
  });

  it("change d'empreinte quand la liste change", async () => {
    const before = (await get()).headers.get("etag");
    jest.mocked(service.listTournamentBuckets).mockResolvedValue({ ...buckets(), running: [] , finishedTotals: { all: 3, byGame: { OW: 3, MR: 0 } } });

    const after = (await get()).headers.get("etag");

    expect(after).not.toBe(before);
  });

  it("sérialise une seule fois la liste mise en cache (même objet, même corps)", async () => {
    const cachedList = buckets();
    jest.mocked(service.listTournamentBuckets).mockResolvedValue(cachedList);
    const stringify = jest.spyOn(JSON, "stringify");

    await get();
    await get();
    const calls = stringify.mock.calls.filter(([value]) => value && typeof value === "object" && "buckets" in value);
    stringify.mockRestore();

    expect(calls).toHaveLength(1);
  });

  it("une liste publique rebâtie (cache vidé) garde la même empreinte tant que son contenu est le même", async () => {
    jest.mocked(service.listTournamentBuckets).mockImplementation(async () => buckets());

    const first = (await get()).headers.get("etag") ?? "";
    const res = await get({ "If-None-Match": first });

    expect(res.status).toBe(304);
  });

  it("refuse un visiteur sans session en 401, empreinte reçue ou non", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await get({ "If-None-Match": "*" });

    expect(res.status).toBe(401);
    expect(service.listTournamentBuckets).not.toHaveBeenCalled();
  });

  it("refuse les invisibles à un joueur en 403 avant toute empreinte", async () => {
    const res = await get({ "If-None-Match": "*" }, "/api/tournaments?scope=hidden");

    expect(res.status).toBe(403);
    expect(service.listTournamentBuckets).not.toHaveBeenCalled();
  });

  it("rend les invisibles au staff sans empreinte et sans copie gardée par le navigateur", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);

    const res = await get({}, "/api/tournaments?scope=hidden");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("etag")).toBeNull();
    expect(await res.json()).toEqual({ buckets: buckets() });
  });

  it("rend un code 500 quand la lecture de la liste échoue", async () => {
    jest.mocked(service.listTournamentBuckets).mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:3306"));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await get();
    consoleError.mockRestore();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "TOURNAMENT_LIST_FAILED" });
  });

  it("ne rend jamais 304 aux invisibles, même au joker", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);

    const res = await get({ "If-None-Match": "*" }, "/api/tournaments?scope=hidden");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ buckets: buckets() });
  });
});
