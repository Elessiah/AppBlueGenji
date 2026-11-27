import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { clearCache } from "@/lib/server/cache";
import { getGetiCommunity } from "@/lib/server/geti/community";
import { GETI_OFFICIAL_INVITE_CODE } from "@/lib/shared/geti/page";

type FetchFn = typeof globalThis.fetch;

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 404, json: async () => body } as unknown as Response;
}

describe("fréquentation du serveur officiel de GETI", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearCache();
  });

  function mockFetch(impl: () => Response | Promise<Response>) {
    const spy = jest.fn<FetchFn>(async () => impl());
    globalThis.fetch = spy;
    return spy;
  }

  it("interroge l'invitation de GETI avec les compteurs", async () => {
    const spy = mockFetch(() => jsonResponse({ approximate_member_count: 3500, approximate_presence_count: 900 }));

    await expect(getGetiCommunity()).resolves.toEqual({ memberCount: 3500, onlineCount: 900 });

    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain(`/invites/${GETI_OFFICIAL_INVITE_CODE}`);
    expect(url).toContain("with_counts=true");
  });

  it("une invitation que Discord ne connaît pas ne donne aucun chiffre", async () => {
    mockFetch(() => jsonResponse({ message: "Unknown Invite" }, false));

    await expect(getGetiCommunity()).resolves.toBeNull();
  });

  it("une réponse sans compteur ne donne aucun chiffre", async () => {
    mockFetch(() => jsonResponse({ code: "x" }));

    await expect(getGetiCommunity()).resolves.toBeNull();
  });

  it("une panne réseau ne donne aucun chiffre, sans exception", async () => {
    mockFetch(() => Promise.reject(new Error("réseau coupé")));

    await expect(getGetiCommunity()).resolves.toBeNull();
  });

  it("l'échec est mis en cache : un seul appel sortant pour deux rendus", async () => {
    const spy = mockFetch(() => jsonResponse({}, false));

    await getGetiCommunity();
    await getGetiCommunity();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
