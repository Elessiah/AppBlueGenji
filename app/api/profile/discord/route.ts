/**
 * Certification du tag Discord du compte connecté.
 *
 * Deux verbes, un seul objet : `POST` ouvre la certification (et la **termine**
 * sur place quand l'identifiant Discord est déjà prouvé), `PUT` la confirme avec
 * le code reçu. La règle vit dans `lib/server/discord-verification.ts` ; la
 * route ne fait que garder l'accès, plafonner et traduire en HTTP.
 *
 * Aucun `DELETE` : la certification **se perd avec le tag**, par
 * `PATCH /api/profile` — le retrait (`discordPseudo: null`, seul geste offert à
 * un compte rattaché, dont le tag est verrouillé) est le même que « je ne veux
 * plus être exposé », et un second chemin laisserait un compte certifié sur un
 * tag qu'il vient de changer.
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
  confirmDiscordVerification,
  getDiscordAccountState,
  startDiscordVerification,
} from "@/lib/server/discord-verification";

/**
 * Codes de refus et leur statut.
 *
 * Écrit une fois pour les deux verbes : ils partagent presque tous leurs refus,
 * et deux tables divergeraient — un même code rendu 400 d'un côté et 409 de
 * l'autre, sur la même cause.
 */
function statusFor(message: string): number {
  switch (message) {
    case "INVALID_DISCORD_HANDLE":
    case "INVALID_CODE":
      return 400;
    // Le tag désigne un autre compte Discord que celui déjà rattaché : ce n'est
    // pas une saisie malformée mais un **conflit d'état**, et c'est au joueur de
    // trancher (corriger son tag, ou rester sur son compte de connexion).
    case "DISCORD_ID_MISMATCH":
    case "DISCORD_ALREADY_LINKED":
      return 409;
    case "CODE_INVALID_OR_EXPIRED":
      return 401;
    case "DISCORD_USER_NOT_FOUND":
    case "PROFILE_NOT_FOUND":
      return 404;
    case "TOO_MANY_CODE_REQUESTS":
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

/**
 * État Discord du compte : le tag **enregistré**, s'il est certifié, et si un
 * identifiant est déjà rattaché (auquel cas la certification se fait sans code).
 *
 * Séparé de `GET /api/profile`, qui rend la fiche entière : cet état-ci change
 * sans que la fiche change (une certification n'y touche à rien d'autre), et le
 * profil le relit seul après chaque sauvegarde pour que la pastille suive le tag.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  return ok(await getDiscordAccountState(user.id));
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  // Par compte du site : la route est authentifiée, il y a enfin quelqu'un à qui
  // imputer la dépense (une résolution de tag auprès du bot par appel).
  const throttled = enforceRateLimit(DISCORD_VERIFY_TAG_RULE, user.id);
  if (throttled) return throttled;

  try {
    const body = (await req.json()) as { handle?: string };

    // Le plafond par **compte Discord visé** — celui qui protège le téléphone de
    // quelqu'un — ne peut être posé qu'une fois le tag résolu, et il doit
    // **refuser** : d'où un garde passé au service, appelé juste avant l'envoi.
    // Posé après, il n'aurait rien empêché tout en vidant le seau que
    // `/api/auth/discord/request` consulte, lui, avant d'envoyer — de quoi
    // fermer la connexion Discord du compte visé sans jamais freiner celle-ci.
    //
    // Il n'est pas consulté sur le chemin sans code : une certification
    // immédiate ne fait sonner personne.
    const result = await startDiscordVerification(user.id, body.handle ?? "", (discordId) => {
      if (enforceRateLimit(DISCORD_CODE_REQUEST_RULE, discordId)) {
        throw new Error("TOO_MANY_CODE_REQUESTS");
      }
    });

    return ok(result);
  } catch (error) {
    const message = (error as Error).message || "DISCORD_VERIFICATION_FAILED";
    return fail(message, statusFor(message));
  }
}

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  // Seau **distinct** de celui de la demande : partagé, les essais de tag
  // infructueux épuiseraient le quota de la confirmation, et un joueur se
  // verrait refuser le code qu'il vient de recevoir.
  const throttled = enforceRateLimit(DISCORD_VERIFY_CONFIRM_RULE, user.id);
  if (throttled) return throttled;

  try {
    const body = (await req.json()) as { discordId?: string; code?: string };
    const discordId = (body.discordId ?? "").trim();
    const code = (body.code ?? "").trim();
    if (!/^\d{5,32}$/.test(discordId)) return fail("INVALID_DISCORD_HANDLE", 400);
    if (!/^\d{6}$/.test(code)) return fail("INVALID_CODE", 400);

    const result = await confirmDiscordVerification(user.id, discordId, code);
    return ok({ status: "VERIFIED", ...result });
  } catch (error) {
    const message = (error as Error).message || "DISCORD_VERIFICATION_FAILED";
    return fail(message, statusFor(message));
  }
}
