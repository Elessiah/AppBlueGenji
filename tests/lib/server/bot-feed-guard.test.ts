import { beforeEach, describe, expect, it } from "@jest/globals";

import {
  MAX_BOT_FEED_STREAMS,
  MAX_BOT_FEED_STREAMS_PER_CLIENT,
  acquireBotFeedSlot,
  botFeedStreamCount,
  resetBotFeedSlots,
} from "@/lib/server/bot-feed-guard";

/**
 * `/api/bot/feed/stream` est la seule route du site à tenir une connexion longue
 * **sans compte** : `/bot` est une page de vitrine. Chaque lecteur y fait
 * pourtant tenir deux connexions — la sienne, et celle que l'app ouvre vers le
 * bot. Sans plafond, une poignée d'onglets immobilise autant de sockets des deux
 * côtés.
 */
describe("acquireBotFeedSlot", () => {
  beforeEach(resetBotFeedSlots);

  it("accorde une place à un client qui n'en a aucune", () => {
    expect(acquireBotFeedSlot("10.0.0.1")).not.toBeNull();
    expect(botFeedStreamCount()).toBe(1);
  });

  it("refuse au-delà du plafond par client", () => {
    for (let i = 0; i < MAX_BOT_FEED_STREAMS_PER_CLIENT; i += 1) {
      expect(acquireBotFeedSlot("10.0.0.1")).not.toBeNull();
    }

    expect(acquireBotFeedSlot("10.0.0.1")).toBeNull();
  });

  it("ne fait pas payer un client pour les onglets d'un autre", () => {
    for (let i = 0; i < MAX_BOT_FEED_STREAMS_PER_CLIENT; i += 1) {
      acquireBotFeedSlot("10.0.0.1");
    }

    expect(acquireBotFeedSlot("10.0.0.2")).not.toBeNull();
  });

  it("rend la place à la libération", () => {
    const release = acquireBotFeedSlot("10.0.0.1")!;
    for (let i = 1; i < MAX_BOT_FEED_STREAMS_PER_CLIENT; i += 1) {
      acquireBotFeedSlot("10.0.0.1");
    }
    expect(acquireBotFeedSlot("10.0.0.1")).toBeNull();

    release();

    expect(acquireBotFeedSlot("10.0.0.1")).not.toBeNull();
  });

  it("supporte une libération répétée sans creuser le compteur", () => {
    // Un flux se termine par plusieurs portes — fin de l'amont, annulation du
    // corps, abandon de la requête — et aucune ne sait si une autre l'a
    // précédée. Compter deux fois la même sortie ouvrirait le plafond.
    const release = acquireBotFeedSlot("10.0.0.1")!;

    release();
    release();
    release();

    expect(botFeedStreamCount()).toBe(0);
  });

  it("borne les visiteurs sans IP connue par le seul plafond global", () => {
    // Derrière un proxy qui ne pose pas `X-Forwarded-For`, personne n'a
    // d'identité : le plafond par client ne borne alors rien, et c'est le
    // plafond global qui tient.
    for (let i = 0; i < MAX_BOT_FEED_STREAMS; i += 1) {
      expect(acquireBotFeedSlot(null)).not.toBeNull();
    }

    expect(acquireBotFeedSlot(null)).toBeNull();
    // Le plafond global vaut pour tout le monde, identifié ou non.
    expect(acquireBotFeedSlot("10.0.0.1")).toBeNull();
  });

  it("refuse au-delà du plafond global, même répartis sur des clients distincts", () => {
    for (let i = 0; i < MAX_BOT_FEED_STREAMS; i += 1) {
      expect(acquireBotFeedSlot(`10.0.0.${i}`)).not.toBeNull();
    }

    expect(acquireBotFeedSlot("10.9.9.9")).toBeNull();
  });

  it("garde un plafond par client plus étroit que le plafond global", () => {
    // Sinon le premier ne bornerait jamais rien : le second tomberait d'abord.
    expect(MAX_BOT_FEED_STREAMS_PER_CLIENT).toBeLessThan(MAX_BOT_FEED_STREAMS);
  });
});
