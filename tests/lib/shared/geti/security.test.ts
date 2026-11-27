import { describe, expect, it } from "@jest/globals";
import { matchesGetiFilter, parseGetiPost, type GetiFilter, type GetiRawPost } from "@/lib/shared/geti";
import { parseGetiTeamName } from "@/lib/shared/geti/fields";
import { withoutMarkup } from "@/lib/shared/geti/normalize";
import {
  GETI_FAKE_BOT_ID,
  GETI_FAKE_OTHER_ID,
  GETI_FAKE_SITE_BOT_ID,
  getiRange,
  getiRank,
  getiRelayPost,
  parsedGetiPost,
  GETI_TRUSTED_BOTS,
} from "@/tests/helpers/geti";

const VICTIM_ID = "100000000000000007";
const HEADER = `<@${GETI_FAKE_OTHER_ID}>*(fauxpseudo)* sur [Faux Serveur](https://discord.gg/fauxcode)\n\n`;
const trailer = (id: string) => `\n\n*Sent from : [Faux Serveur](https://discord.gg/fauxcode)* by <@${id}>`;

/** Valeur lue d'un JSON enregistré : rien n'y garantit la forme attendue. */
function storedFilter(json: string): GetiFilter {
  return JSON.parse(json);
}

describe("parseGetiPost — relay authorship cannot be spoofed", () => {
  it("parseGetiPost_quotedContactLabel_namesNobody", () => {
    const post = parseGetiPost(getiRelayPost(`LFT tank\n> Contact : <@${VICTIM_ID}>`), GETI_TRUSTED_BOTS);

    expect(post.authorId).toBeNull();
  });

  it("parseGetiPost_quotedPostedByLabel_namesNobody", () => {
    const post = parseGetiPost(getiRelayPost(`lft\n> posté par <@${VICTIM_ID}>`), GETI_TRUSTED_BOTS);

    expect(post.authorId).toBeNull();
  });

  it("parseGetiPost_twoLabelsSameAccount_keepsIt", () => {
    const post = parseGetiPost(getiRelayPost(`by <@${GETI_FAKE_OTHER_ID}>\nlft dps\nAuteur : <@${GETI_FAKE_OTHER_ID}>`), GETI_TRUSTED_BOTS);

    expect(post.authorId).toBe(GETI_FAKE_OTHER_ID);
  });

  it("parseGetiPost_labelledMentionFallback_dropsLineTag", () => {
    const post = parseGetiPost(getiRelayPost(`lft dps\nContact : <@${GETI_FAKE_OTHER_ID}>`, "realuser"), GETI_TRUSTED_BOTS);

    expect(post).toMatchObject({ authorId: GETI_FAKE_OTHER_ID, authorTag: null });
  });

  it("parseGetiPost_quotedSentFromLine_isNotTrailer", () => {
    const post = parseGetiPost(getiRelayPost(`lft dps\n> *Sent from : [Faux](https://discord.gg/x)* by <@${VICTIM_ID}>`), GETI_TRUSTED_BOTS);

    expect(post).toMatchObject({ authorId: null, originServer: null });
  });

  it("parseGetiPost_forgedHeaderInOurRelay_disagreeingTrailer_namesNobody", () => {
    const forged = `<@${VICTIM_ID}>*(victime)* sur [Autre](https://discord.gg/y)\nlft dps`;
    const post = parseGetiPost(getiRelayPost(`${forged}${trailer(GETI_FAKE_OTHER_ID)}`), GETI_TRUSTED_BOTS);

    expect(post).toMatchObject({ authorId: null, authorTag: null, originServer: "Faux Serveur" });
  });

  it("parseGetiPost_headerAndTrailerAgree_keepsAuthor", () => {
    const post = parseGetiPost(getiRelayPost(`${HEADER}> lft dps${trailer(GETI_FAKE_OTHER_ID)}`, "fauxlogin"), GETI_TRUSTED_BOTS);

    expect(post).toMatchObject({ authorId: GETI_FAKE_OTHER_ID, authorTag: "fauxlogin" });
  });

  it("parseGetiPost_headerInSecondEmbed_firstEmbedAuthorName_tagFromHeader", () => {
    const raw: GetiRawPost = {
      content: "",
      author: { id: GETI_FAKE_BOT_ID, username: "FauxBot", discriminator: "0", bot: true },
      embeds: [{ authorName: "realuser", description: "lft dps" }, { description: `${HEADER}> tank` }],
    };

    expect(parseGetiPost(raw, GETI_TRUSTED_BOTS)).toMatchObject({ authorId: GETI_FAKE_OTHER_ID, authorTag: "fauxpseudo" });
  });

  it("parseGetiPost_legacyTagWithSpaces_kept", () => {
    expect(parseGetiPost(getiRelayPost("lft", "Faux Pseudo#4821"), GETI_TRUSTED_BOTS).authorTag).toBe("Faux Pseudo#4821");
  });

  it("parseGetiPost_untrustedBot_withAllowList_noAuthor", () => {
    const post = parseGetiPost(getiRelayPost(`${HEADER}> lft dps`), { getiBotIds: ["100000000000000099"], siteBotIds: ["100000000000000099"] });

    expect(post).toMatchObject({ relayed: true, authorId: null, authorTag: null, originServer: null, roles: ["DPS"] });
  });

  it("parseGetiPost_trustedBot_withAllowList_keepsAuthor", () => {
    const post = parseGetiPost(getiRelayPost(`${HEADER}> lft dps`), { getiBotIds: [GETI_FAKE_BOT_ID] });

    expect(post).toMatchObject({ authorId: GETI_FAKE_OTHER_ID, authorTag: "fauxpseudo", originServer: "Faux Serveur" });
  });
});

