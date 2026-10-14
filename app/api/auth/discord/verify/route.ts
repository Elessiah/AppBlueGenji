import { createSession } from "@/lib/server/auth";
import { AccountSuspendedError, assertIdentityNotSuspended } from "@/lib/server/account-suspensions";
import { ACCOUNT_SUSPENDED } from "@/lib/shared/account-suspension";
import { DISCORD_CODE_VERIFY_RULE, enforceRateLimit, requestClientIp } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { rejectCrossSiteRequest } from "@/lib/server/request-origin";
import { consumeDiscordLoginChallenge, isDiscordChallengeToken } from "@/lib/server/users/discord-challenges";
import { createOrGetDiscordUser } from "@/lib/server/users/sign-in";
import { recordLoginLocale } from "@/lib/server/users/account-locale";
import { isLocale } from "@/lib/shared/locales";
import { TERMS_REQUIRED, TERMS_VERSION } from "@/lib/shared/terms-of-use";
import { SMALL_JSON_BODY_MAX_BYTES, readJsonBody } from "@/lib/server/request-body";

export async function POST(req: Request) {
  // Avant tout : un formulaire d'un autre site posant le code **de
  // l'attaquant** connecterait la victime à son compte (CSRF de connexion).
  const crossSite = rejectCrossSiteRequest(req, { requireJson: true });
  if (crossSite) return crossSite;

  try {
    const body = (await readJsonBody(req, SMALL_JSON_BODY_MAX_BYTES)) as {
      challenge?: unknown;
      code?: string;
      pseudo?: string;
      termsAccepted?: boolean;
      /** Version des conditions que la page a montrée. */
      termsVersion?: unknown;
      /** Acceptées dans la page, pas relues du navigateur. */
      termsAcceptedNow?: unknown;
      /** Langue de la page de connexion (lot 9-3) : celle du compte. */
      locale?: unknown;
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
    // à résoudre l'identifiant, et c'est lui — jamais une valeur renvoyée par le
    // client — que le compte enregistre. **Sans le certifier** : se connecter
    // n'est pas consentir à exposer son tag, et la certification reste un clic
    // distinct sur le profil.
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
    // Un compte suspendu est refusé avant que la porte n'écrive son tag.
    await assertIdentityNotSuspended("DISCORD", proof.discordId);
    // La version montrée doit être celle en vigueur : une page chargée avant
    // une nouvelle version n'accepte pas celle-ci (elle ne l'a pas montrée).
    const termsAccepted = body.termsAccepted === true && body.termsVersion === TERMS_VERSION;
    const userId = await createOrGetDiscordUser(proof.discordId, body.pseudo, proof.handle, {
      method: "DM_CODE",
      termsAccepted,
      acceptedNow: termsAccepted && body.termsAcceptedNow === true,
    });
    await createSession(userId, "LOGIN_DISCORD_CODE");
    // La langue du compte suit celle de la page de connexion (lot 9-3), jamais
    // bloquant. Une valeur absente ou inconnue (page d'avant le lot restée
    // ouverte) n'écrit rien : le compte garde sa langue — un compte neuf a le
    // français par défaut de la colonne.
    if (isLocale(body.locale)) await recordLoginLocale(userId, body.locale);

    return ok({ success: true });
  } catch (error) {
    // Le code vient d'être consommé : un compte neuf refusé faute de conditions
    // acceptées devra en redemander un. Le cas se présente à un client qui
    // contourne la case de `/connexion`, ou à un onglet chargé avant une
    // nouvelle version des conditions (`termsVersion` absent ou ancien) : le
    // refus (`TERMS_REQUIRED`) dit de recharger la page, qui les présente.
    if ((error as Error).message === TERMS_REQUIRED) return fail(TERMS_REQUIRED, 400);
    // Compte suspendu : l'exposé de la décision part dans le corps, que la page
    // de connexion affiche — c'est le seul canal qui joigne un compte sans
    // Discord rattaché, et le lecteur vient de prouver en être le titulaire.
    if (error instanceof AccountSuspendedError) {
      return fail(ACCOUNT_SUSPENDED, 403, { suspension: error.notice });
    }
    return fail((error as Error).message || "DISCORD_AUTH_FAILED", 500);
  }
}
