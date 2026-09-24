import { createSession } from "@/lib/server/auth";
import { DISCORD_CODE_VERIFY_RULE, enforceRateLimit, requestClientIp } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { consumeDiscordChallenge, createOrGetDiscordUser } from "@/lib/server/users-service";
import { TERMS_REQUIRED } from "@/lib/shared/terms-of-use";

function normalizeDiscordId(raw: string): string {
  return raw.trim();
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      discordId?: string;
      code?: string;
      pseudo?: string;
      termsAccepted?: boolean;
    };
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

    // On consomme plutôt qu'on ne vérifie : le défi porte le **tag** qui a servi
    // à résoudre l'identifiant, et se connecter par Discord *est* la preuve que
    // la certification demande. Le compte ressort donc avec son tag certifié,
    // sans que personne n'ait à refaire le geste depuis son profil — ce qui
    // règle d'un coup le cas de tous les comptes nés par cette porte.
    const proof = await consumeDiscordChallenge(discordId, code);
    if (!proof) {
      return fail("CODE_INVALID_OR_EXPIRED", 401);
    }

    // La porte est nommée : ce chemin-ci ne laisse **aucune** autorisation
    // d'application chez Discord, à la différence du bouton. Et elle ne
    // dégrade jamais un rattachement déjà noué par OAuth — c'est la fonction
    // appelée qui tient cette règle (`lib/shared/account-connections.ts`).
    const userId = await createOrGetDiscordUser(discordId, body.pseudo, proof.handle, {
      method: "DM_CODE",
      termsAccepted: body.termsAccepted === true,
    });
    await createSession(userId);

    return ok({ success: true });
  } catch (error) {
    // Le code vient d'être consommé : un compte neuf refusé faute de conditions
    // acceptées devra en redemander un. Le cas ne se présente qu'à un client qui
    // contourne la case de `/connexion`.
    if ((error as Error).message === TERMS_REQUIRED) return fail(TERMS_REQUIRED, 400);
    return fail((error as Error).message || "DISCORD_AUTH_FAILED", 500);
  }
}
