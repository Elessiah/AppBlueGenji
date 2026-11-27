import { describe, expect, it } from "@jest/globals";

import { parseGetiPost, type GetiRawPost } from "@/lib/shared/geti";
import { isGetiRelay } from "@/lib/shared/geti/ingest";
import { GETI_FAKE_BOT_ID, GETI_TRUSTED_BOTS } from "../../../helpers/geti";

/**
 * Relais de GETI Bot, forme réelle : contenu vide, un encart dont la
 * description commence par « <@id>*(pseudo)* sur [Serveur](invitation) », puis
 * l'annonce citée. Données de synthèse (pseudos, identifiants, serveurs factices).
 */

const AUTHOR_ID = "100000000000000012";
const HEADER = `<@${AUTHOR_ID}>*(fauxpseudo)* sur [[FAUX] Serveur Test](https://discord.gg/fauxcode)`;

function relay(description: string): GetiRawPost {
  return {
    content: "",
    author: { id: GETI_FAKE_BOT_ID, username: "GETI Bot", discriminator: "0", bot: true },
    embeds: [{ description }],
  };
}

describe("parseGetiPost — relais de GETI Bot", () => {
  it("parseGetiPost_getiRelay_readsAuthorTagIdAndOriginServerFromTheHeader", () => {
    const parsed = parseGetiPost(relay(`${HEADER}\n\n> LFP tank Master 3, EU, PC`), GETI_TRUSTED_BOTS);

    expect(parsed).toMatchObject({
      relayed: true,
      authorId: AUTHOR_ID,
      authorTag: "fauxpseudo",
      originServer: "[FAUX] Serveur Test",
    });
  });

  it("parseGetiPost_getiRelay_keepsOnlyThePostInTheText", () => {
    const parsed = parseGetiPost(relay(`${HEADER}\n\n> LFP tank Master 3, EU, PC`), GETI_TRUSTED_BOTS);

    expect(parsed.text).toBe("> LFP tank Master 3, EU, PC");
  });

  it("parseGetiPost_getiRelayOverSeveralLines_keepsEveryLineOfThePost", () => {
    const parsed = parseGetiPost(relay(`${HEADER}\n\n> LFP tank\n> Master 3\nEU, PC`), GETI_TRUSTED_BOTS);

    expect(parsed.text).toBe("> LFP tank\n> Master 3\nEU, PC");
  });

  it("parseGetiPost_getiRelayFromAServerWithoutBrackets_readsItsName", () => {
    const description = `<@${AUTHOR_ID}>*(fauxpseudo)* sur [Faux Serveur](https://discord.gg/fauxcode)\n\n> LFP tank`;

    expect(parseGetiPost(relay(description), GETI_TRUSTED_BOTS).originServer).toBe("Faux Serveur");
  });

  it("parseGetiPost_getiRelay_readsTheFieldsOfThePost", () => {
    const parsed = parseGetiPost(relay(`${HEADER}\n\n> LFP tank Master 3, EU, PC`), GETI_TRUSTED_BOTS);

    expect(parsed).toMatchObject({ roles: ["TANK"], regions: ["EU"], platforms: ["PC"] });
    expect(parsed.ranks.min).toEqual({ tier: "MASTER", division: 3 });
  });

  it("parseGetiPost_getiRelayWhosePostMentionsSomeoneElse_keepsTheHeaderAuthor", () => {
    const parsed = parseGetiPost(relay(`${HEADER}\n\n> LFT dps en duo avec <@100000000000000013>, contact : <@100000000000000013>`), GETI_TRUSTED_BOTS);

    expect(parsed.authorId).toBe(AUTHOR_ID);
  });

  it("parseGetiPost_getiRelayWithLegacyDiscriminatorInThePseudo_keepsIt", () => {
    const description = `<@${AUTHOR_ID}>*(VieuxCompte#4821)* sur [Faux Serveur](https://discord.gg/fauxcode)\n\n> LFT`;

    expect(parseGetiPost(relay(description), GETI_TRUSTED_BOTS).authorTag).toBe("VieuxCompte#4821");
  });

  it("parseGetiPost_headerNotAtTheStart_isNotReadAsAHeader", () => {
    const parsed = parseGetiPost(relay(`LFP tank\n${HEADER}\n\n> suite`), GETI_TRUSTED_BOTS);

    expect(parsed.authorTag).toBeNull();
    expect(parsed.originServer).toBeNull();
  });

  it("parseGetiPost_headerWithoutServerLink_isNotReadAsAHeader", () => {
    const parsed = parseGetiPost(relay(`<@${AUTHOR_ID}>*(fauxpseudo)* sur Faux Serveur\n\n> LFP tank`), GETI_TRUSTED_BOTS);

    expect(parsed.authorTag).toBeNull();
    expect(parsed.originServer).toBeNull();
  });

  it("parseGetiPost_quoteMarkInADirectMessage_isKept", () => {
    const parsed = parseGetiPost({ content: "> LFT support", author: { id: AUTHOR_ID, username: "fauxjoueur", bot: false } });

    expect(parsed.text).toBe("> LFT support");
  });
});

describe("isGetiRelay — relais ou avis de GETI Bot", () => {
  it("isGetiRelay_firstEmbedStartsWithTheAuthorMention_returnsTrue", () => {
    expect(isGetiRelay([{ description: `${HEADER}\n\n> LFP tank` }])).toBe(true);
  });

  it("isGetiRelay_publishedNotice_returnsFalse", () => {
    expect(isGetiRelay([{ description: "Ton annonce a été publié dans **32 autres channels**." }])).toBe(false);
  });

  it("isGetiRelay_noEmbed_returnsFalse", () => {
    expect(isGetiRelay([])).toBe(false);
    expect(isGetiRelay(null)).toBe(false);
  });

  it("isGetiRelay_descriptionMissing_returnsFalse", () => {
    expect(isGetiRelay([{ description: null }])).toBe(false);
  });

  it("isGetiRelay_mentionNotAtTheStart_returnsFalse", () => {
    expect(isGetiRelay([{ description: `LFP tank ${HEADER}` }])).toBe(false);
  });

  it("isGetiRelay_mentionThenNotice_returnsFalse", () => {
    expect(isGetiRelay([{ description: `<@${AUTHOR_ID}> Ton annonce a été publiée dans 32 autres channels.` }])).toBe(false);
  });

  it("isGetiRelay_englishHeaderWithOn_returnsTrue", () => {
    expect(isGetiRelay([{ description: `<@${AUTHOR_ID}> (fauxpseudo) on [Faux Serveur](https://discord.gg/fauxcode)\n\n> LFT dps` }])).toBe(true);
  });
});
