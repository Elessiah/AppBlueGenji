import { describe, expect, it, jest } from "@jest/globals";

import { PINNED_ADDRESS_REFUSED, pinnedHttpsGet, pinnedLookup, type AddressResolver } from "@/lib/server/pinned-https";

/**
 * Le relais d'images jugeait les adresses résolues **avant** chaque saut, puis
 * laissait `fetch` résoudre de nouveau le nom en se connectant : un serveur DNS
 * hostile à durée de vie nulle pouvait rendre une adresse publique au contrôle,
 * `127.0.0.1` à la connexion. La résolution qui sert au socket est désormais
 * celle qui est jugée.
 */

const isPublic = (address: string) => !address.startsWith("127.") && !address.startsWith("10.") && address !== "::1";

type LookupResult = { error: (Error & { code?: string }) | null; address: unknown; family?: number };

function runLookup(resolve: AddressResolver, options: { all?: boolean; family?: number | string }): Promise<LookupResult> {
  const lookup = pinnedLookup(resolve, isPublic) as unknown as (
    hostname: string,
    options: { all?: boolean; family?: number | string },
    callback: (error: (Error & { code?: string }) | null, address: unknown, family?: number) => void,
  ) => void;
  return new Promise((done) => {
    lookup("cdn.exemple.fr", options, (error, address, family) => done({ error, address, family }));
  });
}

describe("pinnedLookup", () => {
  it("rend au socket l'adresse jugée", async () => {
    const result = await runLookup(async () => ["93.184.215.14"], {});
    expect(result).toEqual({ error: null, address: "93.184.215.14", family: 4 });
  });

  it("rend toutes les adresses jugées quand le socket en tente plusieurs", async () => {
    const result = await runLookup(async () => ["93.184.215.14", "2606:4700::1"], { all: true });
    expect(result.error).toBeNull();
    expect(result.address).toEqual([
      { address: "93.184.215.14", family: 4 },
      { address: "2606:4700::1", family: 6 },
    ]);
  });

  it("ne rend que la famille demandée", async () => {
    const result = await runLookup(async () => ["93.184.215.14", "2606:4700::1"], { family: 6 });
    expect(result).toEqual({ error: null, address: "2606:4700::1", family: 6 });
  });

  it("refuse la connexion dès qu'une adresse résolue est interne — le rebinding", async () => {
    let calls = 0;
    // Publique au premier jugement, interne au second : c'est la seconde qui
    // servirait à la connexion d'un client qui résout de nouveau.
    const rebinding: AddressResolver = async () => (++calls === 1 ? ["93.184.215.14"] : ["127.0.0.1"]);
    await runLookup(rebinding, {});
    const second = await runLookup(rebinding, {});
    expect(second.error?.message).toBe(PINNED_ADDRESS_REFUSED);
    expect(second.error?.code).toBe("EACCES");
  });

  it("refuse une réponse mixte, une résolution vide ou en échec", async () => {
    expect((await runLookup(async () => ["93.184.215.14", "10.0.0.4"], {})).error?.message).toBe(PINNED_ADDRESS_REFUSED);
    expect((await runLookup(async () => [], { all: true })).error?.message).toBe(PINNED_ADDRESS_REFUSED);
    const failed = await runLookup(async () => {
      throw new Error("ENOTFOUND");
    }, {});
    expect(failed.error?.message).toBe("ENOTFOUND");
  });

  it("résout le nom sans ses crochets", async () => {
    const resolve = jest.fn<AddressResolver>(async () => ["93.184.215.14"]);
    const lookup = pinnedLookup(resolve, isPublic) as unknown as (
      hostname: string,
      options: object,
      callback: () => void,
    ) => void;
    await new Promise<void>((done) => lookup("[cdn.exemple.fr]", {}, () => done()));
    expect(resolve).toHaveBeenCalledWith("cdn.exemple.fr");
  });
});

describe("pinnedHttpsGet", () => {
  it("n'ouvre aucune connexion vers une adresse refusée", async () => {
    await expect(
      pinnedHttpsGet(new URL("https://piege.exemple.fr/p.png"), {
        headers: {},
        signal: new AbortController().signal,
        resolve: async () => ["127.0.0.1"],
        isAllowedAddress: isPublic,
      }),
    ).rejects.toThrow(PINNED_ADDRESS_REFUSED);
  });
});
