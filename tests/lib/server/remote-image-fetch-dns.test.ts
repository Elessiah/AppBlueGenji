import { afterEach, describe, expect, it, jest } from "@jest/globals";

// La connexion à adresse fixée (`pinned-https.ts`) passe par `node:https` ;
// ici, elle est rendue au `fetch` simulé de chaque cas.
jest.mock("@/lib/server/pinned-https", () => ({
  pinnedHttpsGet: (url: URL, init: { headers: Record<string, string>; signal: AbortSignal }) =>
    globalThis.fetch(url, { headers: init.headers, signal: init.signal, redirect: "manual" }),
}));
import { fetchRemoteImage, hostResolvesPublicly, type HostResolver } from "@/lib/server/remote-image-fetch";

/**
 * Le filtre d'hôte ne jugeait que le nom écrit dans l'URL : un domaine public
 * dont l'enregistrement DNS désigne `127.0.0.1` passait. Chaque saut résout
 * désormais le nom et juge toutes les adresses rendues.
 */
function resolver(addresses: string[] | Error): jest.Mock<HostResolver> {
  return jest.fn<HostResolver>(async () => {
    if (addresses instanceof Error) throw addresses;
    return addresses;
  });
}

describe("hostResolvesPublicly", () => {
  it("accepte un nom qui ne résout que vers des adresses publiques", async () => {
    await expect(hostResolvesPublicly("cdn.exemple.fr", resolver(["93.184.215.14", "2606:4700::1"]))).resolves.toBe(true);
  });

  it.each([["127.0.0.1"], ["10.0.0.4"], ["169.254.169.254"], ["::1"], ["::ffff:127.0.0.1"], ["fd12::1"]])(
    "refuse un nom qui résout vers %s",
    async (address) => {
      await expect(hostResolvesPublicly("piege.exemple.fr", resolver([address]))).resolves.toBe(false);
    },
  );

  it("refuse dès qu'une seule des adresses est interne", async () => {
    await expect(hostResolvesPublicly("mixte.exemple.fr", resolver(["93.184.215.14", "127.0.0.1"]))).resolves.toBe(false);
  });

  it("refuse une résolution qui échoue ou ne rend rien", async () => {
    await expect(hostResolvesPublicly("absent.exemple.fr", resolver(new Error("ENOTFOUND")))).resolves.toBe(false);
    await expect(hostResolvesPublicly("vide.exemple.fr", resolver([]))).resolves.toBe(false);
  });

  it("ne résout pas une adresse littérale, déjà jugée par son écriture", async () => {
    const resolve = resolver(["127.0.0.1"]);
    await expect(hostResolvesPublicly("8.8.8.8", resolve)).resolves.toBe(true);
    await expect(hostResolvesPublicly("[2606:4700::1]", resolve)).resolves.toBe(true);
    await expect(hostResolvesPublicly("[::ffff:7f00:1]", resolve)).resolves.toBe(false);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("fetchRemoteImage — résolution à chaque saut", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("ne part pas vers un nom qui résout vers une adresse interne", async () => {
    const fetchMock = jest.fn<typeof fetch>();
    globalThis.fetch = fetchMock;

    await expect(
      fetchRemoteImage(new URL("https://piege.exemple.fr/p.png"), { resolveHost: resolver(["127.0.0.1"]) }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("revalide la résolution après une redirection", async () => {
    const fetchMock = jest.fn<typeof fetch>(async () =>
      new Response(null, { status: 302, headers: { location: "https://interne.exemple.fr/p.png" } }),
    );
    globalThis.fetch = fetchMock;
    const resolve = jest.fn<HostResolver>(async (host) =>
      host === "interne.exemple.fr" ? ["10.0.0.4"] : ["93.184.215.14"],
    );

    await expect(
      fetchRemoteImage(new URL("https://cdn.exemple.fr/p.png"), { resolveHost: resolve }),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("interne.exemple.fr");
  });

  it("va chercher l'image quand le nom résout publiquement", async () => {
    globalThis.fetch = jest.fn<typeof fetch>(async () =>
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
    );

    const fetched = await fetchRemoteImage(new URL("https://cdn.exemple.fr/p.png"), {
      resolveHost: resolver(["93.184.215.14"]),
    });
    expect(fetched?.contentType).toBe("image/png");
  });
});
