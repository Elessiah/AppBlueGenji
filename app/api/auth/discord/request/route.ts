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
  discardDiscordChallenge,
  discordAccountExists,
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

    // Le tag part avec le défi : c'est lui qui sera certifié si le code
    // revient juste (`consumeDiscordChallenge`). Un identifiant numérique n'en
    // est pas un, `normalizeDiscordHandle` le laisse tomber.
    const challenge = await createDiscordLoginChallenge(discordId, handle);

    try {
      await sendDiscordLoginCode(discordId, challenge.code);
    } catch (error) {
      // **Un envoi raté n'a produit aucun code**, et la base doit le dire.
      //
      // `verifyDiscordChallenge` ne lit que le **dernier émis** : laissée là, la
      // ligne mort-née ferait refuser le code que le joueur tient de la demande
      // précédente — refusé comme invalide, et chaque essai brûlant le quota de
      // la mauvaise ligne. Le supprimer rend au code déjà reçu sa place de
      // dernier, sans rien écrire d'autre. C'est aussi pourquoi rien n'est
      // invalidé avant l'envoi : l'ancien tué, le neuf jamais reçu, le joueur
      // n'avait plus rien du tout dès que le bot redémarrait.
      await discardDiscordChallenge(challenge.challengeId).catch(() => {
        // Ménage impossible : on rend quand même l'échec d'envoi, qui est
        // l'erreur que le joueur doit lire.
      });
      throw error;
    }

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
