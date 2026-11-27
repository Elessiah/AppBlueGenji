import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";
import { parseGetiPost, type GetiParseOptions, type GetiParsedPost, type GetiRawPost } from "@/lib/shared/geti";

type GetiFixture = { name: string; raw: GetiRawPost; expected: Partial<GetiParsedPost> };

// Annonces de synthèse et annonces réelles réécrites (« reel-… », lot 2b), sur les tournures du recrutement
// Overwatch (FR et EN) : pseudos, identifiants, équipes et serveurs y sont faux.
const fixtures: GetiFixture[] = JSON.parse(
  readFileSync(path.join(process.cwd(), "tests", "fixtures", "geti", "posts.json"), "utf8"),
);

// Bots relais factices du jeu : 090 et 091 relaient comme GETI, 092 comme notre bot.
const RELAY_BOTS: GetiParseOptions = {
  getiBotIds: ["100000000000000090", "100000000000000091"],
  siteBotIds: ["100000000000000092"],
};

describe("parseGetiPost — annonces anonymisées (tests/fixtures/geti/posts.json)", () => {
  it("le jeu d'annonces couvre les six catégories", () => {
    const categories = new Set(fixtures.map((fixture) => parseGetiPost(fixture.raw, RELAY_BOTS).category));

    expect([...categories].sort()).toEqual(["lfcast", "lfp", "lfs", "lfstaff", "lfsub", "lft"]);
  });

  it.each(fixtures.map((fixture): [string, GetiFixture] => [fixture.name, fixture]))("%s", (_name, fixture) => {
    const parsed = parseGetiPost(fixture.raw, RELAY_BOTS);

    const read = Object.fromEntries(Object.keys(fixture.expected).map((key) => [key, parsed[key as keyof GetiParsedPost]]));
    expect(read).toEqual(fixture.expected);
  });

  it("aucune annonce du jeu ne garde d'identifiant ou de pseudo réel : les identifiants sont de la plage factice", () => {
    const ids = fixtures.flatMap((fixture) => JSON.stringify(fixture.raw).match(/\d{15,22}/gu) ?? []);
    const channelIds = new Set([
      "679323677874978826",
      "679323773559635999",
      "679323726717911090",
      "679323814106103819",
      "930074663340605451",
      "1085116755925536828",
    ]);

    const unexpected = ids.filter((id) => !channelIds.has(id) && !/^(?:10{15}\d{2}|1{17}\d)$/u.test(id));
    expect(unexpected).toEqual([]);
  });
});
