import { resolveDiscordUser, sendDiscordLoginCode } from "@/lib/server/bot-integration";
import { fail, ok } from "@/lib/server/http";
import { createDiscordLoginChallenge, discordAccountExists } from "@/lib/server/users-service";

function mapRequestError(message: string): { code: string; status: number } {
  if (message === "BOT_INTERNAL_UNREACHABLE") {
    return { code: "BOT_INTERNAL_UNREACHABLE", status: 503 };
  }

  if (message === "BOT_INTERNAL_UNAUTHORIZED") {
    return { code: "BOT_INTERNAL_UNAUTHORIZED", status: 500 };
  }

  if (message === "DISCORD_USER_NOT_FOUND") {
    return { code: "DISCORD_USER_NOT_FOUND", status: 404 };
  }

  if (message === "DISCORD_DM_FAILED") {
    return { code: "DISCORD_DM_FAILED", status: 502 };
  }

  return { code: message || "FAILED_TO_SEND_CODE", status: 500 };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { discordId?: string; handle?: string };
    // `handle` = tag Discord ou ID ; `discordId` conservé pour rétrocompat.
    const handle = (body.handle ?? body.discordId ?? "").trim();

    if (!handle) {
      return fail("INVALID_DISCORD_HANDLE", 400);
    }

    const discordId = await resolveDiscordUser(handle);

    // Un compte déjà rattaché à ce Discord a forcément un pseudo : le client
    // masque alors le champ « pseudo site », réservé à la première connexion.
    const isNewAccount = !(await discordAccountExists(discordId));

    const challenge = await createDiscordLoginChallenge(discordId);
    await sendDiscordLoginCode(discordId, challenge.code);

    return ok({
      success: true,
      discordId,
      isNewAccount,
      expiresAt: challenge.expiresAt.toISOString(),
    });
  } catch (error) {
    const mapped = mapRequestError((error as Error).message || "");
    return fail(mapped.code, mapped.status);
  }
}
