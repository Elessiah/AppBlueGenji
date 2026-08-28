import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clearCache } from "@/lib/server/cache";
import {
  TOURNAMENT_LIST_TTL_MS,
  cachedTournamentList,
  invalidateTournamentLists,
} from "@/lib/server/tournaments/list-cache";

const ROOT = join(__dirname, "..", "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

afterEach(() => {
  clearCache();
});

describe("list-cache", () => {
  it("mutualise une même liste", async () => {
    const loader = jest.fn(async () => ["a"]);

    await cachedTournamentList("public", loader);
    await cachedTournamentList("public", loader);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("garde les listes distinctes séparées", async () => {
    expect(await cachedTournamentList("public", async () => "P")).toBe("P");
    expect(await cachedTournamentList("mine:7", async () => "M")).toBe("M");
    expect(await cachedTournamentList("public", async () => "autre")).toBe("P");
  });

  it("oublie toutes les listes d'un coup", async () => {
    await cachedTournamentList("public", async () => 1);
    await cachedTournamentList("mine:7", async () => 2);

    invalidateTournamentLists();

    expect(await cachedTournamentList("public", async () => 10)).toBe(10);
    expect(await cachedTournamentList("mine:7", async () => 20)).toBe(20);
  });

  it("ne touche pas aux autres caches", async () => {
    const { cached } = await import("@/lib/server/cache");
    await cached("landing:stats", 60_000, async () => "stats");
    await cachedTournamentList("public", async () => "liste");

    invalidateTournamentLists();

    expect(await cached("landing:stats", 60_000, async () => "autre")).toBe("stats");
  });

  it("garde une durée de vie courte", () => {
    // Elle ne borne que le retard d'une bascule d'état : toute écriture
    // invalide, et le client fait basculer l'affichage tout seul.
    expect(TOURNAMENT_LIST_TTL_MS).toBeGreaterThan(0);
    expect(TOURNAMENT_LIST_TTL_MS).toBeLessThanOrEqual(60_000);
  });
});

describe("listTournamentBuckets — portée mutualisée", () => {
  const index = read("lib/server/tournaments/index.ts");

  it("ne partage que la liste publique sans recherche", () => {
    // Une liste personnelle (`scope=mine`) ou filtrée est propre à un lecteur :
    // la mutualiser servirait la liste de quelqu'un d'autre.
    expect(index).toContain(
      "const isSharedList = scope.organizerUserId === undefined && !searchTerm?.trim();",
    );
    expect(index).toContain("if (!isSharedList) return loadTournamentBuckets(searchTerm, scope);");
    expect(index).toContain('cachedTournamentList("public"');
  });

  it("garde la synchronisation d'états étranglée", () => {
    // À une seconde, une poignée de visiteurs suffisait à faire tourner en
    // continu une transaction sur tous les tournois non terminés.
    const match = index.match(/const SYNC_THROTTLE_MS = ([\d_]+);/);
    expect(match).not.toBeNull();
    expect(Number(match![1].replace(/_/g, ""))).toBeGreaterThanOrEqual(10_000);
  });
});
