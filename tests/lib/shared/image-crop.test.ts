import { describe, expect, it } from "@jest/globals";
import {
  IMAGE_CROP_ASPECTS,
  IMAGE_CROP_ROUND,
  IMAGE_UPLOAD_KINDS,
  cropBoxFromKey,
  cropBoxToRect,
  cropRectToRegion,
  cropToSend,
  defaultCropBox,
  isFullCrop,
  minCropSize,
  moveCropBox,
  parseImageCropField,
  resizeCropBox,
  scaleCropBox,
  serializeCropRect,
  type CropBox,
} from "@/lib/shared/image-crop";

/**
 * Géométrie du recadrage manuel : partagée par la modale (déplacements,
 * redimensionnement, clavier) et par le serveur (lecture du champ, conversion
 * en pixels). Les invariants tenus ici sont ceux que l'écran ne peut pas
 * montrer faux : le cadre ne sort jamais de l'image, garde ses proportions
 * quand le gabarit en impose, et le cadre proposé est ce que le serveur
 * appliquait seul.
 */

const landscape = { width: 1000, height: 500 };
const portrait = { width: 400, height: 800 };

function inside(box: CropBox, size: { width: number; height: number }) {
  const eps = 1e-9;
  expect(box.x).toBeGreaterThanOrEqual(-eps);
  expect(box.y).toBeGreaterThanOrEqual(-eps);
  expect(box.x + box.width).toBeLessThanOrEqual(size.width + eps);
  expect(box.y + box.height).toBeLessThanOrEqual(size.height + eps);
}

describe("registre des gabarits", () => {
  it("donne des proportions et une forme à chaque gabarit", () => {
    for (const kind of IMAGE_UPLOAD_KINDS) {
      expect(kind in IMAGE_CROP_ASPECTS).toBe(true);
      expect(kind in IMAGE_CROP_ROUND).toBe(true);
    }
  });

  it("impose les proportions là où le serveur recadre, les laisse libres là où il contient", () => {
    expect(IMAGE_CROP_ASPECTS.avatar).toBe(1);
    expect(IMAGE_CROP_ASPECTS["benevole-photo"]).toBe(1);
    expect(IMAGE_CROP_ASPECTS["sponsor-banner"]).toBe(3);
    expect(IMAGE_CROP_ASPECTS["team-logo"]).toBeNull();
    expect(IMAGE_CROP_ASPECTS["sponsor-logo"]).toBeNull();
    expect(IMAGE_CROP_ASPECTS["tournament-image"]).toBeNull();
  });
});

describe("defaultCropBox — le cadre proposé est celui du gabarit", () => {
  it("prend l'image entière quand les proportions sont libres", () => {
    expect(defaultCropBox(landscape, null)).toEqual({ x: 0, y: 0, width: 1000, height: 500 });
  });

  it("centre le plus grand carré d'un paysage (le « cover » centré du serveur)", () => {
    expect(defaultCropBox(landscape, 1)).toEqual({ x: 250, y: 0, width: 500, height: 500 });
  });

  it("centre le plus grand carré d'un portrait", () => {
    expect(defaultCropBox(portrait, 1)).toEqual({ x: 0, y: 200, width: 400, height: 400 });
  });

  it("taille un 3:1 dans une image carrée", () => {
    expect(defaultCropBox({ width: 900, height: 900 }, 3)).toEqual({ x: 0, y: 300, width: 900, height: 300 });
  });

  it("ne produit aucun recadrage à envoyer pour une image entière", () => {
    expect(cropToSend(defaultCropBox(landscape, null), landscape)).toBeNull();
  });
});

describe("moveCropBox", () => {
  const box = { x: 100, y: 100, width: 200, height: 200 };

  it("déplace le cadre", () => {
    expect(moveCropBox(box, 50, -20, landscape)).toEqual({ x: 150, y: 80, width: 200, height: 200 });
  });

  it("bute contre les bords sans se déformer", () => {
    expect(moveCropBox(box, -500, 9999, landscape)).toEqual({ x: 0, y: 300, width: 200, height: 200 });
  });
});

