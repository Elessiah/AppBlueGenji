import { describe, expect, it } from "@jest/globals";
import { matchesGetiFilter, type GetiFilter, type GetiRank } from "@/lib/shared/geti";
import { getiStoredRankRange } from "@/lib/shared/geti/filter";
import { getiChipMatches, getiLinkNavigatesTab, getiPostChips, type GetiChip } from "@/lib/shared/geti/page";
import { getiRank, parsedGetiPost } from "@/tests/helpers/geti";

const HERE = "https://bluegenji.test/geti-info/lfp?role=tank";

function link(href: string, target = "", download = false) {
  return { href, target, download };
}

describe("getiLinkNavigatesTab", () => {
  it("un lien du site vers une autre page remplace cet onglet", () => {
    expect(getiLinkNavigatesTab(link("/geti-info/lft"), HERE)).toBe(true);
  });

  it("une cible « _self » (casse indifférente) remplace cet onglet", () => {
    expect(getiLinkNavigatesTab(link("/geti-info/lft", "_SELF"), HERE)).toBe(true);
  });

  it("un lien ouvert dans un nouvel onglet ne remplace rien", () => {
    expect(getiLinkNavigatesTab(link("/geti-info/lft", "_blank"), HERE)).toBe(false);
  });

  it("un téléchargement ne remplace rien", () => {
    expect(getiLinkNavigatesTab(link("/fichier.txt", "", true), HERE)).toBe(false);
  });

  it("un lien vers un autre site ne compte pas", () => {
    expect(getiLinkNavigatesTab(link("https://discord.com/channels/1/2"), HERE)).toBe(false);
  });

  it("une ancre de la même page ne remplace rien", () => {
    expect(getiLinkNavigatesTab(link("#haut"), HERE)).toBe(false);
  });

  it("la même page avec d'autres paramètres la remplace", () => {
    expect(getiLinkNavigatesTab(link("/geti-info/lfp?p=2"), HERE)).toBe(true);
  });

  it("une adresse courante illisible ne compte pas, sans erreur", () => {
    expect(getiLinkNavigatesTab(link("/geti-info/lft"), "pas une adresse")).toBe(false);
  });
});

describe("getiChipMatches — fourchette globale de l'annonce", () => {
  const gold = getiRank("GOLD", 3);
  const grandmaster = getiRank("GRANDMASTER", 3);
  const overall = { min: gold, max: grandmaster };
  const tankChip: GetiChip = { kind: "rank", role: "TANK", min: gold, max: gold, overall };
  const supportChip: GetiChip = { kind: "rank", role: "SUPPORT", min: grandmaster, max: grandmaster, overall };
  const chips = [tankChip, supportChip];
  const platinumToDiamond: GetiFilter["ranks"] = { min: getiRank("PLATINUM", 5), max: getiRank("DIAMOND", 1) };

  it("sans rang du rôle voulu, chaque rang par rôle se juge sur la fourchette globale", () => {
    const filter: GetiFilter = { roles: ["DPS"], ranks: platinumToDiamond };

    expect(getiChipMatches(tankChip, filter, chips)).toBe(true);
    expect(getiChipMatches(supportChip, filter, chips)).toBe(true);
  });

  it("sans rôle voulu, chaque rang par rôle se juge sur la fourchette globale", () => {
    const filter: GetiFilter = { ranks: platinumToDiamond };

    expect(getiChipMatches(tankChip, filter, chips)).toBe(true);
    expect(getiChipMatches(supportChip, filter, chips)).toBe(true);
  });

  it("sans fourchette globale lisible, rien n'est mis en avant", () => {
    const orphan: GetiChip = { ...tankChip, overall: null };

    expect(getiChipMatches(orphan, { ranks: { min: gold } }, [orphan])).toBe(false);
  });

  it("avec le rang du rôle voulu, seul ce rang compte, sur sa propre fourchette", () => {
    const filter: GetiFilter = { roles: ["TANK"], ranks: platinumToDiamond };

    expect(getiChipMatches(tankChip, filter, chips)).toBe(false);
    expect(getiChipMatches(supportChip, filter, chips)).toBe(false);
  });

  it("les rangs par rôle d'une annonce portent sa fourchette globale", () => {
    const post = parsedGetiPost({ ranks: { min: gold, max: grandmaster, byRole: { TANK: { min: gold, max: gold } } } });

    expect(getiPostChips(post)).toContainEqual({ kind: "rank", role: "TANK", min: gold, max: gold, overall });
  });
});

describe("getiStoredRankRange — normalisation", () => {
  it("une division écrite en texte devient un nombre", () => {
    const stored = { min: { tier: "GOLD", division: "3" }, max: { tier: "GOLD", division: "3" } };

    expect(getiStoredRankRange(stored)).toEqual({ min: getiRank("GOLD", 3), max: getiRank("GOLD", 3) });
  });

  it("des bornes inversées sont remises dans l'ordre", () => {
    const stored = { min: getiRank("DIAMOND", 1), max: getiRank("GOLD", 5) };

    expect(getiStoredRankRange(stored)).toEqual({ min: getiRank("GOLD", 5), max: getiRank("DIAMOND", 1) });
  });

  it("une fourchette gardée inversée retient l'annonce et met en avant son rang", () => {
    const inverted = { min: getiRank("DIAMOND", 1), max: getiRank("GOLD", 5) };
    const post = parsedGetiPost({
      roles: ["TANK"],
      ranks: { min: inverted.min, max: inverted.max, byRole: { TANK: inverted } },
    });
    const platinum: GetiRank = getiRank("PLATINUM", 3);
    const filter: GetiFilter = { roles: ["TANK"], ranks: { min: platinum, max: platinum } };
    const chips = getiPostChips(post);

    expect(matchesGetiFilter(post, filter)).toBe(true);
    expect(chips[0]).toMatchObject({ kind: "rank", role: "TANK", min: getiRank("GOLD", 5) });
    expect(getiChipMatches(chips[0], filter, chips)).toBe(true);
  });
});
