import { describe, expect, it } from "@jest/globals";
import {
  APPLE_SCREENS,
  APPLE_STARTUP_IMAGE_PATH,
  APPLE_STARTUP_LOGO_RATIO,
  appleStartupImageFiles,
  appleStartupImageLinks,
  appleStartupImages,
  appleStartupLogoSize,
  parseAppleStartupImageFile,
} from "@/lib/shared/apple-startup-images";

/**
 * iOS ne redimensionne pas un écran de lancement : il prend l'image dont le
 * `media` correspond exactement à l'appareil, et sinon affiche du blanc. Une
 * dimension fausse ou un `media` mal écrit ne casse donc rien de visible dans
 * un test d'interface — c'est ici qu'on le tient.
 */

describe("appleStartupImages", () => {
  const images = appleStartupImages();

  it("donne deux images par écran, portrait puis paysage", () => {
    expect(images).toHaveLength(APPLE_SCREENS.length * 2);
    APPLE_SCREENS.forEach((screen, index) => {
      expect(images[index * 2].media).toContain("(orientation: portrait)");
      expect(images[index * 2 + 1].media).toContain("(orientation: landscape)");
    });
  });

  it("dimensionne chaque image en pixels physiques de l'écran visé", () => {
    const iPhone15 = images.filter((image) => image.media.includes("(device-width: 393px)"));
    expect(iPhone15.map((image) => image.file)).toEqual(["1179x2556.png", "2556x1179.png"]);
    expect(iPhone15[0]).toMatchObject({ width: 1179, height: 2556 });
    expect(iPhone15[1]).toMatchObject({ width: 2556, height: 1179 });
  });

  it("garde les dimensions du portrait dans le media du paysage : seule l'orientation départage", () => {
    const landscape = images.find((image) => image.file === "2556x1179.png");
    expect(landscape?.media).toBe(
      "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)",
    );
  });

  it("distingue deux écrans de même taille par leur densité", () => {
    const xr = images.find((image) => image.file === "828x1792.png");
    const xsMax = images.find((image) => image.file === "1242x2688.png");
    expect(xr?.media).toContain("(-webkit-device-pixel-ratio: 2)");
    expect(xsMax?.media).toContain("(-webkit-device-pixel-ratio: 3)");
  });

  it("n'a jamais deux media identiques, iOS n'en retiendrait qu'un", () => {
    const media = images.map((image) => image.media);
    expect(new Set(media).size).toBe(media.length);
  });

  it("déclare chaque écran en portrait (largeur < hauteur)", () => {
    for (const screen of APPLE_SCREENS) expect(screen.width).toBeLessThan(screen.height);
  });

  it("couvre l'iPhone SE, le plus grand iPhone et le plus grand iPad", () => {
    const files = appleStartupImageFiles();
    expect(files).toContain("750x1334.png");
    expect(files).toContain("1320x2868.png");
    expect(files).toContain("2064x2752.png");
  });
});

describe("appleStartupImageFiles", () => {
  it("ne rend chaque fichier qu'une fois", () => {
    const files = appleStartupImageFiles();
    expect(new Set(files).size).toBe(files.length);
  });
});

describe("appleStartupImageLinks", () => {
  it("désigne la route des images, un lien par image", () => {
    const links = appleStartupImageLinks();
    expect(links).toHaveLength(appleStartupImages().length);
    for (const link of links) expect(link.url).toMatch(new RegExp(`^${APPLE_STARTUP_IMAGE_PATH}/\\d+x\\d+\\.png$`));
  });

  it("finit en .png, ce qui tient la route hors du middleware", () => {
    for (const link of appleStartupImageLinks()) expect(link.url.endsWith(".png")).toBe(true);
  });
});

describe("parseAppleStartupImageFile", () => {
  it("rend les dimensions d'un fichier de la liste", () => {
    expect(parseAppleStartupImageFile("1179x2556.png")).toEqual({ width: 1179, height: 2556 });
  });

  it.each(["1x1.png", "100000x100000.png", "1179x2556.webp", "1179x2556", "../1179x2556.png", ""])(
    "refuse %p, absent de la liste",
    (file) => {
      expect(parseAppleStartupImageFile(file)).toBeNull();
    },
  );
});

describe("appleStartupLogoSize", () => {
  it("prend une fraction du plus petit côté, quelle que soit l'orientation", () => {
    expect(appleStartupLogoSize(1000, 2000)).toBe(1000 * APPLE_STARTUP_LOGO_RATIO);
    expect(appleStartupLogoSize(2000, 1000)).toBe(1000 * APPLE_STARTUP_LOGO_RATIO);
  });

  it("rend un entier", () => {
    expect(Number.isInteger(appleStartupLogoSize(1179, 2556))).toBe(true);
  });
});
