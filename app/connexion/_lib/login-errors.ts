/**
 * Les refus de la connexion Discord, dits dans la langue de la page.
 *
 * Le registre vivait dans `page.tsx` et se terminait par `return errorCode` :
 * tout code que la carte ne connaissait pas s'affichait tel quel dans le toast.
 * Les plafonds posés par la passe de sécurité en ont ajouté deux — un joueur
 * lisait `TOO_MANY_CODE_REQUESTS` en capitales —, et ce sont justement les
 * refus qui appellent une consigne : *attends*, et *par où passer en attendant*.
 *
 * Même forme que `app/(secured)/equipes/_lib/membership-errors.ts` : un registre
 * pur, testable, et un repli qui ne laisse **jamais** sortir un jeton.
 *
 * Les phrases vivent dans les messages (`login.errors`, `login.oauthErrors`,
 * lot 6 — `docs/features/I18N.md` § Connexion) ; ce registre garde la **liste**
 * des codes connus et, en commentaire, la raison de chaque phrase. Sans langue
 * (`FR_LOGIN_TEXT`), le français : les autres lecteurs lisent ce qu'ils lisaient.
 */

import { loginEnvironmentAdvice, type LoginEnvironment } from "@/lib/shared/login-environment";
import { ACCOUNT_SUSPENDED } from "@/lib/shared/account-suspension";
import { FR_LOGIN_TEXT, suspendedLoginText, type LoginMessages, type LoginText } from "@/lib/shared/login-text";

type LoginErrorCode = Exclude<keyof LoginMessages["errors"], "fallback">;

/** Codes connus ; la phrase est le message `login.errors.<CODE>`. */
const LOGIN_ERRORS: Readonly<Record<LoginErrorCode, true>> = {
  // Bot injoignable ou mal configuré : la panne est de notre côté, le joueur n'a
  // rien à corriger — mais la connexion Google, elle, reste ouverte.
  BOT_INTERNAL_UNREACHABLE: true,
  // Le bot a répondu trop tard : tag absent de ses serveurs ou bot surchargé,
  // sans qu'on sache lequel. Les deux sorties évitent la recherche par tag —
  // l'ID ne vaut pourtant que pour un joueur qui **est** sur un serveur du bot,
  // mais que le balayage de toutes les guildes n'a pas atteint à temps : sans
  // serveur commun, Discord refuse le message privé quel que soit l'identifiant.
  // La condition nomme le seul serveur que le joueur peut vérifier.
  BOT_RESOLVE_TIMEOUT: true,
  BOT_INTERNAL_UNAUTHORIZED: true,
  // Sur une saisie par ID, c'est aussi ce qui arrive sans serveur commun : la
  // recherche est sautée, et c'est Discord qui refuse l'envoi.
  DISCORD_DM_FAILED: true,
  // Tag inconnu de tous les serveurs du bot : saisir l'ID ne changerait rien, le
  // message privé serait refusé faute de serveur commun.
  DISCORD_USER_NOT_FOUND: true,
  FAILED_TO_SEND_CODE: true,

  INVALID_DISCORD_HANDLE: true,
  INVALID_DISCORD_ID: true,
  INVALID_CODE: true,

  // Code faux, expiré (10 min), ou brûlé par cinq essais ratés. Les trois cas
  // se réparent pareil — en redemander un —, et les distinguer renseignerait
  // qui essaie de deviner.
  CODE_INVALID_OR_EXPIRED: true,

  // Plafond du nombre de codes envoyés à ce compte : chaque demande fait vibrer
  // un téléphone, elles sont comptées.
  TOO_MANY_CODE_REQUESTS: true,
  // Plafond **journalier** : la borne qui tient la force brute lente du code.
  // Le bouton Discord (OAuth) n'y est pas soumis — c'est la sortie à nommer.
  TOO_MANY_CODE_REQUESTS_TODAY: true,
  // Défi absent ou illisible : l'onglet est antérieur à la demande de code, ou
  // la page a été rechargée entre les deux étapes.
  INVALID_CHALLENGE: true,
  // La requête ne vient pas de cette page (formulaire d'un autre site, ou
  // extension qui la réécrit) : rien que le joueur puisse corriger, sauf
  // recommencer depuis le site.
  CROSS_SITE_REQUEST: true,
  UNSUPPORTED_CONTENT_TYPE: true,
  // Plafond de débit générique (`enforceRateLimit`), sur la demande comme sur la
  // vérification.
  TOO_MANY_REQUESTS: true,

  DISCORD_AUTH_FAILED: true,

  // Compte neuf sans les conditions d'utilisation acceptées : la case de
  // l'écran d'accueil de la page a été contournée (ou l'onglet est antérieur à
  // la règle). Recharger la page la représente.
  TERMS_REQUIRED: true,
};

function isLoginErrorCode(code: string): code is LoginErrorCode {
  return Object.hasOwn(LOGIN_ERRORS, code);
}

