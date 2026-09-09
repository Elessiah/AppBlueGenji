import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { getContactInfo, setContactInfo, DEFAULT_CONTACT } from "@/lib/server/contact-service";
import {
  CONTACT_EMAIL_KEY,
  CONTACT_DISCORD_TAG_KEY,
  CONTACT_DISCORD_URL_KEY,
} from "@/lib/shared/contact";
import { clearCache } from "@/lib/server/cache";

jest.mock("@/lib/server/database");

async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
}

describe("contact-service", () => {
  // La lecture est mutualisée (`showcase-cache`) : sans cette remise à zéro, le
  // premier cas resservirait sa réponse à tous les suivants.
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });
  afterEach(() => {
    clearCache();
    jest.restoreAllMocks();
  });

  describe("getContactInfo", () => {
    it("falls back to defaults when no row is configured", async () => {
      await mockDb(jest.fn().mockResolvedValue([[]]));
      expect(await getContactInfo()).toEqual(DEFAULT_CONTACT);
    });

    it("respects an explicitly emptied channel instead of reverting to default", async () => {
      // Email présent mais vidé, lien Discord absent → l'email reste vide,
      // le lien retombe sur le défaut.
      await mockDb(
        jest.fn().mockResolvedValue([
          [{ setting_key: CONTACT_EMAIL_KEY, setting_value: "" }],
        ]),
      );
      const info = await getContactInfo();
      expect(info.email).toBe("");
      expect(info.discordUrl).toBe(DEFAULT_CONTACT.discordUrl);
    });

    it("returns stored values, trimmed", async () => {
      await mockDb(
        jest.fn().mockResolvedValue([
          [
            { setting_key: CONTACT_EMAIL_KEY, setting_value: "  a@bg.fr " },
            { setting_key: CONTACT_DISCORD_TAG_KEY, setting_value: "bluegenji" },
            { setting_key: CONTACT_DISCORD_URL_KEY, setting_value: "https://discord.gg/x" },
          ],
        ]),
      );
      expect(await getContactInfo()).toEqual({
        email: "a@bg.fr",
        discordTag: "bluegenji",
        discordUrl: "https://discord.gg/x",
      });
    });

    it("returns the full default set when the database is unreachable", async () => {
      const { getDatabase } = await import("@/lib/server/database");
      (getDatabase as jest.Mock).mockRejectedValue(new Error("down"));
      expect(await getContactInfo()).toEqual(DEFAULT_CONTACT);
    });
  });

  describe("setContactInfo", () => {
    it("validates then upserts the three channels", async () => {
      const execute = jest.fn().mockResolvedValue([{}]);
      await mockDb(execute);

      const result = await setContactInfo({
        email: "  A@BG.FR ",
        discordTag: " tag ",
        discordUrl: "https://discord.gg/x",
      });

      expect(result).toEqual({ email: "a@bg.fr", discordTag: "tag", discordUrl: "https://discord.gg/x" });
      const params = execute.mock.calls[0][1] as string[];
      expect(params).toEqual([
        CONTACT_EMAIL_KEY, "a@bg.fr",
        CONTACT_DISCORD_TAG_KEY, "tag",
        CONTACT_DISCORD_URL_KEY, "https://discord.gg/x",
      ]);
    });

    it("throws the validation error and does not write on invalid input", async () => {
      const execute = jest.fn();
      await mockDb(execute);
      await expect(setContactInfo({ discordUrl: "https://evil.com" })).rejects.toThrow("DISCORD_URL_INVALID");
      expect(execute).not.toHaveBeenCalled();
    });
  });
});

/**
 * `PublicFooter` appelle `getContactInfo` : **chaque page publique** du site la
 * demande donc à chaque rendu — accueil, association, bénévoles, recrutement,
 * bot, règles. Trois canaux qui changent une fois par an valaient une requête
 * par visite, sans qu'aucun plafond de débit ne puisse s'y opposer : c'est un
 * composant serveur, il ne répond pas 429.
 */
describe("contact-service — mutualisation de la lecture", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });
  afterEach(() => {
    clearCache();
    jest.restoreAllMocks();
  });

  it("ne lit la base qu'une fois pour cent arrivées simultanées", async () => {
    const execute = jest.fn().mockResolvedValue([[]]);
    await mockDb(execute);

    await Promise.all(Array.from({ length: 100 }, () => getContactInfo()));

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("resert les coordonnées en cache aux visites suivantes", async () => {
    const execute = jest.fn().mockResolvedValue([[]]);
    await mockDb(execute);

    await getContactInfo();
    await getContactInfo();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("ne met pas un échec en cache", async () => {
    const execute = jest
      .fn()
      .mockRejectedValueOnce(new Error("DOWN"))
      .mockResolvedValue([[{ setting_key: CONTACT_EMAIL_KEY, setting_value: "a@bg.fr" }]]);
    await mockDb(execute);

    expect(await getContactInfo()).toEqual(DEFAULT_CONTACT);
    expect((await getContactInfo()).email).toBe("a@bg.fr");
  });

  it("oublie les coordonnées après une écriture du staff", async () => {
    const execute = jest.fn().mockResolvedValue([[]]);
    await mockDb(execute);

    await getContactInfo();
    execute.mockClear();

    await setContactInfo({
      email: "a@bg.fr",
      discordTag: "bluegenji",
      discordUrl: "https://discord.gg/x",
    });
    await getContactInfo();

    expect(execute.mock.calls.some(([sql]) => String(sql).trim().startsWith("SELECT"))).toBe(true);
  });
});
