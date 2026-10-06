import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PODIUM_CARD_CACHE_CONTROL,
  STATIC_CARD_CACHE_CONTROL,
  buildPageShareImage,
  renderPageShareImage,
} from "@/lib/server/page-share-image";
import { clearShareImageCache } from "@/lib/server/share-image-cache";
import { shareCardLogo } from "@/lib/server/share-card-logo";
import { loadSharePodium } from "@/lib/server/share-podium";
import { findShareTeam, loadShareTeam } from "@/lib/server/share-team";
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
      super("png", {
        headers: { "content-type": "image/png", ...(options as { headers?: Record<string, string> }).headers },
      });
    }
  },
}));
jest.mock("@/lib/server/share-podium");
jest.mock("@/lib/server/share-card-logo");
jest.mock("@/lib/server/share-team", () => ({
  TEAM_SHARE_LOGO_SIZE: 208,
  findShareTeam: jest.fn(),
  loadShareTeam: jest.fn(),
}));

const PODIUM = [
  { teamName: "Alpha", points: 1240, logoSrc: null },
  { teamName: "Bravo", points: 1180, logoSrc: null },
  { teamName: "Charlie", points: 1100, logoSrc: null },
];

async function render(key: string, locale: "fr" | "en" = "fr") {
  const image = (await buildPageShareImage(key, locale)) as unknown as FakeImageResponse | null;
  return image ? { image, html: renderToStaticMarkup(image.element) } : null;
}

beforeEach(() => {
  jest.mocked(loadSharePodium).mockReset().mockResolvedValue(PODIUM);
  jest.mocked(shareCardLogo).mockReset().mockResolvedValue(null);
  jest.mocked(loadShareTeam).mockReset().mockResolvedValue(null);
  jest.mocked(findShareTeam).mockReset().mockResolvedValue(null);
  clearShareImageCache();
});

describe("renderPageShareImage — coût d'un rendu", () => {
  const TEAM_ROW = { teamName: "Dragon Squad", logoUrl: null, wins: 1, losses: 0, draws: 0, points: 1000 };

  it("rend une carte fixe une fois, puis la ressert depuis la mémoire", async () => {
    const first = await renderPageShareImage("association", "fr");
    const second = await renderPageShareImage("association", "fr");
    expect(shareCardLogo).toHaveBeenCalledTimes(1);
    expect(second!.headers.get("content-type")).toBe("image/png");
    expect(second!.headers.get("cache-control")).toBe(STATIC_CARD_CACHE_CONTROL);
    expect(await second!.text()).toBe(await first!.text());
  });

  it("ne partage pas une carte entre les langues", async () => {
    await renderPageShareImage("association", "fr");
    await renderPageShareImage("association", "en");
    expect(shareCardLogo).toHaveBeenCalledTimes(2);
  });

  it("partage un seul rendu entre des robots simultanés", async () => {
    await Promise.all([1, 2, 3].map(() => renderPageShareImage("ranking", "fr")));
    expect(loadSharePodium).toHaveBeenCalledTimes(1);
  });

  it("sert à toute équipe hors classement la même carte générique, en cache court", async () => {
    const responses = await Promise.all([11, 12, 13].map((id) => renderPageShareImage(`team-${id}`, "fr")));
    expect(findShareTeam).toHaveBeenCalledTimes(3);
    expect(loadShareTeam).toHaveBeenCalledTimes(0);
    expect(shareCardLogo).toHaveBeenCalledTimes(1);
    for (const response of responses) expect(response!.headers.get("cache-control")).toBe(PODIUM_CARD_CACHE_CONTROL);
    // La carte générique de la page `team`, elle, garde sa durée d'un jour.
    expect((await renderPageShareImage("team", "fr"))!.headers.get("cache-control")).toBe(STATIC_CARD_CACHE_CONTROL);
  });

  it("rend une équipe classée une fois (logo compris) pour plusieurs robots", async () => {
    jest.mocked(findShareTeam).mockResolvedValue(TEAM_ROW);
    jest.mocked(loadShareTeam).mockResolvedValue({ ...TEAM_ROW, logoSrc: null });
    await Promise.all([1, 2, 3].map(() => renderPageShareImage("team-42", "fr")));
    await renderPageShareImage("team-42", "fr");
    expect(loadShareTeam).toHaveBeenCalledTimes(1);
  });

  it("ne garde pas un échec de rendu", async () => {
    jest.mocked(shareCardLogo).mockRejectedValueOnce(new Error("disque"));
    await expect(renderPageShareImage("association", "fr")).rejects.toThrow("disque");
    expect(await renderPageShareImage("association", "fr")).not.toBeNull();
  });
});

describe("carte nominative d'une équipe", () => {
  const TEAM = { teamName: "Dragon Squad", wins: 12, losses: 3, draws: 0, points: 1240, logoSrc: null };

  it("rend nom, cote et bilan, en cache court, sans lire le podium", async () => {
    jest.mocked(loadShareTeam).mockResolvedValue(TEAM);
    const result = await render("team-42");
    expect(loadShareTeam).toHaveBeenCalledWith(42);
    expect(loadSharePodium).not.toHaveBeenCalled();
    expect(result!.image.options.headers["cache-control"]).toBe(PODIUM_CARD_CACHE_CONTROL);
    for (const text of ["Dragon Squad", "1240 pts", "12 V · 3 D", "Cote", "Bilan", "Équipe"]) expect(result!.html).toContain(text);
    // Sans logo, l'initiale ; jamais le bouclier générique.
    expect(result!.html).toContain(">D<");
  });

  it("pose le logo du site à la place du motif", async () => {
    jest.mocked(loadShareTeam).mockResolvedValue({ ...TEAM, logoSrc: "data:image/png;base64,AAAA" });
    const result = await render("team-42");
    expect(result!.html).toContain('src="data:image/png;base64,AAAA"');
    expect(result!.html).toContain('width="208"');
  });

  it("écrit la carte en anglais sous /og/en", async () => {
    jest.mocked(loadShareTeam).mockResolvedValue(TEAM);
    const result = await render("team-42", "en");
    for (const text of ["Team", "Rating", "Record", "12 W · 3 L", "Nonprofit association"]) expect(result!.html).toContain(text);
  });

  it("retombe sur la carte générique (équipe absente, fantôme, solo, base injoignable), en cache court", async () => {
    const result = await render("team-42");
    expect(result!.html).toContain("Fiche d&#x27;équipe");
    expect(result!.html).not.toContain("Dragon Squad");
    expect(result!.image.options.headers["cache-control"]).toBe(PODIUM_CARD_CACHE_CONTROL);
  });

  it("ne lit rien pour une clé d'équipe malformée (404 par la route)", async () => {
    const response = await GET(new Request("http://localhost/og/fr/team-007.png"), {
      params: Promise.resolve({ locale: "fr", card: "team-007.png" }),
    });
    expect(response.status).toBe(404);
    expect(loadShareTeam).not.toHaveBeenCalled();
  });
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
    expect(mode!.html).toContain("Nonprofit association");
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
    expect(await buildPageShareImage("nope", "fr")).toBeNull();
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
