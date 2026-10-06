import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PODIUM_CARD_CACHE_CONTROL,
  STATIC_CARD_CACHE_CONTROL,
  renderPageShareImage,
} from "@/lib/server/page-share-image";
import { shareCardLogo } from "@/lib/server/share-card-logo";
import { loadSharePodium } from "@/lib/server/share-podium";
import { GET } from "@/app/og/[locale]/[card]/route";

/**
 * Route `/og/<langue>/<clé>.png` et son rendu (`docs/features/SHARE_METADATA.md`
 * § « Une carte par page »). `ImageResponse` est remplacée par un double qui
 * garde l'arbre et les options : Satori (WebAssembly) ne tourne pas sous Jest ;
 * le PNG 1200×630 est vérifié au rendu sur `next dev`.
 */

type FakeImageResponse = Response & {
  element: ReactElement;
  options: { width: number; height: number; headers: Record<string, string> };
};

jest.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(
      readonly element: unknown,
      readonly options: unknown,
    ) {
      super("png", { headers: { "content-type": "image/png" } });
    }
  },
}));
jest.mock("@/lib/server/share-podium");
jest.mock("@/lib/server/share-card-logo");

const PODIUM = [
  { teamName: "Alpha", points: 1240, logoSrc: null },
  { teamName: "Bravo", points: 1180, logoSrc: null },
  { teamName: "Charlie", points: 1100, logoSrc: null },
];

async function render(key: string, locale: "fr" | "en" = "fr") {
  const image = (await renderPageShareImage(key, locale)) as unknown as FakeImageResponse | null;
  return image ? { image, html: renderToStaticMarkup(image.element) } : null;
}

beforeEach(() => {
  jest.mocked(loadSharePodium).mockReset().mockResolvedValue(PODIUM);
  jest.mocked(shareCardLogo).mockReset().mockResolvedValue(null);
});

describe("renderPageShareImage", () => {
  it("rend une carte 1200×630 en cache d'un jour pour une page fixe", async () => {
    const result = await render("association");
    expect(result!.image.options).toMatchObject({ width: 1200, height: 630 });
    expect(result!.image.options.headers["cache-control"]).toBe(STATIC_CARD_CACHE_CONTROL);
    expect(result!.html).toContain("Une association par et pour les joueurs");
    expect(result!.html).toContain("<svg");
    expect(loadSharePodium).not.toHaveBeenCalled();
  });

  it("rend le podium du classement, en cache court", async () => {
    const result = await render("ranking");
    expect(loadSharePodium).toHaveBeenCalledTimes(1);
    expect(result!.image.options.headers["cache-control"]).toBe(PODIUM_CARD_CACHE_CONTROL);
    for (const text of ["Alpha", "Bravo", "Charlie", "1240 pts", "Le podium BlueGenji"]) expect(result!.html).toContain(text);
  });

  it("retombe sur la carte du classement sous trois équipes, toujours en cache court", async () => {
    jest.mocked(loadSharePodium).mockResolvedValue(PODIUM.slice(0, 2));
    const result = await render("ranking");
    expect(result!.html).toContain("Classement des équipes");
    expect(result!.html).not.toContain("Alpha");
    expect(result!.image.options.headers["cache-control"]).toBe(PODIUM_CARD_CACHE_CONTROL);
  });

  it("écrit la carte en anglais sous /en", async () => {
    const ranking = await render("ranking", "en");
    expect(ranking!.html).toContain("The BlueGenji podium");
    expect(ranking!.html).toContain("1st");
    const mode = await render("rules-bluegenji-survie", "en");
    expect(mode!.html).toContain("BlueGenji&#x27;s Survival");
    expect(mode!.html).toContain("French nonprofit (law of 1901)");
  });

  it.each(["team", "player", "teams", "players", "tournaments"])(
    "la carte %s de l'espace membre ne lit aucune donnée",
    async (key) => {
      const result = await render(key);
      expect(result!.html).toContain("BLUEGENJI");
      expect(loadSharePodium).not.toHaveBeenCalled();
      expect(result!.html).not.toContain("Alpha");
    },
  );

  it("rend null pour une clé inconnue", async () => {
    expect(await renderPageShareImage("nope", "fr")).toBeNull();
  });
});

describe("GET /og/[locale]/[card]", () => {
  const call = (locale: string, card: string) =>
    GET(new Request(`http://localhost/og/${locale}/${card}`), { params: Promise.resolve({ locale, card }) });

  it("sert l'image d'une carte connue", async () => {
    const response = await call("en", "rules.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it.each([
    ["de", "rules.png"],
    ["fr", "rules"],
    ["fr", "inconnue.png"],
  ])("répond 404 à /og/%s/%s", async (locale, card) => {
    expect((await call(locale, card)).status).toBe(404);
  });
});
