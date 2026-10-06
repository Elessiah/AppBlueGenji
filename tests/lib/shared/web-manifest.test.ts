import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import manifest from "@/app/manifest";
import { config as middlewareConfig } from "@/middleware";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/shared/share-metadata";
import {
  APP_BACKGROUND_COLOR,
  APP_ICONS,
  APP_SCREENSHOTS,
  APP_SHORTCUTS,
  APP_SHORT_NAME,
  APP_THEME_COLOR,
  buildWebManifest,
} from "@/lib/shared/web-manifest";

/**
 * Le manifeste ne casse jamais bruyamment : une icône absente, une couleur qui
 * dérive du fond ou un raccourci vers une page renommée donnent seulement une
 * installation plus laide ou un lien mort. Ce sont ces pannes-là qui sont
 * tenues ici, pas la forme de l'objet.
 */

const ROOT = path.resolve(__dirname, "../../..");

/** Largeur et hauteur lues dans l'en-tête IHDR d'un PNG. */
function pngSize(file: string): { width: number; height: number } {
  const buffer = readFileSync(file);
  expect(buffer.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe("buildWebManifest", () => {
  const webManifest = buildWebManifest();

  it("nomme le site et le décrit comme les métadonnées de partage", () => {
    expect(webManifest.name).toBe(SITE_NAME);
    expect(webManifest.short_name).toBe(APP_SHORT_NAME);
    expect(webManifest.description).toBe(SITE_DESCRIPTION);
    expect(webManifest.lang).toBe("fr");
  });

  it("s'installe sans mode autonome, où iOS perdrait la session OAuth", () => {
    expect(webManifest.display).toBe("minimal-ui");
    expect(webManifest.start_url).toBe("/");
    expect(webManifest.scope).toBe("/");
    expect(webManifest.id).toBe("/");
  });

  it("prend la couleur du fond du site, telle que la déclare `globals.css`", () => {
    const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    const cyberBg = /--cyber-bg:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    expect(cyberBg?.toLowerCase()).toBe(APP_BACKGROUND_COLOR);
    expect(webManifest.background_color).toBe(APP_BACKGROUND_COLOR);
  });

  it("prend le néon `--cyan-400` pour couleur de thème, dans le manifeste et la page", () => {
    const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    const cyan = /--cyan-400:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    expect(APP_THEME_COLOR).toBe("#3ee6ff");
    expect(cyan?.toLowerCase()).toBe(APP_THEME_COLOR);
    expect(webManifest.theme_color).toBe(APP_THEME_COLOR);
    expect(APP_THEME_COLOR).not.toBe(APP_BACKGROUND_COLOR);
    const layout = readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");
    expect(layout).toMatch(/themeColor:\s*APP_THEME_COLOR/);
  });

  it("déclare les icônes qu'exigent Chrome et Android : 192, 512 et une masquable", () => {
    const icons = webManifest.icons ?? [];
    expect(icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "any")).toBe(true);
    expect(icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "any")).toBe(true);
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("ne mêle jamais les deux usages dans une même icône", () => {
    for (const icon of APP_ICONS) expect(["any", "maskable"]).toContain(icon.purpose);
  });

  it.each(APP_ICONS.map((icon) => [icon.src, icon.sizes] as [string, string]))(
    "%s existe et mesure bien %s",
    (src, sizes) => {
      const file = path.join(ROOT, "public", src);
      expect(existsSync(file)).toBe(true);
      const { width, height } = pngSize(file);
      expect(`${width}x${height}`).toBe(sizes);
    },
  );

  it("déclare une capture large et une étroite, sans quoi Chrome n'offre que l'invite minimale", () => {
    const factors = (webManifest.screenshots ?? []).map((screenshot) => screenshot.form_factor);
    expect(factors).toContain("wide");
    expect(factors).toContain("narrow");
    for (const screenshot of webManifest.screenshots ?? []) expect(screenshot.label).toBeTruthy();
  });

  it.each(APP_SCREENSHOTS.map((screenshot) => [screenshot.src, screenshot.sizes, screenshot.form_factor] as [string, string, string]))(
    "%s existe, mesure bien %s et a la forme d'une capture %s",
    async (src, sizes, formFactor) => {
      const file = path.join(ROOT, "public", src);
      expect(existsSync(file)).toBe(true);
      const { width, height, format } = await sharp(file).metadata();
      expect(format).toBe("webp");
      expect(`${width}x${height}`).toBe(sizes);
      // Bornes de Chrome : côtés entre 320 et 3840 px, rapport au plus 2,3.
      const long = Math.max(width!, height!);
      const short = Math.min(width!, height!);
      expect(short).toBeGreaterThanOrEqual(320);
      expect(long).toBeLessThanOrEqual(3840);
      expect(long / short).toBeLessThanOrEqual(2.3);
      // Une capture large est en paysage, une étroite en portrait.
      expect(width! > height!).toBe(formFactor === "wide");
    },
  );

  it.each(APP_SHORTCUTS.map((shortcut) => [shortcut.url] as [string]))(
    "le raccourci %s mène à une page qui existe",
    (url) => {
      const page = path.join(ROOT, "app/(secured)", url, "page.tsx");
      expect(existsSync(page)).toBe(true);
    },
  );

  it("donne une icône à chaque raccourci, sans quoi Android le masque", () => {
    for (const shortcut of webManifest.shortcuts ?? []) {
      expect(shortcut.icons?.length).toBeGreaterThan(0);
    }
  });

  it("rend un objet neuf à chaque appel : la route ne partage rien avec les constantes", () => {
    const first = buildWebManifest();
    first.icons?.push({ src: "/x.png" });
    expect(buildWebManifest().icons).toHaveLength(APP_ICONS.length);
  });
});

describe("app/manifest", () => {
  it("sert le manifeste du module pur", () => {
    expect(manifest()).toEqual(buildWebManifest());
  });
});

describe("middleware", () => {
  it("ne pose pas de politique de sécurité sur le manifeste, fichier statique", () => {
    // La première entrée couvre les pages ; la seconde, `/api/`, n'a rien à
    // voir avec un fichier statique.
    const source = (middlewareConfig.matcher[0] as { source: string }).source;

    const matches = new RegExp(`^${source}$`).test("/manifest.webmanifest");
    expect(matches).toBe(false);
    // Témoin : une page ordinaire passe toujours par le middleware.
    expect(new RegExp(`^${source}$`).test("/tournois")).toBe(true);
  });
});
