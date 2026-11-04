/**
 * Polices Inter des images d'aperçu (`lib/server/share-card-fonts.ts`) : lues
 * sur le disque une fois par processus, `[]` plutôt qu'une erreur.
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resetShareCardFontsForTests,
  SHARE_CARD_FONT_DIR,
  SHARE_CARD_FONT_FILES,
  shareCardFonts,
  shareImageOptions,
} from "@/lib/server/share-card-fonts";

afterEach(() => {
  jest.restoreAllMocks();
  resetShareCardFontsForTests();
});

describe("shareCardFonts", () => {
  it("shareCardFonts_filesPresent_returnsInterRegularAndBold", async () => {
    const fonts = await shareCardFonts();
    expect(fonts).toHaveLength(SHARE_CARD_FONT_FILES.length);
    expect(new Set(fonts.map((font) => font.name))).toEqual(new Set(["Inter"]));
    expect(new Set(fonts.map((font) => font.weight))).toEqual(new Set([400, 700]));
  });

  it("shareCardFonts_embeddedFiles_areTrueTypeThatSatoriReads", () => {
    for (const { file } of SHARE_CARD_FONT_FILES) {
      const head = readFileSync(join(process.cwd(), SHARE_CARD_FONT_DIR, file)).subarray(0, 4);
      expect([...head]).toEqual([0, 1, 0, 0]);
    }
  });

  it("shareCardFonts_secondCall_returnsSamePromise", () => {
    expect(shareCardFonts()).toBe(shareCardFonts());
  });

  it("shareCardFonts_unreadableFile_returnsEmptyAndRetriesNextCall", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const spy = jest.spyOn(process, "cwd").mockReturnValue(join(process.cwd(), "inexistant"));
    await expect(shareCardFonts()).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    await expect(shareCardFonts()).resolves.toHaveLength(SHARE_CARD_FONT_FILES.length);
  });
});

describe("shareImageOptions", () => {
  it("shareImageOptions_baseWithHeaders_keepsBaseAndAddsFonts", async () => {
    const base = { width: 10, height: 5, headers: { "cache-control": "public, max-age=1" } };
    const options = await shareImageOptions(base);
    expect(options.width).toBe(10);
    expect(options.headers).toEqual(base.headers);
    expect(options.fonts).toHaveLength(SHARE_CARD_FONT_FILES.length);
  });
});
