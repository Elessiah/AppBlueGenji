/**
 * Logo de l'image d'aperçu (`lib/server/share-card-logo.ts`) : lu sur le
 * disque une fois par processus, `null` plutôt qu'une erreur quand il manque.
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resetShareCardLogoForTests,
  shareCardLogo,
  SHARE_CARD_LOGO_PATH,
} from "@/lib/server/share-card-logo";

afterEach(() => {
  jest.restoreAllMocks();
  resetShareCardLogoForTests();
});

describe("shareCardLogo", () => {
  it("rend le PNG du manifeste en URL data:", async () => {
    const expected = readFileSync(join(process.cwd(), SHARE_CARD_LOGO_PATH)).toString("base64");
    await expect(shareCardLogo()).resolves.toBe(`data:image/png;base64,${expected}`);
  });

  it("vise un PNG, que Satori sait décoder (pas le WebP de la vitrine)", () => {
    expect(SHARE_CARD_LOGO_PATH.endsWith(".png")).toBe(true);
  });

  it("mémorise la lecture : un second appel rend la même promesse", () => {
    expect(shareCardLogo()).toBe(shareCardLogo());
  });

  it("rend null quand le fichier manque, sans lever, et le journalise", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(process, "cwd").mockReturnValue(join(process.cwd(), "dossier-qui-n-existe-pas"));
    await expect(shareCardLogo()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith("[share-card] logo illisible (ENOENT) : carte sans logo");
  });

  it("ne mémorise pas un échec : le rendu suivant relit le fichier", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const realRoot = process.cwd();
    const cwd = jest.spyOn(process, "cwd").mockReturnValue(join(realRoot, "dossier-qui-n-existe-pas"));
    await expect(shareCardLogo()).resolves.toBeNull();
    cwd.mockReturnValue(realRoot);
    await expect(shareCardLogo()).resolves.toMatch(/^data:image\/png;base64,/);
  });
});
