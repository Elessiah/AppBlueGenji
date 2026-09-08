import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { GET } from "@/app/api/bot/feed/stream/route";
import { BOT_FEED_OPEN_RULE } from "@/lib/server/api-guard";
import {
  MAX_BOT_FEED_STREAMS_PER_CLIENT,
  botFeedStreamCount,
  resetBotFeedSlots,
} from "@/lib/server/bot-feed-guard";
import { resetRateLimit } from "@/lib/server/rate-limit";

const CLIENT_IP = "203.0.113.7";

function request(): Request {
  return new Request("http://localhost/api/bot/feed/stream", {
    headers: { "x-forwarded-for": CLIENT_IP },
  });
}

/** Amont bouchonné : un évènement puis la fin, sans toucher au bot. */
function upstreamOk(chunks: string[] = ["data: {}\n\n"]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
  return new Response(body, { status: 200 });
}

/** Vide entièrement le corps de la réponse, comme le ferait un client. */
async function drain(response: Response): Promise<void> {
  const reader = response.body!.getReader();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  resetBotFeedSlots();
  resetRateLimit(BOT_FEED_OPEN_RULE.name);
  globalThis.fetch = jest.fn(async () => upstreamOk()) as never;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  resetBotFeedSlots();
  resetRateLimit(BOT_FEED_OPEN_RULE.name);
});

/**
 * Le relais du flux d'activité du bot est la seule route du site à tenir une
 * connexion longue sans compte. Chaque lecteur y fait tenir **deux** connexions
 * — la sienne, et celle qu'on ouvre vers le bot —, et rien ne les bornait.
 */
describe("GET /api/bot/feed/stream — garde-fous", () => {
  it("relaie le flux du bot dans le cas nominal", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    await drain(response);
  });

  it("refuse au-delà du plafond de flux simultanés, sans appeler le bot", async () => {
    const held: Response[] = [];
    for (let i = 0; i < MAX_BOT_FEED_STREAMS_PER_CLIENT; i += 1) {
      held.push(await GET(request()));
    }
    (globalThis.fetch as jest.Mock).mockClear();

    const refused = await GET(request());

    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("30");
    // Le refus précède l'ouverture vers le bot : une place refusée ne doit rien
    // lui coûter.
    expect(globalThis.fetch).not.toHaveBeenCalled();

    for (const response of held) await drain(response);
  });

  it("rend la place quand le flux amont se termine", async () => {
    const response = await GET(request());
    expect(botFeedStreamCount()).toBe(1);

    await drain(response);

    expect(botFeedStreamCount()).toBe(0);
  });

  it("rend la place quand le client annule le corps", async () => {
    const response = await GET(request());
    expect(botFeedStreamCount()).toBe(1);

    await response.body!.cancel();

    expect(botFeedStreamCount()).toBe(0);
  });

  it("rend la place quand le bot est injoignable", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as never;

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(botFeedStreamCount()).toBe(0);
  });

  it("rend la place quand le client est parti pendant l'ouverture", async () => {
    // Course résiduelle : le `fetch` vers le bot **réussit**, mais le client a
    // fermé son onglet entre-temps. Un signal déjà avorté ne déclenche jamais
    // son écouteur, et rien ne garantit que le runtime annulera un corps que
    // personne ne consomme : sans garde, la place fuyait définitivement, et
    // quarante fuites referment le plafond pour tout le monde.
    const controller = new AbortController();
    globalThis.fetch = jest.fn(async () => {
      controller.abort();
      return upstreamOk();
    }) as never;

    const response = await GET(
      new Request("http://localhost/api/bot/feed/stream", {
        headers: { "x-forwarded-for": CLIENT_IP },
        signal: controller.signal,
      }),
    );

    expect(response.status).toBe(204);
    expect(botFeedStreamCount()).toBe(0);
  });

  it("rend la place quand le bot refuse", async () => {
    globalThis.fetch = jest.fn(async () => new Response(null, { status: 401 })) as never;

    const response = await GET(request());

    expect(response.status).toBe(502);
    expect(botFeedStreamCount()).toBe(0);
  });

  it("plafonne le rythme d'ouverture, place libérée ou non", async () => {
    // Distinct du plafond de flux simultanés : un client qui ouvre et referme en
    // boucle libère sa place à chaque fois et y échapperait, tout en refaisant à
    // chaque tour l'ouverture vers le bot.
    for (let i = 0; i < BOT_FEED_OPEN_RULE.limit; i += 1) {
      const response = await GET(request());
      expect(response.status).toBe(200);
      await drain(response);
    }

    const refused = await GET(request());

    expect(refused.status).toBe(429);
  });

  it("ne compte pas les visiteurs sur le même seau qu'un autre", async () => {
    for (let i = 0; i < BOT_FEED_OPEN_RULE.limit; i += 1) {
      await drain(await GET(request()));
    }

    const other = new Request("http://localhost/api/bot/feed/stream", {
      headers: { "x-forwarded-for": "198.51.100.4" },
    });

    const response = await GET(other);
    expect(response.status).toBe(200);
    await drain(response);
  });
});
