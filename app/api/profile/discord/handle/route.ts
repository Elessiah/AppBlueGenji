/**
 * « Mettre à jour mon pseudo » par le bot Discord — la ligne « Bot Discord (code
 * par message privé) » d'« Applications connectées ».
 *
 * `POST { handle }` fait résoudre le pseudo par le bot et envoie un code à six
 * chiffres en message privé et rend le jeton du défi ; `PUT { challenge, code }`
 * le confirme, et le
 * pseudo enregistré est celui **retenu sur le défi**, jamais une valeur du
 * client. La règle vit dans `lib/server/discord-verification.ts`
 * (`startDiscordHandleUpdate` / `confirmDiscordHandleUpdate`) ; la route garde
 * l'accès, plafonne et traduit en HTTP — avec **les mêmes seaux** que la
 * certification par code : ils bornent la même dépense (une résolution auprès du
 * bot, un message privé), et deux routes aux seaux distincts doubleraient le
 * quota de qui fait sonner un téléphone.
 */
import { getCurrentUser } from "@/lib/server/auth";
import {
  DISCORD_CODE_REQUEST_RULE,
  DISCORD_VERIFY_CONFIRM_RULE,
  DISCORD_VERIFY_TAG_RULE,
  enforceRateLimit,
} from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import {
  confirmDiscordHandleUpdate,
  startDiscordHandleUpdate,
} from "@/lib/server/discord-verification";
import { readJsonBody } from "@/lib/server/request-body";
import { isDiscordChallengeToken } from "@/lib/server/users-service";

/** Codes de refus et leur statut — les mêmes que la certification. */
function discordHandleStatusFor(message: string): number {
  switch (message) {
    case "INVALID_DISCORD_HANDLE":
    case "INVALID_CHALLENGE":
    case "INVALID_CODE":
      return 400;

    case "DISCORD_ID_MISMATCH":
    case "DISCORD_ALREADY_LINKED":
      return 409;
    case "CODE_INVALID_OR_EXPIRED":
      return 401;
    case "DISCORD_USER_NOT_FOUND":
    case "PROFILE_NOT_FOUND":
      return 404;
    case "TOO_MANY_CODE_REQUESTS":
    case "TOO_MANY_CODE_REQUESTS_TODAY":
      return 429;
    case "DISCORD_DM_FAILED":
      return 502;
    case "BOT_INTERNAL_UNREACHABLE":
      return 503;
    case "BOT_RESOLVE_TIMEOUT":
      return 504;
    default:
      return 500;
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const throttled = enforceRateLimit(DISCORD_VERIFY_TAG_RULE, user.id);
  if (throttled) return throttled;

  try {
    const body = (await readJsonBody(req)) as { handle?: unknown };
    const handle = typeof body.handle === "string" ? body.handle : "";
    // Le plafond par compte Discord **visé** ne peut être posé qu'une fois le
    // pseudo résolu : d'où le garde passé au service, appelé avant l'envoi.
    const result = await startDiscordHandleUpdate(
      user.id,
      handle,
      (discordId) => {
        if (enforceRateLimit(DISCORD_CODE_REQUEST_RULE, discordId)) {
          throw new Error("TOO_MANY_CODE_REQUESTS");
        }
      },
    );
    return ok(result);
  } catch (error) {
    const message = (error as Error).message || "DISCORD_HANDLE_UPDATE_FAILED";
    return fail(message, discordHandleStatusFor(message));
  }
}

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const throttled = enforceRateLimit(DISCORD_VERIFY_CONFIRM_RULE, user.id);
  if (throttled) return throttled;

  try {
    const body = (await readJsonBody(req)) as {
      challenge?: unknown;
      code?: unknown;
    };
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!isDiscordChallengeToken(body.challenge))
      return fail("INVALID_CHALLENGE", 400);
    if (!/^\d{6}$/.test(code)) return fail("INVALID_CODE", 400);

    const result = await confirmDiscordHandleUpdate(user.id, body.challenge, code);

    return ok({ status: "UPDATED", ...result });
  } catch (error) {
    const message = (error as Error).message || "DISCORD_HANDLE_UPDATE_FAILED";
    return fail(message, discordHandleStatusFor(message));
  }
}
