import { describe, expect, it } from "@jest/globals";
import { DISCORD_PERMISSIONS, decodeDiscordPermissions } from "@/lib/shared/discord-permissions";
import { DEFAULT_BOT_PERMISSIONS } from "@/lib/server/bot-invite";

describe("decodeDiscordPermissions", () => {
  it("lit le défaut du site pour ce qu'il est : le seul bit 40", () => {
    // La carte annonçait cinq permissions au-dessus de cet entier ; il n'en
    // demande qu'une, et aucune des cinq.
    expect(decodeDiscordPermissions(DEFAULT_BOT_PERMISSIONS)).toEqual([
      { bit: 40, flag: "MODERATE_MEMBERS", label: "Exclure temporairement des membres" },
    ]);
  });

  it("rend les permissions par rang de bit croissant", () => {
    // SEND_MESSAGES (11) + EMBED_LINKS (14) + VIEW_CHANNEL (10)
    const value = String((1 << 11) | (1 << 14) | (1 << 10));
    expect(decodeDiscordPermissions(value)?.map((p) => p.flag)).toEqual([
      "VIEW_CHANNEL",
      "SEND_MESSAGES",
      "EMBED_LINKS",
    ]);
  });

  it("ne perd aucun bit au-delà de 2⁵³", () => {
    // Un `Number` arrondirait : 2⁶⁰ + 1 s'écrirait 2⁶⁰ et le bit 0 disparaîtrait.
    const value = (BigInt(2) ** BigInt(60) + BigInt(1)).toString();
    expect(Number(value).toString()).not.toBe(value);
    expect(decodeDiscordPermissions(value)?.map((p) => p.bit)).toEqual([0, 60]);
  });

  it("nomme les permissions publiées les plus récentes", () => {
    const value = ((BigInt(1) << BigInt(48)) | (BigInt(1) << BigInt(52))).toString();
    expect(decodeDiscordPermissions(value)?.map((p) => p.flag)).toEqual([
      "SET_VOICE_CHANNEL_STATUS",
      "BYPASS_SLOWMODE",
    ]);
  });

  it("nomme un bit inconnu plutôt que de le taire", () => {
    const value = (BigInt(1) << BigInt(47)).toString();
    expect(decodeDiscordPermissions(value)).toEqual([
      { bit: 47, flag: "BIT_47", label: "Permission inconnue (bit 47)" },
    ]);
  });

  it("rend une liste vide pour zéro, pas `null`", () => {
    expect(decodeDiscordPermissions("0")).toEqual([]);
  });

  it("tolère les espaces autour de la valeur", () => {
    expect(decodeDiscordPermissions("  2048 ")?.map((p) => p.flag)).toEqual(["SEND_MESSAGES"]);
  });

  it.each(["", "abc", "-8", "12.5", "0x800", "1e3", "1".repeat(31)])(
    "refuse « %s », qui n'est pas un entier décimal positif",
    (raw) => {
      expect(decodeDiscordPermissions(raw)).toBeNull();
    },
  );

  it("tient un registre sans doublon, trié par bit", () => {
    const bits = DISCORD_PERMISSIONS.map((p) => p.bit);
    expect(new Set(bits).size).toBe(bits.length);
    expect([...bits].sort((a, b) => a - b)).toEqual(bits);
    expect(new Set(DISCORD_PERMISSIONS.map((p) => p.flag)).size).toBe(bits.length);
  });
});
