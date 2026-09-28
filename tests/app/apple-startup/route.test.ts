import { describe, expect, it } from "@jest/globals";
import sharp from "sharp";
import { dynamic, dynamicParams, generateStaticParams, GET } from "@/app/apple-startup/[file]/route";
import { renderAppleStartupImage } from "@/lib/server/apple-startup-image";
import { appleStartupImageFiles, appleStartupLogoSize } from "@/lib/shared/apple-startup-images";
import { APP_BACKGROUND_COLOR } from "@/lib/shared/web-manifest";

/** Rendu réel par sharp : c'est l'image même qu'iOS affichera. */

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

async function pixel(buffer: Buffer, x: number, y: number): Promise<string> {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return hex(data[offset], data[offset + 1], data[offset + 2]);
}

describe("renderAppleStartupImage", () => {
  it("rend un PNG opaque aux dimensions demandées", async () => {
    const buffer = await renderAppleStartupImage(750, 1334);
    const meta = await sharp(buffer).metadata();
    expect(meta).toMatchObject({ format: "png", width: 750, height: 1334, hasAlpha: false });
  });

  it("peint le fond du site dans les coins", async () => {
    const buffer = await renderAppleStartupImage(1334, 750);
    expect(await pixel(buffer, 0, 0)).toBe(APP_BACKGROUND_COLOR);
    expect(await pixel(buffer, 1333, 749)).toBe(APP_BACKGROUND_COLOR);
  });

  it("pose le logo au centre, et nulle part hors de son carré", async () => {
    const width = 750;
    const height = 1334;
    const buffer = await renderAppleStartupImage(width, height);
    const side = appleStartupLogoSize(width, height);
    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    let inside = 0;
    let outside = 0;
    const left = Math.floor((width - side) / 2);
    const top = Math.floor((height - side) / 2);
    for (let y = 0; y < height; y += 3) {
      for (let x = 0; x < width; x += 3) {
        const offset = (y * info.width + x) * info.channels;
        if (hex(data[offset], data[offset + 1], data[offset + 2]) === APP_BACKGROUND_COLOR) continue;
        const inSquare = x >= left - 1 && x <= left + side && y >= top - 1 && y <= top + side;
        if (inSquare) inside += 1;
        else outside += 1;
      }
    }
    expect(inside).toBeGreaterThan(0);
    expect(outside).toBe(0);
  });
});

describe("app/apple-startup/[file]", () => {
  it("se rend à la compilation, et seulement pour les fichiers de la liste", () => {
    expect(dynamic).toBe("force-static");
    expect(dynamicParams).toBe(false);
    expect(generateStaticParams()).toEqual(appleStartupImageFiles().map((file) => ({ file })));
  });

  it("sert l'image d'un fichier de la liste", async () => {
    const response = await GET(new Request("http://localhost/apple-startup/750x1334.png"), {
      params: Promise.resolve({ file: "750x1334.png" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    expect(meta).toMatchObject({ width: 750, height: 1334 });
  });

  it("refuse en 404 une taille absente de la liste", async () => {
    const response = await GET(new Request("http://localhost/apple-startup/4000x4000.png"), {
      params: Promise.resolve({ file: "4000x4000.png" }),
    });
    expect(response.status).toBe(404);
  });
});
