import { createSession } from "@/lib/server/auth";
import { DISCORD_CODE_VERIFY_RULE, enforceRateLimit, requestClientIp } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { rejectCrossSiteRequest } from "@/lib/server/request-origin";
import {
  consumeDiscordLoginChallenge,
  createOrGetDiscordUser,
  isDiscordChallengeToken,
} from "@/lib/server/users-service";
import { TERMS_REQUIRED } from "@/lib/shared/terms-of-use";

export async function POST(req: Request) {
  // Avant tout : un formulaire d'un autre site posant le code **de
  // l'attaquant** connecterait la victime à son compte (CSRF de connexion).
  const crossSite = rejectCrossSiteRequest(req, { requireJson: true });
  if (crossSite) return crossSite;

  try {
    const body = (await req.json()) as {
      challenge?: unknown;
      code?: string;
      pseudo?: string;
      termsAccepted?: boolean;
    };
    const challenge = body.challenge;
    const code = typeof body.code === "string" ? body.code.trim() : "";

    if (!isDiscordChallengeToken(challenge)) {
      return fail("INVALID_CHALLENGE", 400);
    }

    if (!/^\d{6}$/.test(code)) {
      return fail("INVALID_CODE", 400);
    }

    // Plafonné sur le couple **(défi visé, IP appelante)**, une fois la forme
    // validée. Sur le seul compte visé, ce plafond se retournait contre lui : la
    // route est anonyme, et dix essais bidon fermaient à un joueur nommé sa
    // propre connexion Discord pour un quart d'heure. Ici l'attaquant ne
    // plafonne que lui-même. Le quota d'essais du code, lui, est en base :
    // changer d'IP n'en donne pas un de plus.
    //
    // Sans IP — proxy qui ne pose pas l'en-tête —, pas de plafond du tout : la
    // règle de la maison (voir `enforceRateLimit`), qui vaut mieux que de
    // retomber sur l'axe de la victime.
    const callerIp = requestClientIp(req);
    const throttled = enforceRateLimit(
      DISCORD_CODE_VERIFY_RULE,
      callerIp === null ? null : `${challenge}:${callerIp}`,
    );
    if (throttled) return throttled;

    // On consomme plutôt qu'on ne vérifie : le défi porte le **tag** qui a servi
    // à résoudre l'identifiant, et se connecter par Discord *est* la preuve que
    // la certification demande. Le compte ressort donc avec son tag certifié,
    // sans que personne n'ait à refaire le geste depuis son profil — ce qui
    // règle d'un coup le cas de tous les comptes nés par cette porte.
    //
    // L'identifiant Discord vient **du défi**, jamais du client : la demande de
    // code ne le publie plus (c'était un oracle), et il n'est relu qu'une fois
    // le code juste.
    const proof = await consumeDiscordLoginChallenge(challenge, code);
    if (!proof) {
      return fail("CODE_INVALID_OR_EXPIRED", 401);
    }

    // La porte est nommée : ce chemin-ci ne laisse **aucune** autorisation
    // d'application chez Discord, à la différence du bouton. Et elle ne
    // dégrade jamais un rattachement déjà noué par OAuth — c'est la fonction
    // appelée qui tient cette règle (`lib/shared/account-connections.ts`).
    //
    // Le pseudo saisi n'est lu qu'à la création : un compte existant garde le
    // sien. Le formulaire le propose donc toujours, faute de pouvoir savoir —
    // sans oracle — si le compte existe.
    const userId = await createOrGetDiscordUser(proof.discordId, body.pseudo, proof.handle, {
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