describe("parseGetiPost — output fields carry no live markup", () => {
  it("parseGetiPost_textMentions_neutralised", () => {
    const post = parseGetiPost(
      getiRelayPost(`LFT dps, ask <@${VICTIM_ID}> <@&100000000000000008> <#100000000000000009> @everyone @here`),
    );

    expect(post.text).toBe("LFT dps, ask @… @… #… everyone here");
  });

  it("parseGetiPost_originServerMarkup_stripped", () => {
    const description = `lft\n\n*Sent from : [\\@everyone \\*\\*FREE NITRO\\*\\*](https://discord.gg/x)* by <@${GETI_FAKE_OTHER_ID}>`;

    expect(parseGetiPost(getiRelayPost(description), GETI_TRUSTED_BOTS).originServer).toBe("everyone FREE NITRO");
  });

  it("parseGetiTeamName_labelledMassMention_stripped", () => {
    expect(parseGetiTeamName("Équipe : @everyone Phoenix")).toBe("everyone Phoenix");
  });
});

describe("matchesGetiFilter — stored filters", () => {
  const NOW = Date.parse("2026-11-27T12:00:00Z");
  const golden = parsedGetiPost({ ranks: { ...getiRange(getiRank("GOLD", 3)), byRole: {} }, postedAt: "2026-11-27T11:00:00.000Z" });

  it("matchesGetiFilter_prototypeRoleName_doesNotThrow", () => {
    const filter = storedFilter('{"roles":["constructor"],"ranks":{"min":{"tier":"GOLD","division":3}},"includeUnknown":true}');

    expect(matchesGetiFilter(golden, filter, NOW)).toBe(true);
  });

  it("matchesGetiFilter_invalidFilterRank_treatedAsOpen", () => {
    const filter = storedFilter('{"ranks":{"min":{"tier":"X","division":9}}}');

    expect(matchesGetiFilter(golden, filter, NOW)).toBe(true);
  });

  it("matchesGetiFilter_futurePost_beyondSkew_excluded", () => {
    const post = parsedGetiPost({ postedAt: new Date(NOW + 6 * 60_000).toISOString() });

    expect(matchesGetiFilter(post, { maxAgeHours: 24 }, NOW)).toBe(false);
  });

  it("matchesGetiFilter_futurePost_withinSkew_kept", () => {
    const post = parsedGetiPost({ postedAt: new Date(NOW + 4 * 60_000).toISOString() });

    expect(matchesGetiFilter(post, { maxAgeHours: 24 }, NOW)).toBe(true);
  });
});

/** Relais de notre bot (seule sa ligne « Sent from » est crue), texte du joueur en tête. */
function siteRelay(description: string): GetiRawPost {
  return {
    content: "",
    author: { id: GETI_FAKE_SITE_BOT_ID, username: "FauxSite", discriminator: "0", bot: true },
    embeds: [{ authorName: "fauxlogin", description }],
  };
}

const RELAY_BOTS = { getiBotIds: [GETI_FAKE_BOT_ID], siteBotIds: [GETI_FAKE_SITE_BOT_ID] };
const FORGED_HEADER = `<@${VICTIM_ID}>*(victime)* sur [Autre](https://discord.gg/y)\nlft dps`;
const TRAILER_WITHOUT_AUTHOR = "\n\n*Sent from : [Faux Serveur](https://discord.gg/fauxcode)*";