describe("resizeCropBox", () => {
  const box = { x: 200, y: 100, width: 200, height: 200 };

  it("tire le coin bas droit, le coin haut gauche reste en place (libre)", () => {
    expect(resizeCropBox(box, "se", 100, 50, landscape, null)).toEqual({ x: 200, y: 100, width: 300, height: 250 });
  });

  it("tire le coin haut gauche, le coin bas droit reste en place (libre)", () => {
    const next = resizeCropBox(box, "nw", -50, -50, landscape, null);
    expect(next).toEqual({ x: 150, y: 50, width: 250, height: 250 });
    expect(next.x + next.width).toBe(box.x + box.width);
  });

  it("garde les proportions imposées", () => {
    const next = resizeCropBox(box, "se", 120, 10, landscape, 1);
    expect(next.width).toBeCloseTo(next.height);
    expect(next.width).toBe(320);
  });

  it("laisse rétrécir en tirant sur un seul axe, proportions imposées", () => {
    const next = resizeCropBox(box, "se", -80, 0, landscape, 1);
    expect(next.width).toBe(120);
    expect(next.height).toBe(120);
  });

  it("ne sort jamais de l'image", () => {
    for (const handle of ["nw", "ne", "sw", "se"] as const) {
      for (const aspect of [null, 1, 3]) {
        inside(resizeCropBox(box, handle, 5000, 5000, landscape, aspect), landscape);
        inside(resizeCropBox(box, handle, -5000, -5000, landscape, aspect), landscape);
      }
    }
  });

  it("ne se retourne pas et ne descend pas sous la taille minimale", () => {
    const next = resizeCropBox(box, "se", -1000, -1000, landscape, null);
    expect(next.width).toBe(minCropSize(landscape));
    expect(next.height).toBe(minCropSize(landscape));
    expect(next.x).toBe(box.x);
  });

  it("borne la taille minimale par l'image elle-même", () => {
    expect(minCropSize({ width: 10, height: 30 })).toBe(10);
    expect(minCropSize({ width: 3000, height: 3000 })).toBe(24);
  });
});

describe("scaleCropBox", () => {
  it("agrandit autour du centre, proportions gardées", () => {
    const box = { x: 400, y: 150, width: 200, height: 200 };
    const next = scaleCropBox(box, 1.5, landscape, 1);
    expect(next.width).toBe(300);
    expect(next.x + next.width / 2).toBe(500);
  });

  it("ne dépasse pas la plus grande taille qui tient dans l'image", () => {
    const next = scaleCropBox({ x: 400, y: 150, width: 200, height: 200 }, 10, landscape, 1);
    expect(next).toEqual({ x: 250, y: 0, width: 500, height: 500 });
  });

  it("glisse contre un bord plutôt que d'en sortir", () => {
    inside(scaleCropBox({ x: 0, y: 0, width: 200, height: 100 }, 2, landscape, null), landscape);
  });

  it("garde les proportions courantes d'un cadre libre", () => {
    const next = scaleCropBox({ x: 100, y: 100, width: 300, height: 100 }, 1.2, landscape, null);
    expect(next.width / next.height).toBeCloseTo(3);
  });
});

describe("cropBoxFromKey", () => {
  const box = { x: 400, y: 150, width: 200, height: 200 };

  it("déplace de 1 % de l'image aux flèches, 10 % avec Maj", () => {
    expect(cropBoxFromKey(box, "ArrowRight", false, landscape, 1)?.x).toBe(410);
    expect(cropBoxFromKey(box, "ArrowDown", true, landscape, 1)?.y).toBe(200);
  });

  it("agrandit et réduit avec + et -", () => {
    expect(cropBoxFromKey(box, "+", false, landscape, 1)!.width).toBeGreaterThan(200);
    expect(cropBoxFromKey(box, "-", false, landscape, 1)!.width).toBeLessThan(200);
  });

  it("revient au cadre proposé avec Origine", () => {
    expect(cropBoxFromKey(box, "Home", false, landscape, 1)).toEqual(defaultCropBox(landscape, 1));
  });

  it("ignore les autres touches", () => {
    expect(cropBoxFromKey(box, "Enter", false, landscape, 1)).toBeNull();
    expect(cropBoxFromKey(box, "a", false, landscape, 1)).toBeNull();
  });
});

