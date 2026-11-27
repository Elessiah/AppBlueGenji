import { parsePushedPost, type GetiPushedPost } from "@/lib/server/geti/wire";
import { GETI_CHANNEL_IDS } from "@/lib/shared/geti";
import { GETI_BOT_USER_ID } from "@/lib/shared/geti/ingest";

/** Identifiants factices (aucun message ni compte réel). */
export const GETI_FAKE_MESSAGE_ID = "100000000000000901";
export const GETI_FAKE_POSTED_AT = "2026-11-27T10:00:00.000Z";
export const GETI_FAKE_RELAYED_AUTHOR_ID = "100000000000000012";

/** Corps d'une annonce telle que le bot la pousse : message écrit directement dans « je cherche une équipe ». */
export function getiWirePost(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: GETI_FAKE_MESSAGE_ID,
    channelId: GETI_CHANNEL_IDS.lft,
    content: "LFT support Master 2, EU, PC, FR",
    author: { id: "100000000000000001", username: "fauxjoueur", discriminator: "0", bot: false },
    embeds: [],
    postedAt: GETI_FAKE_POSTED_AT,
    editedAt: null,
    ...overrides,
  };
}

/** Annonce poussée déjà lue ; lève si le corps de test n'est pas lisible. */
export function getiPushedPost(overrides: Record<string, unknown> = {}): GetiPushedPost {
  const post = parsePushedPost(getiWirePost(overrides));
  if (!post) throw new Error("corps de test illisible");
  return post;
}

/** Description de l'encart d'un relais de GETI Bot : en-tête (auteur, pseudo, serveur), puis l'annonce citée. */
export function getiRelayDescription(text: string, username = "fauxpseudo", server = "[FAUX] Serveur Test"): string {
  return `<@${GETI_FAKE_RELAYED_AUTHOR_ID}>*(${username})* sur [${server}](https://discord.gg/fauxcode)\n\n> ${text}`;
}

/** Relais de GETI Bot : contenu vide, un encart dont la description porte l'en-tête et l'annonce. */
export function getiWireRelay(text: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return getiWirePost({
    content: "",
    author: { id: GETI_BOT_USER_ID, username: "GETI Bot", discriminator: "0", bot: true },
    embeds: [{ description: getiRelayDescription(text) }],
    ...overrides,
  });
}
