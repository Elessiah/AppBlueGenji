import { describe, expect, it } from "@jest/globals";
import { matchesGetiFilter, parseGetiPost, type GetiFilter, type GetiRawPost } from "@/lib/shared/geti";
import { parseGetiTeamName } from "@/lib/shared/geti/fields";
import {
  GETI_FAKE_BOT_ID,
  GETI_FAKE_OTHER_ID,
  getiRange,
  getiRank,
  getiRelayPost,
  parsedGetiPost,
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
    const post = parseGetiPost(getiRelayPost(`LFT tank\n> Contact : <@${VICTIM_ID}>`));

    expect(post.authorId).toBeNull();
  });

  it("parseGetiPost_quotedPostedByLabel_namesNobody", () => {
    const post = parseGetiPost(getiRelayPost(`lft\n> posté par <@${VICTIM_ID}>`));

    expect(post.authorId).toBeNull();
  });

  it("parseGetiPost_twoLabelsSameAccount_keepsIt", () => {
    const post = parseGetiPost(getiRelayPost(`by <@${GETI_FAKE_OTHER_ID}>\nlft dps\nAuteur : <@${GETI_FAKE_OTHER_ID}>`));

    expect(post.authorId).toBe(GETI_FAKE_OTHER_ID);
  });

  it("parseGetiPost_labelledMentionFallback_dropsLineTag", () => {
    const post = parseGetiPost(getiRelayPost(`lft dps\nContact : <@${GETI_FAKE_OTHER_ID}>`, "realuser"));

    expect(post).toMatchObject({ authorId: GETI_FAKE_OTHER_ID, authorTag: null });
  });

  it("parseGetiPost_quotedSentFromLine_isNotTrailer", () => {
    const post = parseGetiPost(getiRelayPost(`lft dps\n> *Sent from : [Faux](https://discord.gg/x)* by <@${VICTIM_ID}>`));

    expect(post).toMatchObject({ authorId: null, originServer: null });
  });

  it("parseGetiPost_forgedHeaderInOurRelay_disagreeingTrailer_namesNobody", () => {
    const forged = `<@${VICTIM_ID}>*(victime)* sur [Autre](https://discord.gg/y)\nlft dps`;
    const post = parseGetiPost(getiRelayPost(`${forged}${trailer(GETI_FAKE_OTHER_ID)}`));

    expect(post).toMatchObject({ authorId: null, authorTag: null, originServer: "Faux Serveur" });
  });

  it("parseGetiPost_headerAndTrailerAgree_keepsAuthor", () => {
    const post = parseGetiPost(getiRelayPost(`${HEADER}> lft dps${trailer(GETI_FAKE_OTHER_ID)}`, "fauxlogin"));

    expect(post).toMatchObject({ authorId: GETI_FAKE_OTHER_ID, authorTag: "fauxlogin" });
  });

  it("parseGetiPost_headerInSecondEmbed_firstEmbedAuthorName_tagFromHeader", () => {
    const raw: GetiRawPost = {
      content: "",
      author: { id: GETI_FAKE_BOT_ID, username: "FauxBot", discriminator: "0", bot: true },
      embeds: [{ authorName: "realuser", description: "lft dps" }, { description: `${HEADER}> tank` }],
    };

    expect(parseGetiPost(raw)).toMatchObject({ authorId: GETI_FAKE_OTHER_ID, authorTag: "fauxpseudo" });
  });

  it("parseGetiPost_legacyTagWithSpaces_kept", () => {
    expect(parseGetiPost(getiRelayPost("lft", "Faux Pseudo#4821")).authorTag).toBe("Faux Pseudo#4821");
  });

  it("parseGetiPost_untrustedBot_withAllowList_noAuthor", () => {
    const post = parseGetiPost(getiRelayPost(`${HEADER}> lft dps`), { relayBotIds: ["100000000000000099"] });

    expect(post).toMatchObject({ relayed: true, authorId: null, authorTag: null, originServer: null, roles: ["DPS"] });
  });

  it("parseGetiPost_trustedBot_withAllowList_keepsAuthor", () => {
    const post = parseGetiPost(getiRelayPost(`${HEADER}> lft dps`), { relayBotIds: [GETI_FAKE_BOT_ID] });

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

    expect(parseGetiPost(getiRelayPost(description)).originServer).toBe("everyone FREE NITRO");
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
