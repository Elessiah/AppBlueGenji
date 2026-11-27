import { describe, expect, it } from "@jest/globals";

import {
  GETI_INGEST_ERRORS,
  GETI_RAW_JSON_MAX_BYTES,
  parseDeleteBody,
  parsePushedPost,
  parseReconcileBody,
  parseUpsertBody,
} from "@/lib/server/geti/wire";
import { GETI_CHANNEL_IDS } from "@/lib/shared/geti";
import { GETI_BOT_USER_ID } from "@/lib/shared/geti/ingest";
import { GETI_FAKE_MESSAGE_ID, getiWirePost, getiWireRelay } from "../../../helpers/geti-ingest";

/** Lecture des corps poussés par le bot : types, bornes, formes inattendues. */

const ID = "100000000000000902";

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `1000000000000${String(index).padStart(5, "0")}`);
}

describe("parsePushedPost", () => {
  it("parsePushedPost_validUserMessage_returnsBoundedPost", () => {
    const post = parsePushedPost(getiWirePost({ editedAt: "2026-11-27T11:00:00.000Z" }));

    expect(post).toEqual({
      messageId: GETI_FAKE_MESSAGE_ID,
      channelId: GETI_CHANNEL_IDS.lft,
      category: "lft",
      source: "direct",
      raw: {
        category: "lft",
        channelId: GETI_CHANNEL_IDS.lft,
        content: "LFT support Master 2, EU, PC, FR",
        author: { id: "100000000000000001", username: "fauxjoueur", discriminator: "0", bot: false },
        embeds: [],
        postedAt: "2026-11-27T10:00:00.000Z",
        editedAt: "2026-11-27T11:00:00.000Z",
      },
      postedAt: new Date("2026-11-27T10:00:00.000Z"),
      editedAt: new Date("2026-11-27T11:00:00.000Z"),
    });
  });

  it("parsePushedPost_notAnObject_returnsNull", () => {
    expect(parsePushedPost(["x"])).toBeNull();
  });

  it("parsePushedPost_messageIdOf14Digits_returnsNull", () => {
    expect(parsePushedPost(getiWirePost({ id: "1".repeat(14) }))).toBeNull();
  });

  it("parsePushedPost_messageIdOf15Digits_isRead", () => {
    expect(parsePushedPost(getiWirePost({ id: "1".repeat(15) }))?.messageId).toBe("1".repeat(15));
  });

  it("parsePushedPost_messageIdOf22Digits_isRead", () => {
    expect(parsePushedPost(getiWirePost({ id: "1".repeat(22) }))?.messageId).toBe("1".repeat(22));
  });

  it("parsePushedPost_messageIdOf23Digits_returnsNull", () => {
    expect(parsePushedPost(getiWirePost({ id: "1".repeat(23) }))).toBeNull();
  });

  it("parsePushedPost_numericMessageId_returnsNull", () => {
    expect(parsePushedPost(getiWirePost({ id: 100000000000000900 }))).toBeNull();
  });

  it("parsePushedPost_channelOutsideTheSixSources_returnsNull", () => {
    expect(parsePushedPost(getiWirePost({ channelId: "100000000000000555" }))).toBeNull();
  });

  it("parsePushedPost_unreadablePostedAt_returnsNull", () => {
    expect(parsePushedPost(getiWirePost({ postedAt: "hier" }))).toBeNull();
  });

  it("parsePushedPost_overlongPostedAt_returnsNull", () => {
    expect(parsePushedPost(getiWirePost({ postedAt: `2026-11-27T10:00:00.000Z${" ".repeat(40)}` }))).toBeNull();
  });

  it("parsePushedPost_unreadableEditedAt_keepsPostUnedited", () => {
    const post = parsePushedPost(getiWirePost({ editedAt: "bientôt" }));

    expect(post?.editedAt).toBeNull();
    expect(post?.raw.editedAt).toBeNull();
  });

  it("parsePushedPost_contentOver4000Characters_isTruncated", () => {
    const post = parsePushedPost(getiWirePost({ content: "a".repeat(4001) }));

    expect(post?.raw.content).toHaveLength(4000);
  });

  it("parsePushedPost_contentNotAString_becomesEmpty", () => {
    expect(parsePushedPost(getiWirePost({ content: { text: "LFT" } }))?.raw.content).toBe("");
  });

  it("parsePushedPost_elevenEmbeds_keepsTen", () => {
    const embeds = Array.from({ length: 11 }, () => ({ description: "LFP" }));

    expect(parsePushedPost(getiWirePost({ embeds }))?.raw.embeds).toHaveLength(10);
  });

  it("parsePushedPost_embedThatIsNotAnObject_isDropped", () => {
    const post = parsePushedPost(getiWirePost({ embeds: ["texte", { title: "LFP" }] }));

    expect(post?.raw.embeds).toEqual([{ authorName: null, title: "LFP", description: null, fields: [], footerText: null }]);
  });

  it("parsePushedPost_embedTexts_areBounded", () => {
    const embed = {
      authorName: "n".repeat(300),
      title: "t".repeat(300),
      description: "d".repeat(5000),
      footerText: "f".repeat(3000),
      fields: [{ name: "a".repeat(300), value: "v".repeat(2000) }, "pas un champ"],
    };

    const [read] = parsePushedPost(getiWirePost({ embeds: [embed] }))?.raw.embeds ?? [];

    expect(read?.authorName).toHaveLength(256);
    expect(read?.title).toHaveLength(256);
    expect(read?.description).toHaveLength(4096);
    expect(read?.footerText).toHaveLength(2048);
    expect(read?.fields).toEqual([{ name: "a".repeat(256), value: "v".repeat(1024) }]);
  });

  it("parsePushedPost_twentySixEmbedFields_keepsTwentyFive", () => {
    const fields = Array.from({ length: 26 }, () => ({ name: "Rôle", value: "Tank" }));

    const [read] = parsePushedPost(getiWirePost({ embeds: [{ fields }] }))?.raw.embeds ?? [];

    expect(read?.fields).toHaveLength(25);
  });

  it("parsePushedPost_botFlagNotExactlyTrue_isNotABot", () => {
    const post = parsePushedPost(getiWirePost({ author: { id: "100000000000000001", username: "x", bot: "true" } }));

    expect(post?.raw.author?.bot).toBe(false);
  });

  it("parsePushedPost_missingAuthor_keepsEmptyAuthor", () => {
    const post = parsePushedPost(getiWirePost({ author: null }));

    expect(post?.raw.author).toEqual({ id: null, username: null, discriminator: null, bot: false });
  });

  it("parsePushedPost_invalidAuthorId_isDropped", () => {
    const post = parsePushedPost(getiWirePost({ author: { id: "abc", username: "x" } }));

    expect(post?.raw.author?.id).toBeNull();
  });

  it("parsePushedPost_relayOfGetiBot_isReadAsARelay", () => {
    const post = parsePushedPost(getiWireRelay("LFP tank Master"));

    expect(post).toMatchObject({ source: "relay", raw: { author: { id: GETI_BOT_USER_ID, bot: true } } });
  });

  it("parsePushedPost_publishedNoticeOfGetiBot_returnsNull", () => {
    const embeds = [{ description: "Ton annonce a été publié dans **32 autres channels**." }];

    expect(parsePushedPost(getiWireRelay("", { embeds }))).toBeNull();
  });

  it("parsePushedPost_messageOfAnotherBot_returnsNull", () => {
    const author = { id: "100000000000000090", username: "AutreBot", discriminator: "0", bot: true };

    expect(parsePushedPost(getiWireRelay("LFP tank Master", { author }))).toBeNull();
  });

  it("parsePushedPost_botWithoutId_returnsNull", () => {
    expect(parsePushedPost(getiWirePost({ author: { username: "AutreBot", bot: true } }))).toBeNull();
  });

  it("parsePushedPost_rawHeavierThanTheByteCap_returnsNull", () => {
    // Dix encarts pleins de caractères de deux octets : sous les bornes de longueur, au-delà du plafond d'octets.
    const embeds = Array.from({ length: 10 }, () => ({ description: "é".repeat(4096) }));
    const heavy = getiWirePost({ embeds });

    expect(Buffer.byteLength(JSON.stringify(heavy), "utf8")).toBeGreaterThan(GETI_RAW_JSON_MAX_BYTES);
    expect(parsePushedPost(heavy)).toBeNull();
  });
});