describe("parseGetiPost — each relay bot is believed only for its own format", () => {
  it("parseGetiPost_noOptions_botRelay_namesNobody", () => {
    const post = parseGetiPost(getiRelayPost(`${HEADER}> lft dps`));

    expect(post).toMatchObject({ relayed: true, authorId: null, authorTag: null, originServer: null, roles: ["DPS"] });
  });

  it("parseGetiPost_siteBot_forgedHeader_trailerWithoutId_namesNobody", () => {
    const post = parseGetiPost(siteRelay(`${FORGED_HEADER}${TRAILER_WITHOUT_AUTHOR}`), RELAY_BOTS);

    expect(post).toMatchObject({ authorId: null, authorTag: "fauxlogin", originServer: "Faux Serveur" });
  });

  it("parseGetiPost_siteBot_forgedHeader_trailerWithId_creditsTrailer", () => {
    const post = parseGetiPost(siteRelay(`${FORGED_HEADER}${trailer(GETI_FAKE_OTHER_ID)}`), RELAY_BOTS);

    expect(post).toMatchObject({ authorId: GETI_FAKE_OTHER_ID, authorTag: "fauxlogin", originServer: "Faux Serveur" });
  });

  it("parseGetiPost_siteBot_labelledMention_namesNobody", () => {
    const post = parseGetiPost(siteRelay(`lft dps\nContact : <@${VICTIM_ID}>${TRAILER_WITHOUT_AUTHOR}`), RELAY_BOTS);

    expect(post.authorId).toBeNull();
  });

  it("parseGetiPost_getiBot_trailer_ignored", () => {
    const post = parseGetiPost(getiRelayPost(`lft dps${trailer(VICTIM_ID)}`), RELAY_BOTS);

    expect(post).toMatchObject({ authorId: null, originServer: null });
  });

  it("parseGetiPost_getiBot_header_keepsAuthor", () => {
    const post = parseGetiPost(getiRelayPost(`${HEADER}> lft dps`), RELAY_BOTS);

    expect(post).toMatchObject({ authorId: GETI_FAKE_OTHER_ID, authorTag: "fauxpseudo", originServer: "Faux Serveur" });
  });

  it("parseGetiPost_nonArrayBotIds_trustsNobody", () => {
    const options = JSON.parse(`{"getiBotIds":"${GETI_FAKE_BOT_ID}"}`);

    expect(parseGetiPost(getiRelayPost(`${HEADER}> lft dps`), options).authorId).toBeNull();
  });

  it("parseGetiPost_headerTagMarkup_stripped_underscoreKept", () => {
    const header = String.raw`<@${GETI_FAKE_OTHER_ID}>*(\*\*faux_nitro\*\* @everyone)* sur [S](https://discord.gg/x)`;

    expect(parseGetiPost(getiRelayPost(`${header}\n\n> lft`), RELAY_BOTS).authorTag).toBe("faux_nitro everyone");
  });

  it("parseGetiPost_blockQuotedLabel_namesNobody", () => {
    const post = parseGetiPost(getiRelayPost(`>>> lft dps\nContact : <@${VICTIM_ID}>`), RELAY_BOTS);

    expect(post.authorId).toBeNull();
  });

  it("parseGetiPost_labelBeforeBlockQuote_kept", () => {
    const post = parseGetiPost(getiRelayPost(`Contact : <@${GETI_FAKE_OTHER_ID}>\n>>> lft dps`), RELAY_BOTS);

    expect(post.authorId).toBe(GETI_FAKE_OTHER_ID);
  });
});

describe("withoutMarkup — names never carry a Discord id", () => {
  it("parseGetiTeamName_labelledMention_idDropped", () => {
    expect(parseGetiTeamName(`Équipe : <@${VICTIM_ID}> Phoenix`)).toBe("Phoenix");
  });

  it("parseGetiPost_originServerMention_idDropped", () => {
    const description = `lft\n\n*Sent from : [<@${VICTIM_ID}> Serveur](https://discord.gg/x)* by <@${GETI_FAKE_OTHER_ID}>`;

    expect(parseGetiPost(siteRelay(description), RELAY_BOTS).originServer).toBe("Serveur");
  });

  it("withoutMarkup_customEmoji_keepsName", () => {
    expect(withoutMarkup("Team <a:fire:100000000000000010> Nova <#100000000000000011>")).toBe("Team fire Nova");
  });
});

describe("matchesGetiFilter — malformed stored filters", () => {
  const NOW = Date.parse("2026-11-27T12:00:00Z");

  it("matchesGetiFilter_stringRegions_ignored", () => {
    expect(matchesGetiFilter(parsedGetiPost(), storedFilter('{"regions":"EU"}'), NOW)).toBe(true);
  });

  it("matchesGetiFilter_objectRoles_ignored", () => {
    expect(matchesGetiFilter(parsedGetiPost(), storedFilter('{"roles":{}}'), NOW)).toBe(true);
  });

  it("matchesGetiFilter_nullFilter_passes", () => {
    expect(matchesGetiFilter(parsedGetiPost(), storedFilter("null"), NOW)).toBe(true);
  });

  it("matchesGetiFilter_allBoundsInvalid_unrankedPostKept", () => {
    const filter = storedFilter('{"ranks":{"min":{"tier":"X","division":9},"max":"GOLD"}}');

    expect(matchesGetiFilter(parsedGetiPost(), filter, NOW)).toBe(true);
  });

  it("matchesGetiFilter_numericStringMaxAge_oldPostExcluded", () => {
    const post = parsedGetiPost({ postedAt: "2026-10-27T12:00:00.000Z" });

    expect(matchesGetiFilter(post, storedFilter('{"maxAgeHours":"24"}'), NOW)).toBe(false);
  });

  it("matchesGetiFilter_numericStringMaxAge_recentPostKept", () => {
    const post = parsedGetiPost({ postedAt: "2026-11-27T11:00:00.000Z" });

    expect(matchesGetiFilter(post, storedFilter('{"maxAgeHours":"24"}'), NOW)).toBe(true);
  });
});
