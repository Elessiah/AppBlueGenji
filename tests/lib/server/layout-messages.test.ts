/**
 * `clientShowsSegment` — une mise en page ne renvoie pas un dictionnaire à un
 * client qui affiche déjà ce segment (revue de performance du lot 9-2).
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

let mockHeaders: Record<string, string> = {};
jest.mock("next/headers", () => ({ headers: async () => new Headers(mockHeaders) }));

import { clientShowsSegment } from "@/lib/server/layout-messages";

const ROUTER = { "x-bg-document": "0", host: "bluegenji.test" };

beforeEach(() => {
  mockHeaders = {};
});

describe("clientShowsSegment", () => {
  it("rafraîchissement de la page même : vrai, avec ou sans préfixe de langue, ancre et requête comprises", async () => {
    mockHeaders = { ...ROUTER, referer: "https://bluegenji.test/en/profil#notifications" };
    expect(await clientShowsSegment("/profil")).toBe(true);
    mockHeaders = { ...ROUTER, referer: "https://bluegenji.test/profil?x=1" };
    expect(await clientShowsSegment("/profil")).toBe(true);
  });

  it("d'un signalement à l'autre : vrai pour le segment", async () => {
    mockHeaders = { ...ROUTER, referer: "https://bluegenji.test/en/signalements/12" };
    expect(await clientShowsSegment("/signalements")).toBe(true);
  });

  it("arrivée par navigation depuis une autre page : faux", async () => {
    mockHeaders = { ...ROUTER, referer: "https://bluegenji.test/en/equipes" };
    expect(await clientShowsSegment("/profil")).toBe(false);
    // Un chemin qui commence pareil n'est pas le segment.
    mockHeaders = { ...ROUTER, referer: "https://bluegenji.test/en/profils" };
    expect(await clientShowsSegment("/profil")).toBe(false);
  });

  it("chargement complet, ou indice absent : faux (le dictionnaire part)", async () => {
    mockHeaders = { "x-bg-document": "1", host: "bluegenji.test", referer: "https://bluegenji.test/en/profil" };
    expect(await clientShowsSegment("/profil")).toBe(false);
    mockHeaders = { host: "bluegenji.test", referer: "https://bluegenji.test/en/profil" };
    expect(await clientShowsSegment("/profil")).toBe(false);
    mockHeaders = { ...ROUTER };
    expect(await clientShowsSegment("/profil")).toBe(false);
    mockHeaders = { ...ROUTER, referer: "pas une adresse" };
    expect(await clientShowsSegment("/profil")).toBe(false);
  });

  it("page d'origine d'un autre site : faux ; l'hôte public derrière le mandataire fait foi", async () => {
    mockHeaders = { ...ROUTER, referer: "https://evil.test/en/profil" };
    expect(await clientShowsSegment("/profil")).toBe(false);
    mockHeaders = { "x-bg-document": "0", host: "127.0.0.1:3000", "x-forwarded-host": "bluegenji.test", referer: "https://bluegenji.test/en/profil" };
    expect(await clientShowsSegment("/profil")).toBe(true);
  });
});