describe("parseUpsertBody", () => {
  it("parseUpsertBody_postsNotAnArray_returnsInvalidRequest", () => {
    expect(parseUpsertBody({ posts: "tout" })).toBe(GETI_INGEST_ERRORS.invalidRequest);
  });

  it("parseUpsertBody_twentyPosts_areAllRead", () => {
    const posts = ids(20).map((id) => getiWirePost({ id }));

    const parsed = parseUpsertBody({ posts });

    expect(typeof parsed === "string" ? parsed : parsed.posts.length).toBe(20);
  });

  it("parseUpsertBody_twentyOnePosts_returnsTooManyPosts", () => {
    const posts = ids(21).map((id) => getiWirePost({ id }));

    expect(parseUpsertBody({ posts })).toBe(GETI_INGEST_ERRORS.tooManyPosts);
  });

  it("parseUpsertBody_unreadableEntry_isCountedRejected", () => {
    const parsed = parseUpsertBody({ posts: [getiWirePost(), { id: "x" }] });

    expect(parsed).toMatchObject({ rejected: 1, posts: [{ messageId: GETI_FAKE_MESSAGE_ID }] });
  });

  it("parseUpsertBody_sameMessageTwice_keepsTheFirstReading", () => {
    const parsed = parseUpsertBody({ posts: [getiWirePost({ content: "LFT un" }), getiWirePost({ content: "LFT deux" })] });

    expect(parsed).toMatchObject({ rejected: 1, posts: [{ raw: { content: "LFT un" } }] });
  });
});

