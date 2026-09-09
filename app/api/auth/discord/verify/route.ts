import { createSession } from "@/lib/server/auth";
import { DISCORD_CODE_VERIFY_RULE, enforceRateLimit } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { createOrGetDiscordUser, verifyDiscordChallenge } from "@/lib/server/users-service";

function normalizeDiscordId(raw: string): string {
  return raw.trim();
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { discordId?: string; code?: string; pseudo?: string };
    const discordId = normalizeDiscordId(body.discordId ?? "");
    const code = (body.code ?? "").trim();

    if (!/^\d{5,32}$/.test(discordId)) {
      return fail("INVALID_DISCORD_ID", 400);
    }

    if (!/^\d{6}$/.test(code)) {
      return fail("INVALID_CODE", 400);
    }

    // Plafonné sur le compte visé, une fois sa forme validée : c'est le seul
    // axe qu'un attaquant ne peut pas faire tourner (viser quelqu'un d'autre,
    // c'est attaquer quelqu'un d'autre). Le code porte déjà son propre quota
    // d'essais ; ce plafond borne ce que la demande de codes neufs rouvrirait.
    const throttled = enforceRateLimit(DISCORD_CODE_VERIFY_RULE, discordId);
    if (throttled) return throttled;

    const valid = await verifyDiscordChallenge(discordId, code);
    if (!valid) {
      return fail("CODE_INVALID_OR_EXPIRED", 401);
    }

    const userId = await createOrGetDiscordUser(discordId, body.pseudo);
    await createSession(userId);

    return ok({ success: true });
  } catch (error) {
    return fail((error as Error).message || "DISCORD_AUTH_FAILED", 500);
  }
}