describe("cropBoxToRect / isFullCrop", () => {
  it("convertit en fractions de l'image", () => {
    expect(cropBoxToRect({ x: 250, y: 0, width: 500, height: 500 }, landscape)).toEqual({
      x: 0.25,
      y: 0,
      width: 0.5,
      height: 1,
    });
  });

  it("ne rend jamais un rectangle hors de l'image", () => {
    const rect = cropBoxToRect({ x: 900, y: -10, width: 500, height: 900 }, landscape);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1);
    expect(rect.y).toBe(0);
    expect(rect.y + rect.height).toBeLessThanOrEqual(1);
  });

  it("reconnaît l'image entière, à l'arrondi près", () => {
    expect(isFullCrop({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(isFullCrop({ x: 0, y: 0, width: 0.9999999, height: 1 })).toBe(true);
    expect(isFullCrop({ x: 0.1, y: 0, width: 0.9, height: 1 })).toBe(false);
  });
});

describe("parseImageCropField — le rectangle vient du navigateur", () => {
  it("rend null sans champ : le gabarit s'applique seul", () => {
    expect(parseImageCropField(null)).toEqual({ ok: true, crop: null });
    expect(parseImageCropField(undefined)).toEqual({ ok: true, crop: null });
    expect(parseImageCropField("")).toEqual({ ok: true, crop: null });
  });

  it("relit ce que la modale sérialise", () => {
    const rect = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };
    expect(parseImageCropField(serializeCropRect(rect))).toEqual({ ok: true, crop: rect });
  });

  it.each<[string, unknown]>([
    ["un fichier au lieu d'un texte", new Blob(["x"])],
    ["du JSON illisible", "{x:"],
    ["un tableau", "[0,0,1,1]"],
    ["null sérialisé", "null"],
    ["un champ manquant", JSON.stringify({ x: 0, y: 0, width: 1 })],
    ["une chaîne au lieu d'un nombre", JSON.stringify({ x: "0", y: 0, width: 1, height: 1 })],
    ["une origine négative", JSON.stringify({ x: -0.1, y: 0, width: 0.5, height: 0.5 })],
    ["une surface nulle", JSON.stringify({ x: 0, y: 0, width: 0, height: 0.5 })],
    ["un débord à droite", JSON.stringify({ x: 0.6, y: 0, width: 0.5, height: 0.5 })],
    ["un débord en bas", JSON.stringify({ x: 0, y: 0.6, width: 0.5, height: 0.5 })],
    ["un champ démesuré", `{"x":0,"y":0,"width":1,"height":1,"pad":"${"a".repeat(300)}"}`],
  ])("refuse %s", (_label, raw) => {
    expect(parseImageCropField(raw)).toEqual({ ok: false });
  });

  it("tolère l'arrondi d'un rectangle calé sur le bord", () => {
    expect(parseImageCropField(JSON.stringify({ x: 0.333333, y: 0, width: 0.666668, height: 1 })).ok).toBe(true);
  });
});

describe("cropRectToRegion — pixels entiers pour sharp", () => {
  it("convertit en pixels de l'image orientée", () => {
    expect(cropRectToRegion({ x: 0.25, y: 0, width: 0.5, height: 1 }, landscape)).toEqual({
      left: 250,
      top: 0,
      width: 500,
      height: 500,
    });
  });

  it("arrondit vers l'extérieur et reste dans l'image", () => {
    const region = cropRectToRegion({ x: 0.3333, y: 0.1111, width: 0.6667, height: 0.8889 }, { width: 7, height: 9 });
    expect(region.left + region.width).toBeLessThanOrEqual(7);
    expect(region.top + region.height).toBeLessThanOrEqual(9);
    expect(region).toEqual({ left: 2, top: 0, width: 5, height: 9 });
  });

  it("ne s'effondre jamais sous un pixel", () => {
    const region = cropRectToRegion({ x: 0.999999, y: 0.999999, width: 0.000001, height: 0.000001 }, landscape);
    expect(region.width).toBeGreaterThanOrEqual(1);
    expect(region.height).toBeGreaterThanOrEqual(1);
    expect(region.left + region.width).toBeLessThanOrEqual(1000);
  });
});