describe("parseDeleteBody", () => {
  it("parseDeleteBody_validIds_areDeduplicated", () => {
    expect(parseDeleteBody({ ids: [ID, GETI_FAKE_MESSAGE_ID, ID] })).toEqual({ ids: [ID, GETI_FAKE_MESSAGE_ID] });
  });

  it("parseDeleteBody_idsNotAnArray_returnsInvalidRequest", () => {
    expect(parseDeleteBody({ ids: ID })).toBe(GETI_INGEST_ERRORS.invalidRequest);
  });

  it("parseDeleteBody_hundredIds_areAccepted", () => {
    expect(parseDeleteBody({ ids: ids(100) })).toEqual({ ids: ids(100) });
  });

  it("parseDeleteBody_hundredAndOneIds_returnsTooManyIds", () => {
    expect(parseDeleteBody({ ids: ids(101) })).toBe(GETI_INGEST_ERRORS.tooManyIds);
  });

  it("parseDeleteBody_oneInvalidId_returnsInvalidRequest", () => {
    expect(parseDeleteBody({ ids: [ID, "1 OR 1=1"] })).toBe(GETI_INGEST_ERRORS.invalidRequest);
  });
});

describe("parseReconcileBody", () => {
  const window = { channelId: GETI_CHANNEL_IDS.lfs, since: "2026-11-13T10:00:00.000Z", until: "2026-11-27T10:00:00.000Z", ids: [ID] };

  it("parseReconcileBody_validWindow_returnsDatesAndIds", () => {
    expect(parseReconcileBody(window)).toEqual({
      channelId: GETI_CHANNEL_IDS.lfs,
      since: new Date("2026-11-13T10:00:00.000Z"),
      until: new Date("2026-11-27T10:00:00.000Z"),
      ids: [ID],
    });
  });

  it("parseReconcileBody_malformedChannel_returnsInvalidRequest", () => {
    expect(parseReconcileBody({ ...window, channelId: "lfs" })).toBe(GETI_INGEST_ERRORS.invalidRequest);
  });

  it("parseReconcileBody_channelOutsideTheSixSources_returnsUnknownChannel", () => {
    expect(parseReconcileBody({ ...window, channelId: "100000000000000555" })).toBe(GETI_INGEST_ERRORS.unknownChannel);
  });

  it("parseReconcileBody_missingSince_returnsInvalidWindow", () => {
    expect(parseReconcileBody({ ...window, since: undefined })).toBe(GETI_INGEST_ERRORS.invalidWindow);
  });

  it("parseReconcileBody_unreadableUntil_returnsInvalidWindow", () => {
    expect(parseReconcileBody({ ...window, until: "demain" })).toBe(GETI_INGEST_ERRORS.invalidWindow);
  });

  it("parseReconcileBody_sinceAfterUntil_returnsInvalidWindow", () => {
    expect(parseReconcileBody({ ...window, since: "2026-11-27T10:00:00.001Z" })).toBe(GETI_INGEST_ERRORS.invalidWindow);
  });

  it("parseReconcileBody_sinceEqualsUntil_isAccepted", () => {
    expect(parseReconcileBody({ ...window, since: window.until })).toMatchObject({ ids: [ID] });
  });

  it("parseReconcileBody_emptyIds_isAccepted", () => {
    expect(parseReconcileBody({ ...window, ids: [] })).toMatchObject({ ids: [] });
  });

  it("parseReconcileBody_tenThousandAndOneIds_returnsTooManyIds", () => {
    expect(parseReconcileBody({ ...window, ids: ids(10_001) })).toBe(GETI_INGEST_ERRORS.tooManyIds);
  });

  it("parseReconcileBody_invalidId_returnsInvalidRequest", () => {
    expect(parseReconcileBody({ ...window, ids: [42] })).toBe(GETI_INGEST_ERRORS.invalidRequest);
  });
});
