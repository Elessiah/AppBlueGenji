import {
  DISCORD_CODE_REQUEST_IP_RULE,
  DISCORD_CODE_REQUEST_RULE,
  enforceRateLimit,
  requestClientIp,
} from "@/lib/server/api-guard";
import { resolveDiscordUser, sendDiscordLoginCode } from "@/lib/server/bot-integration";
import { fail, ok } from "@/lib/server/http";
import {
  createDiscordLoginChallenge,
  discordAccountExists,
  retireOtherDiscordChallenges,
} from "@/lib/server/users-service";

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

  // Trop de codes demandés pour ce compte : c'est un plafond, pas une panne.
  if (message === "TOO_MANY_CODE_REQUESTS") {
    return { code: "TOO_MANY_CODE_REQUESTS", status: 429 };
  }

  return { code: message || "FAILED_TO_SEND_CODE", status: 500 };
}

export async function POST(req: Request) {
  // **Avant tout le reste**, y compris la lecture du corps : la suite ouvre une
  // requête vers le bot (qui interroge Discord) pour résoudre le pseudo, et le
  // plafond par compte visé ne peut être posé qu'après cette résolution. Sans
  // cette borne-ci, la route anonyme faisait sortir une requête par appel.
  const ipThrottled = enforceRateLimit(DISCORD_CODE_REQUEST_IP_RULE, requestClientIp(req));
  if (ipThrottled) return ipThrottled;

  try {
    const body = (await req.json()) as { discordId?: string; handle?: string };
    // `handle` = tag Discord ou ID ; `discordId` conservé pour rétrocompat.
    const handle = (body.handle ?? body.discordId ?? "").trim();

    if (!handle) {
      return fail("INVALID_DISCORD_HANDLE", 400);
    }

    const discordId = await resolveDiscordUser(handle);

    // Plafonné sur le compte visé, et non sur l'appelant : chaque appel envoie
    // un message privé à quelqu'un et remet en jeu un code neuf. C'est aussi le
    // seul axe qu'un attaquant ne peut pas faire tourner — l'IP, elle, se
    // renouvelle, et l'en-tête qui la porte n'est pas toujours posé par un
    // relais de confiance.
    const throttled = enforceRateLimit(DISCORD_CODE_REQUEST_RULE, discordId);
    if (throttled) return throttled;

    // Un compte déjà rattaché à ce Discord a forcément un pseudo : le client
    // masque alors le champ « pseudo site », réservé à la première connexion.
    const isNewAccount = !(await discordAccountExists(discordId));

    const challenge = await createDiscordLoginChallenge(discordId);
    await sendDiscordLoginCode(discordId, challenge.code);

    // Les codes précédents ne meurent qu'**une fois celui-ci parti**. Les périmer
    // avant l'envoi laissait le joueur sans rien du tout quand le bot était
    // injoignable : l'ancien tué, le neuf jamais reçu. Deux codes se chevauchent
    // donc le temps d'un aller-retour, chacun avec son propre quota d'essais.
    await retireOtherDiscordChallenges(discordId, challenge.challengeId);

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
