import { createSession } from "@/lib/server/auth";
import { DISCORD_CODE_VERIFY_RULE, enforceRateLimit, requestClientIp } from "@/lib/server/api-guard";
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

    // Plafonné sur le couple **(compte visé, IP appelante)**, une fois la forme
    // validée. Sur le seul compte visé, ce plafond se retournait contre lui :
    // la route est anonyme, l'identifiant Discord d'un joueur se lit dans la
    // réponse de la demande de code, et dix essais bidon lui fermaient sa propre
    // connexion Discord pour un quart d'heure. Ici l'attaquant ne plafonne que
    // lui-même. Le quota d'essais du code, lui, est en base : changer d'IP n'en
    // donne pas un de plus.
    //
    // Sans IP — proxy qui ne pose pas l'en-tête —, pas de plafond du tout : la
    // règle de la maison (voir `enforceRateLimit`), qui vaut mieux que de
    // retomber sur l'axe de la victime.
    const callerIp = requestClientIp(req);
    const throttled = enforceRateLimit(
      DISCORD_CODE_VERIFY_RULE,
      callerIp === null ? null : `${discordId}:${callerIp}`,
    );
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
