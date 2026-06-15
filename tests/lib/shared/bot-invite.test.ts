import { describe, it, expect, afterEach } from "@jest/globals";
import { botInviteUrl, DEFAULT_BOT_PERMISSIONS } from "@/lib/shared/bot-invite";

describe("botInviteUrl", () => {
  const originalClientId = process.env.DISCORD_BOT_CLIENT_ID;
  const originalPermissions = process.env.DISCORD_BOT_PERMISSIONS;

  afterEach(() => {
    process.env.DISCORD_BOT_CLIENT_ID = originalClientId;
    process.env.DISCORD_BOT_PERMISSIONS = originalPermissions;
  });

  it("retourne un lien inerte quand aucun client_id n'est configuré", () => {
    delete process.env.DISCORD_BOT_CLIENT_ID;
    expect(botInviteUrl()).toBe("#");
  });

  it("ignore un client_id vide ou en espaces", () => {
    process.env.DISCORD_BOT_CLIENT_ID = "   ";
    expect(botInviteUrl()).toBe("#");
  });

  it("construit l'URL OAuth2 avec le client_id et les permissions par défaut", () => {
    process.env.DISCORD_BOT_CLIENT_ID = "987654321098765432";
    delete process.env.DISCORD_BOT_PERMISSIONS;

    const url = new URL(botInviteUrl());
    expect(url.origin + url.pathname).toBe("https://discord.com/api/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("987654321098765432");
    expect(url.searchParams.get("permissions")).toBe(DEFAULT_BOT_PERMISSIONS);
    expect(url.searchParams.get("scope")).toBe("bot applications.commands");
  });

  it("respecte un bitfield de permissions personnalisé", () => {
    process.env.DISCORD_BOT_CLIENT_ID = "111";
    process.env.DISCORD_BOT_PERMISSIONS = "8";
    expect(new URL(botInviteUrl()).searchParams.get("permissions")).toBe("8");
  });
});
