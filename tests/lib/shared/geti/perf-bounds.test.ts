import { describe, expect, it, jest } from "@jest/globals";
import { filterGetiPosts, getiRankValue, parseGetiPost } from "@/lib/shared/geti";
import { getiRank, getiRawPost, getiRelayPost, parseGetiText, parsedGetiPost } from "@/tests/helpers/geti";

const BOT = { id: "100000000000000090", username: "FauxBot", discriminator: "0", bot: true };
const AUTHOR_ID = "100000000000000001";
/** Large time budget: the point is « linear, not quadratic » (400k chars took ~99 s before the caps). */
const BUDGET_MS = 3000;

function timed(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

describe("parseGetiPost — bounded cost on hostile raw input", () => {
  it("a 400 000-character relay description of whitespace after « by » is read in bounded time", () => {
    const raw = getiRelayPost(`by${" ".repeat(400_000)}`);

    expect(timed(() => parseGetiPost(raw))).toBeLessThan(BUDGET_MS);
  });

  it("a 100 000-character description of stars or newlines is read in bounded time", () => {
    const stars = getiRelayPost("*".repeat(100_000));
    const lines = getiRelayPost("\n".repeat(100_000));

    expect(timed(() => parseGetiPost(stars))).toBeLessThan(BUDGET_MS);
    expect(timed(() => parseGetiPost(lines))).toBeLessThan(BUDGET_MS);
  });

  it("a user message of 400 000 characters keeps only the displayed bound", () => {
    const post = parseGetiPost(getiRawPost("tank ".repeat(80_000)));

    expect(post.text.length).toBeLessThanOrEqual(4096);
    expect(post.roles).toEqual(["TANK"]);
  });

  it("a post of U+FDFA expands under NFKC yet stays bounded", () => {
    expect(timed(() => parseGetiPost(getiRawPost("\uFDFA".repeat(4000))))).toBeLessThan(BUDGET_MS);
  });

  it("only the first 10 embeds and 25 fields per embed are read", () => {
    const fields = Array.from({ length: 30 }, (_, index) => ({ name: `n${index}`, value: index === 29 ? "support" : "x" }));
    const embeds = Array.from({ length: 12 }, (_, index) => ({
      description: index === 11 ? "dps" : "rien",
      fields: index === 0 ? fields : [],
    }));
    const post = parseGetiPost({ content: "", author: BOT, embeds });

    expect(post.roles).toEqual([]);
  });

  it("text past the raw bound is not read", () => {
    const post = parseGetiPost(getiRawPost(`${"a ".repeat(4200)}tank`));

    expect(post.roles).toEqual([]);
  });
});

describe("relay trailer and author labels after the bounds", () => {
  it("the « Sent from » trailer at the end of a long description is still read", () => {
    const description = `${"Cherche tank diamant. ".repeat(100)}\n\n*Sent from : [Mon Serveur](https://discord.gg/abc)* by <@${AUTHOR_ID}>`;
    const post = parseGetiPost(getiRelayPost(description));

    expect(post.originServer).toBe("Mon Serveur");
    expect(post.authorId).toBe(AUTHOR_ID);
    expect(post.text).not.toContain("Sent from");
  });

  it("« by : <@id> » and « by<@id> » are both read as labels", () => {
    expect(parseGetiPost(getiRelayPost(`LFT tank\nby : <@${AUTHOR_ID}>`)).authorId).toBe(AUTHOR_ID);
    expect(parseGetiPost(getiRelayPost(`LFT tank\nby<@${AUTHOR_ID}>`)).authorId).toBe(AUTHOR_ID);
  });

  it("two labelled mentions of different accounts name nobody", () => {
    const other = "100000000000000002";
    const post = parseGetiPost(getiRelayPost(`by <@${other}>\nby <@${AUTHOR_ID}>`));

    expect(post.authorId).toBeNull();
  });
});

describe("rank token joins and role adjacency after the rewrites", () => {
  it("« gold a plat » and « du gm au champ » keep both bounds", () => {
    const gold = parseGetiText("gold a plat").ranks;
    const gm = parseGetiText("du gm au champ").ranks;

    expect(gold.min).toEqual(getiRank("GOLD", 5));
    expect(gold.max).toEqual(getiRank("PLATINUM", 1));
    expect(gm.min).toEqual(getiRank("GRANDMASTER", 5));
    expect(gm.max).toEqual(getiRank("CHAMPION", 1));
  });

  it("ranks stay attached to their own role, before or after it", () => {
    const post = parseGetiText("tank diamant 3, dps platine 2");

    expect(post.ranks.byRole.TANK?.min).toEqual(getiRank("DIAMOND", 3));
    expect(post.ranks.byRole.DPS?.min).toEqual(getiRank("PLATINUM", 2));
  });

  it("a long run of repeated joined ranks is parsed in bounded time", () => {
    expect(timed(() => parseGetiText("gold a plat ".repeat(340)))).toBeLessThan(BUDGET_MS);
    expect(timed(() => parseGetiText("tank m2 ".repeat(500)))).toBeLessThan(BUDGET_MS);
  });

  it("getiRankValue orders every tier", () => {
    expect(getiRankValue(getiRank("BRONZE", 5))).toBe(0);
    expect(getiRankValue(getiRank("CHAMPION", 1))).toBe(39);
  });
});

describe("filterGetiPosts", () => {
  const NOW = Date.parse("2026-11-27T12:00:00.000Z");
  const edge = parsedGetiPost({ postedAt: "2026-11-27T10:00:00.000Z" });
  const old = parsedGetiPost({ postedAt: "2026-11-26T10:00:00.000Z" });

  it("keeps the passing posts in order", () => {
    expect(filterGetiPosts([old, edge, old, edge], { maxAgeHours: 3 }, NOW)).toEqual([edge, edge]);
  });

  it("an empty filter keeps everything", () => {
    expect(filterGetiPosts([old, edge], {}, NOW)).toHaveLength(2);
  });

  it("reads the clock once for the whole list", () => {
    let calls = 0;
    const clock = jest.spyOn(Date, "now").mockImplementation(() => {
      calls += 1;
      return NOW;
    });
    filterGetiPosts([old, edge, old, edge], { maxAgeHours: 3 });
    clock.mockRestore();

    expect(calls).toBe(1);
  });

  it("an empty list gives an empty list", () => {
    expect(filterGetiPosts([], { maxAgeHours: 3 }, NOW)).toEqual([]);
  });
});

