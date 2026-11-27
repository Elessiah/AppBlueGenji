import { parsePushedPost, type GetiPushedPost } from "@/lib/server/geti/wire";
import { GETI_CHANNEL_IDS } from "@/lib/shared/geti";

/** Identifiants factices (aucun message ni compte réel). */
export const GETI_FAKE_MESSAGE_ID = "100000000000000901";
export const GETI_FAKE_POSTED_AT = "2026-11-27T10:00:00.000Z";

/** Corps d'une annonce telle que le bot la pousse : message d'un joueur dans « je cherche une équipe ». */
export function getiWirePost(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: GETI_FAKE_MESSAGE_ID,
    channelId: GETI_CHANNEL_IDS.lft,
    content: "LFT support Master 2, EU, PC, FR",
    author: { id: "100000000000000001", username: "fauxjoueur", discriminator: "0", bot: false },
    embeds: [],
    mentions: [],
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

/** Relais d'un bot : ligne d'auteur et description de l'encart. */
export function getiWireRelay(authorName: string, description: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return getiWirePost({
    content: "",
    author: { id: "100000000000000090", username: "FauxBot", discriminator: "0", bot: true },
    embeds: [{ authorName, description }],
    ...overrides,
  });
}
