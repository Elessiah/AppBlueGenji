import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import manifest from "@/app/manifest";
import { config as middlewareConfig } from "@/middleware";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/shared/share-metadata";
import {
  APP_BACKGROUND_COLOR,
  APP_ICONS,
  APP_SHORTCUTS,
  APP_SHORT_NAME,
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

  it("s'installe en application autonome couvrant tout le site", () => {
    expect(webManifest.display).toBe("standalone");
    expect(webManifest.start_url).toBe("/");
    expect(webManifest.scope).toBe("/");
    expect(webManifest.id).toBe("/");
  });

  it("prend la couleur du fond du site, telle que la déclare `globals.css`", () => {
    const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    const cyberBg = /--cyber-bg:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    expect(cyberBg?.toLowerCase()).toBe(APP_BACKGROUND_COLOR);
    expect(webManifest.background_color).toBe(APP_BACKGROUND_COLOR);
    expect(webManifest.theme_color).toBe(APP_BACKGROUND_COLOR);
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
    const source = middlewareConfig.matcher[0].source;
    const matches = new RegExp(`^${source}$`).test("/manifest.webmanifest");
    expect(matches).toBe(false);
    // Témoin : une page ordinaire passe toujours par le middleware.
    expect(new RegExp(`^${source}$`).test("/tournois")).toBe(true);
  });
});
