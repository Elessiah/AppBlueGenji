import { describe, expect, it } from "@jest/globals";
import { discordVerificationErrorMessage } from "@/app/(secured)/profil/discord-errors";

/**
 * Les refus de la certification, dits en français.
 *
 * Même exigence que `login-errors` : **aucun code ne doit sortir en capitales**,
 * y compris celui que le serveur ajoutera demain. Et les deux conflits d'état
 * doivent expliquer *ce qu'il y a à faire* — ce sont les seuls que le joueur ne
 * peut pas lever seul en réessayant.
 */
const CODES = [
  "INVALID_DISCORD_HANDLE",
  "INVALID_CODE",
  "CODE_INVALID_OR_EXPIRED",
  "DISCORD_ID_MISMATCH",
  "DISCORD_ALREADY_LINKED",
  "DISCORD_USER_NOT_FOUND",
  "DISCORD_DM_FAILED",
  "BOT_INTERNAL_UNREACHABLE",
  "BOT_RESOLVE_TIMEOUT",
  "BOT_INTERNAL_UNAUTHORIZED",
  "TOO_MANY_CODE_REQUESTS",
  "TOO_MANY_REQUESTS",
  "PROFILE_NOT_FOUND",
  "UNAUTHORIZED",
];

describe("discordVerificationErrorMessage", () => {
  it("traduit tous les refus que la route peut rendre", () => {
    for (const code of CODES) {
      const message = discordVerificationErrorMessage(code);
      expect(message).not.toContain(code);
      expect(message.length).toBeGreaterThan(10);
    }
  });

  it("retombe sur une phrase pour un code inconnu, jamais sur le code", () => {
    expect(discordVerificationErrorMessage("QUELQUE_CHOSE_DE_NEUF")).not.toContain("QUELQUE");
    expect(discordVerificationErrorMessage(undefined)).toMatch(/certification/i);
    expect(discordVerificationErrorMessage(null)).toMatch(/certification/i);
  });

  it("dit où aller sur un tag introuvable : le bot doit partager un serveur", () => {
    expect(discordVerificationErrorMessage("DISCORD_USER_NOT_FOUND")).toMatch(/serveur/i);
  });

  it("explique les deux conflits d'état plutôt que de les constater", () => {
    // Le joueur ne les lève pas en réessayant : il faut lui dire quoi faire.
    expect(discordVerificationErrorMessage("DISCORD_ID_MISMATCH")).toMatch(/corrige|contacte/i);
    expect(discordVerificationErrorMessage("DISCORD_ALREADY_LINKED")).toMatch(/contacte/i);
  });
});
