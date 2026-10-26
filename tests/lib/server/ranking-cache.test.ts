import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { clearCache } from "@/lib/server/cache";
import {
  RANKING_LIST_KEY_PREFIX,
  cachedRanking,
  invalidateRankingLists,
  invalidateTeamRanking,
} from "@/lib/server/ranking-cache";

/**
 * Les deux invalidateurs du classement : `invalidateTeamRanking` (un score
 * tombe, tout est à rejouer) et `invalidateRankingLists` (une dissolution :
 * seule la liste change, le rejeu reste valable).
 */
describe("cache du classement", () => {
  beforeEach(() => {
    clearCache();
  });
  afterEach(() => {
    clearCache();
  });

  const listKeys = ["podium-tiers", "share-podium", "share-teams"].map((key) => `${RANKING_LIST_KEY_PREFIX}${key}`);
  const stateKeys = ["state:all:all", "state:7:all", "state:all:MARVEL_RIVALS"];

  async function warm(keys: string[], loader: () => Promise<string>): Promise<void> {
    for (const key of keys) await cachedRanking(key, loader);
  }

  it("oublie les entrées tirées de la liste à l'invalidation des listes", async () => {
    const loader = jest.fn(async () => "valeur");
    await warm(listKeys, loader);

    invalidateRankingLists();
    await warm(listKeys, loader);

    expect(loader).toHaveBeenCalledTimes(listKeys.length * 2);
  });

  it("garde le rejeu à l'invalidation des listes", async () => {
    const loader = jest.fn(async () => "valeur");
    await warm(stateKeys, loader);

    invalidateRankingLists();
    await warm(stateKeys, loader);

    expect(loader).toHaveBeenCalledTimes(stateKeys.length);
  });

  it("oublie tout, rejeu compris, à l'invalidation du classement", async () => {
    const loader = jest.fn(async () => "valeur");
    await warm([...listKeys, ...stateKeys], loader);

    invalidateTeamRanking();
    await warm([...listKeys, ...stateKeys], loader);

    expect(loader).toHaveBeenCalledTimes((listKeys.length + stateKeys.length) * 2);
  });

  it("les marches, le podium et les fiches de l'aperçu s'écrivent sous le préfixe des listes", () => {
    for (const path of ["lib/server/podium-tiers.ts", "lib/server/share-podium.ts", "lib/server/share-team.ts"]) {
      expect(readFileSync(path, "utf8")).toMatch(/cachedRanking\(`\$\{RANKING_LIST_KEY_PREFIX\}/);
    }
  });
});
