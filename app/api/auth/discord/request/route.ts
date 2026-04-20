import { sendDiscordLoginCode } from "@/lib/server/bot-integration";
import { fail, ok } from "@/lib/server/http";
import { createDiscordLoginChallenge } from "@/lib/server/users-service";

function normalizeDiscordId(raw: string): string {
  return raw.trim();
}

function mapRequestError(message: string): { code: string; status: number } {
  if (message === "BOT_INTERNAL_UNREACHABLE") {
    return { code: "BOT_INTERNAL_UNREACHABLE", status: 503 };
  }

  if (message === "BOT_INTERNAL_UNAUTHORIZED") {
    return { code: "BOT_INTERNAL_UNAUTHORIZED", status: 500 };
  }

  if (message === "DISCORD_DM_FAILED") {
    return { code: "DISCORD_DM_FAILED", status: 502 };
  }

  return { code: message || "FAILED_TO_SEND_CODE", status: 500 };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { discordId?: string };
    const discordId = normalizeDiscordId(body.discordId ?? "");

    if (!/^\d{5,32}$/.test(discordId)) {
      return fail("INVALID_DISCORD_ID", 400);
    }

    const challenge = await createDiscordLoginChallenge(discordId);
    await sendDiscordLoginCode(discordId, challenge.code);

    return ok({
      success: true,
      expiresAt: challenge.expiresAt.toISOString(),
    });
  } catch (error) {
    const mapped = mapRequestError((error as Error).message || "");
    return fail(mapped.code, mapped.status);
  }
}
