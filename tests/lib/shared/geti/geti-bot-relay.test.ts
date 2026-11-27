import { describe, expect, it } from "@jest/globals";

import { parseGetiPost, type GetiRawPost } from "@/lib/shared/geti";
import { GETI_FAKE_BOT_ID } from "../../../helpers/geti";

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
    const parsed = parseGetiPost(relay(`${HEADER}\n\n> LFP tank Master 3, EU, PC`));

    expect(parsed).toMatchObject({
      relayed: true,
      authorId: AUTHOR_ID,
      authorTag: "fauxpseudo",
      originServer: "[FAUX] Serveur Test",
    });
  });

  it("parseGetiPost_getiRelay_keepsOnlyThePostInTheText", () => {
    const parsed = parseGetiPost(relay(`${HEADER}\n\n> LFP tank Master 3, EU, PC`));

    expect(parsed.text).toBe("LFP tank Master 3, EU, PC");
  });

  it("parseGetiPost_getiRelayOverSeveralLines_dropsEveryQuoteMark", () => {
    const parsed = parseGetiPost(relay(`${HEADER}\n\n> LFP tank\n> Master 3\nEU, PC`));

    expect(parsed.text).toBe("LFP tank\nMaster 3\nEU, PC");
  });

  it("parseGetiPost_getiRelay_readsTheFieldsOfThePost", () => {
    const parsed = parseGetiPost(relay(`${HEADER}\n\n> LFP tank Master 3, EU, PC`));

    expect(parsed).toMatchObject({ roles: ["TANK"], regions: ["EU"], platforms: ["PC"] });
    expect(parsed.ranks.min).toEqual({ tier: "MASTER", division: 3 });
  });

  it("parseGetiPost_getiRelayWhosePostMentionsSomeoneElse_keepsTheHeaderAuthor", () => {
    const parsed = parseGetiPost(relay(`${HEADER}\n\n> LFT dps en duo avec <@100000000000000013>, contact : <@100000000000000013>`));

    expect(parsed.authorId).toBe(AUTHOR_ID);
  });

  it("parseGetiPost_getiRelayWithLegacyDiscriminatorInThePseudo_keepsIt", () => {
    const description = `<@${AUTHOR_ID}>*(VieuxCompte#4821)* sur [Faux Serveur](https://discord.gg/fauxcode)\n\n> LFT`;

    expect(parseGetiPost(relay(description)).authorTag).toBe("VieuxCompte#4821");
  });

  it("parseGetiPost_headerNotAtTheStart_isNotReadAsAHeader", () => {
    const parsed = parseGetiPost(relay(`LFP tank\n${HEADER}\n\n> suite`));

    expect(parsed.authorTag).toBeNull();
    expect(parsed.originServer).toBeNull();
  });

  it("parseGetiPost_headerWithoutServerLink_isNotReadAsAHeader", () => {
    const parsed = parseGetiPost(relay(`<@${AUTHOR_ID}>*(fauxpseudo)* sur Faux Serveur\n\n> LFP tank`));

    expect(parsed.authorTag).toBeNull();
    expect(parsed.originServer).toBeNull();
  });

  it("parseGetiPost_quoteMarkInADirectMessage_isKept", () => {
    const parsed = parseGetiPost({ content: "> LFT support", author: { id: AUTHOR_ID, username: "fauxjoueur", bot: false } });

    expect(parsed.text).toBe("> LFT support");
  });
});
