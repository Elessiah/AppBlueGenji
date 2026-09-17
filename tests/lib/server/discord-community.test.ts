import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { cached, clearCache } from "@/lib/server/cache";
import { getDiscordCommunity } from "@/lib/server/discord-community";
import { DISCORD_INVITE_CODE } from "@/lib/shared/discord";
import { invalidateLandingAggregates } from "@/lib/server/landing-cache";

type FetchFn = typeof globalThis.fetch;

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

describe("compteur de membres Discord", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearCache();
    jest.restoreAllMocks();
  });

  function mockFetch(impl: (url: string) => Response | Promise<Response>): jest.Mock {
    const spy = jest.fn(async (input: unknown) => impl(String(input)));
    globalThis.fetch = spy as unknown as FetchFn;
    return spy as unknown as jest.Mock;
  }

  it("interroge l'API publique des invitations, avec les compteurs", async () => {
    const spy = mockFetch(() =>
      jsonResponse({ approximate_member_count: 1284, approximate_presence_count: 213 }),
    );

    await expect(getDiscordCommunity()).resolves.toEqual({ memberCount: 1284, onlineCount: 213 });

    const [url] = spy.mock.calls[0] as [string];
    // Le code de l'invitation, et `with_counts` : sans ce paramètre Discord
    // répond bien, mais sans le moindre compteur — la panne serait muette.
    expect(url).toContain(`/invites/${DISCORD_INVITE_CODE}`);
    expect(url).toContain("with_counts=true");
  });

  it("mutualise les appels concurrents en un seul", async () => {
    const spy = mockFetch(() => jsonResponse({ approximate_member_count: 7 }));

    const [a, b, c] = await Promise.all([
      getDiscordCommunity(),
      getDiscordCommunity(),
      getDiscordCommunity(),
    ]);

    expect([a, b, c]).toEqual([
      { memberCount: 7, onlineCount: 0 },
      { memberCount: 7, onlineCount: 0 },
      { memberCount: 7, onlineCount: 0 },
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("ressert la valeur en cache sans rappeler Discord", async () => {
    const spy = mockFetch(() => jsonResponse({ approximate_member_count: 7 }));

    await getDiscordCommunity();
    await getDiscordCommunity();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Discord plafonne l'appelant", () => jsonResponse({ retry_after: 12 }, { ok: false, status: 429 })],
    ["l'invitation est inconnue", () => jsonResponse({ code: 10006 }, { ok: false, status: 404 })],
    ["la réponse n'a pas de compteur", () => jsonResponse({ code: DISCORD_INVITE_CODE })],
    [
      "le corps est illisible",
      () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError("Unexpected token");
          },
        }) as unknown as Response,
    ],
  ])("rend null quand %s", async (_label, impl) => {
    mockFetch(impl as () => Response);
    await expect(getDiscordCommunity()).resolves.toBeNull();
  });

  it("rend null sans lever quand le réseau échoue", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as FetchFn;

    await expect(getDiscordCommunity()).resolves.toBeNull();
  });

  it("retient aussi le refus, plutôt que de retenter à chaque rendu", async () => {
    // Un plafonnement retenté à chaque visite se prolonge lui-même : le `null`
    // est mis en cache **exprès**.
    const spy = mockFetch(() => jsonResponse({}, { ok: false, status: 429 }));

    await getDiscordCommunity();
    await getDiscordCommunity();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("survit à l'invalidation des agrégats de la vitrine", async () => {
    // La clé vit hors du préfixe `landing:` : un score reporté ne doit pas
    // relancer un appel sortant vers Discord.
    const spy = mockFetch(() => jsonResponse({ approximate_member_count: 7 }));

    await getDiscordCommunity();
    invalidateLandingAggregates();
    await getDiscordCommunity();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("laisse le cache général gouverner sa clé", async () => {
    // Filet : si la clé venait à changer de nom, ce test tomberait avec celui
    // ci-dessus plutôt que de laisser passer une double mise en cache.
    const spy = jest.fn(async () => "sentinelle");
    await cached("discord:community", 60_000, spy as () => Promise<string>);
    await expect(getDiscordCommunity()).resolves.toBe("sentinelle" as never);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
