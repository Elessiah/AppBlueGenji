import { beforeEach, describe, expect, it, jest } from "@jest/globals";

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
  });

  it("refuse au-delà du plafond global, même répartis sur des clients distincts", () => {
    for (let i = 0; i < MAX_BOT_FEED_STREAMS; i += 1) {
      expect(acquireBotFeedSlot(`10.0.0.${i}`)).not.toBeNull();
    }

    expect(acquireBotFeedSlot("10.9.9.9")).toBeNull();
  });

  /**
   * Le plafond global était un seau commun : quatorze IP tenant trois flux
   * chacune privaient tous les visiteurs de `/bot` du direct. Plein, il se
   * partage : le client qui en tient le plus cède son plus ancien flux.
   */
  it("déloge le plus ancien flux du client qui en accumule, au profit d'un nouveau venu", () => {
    const evictions: string[] = [];
    const hoarders = Math.ceil(MAX_BOT_FEED_STREAMS / MAX_BOT_FEED_STREAMS_PER_CLIENT);
    let opened = 0;
    for (let ip = 0; ip < hoarders && opened < MAX_BOT_FEED_STREAMS; ip += 1) {
      for (let n = 0; n < MAX_BOT_FEED_STREAMS_PER_CLIENT && opened < MAX_BOT_FEED_STREAMS; n += 1) {
        const label = `10.0.0.${ip}#${n}`;
        expect(acquireBotFeedSlot(`10.0.0.${ip}`, () => evictions.push(label))).not.toBeNull();
        opened += 1;
      }
    }
    expect(botFeedStreamCount()).toBe(MAX_BOT_FEED_STREAMS);

    expect(acquireBotFeedSlot("192.168.1.1")).not.toBeNull();

    // Le premier flux du premier client à en tenir le plus : le plus ancien.
    expect(evictions).toEqual(["10.0.0.0#0"]);
    expect(botFeedStreamCount()).toBe(MAX_BOT_FEED_STREAMS);
  });

  it("ne déloge jamais un lecteur qui n'en tient pas plus que le nouveau venu", () => {
    const evict = jest.fn();
    for (let i = 0; i < MAX_BOT_FEED_STREAMS; i += 1) {
      acquireBotFeedSlot(`10.0.1.${i}`, evict);
    }
    expect(acquireBotFeedSlot("10.9.9.9")).toBeNull();
    expect(evict).not.toHaveBeenCalled();
  });

  it("ne laisse pas un client délogé reprendre sa place en se reconnectant", () => {
    for (let i = 0; i < MAX_BOT_FEED_STREAMS - 2; i += 1) acquireBotFeedSlot(`10.0.1.${i}`);
    acquireBotFeedSlot("10.0.0.1");
    acquireBotFeedSlot("10.0.0.1");
    // Plein : 38 lecteurs à un flux, un client à deux.
    expect(acquireBotFeedSlot("10.0.2.1")).not.toBeNull();
    // Le client délogé n'en tient plus qu'un, comme les autres : il attend.
    expect(acquireBotFeedSlot("10.0.0.1")).toBeNull();
  });

  it("rend la place du flux délogé une seule fois, même s'il la libère ensuite", () => {
    let releaseVictim: (() => void) | null = null;
    releaseVictim = acquireBotFeedSlot("10.0.0.1", () => releaseVictim?.());
    acquireBotFeedSlot("10.0.0.1");
    for (let i = 0; i < MAX_BOT_FEED_STREAMS - 2; i += 1) acquireBotFeedSlot(`10.0.1.${i}`);

    expect(acquireBotFeedSlot("10.0.3.1")).not.toBeNull();
    releaseVictim!();

    expect(botFeedStreamCount()).toBe(MAX_BOT_FEED_STREAMS);
  });

  it("ne compte pas les visiteurs sans IP connue comme un seul client", () => {
    // Rien ne dit que deux inconnus sont la même personne : les regrouper
    // ferait déloger un lecteur à un seul onglet au profit d'un visiteur identifié.
    const evict = jest.fn();
    for (let i = 0; i < MAX_BOT_FEED_STREAMS; i += 1) acquireBotFeedSlot(null, evict);
    expect(acquireBotFeedSlot("10.0.0.1")).toBeNull();
    expect(evict).not.toHaveBeenCalled();
  });

  it("fait céder un client identifié qui accumule à un visiteur sans IP connue", () => {
    const evict = jest.fn();
    acquireBotFeedSlot("10.0.0.1", evict);
    acquireBotFeedSlot("10.0.0.1");
    for (let i = 2; i < MAX_BOT_FEED_STREAMS; i += 1) acquireBotFeedSlot(null);
    expect(acquireBotFeedSlot(null)).not.toBeNull();
    expect(evict).toHaveBeenCalledTimes(1);
  });

  it("garde un plafond par client plus étroit que le plafond global", () => {
    // Sinon le premier ne bornerait jamais rien : le second tomberait d'abord.
    expect(MAX_BOT_FEED_STREAMS_PER_CLIENT).toBeLessThan(MAX_BOT_FEED_STREAMS);
  });
});