/**
 * Message à afficher pour un code de refus de la connexion.
 *
 * Un code inconnu retombe sur une phrase générique **et non sur le code
 * lui-même** : le jour où le serveur en ajoute un, le joueur lit une phrase.
 *
 * Compte suspendu (`ACCOUNT_SUSPENDED`) sans exposé lisible dans la réponse : la
 * phrase générique (la page montre l'exposé complet quand il a voyagé).
 */
export function loginErrorMessage(code: string | null | undefined, text: LoginText = FR_LOGIN_TEXT): string {
  if (code === ACCOUNT_SUSPENDED) return suspendedLoginText(text, null);
  if (!code || !isLoginErrorCode(code)) return text.t("errors.fallback");
  return text.t(`errors.${code}`);
}

/**
 * Les refus de l'aller-retour OAuth, dits dans la langue de la page.
 *
 * **Une table, pas trois.** La page portait cinq codes écrits en dur, tous
 * préfixés `google_` — `google_not_configured`, `google_unavailable`… —, soit
 * cinq phrases à recopier par fournisseur ajouté, et quinze à tenir à jour. Le
 * refus ne dépend pourtant jamais du fournisseur : c'est toujours « la
 * configuration manque », « l'aller-retour a échoué », « l'état a expiré ». Seul
 * le **nom** change, et il arrive maintenant à part (`?provider=`).
 *
 * Chaque phrase nomme le geste qui lève le refus, et renvoie vers **les autres
 * portes** quand celle-ci est fermée : un joueur bloqué sur Discord n'a pas à
 * deviner que Google marche encore.
 *
 * - `not_configured` : la variable d'environnement manque — rien à réessayer, la
 *   panne est chez nous et aucune patience ne la corrigera ;
 * - `params` : le rappel est arrivé sans code ni état (lien tronqué, ou
 *   consentement refusé chez le fournisseur) ;
 * - `state` : l'état a expiré (dix minutes) ou ne correspond pas — relancer est
 *   la seule réponse, et c'est aussi celle qu'on doit à une tentative de rejeu ;
 * - `session` : `intent=link` sans session, la connexion a expiré pendant
 *   l'aller-retour ;
 * - `terms` : compte neuf sans les conditions d'utilisation acceptées ;
 * - `suspended` : compte suspendu, l'exposé n'ayant pas voyagé (cookie expiré,
 *   page rechargée plus tard) — la phrase générique, qui dit comment contester.
 */
type OAuthErrorKind = Exclude<keyof LoginMessages["oauthErrors"], "providerFallback">;
const OAUTH_ERRORS: ReadonlySet<string> = new Set<OAuthErrorKind | "suspended">([
  "not_configured",
  "unavailable",
  "params",
  "state",
  "oauth",
  "session",
  "terms",
  "suspended",
]);

/**
 * Les refus qu'un contexte à cookies isolés (app installée sur iOS, navigateur
 * intégré) produit réellement : le cookie d'état manque au retour (`state`),
 * l'échange échoue (`oauth`), le rappel arrive vide (`params`) ou la session
 * de départ n'est pas relue (`session`). Une configuration manquante, une
 * panne du fournisseur ou des conditions refusées n'ont rien à voir avec le
 * navigateur : y joindre le conseil enverrait changer de navigateur pour rien.
 */
const ENVIRONMENT_SENSITIVE_OAUTH_ERRORS = new Set(["params", "state", "oauth", "session"]);

/** Nom du fournisseur tel qu'il s'affiche dans une phrase de refus (une marque : le même dans les deux langues). */
const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  discord: "Discord",
  blizzard: "Blizzard",
};

/**
 * Message à afficher pour un refus d'aller-retour OAuth.
 *
 * Un fournisseur inconnu — ou absent, sur un vieux lien — retombe sur « OAuth »
 * plutôt que sur une phrase amputée : le message reste lisible même quand le
 * paramètre manque.
 *
 * `environment` ajoute, pour un refus que le navigateur peut expliquer, le
 * conseil d'en changer (voir `lib/shared/login-environment.ts`).
 */
export function oauthErrorMessage(
  kind: string | null | undefined,
  providerSlug: string | null | undefined,
  environment: LoginEnvironment = "BROWSER",
  text: LoginText = FR_LOGIN_TEXT,
): string | null {
  if (!kind || !OAUTH_ERRORS.has(kind)) return null;
  if (kind === "suspended") return suspendedLoginText(text, null);
  const provider = PROVIDER_LABELS[(providerSlug ?? "").toLowerCase()] ?? text.t("oauthErrors.providerFallback");
  const message = text.t(`oauthErrors.${kind as OAuthErrorKind}`, { provider });
  const advice = ENVIRONMENT_SENSITIVE_OAUTH_ERRORS.has(kind) ? loginEnvironmentAdvice(environment, text) : null;
  return advice ? `${message} ${advice}` : message;
}
