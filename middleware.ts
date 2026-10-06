import { NextResponse, type NextRequest } from "next/server";

import { rejectCrossSiteRequest } from "@/lib/server/request-origin";
import { siteBaseUrl } from "@/lib/server/site-url";
import { CSP_HEADER, CSP_NONCE_HEADER, PATHNAME_HEADER, contentSecurityPolicy } from "@/lib/shared/csp";
import { apiWriteNeedsProvenance } from "@/lib/shared/request-origin";
import { SUSPENSION_NOTICE_COOKIE, SUSPENSION_NOTICE_HEADER } from "@/lib/shared/account-suspension";
import { LOCALE_HEADER, isApiPath, isMigratedRoute, splitLocalePrefix, type Locale } from "@/lib/shared/locales";

/** Cookie de l'invite Google One Tap (retirée), effacé chez qui le porte encore. */
export const LEGACY_GOOGLE_ONE_TAP_COOKIE = "g_state";

/** Ancien chemin du cookie d'avis de suspension, avant `path: "/"` (i18n, lot 0). */
export const LEGACY_SUSPENSION_NOTICE_PATH = "/connexion";

/**
 * Pose la politique de sécurité du contenu, avec un nonce par requête, et la
 * langue de la page (`docs/features/I18N.md`).
 *
 * C'est le seul endroit où la politique peut être posée : `headers()` de
 * `next.config.ts` rend une liste **statique**, alors qu'un nonce doit changer
 * à chaque réponse — réutilisé, il ne nomme plus rien.
 *
 * Le nonce voyage par **deux** chemins, et les deux sont nécessaires. En
 * en-tête de **requête**, il atteint les composants serveur et Next l'appose
 * lui-même sur chacun de ses `<script>` en ligne. En en-tête de **réponse**, il
 * atteint le navigateur, qui saura alors lesquels sont nommés.
 *
 * L'en-tête de requête porte `content-security-policy` **sans** le suffixe
 * `-report-only`, quel que soit le mode : c'est de celui-là que Next tire le
 * nonce. Rien ne s'applique pour autant — un en-tête de requête n'atteint
 * jamais le navigateur ; ce que la page **subit** est décidé par le seul
 * en-tête de réponse, qui, lui, suit {@link CSP_MODE}.
 *
 * Les adresses anglaises (`/en/…`) passent par {@link localeGate}, puis sont
 * **réécrites** vers la même route sans préfixe — l'arborescence `app/` est
 * unique —, la langue voyageant dans `x-bg-locale`, posé dans les mêmes
 * en-têtes de requête que le nonce.
 */
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) return guardApiRequest(request);

  const { locale, path, prefixed } = splitLocalePrefix(request.nextUrl.pathname);
  const early = localeGate(request, path, prefixed);
  if (early) return early;

  // Un préchargement de `/en/…` arrive jusqu'ici (troisième entrée du
  // `matcher`) et suit le chemin commun : réécrit **et** marqué anglais, sans
  // quoi la page préchargée serait rendue en français puis réutilisée à la
  // navigation. Il tire un nonce qui ne servira pas — le middleware ne peut pas
  // le reconnaître : Next retire les en-têtes du routeur (`next-router-prefetch`,
  // `rsc`) de la requête qu'il lui remet, et seul le `matcher` les voit.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCodePoint(...bytes));

  const policy = contentSecurityPolicy(nonce, {
    dev: process.env.NODE_ENV === "development",
  });

  const requestHeaders = localizedRequestHeaders(request, locale, path);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);
  requestHeaders.set("content-security-policy", policy);
  // L'exposé d'une suspension (`lib/server/oauth-flow.ts`) se lit **une fois** :
  // il est remis à la page par un en-tête de requête, et la réponse efface le
  // cookie. Pas par le cookie lui-même : Next fusionne les cookies que pose le
  // middleware dans la requête que voit la page (`cookies()` comme l'en-tête
  // `cookie` de `headers()`), qui lirait donc la valeur vide de l'effacement —
  // vérifié sur `next dev`. Gardé ses dix minutes, le cookie rouvrait la
  // décision, motif compris, à quiconque rouvrait le lien depuis l'historique
  // d'un ordinateur partagé. L'en-tête reçu d'un client est toujours retiré :
  // seul le middleware le pose.
  //
  // La comparaison porte sur le chemin **sans préfixe de langue** : la page de
  // connexion est la même sous `/connexion` et `/en/connexion`, et le cookie
  // est posé sur `/` pour atteindre l'une comme l'autre — c'est ce contrôle-ci,
  // pas le chemin du cookie, qui borne sa lecture à la page de connexion.
  //
  // Et seulement sur un **document** : le retour OAuth y mène toujours par une
  // redirection, donc un chargement complet. Un préchargement de
  // `/en/connexion` (troisième entrée du `matcher`, que le middleware ne sait
  // pas reconnaître autrement) effacerait sinon l'exposé dans une réponse que
  // personne ne lit. `Sec-Fetch-Dest` absent (navigateur ancien, client hors
  // navigateur) vaut document : l'exposé ne doit jamais devenir illisible.
  const onLoginPage = path === "/connexion" && isDocumentRequest(request);
  const suspensionNotice = onLoginPage ? request.cookies.get(SUSPENSION_NOTICE_COOKIE)?.value : undefined;
  requestHeaders.delete(SUSPENSION_NOTICE_HEADER);
  if (suspensionNotice) requestHeaders.set(SUSPENSION_NOTICE_HEADER, suspensionNotice);

  const response = forward(request, prefixed, path, requestHeaders);
  response.headers.set(CSP_HEADER, policy);
  // Le cookie `g_state` que posait le script de l'invite Google One Tap,
  // retirée depuis : il n'a plus de lecteur, et `/rgpd` ne déclare plus aucun
  // cookie tiers. Effacé au premier document demandé, sur n'importe quelle page
  // — un compte connecté ne repasse jamais par `/connexion`.
  if (request.cookies.has(LEGACY_GOOGLE_ONE_TAP_COOKIE)) {
    response.cookies.delete(LEGACY_GOOGLE_ONE_TAP_COOKIE);
  }
  if (onLoginPage && request.cookies.has(SUSPENSION_NOTICE_COOKIE)) {
    response.cookies.set(SUSPENSION_NOTICE_COOKIE, "", { path: "/", maxAge: 0 });
    // Transition : un cookie posé avant le passage à `path: "/"` vit encore
    // dix minutes sous `/connexion`, et c'est lui que le navigateur envoie en
    // premier (chemin plus précis). Un effacement ne vise qu'un chemin : sans
    // ce second `Set-Cookie`, l'exposé serait relu à chaque visite. Ajouté
    // **après** tout `response.cookies.*`, qui réécrit l'en-tête en entier.
    // À retirer une fois le lot 0 de l'i18n déployé depuis plus de dix minutes.
    response.headers.append("set-cookie", `${SUSPENSION_NOTICE_COOKIE}=; Path=${LEGACY_SUSPENSION_NOTICE_PATH}; Max-Age=0`);
  }
  return response;
}

/**
 * Ce qu'une adresse préfixée reçoit **avant** tout rendu.
 *
 * - `/en/api/…` (et `/fr/api/…`) : **404**, jamais réécrit ni redirigé.
 *   Réécrite vers `/api/…`, une écriture intersite échapperait à
 *   {@link guardApiRequest}, qui ne voit que les chemins commençant par
 *   `/api/` : le 403 `CROSS_SITE_REQUEST` serait contourné.
 * - `/fr/…` : **308** vers l'adresse sans préfixe — une seule URL par contenu.
 * - `/en/<route>` d'une route **pas encore traduite** : **307** vers
 *   `/<route>` (liste blanche `lib/shared/i18n-routes.ts`). Temporaire, parce
 *   que la route le deviendra et qu'un moteur ne doit pas retenir le renvoi.
 *
 * Aucune de ces décisions ne lit `Accept-Language` ni un cookie : seule l'URL
 * dit la langue.
 */
function localeGate(request: NextRequest, path: string, prefixed: Locale | null): NextResponse | null {
  if (prefixed === null) return null;
  if (isApiPath(path)) return new NextResponse(null, { status: 404 });
  if (prefixed === "en" && isMigratedRoute(path)) return null;
  // Adresse absolue sur la racine **publique** (`APP_URL`) : l'adaptateur de
  // Next lit tout `Location` par `new URL` sans base (une adresse relative le
  // fait échouer) et récrit sur l'origine de la requête celui qui la partage —
  // derrière le mandataire, l'origine interne `localhost:3000`, livrée telle
  // quelle au visiteur. Les barres de tête sont réduites à une seule :
  // `/en//hote.tld` donnerait sinon `//hote.tld`, que `new URL` résout hors du
  // site (redirection ouverte) — `\` compte aussi, lu `/` par les navigateurs.
  // Sans `APP_URL` (développement, E2E — en production elle est requise),
  // l'origine de la requête est la bonne : aucun mandataire devant.
  const base = siteBaseUrl() ?? request.nextUrl.origin;
  const target = new URL(`/${path.replace(/^[/\\]+/, "")}${request.nextUrl.search}`, base);
  return NextResponse.redirect(target, prefixed === "en" ? 307 : 308);
}

/** Chargement d'un document, et non `fetch` du routeur (préchargement, navigation client). */
function isDocumentRequest(request: NextRequest): boolean {
  const dest = request.headers.get("sec-fetch-dest");
  return dest === null || dest === "document";
}

/**
 * Les en-têtes de requête que voit le rendu : la langue, et le chemin sans
 * préfixe.
 *
 * `x-bg-locale` reçu d'un client est **toujours** remplacé : seule l'URL dit la
 * langue. `x-pathname` porte le chemin demandé, que Next n'expose à aucun
 * composant serveur — seul `usePathname()` le connaît, et il est client. Or la
 * mise en avant de recrutement se tait sur `/recrutement`, et cette décision
 * doit être prise **avant** le rendu : la prendre après l'hydratation ferait
 * clignoter la modale sur la page même où elle n'a rien à faire. Il porte la
 * route **sans** préfixe — `/recrutement` sous `/en/recrutement` aussi —, la
 * langue voyageant à part.
 */
function localizedRequestHeaders(request: NextRequest, locale: Locale, path: string): Headers {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(LOCALE_HEADER, locale);
  requestHeaders.set(PATHNAME_HEADER, path);
  return requestHeaders;
}

/** Laisse passer la requête, réécrite vers la route sans préfixe si elle en portait un. */
function forward(request: NextRequest, prefixed: Locale | null, path: string, requestHeaders: Headers): NextResponse {
  if (prefixed === null) return NextResponse.next({ request: { headers: requestHeaders } });
  const target = request.nextUrl.clone();
  target.pathname = path;
  return NextResponse.rewrite(target, { request: { headers: requestHeaders } });
}

/**
 * Toute **écriture** sous `/api/` doit venir du site lui-même.
 *
 * `SameSite=Lax` ne refuse le cookie de session qu'à un site **tiers** : un
 * sous-domaine voisin du même domaine est *same-site*, et son formulaire ou son
 * `fetch` fait porter la session du visiteur jusqu'à n'importe quelle route
 * authentifiée — plusieurs d'entre elles agissent sans corps (inscription,
 * départ d'équipe, forfait, avancée d'un tournoi), routes d'administration
 * comprises. Posé ici, le contrôle couvre la route ajoutée demain sans que
 * personne ait à s'en souvenir : c'est le seul endroit par où passent toutes.
 *
 * Les lectures passent sans rien regarder (`NextResponse.next()`, aucun en-tête
 * touché) : rappels OAuth, flux SSE, images servies. Deux écritures anonymes
 * sont exemptées (`PROVENANCE_EXEMPT_API_PATHS`).
 */
function guardApiRequest(request: NextRequest) {
  if (!apiWriteNeedsProvenance(request.nextUrl.pathname, request.method)) {
    return NextResponse.next();
  }
  return rejectCrossSiteRequest(request, { requireJson: false }) ?? NextResponse.next();
}

/**
 * Périmètre du middleware.
 *
 * Trois entrées, pour trois rôles. La première couvre les **pages** — tout
 * sauf `/api/`, les fichiers déjà bâtis et les icônes : une politique n'a rien
 * à dire d'une réponse JSON ou d'une image. Les préchargements du routeur en
 * sont exclus par `missing` : ils ne rendent pas de document, donc leur nonce
 * ne servirait à personne — et chacun en aurait consommé un.
 *
 * La deuxième couvre `/api/`, pour le seul contrôle de provenance des écritures
 * ({@link guardApiRequest}) : aucune politique n'y est posée, et une lecture —
 * la route de flux (`/api/tournaments/[id]/stream`) tient une connexion ouverte
 * — ressort telle qu'elle est entrée.
 *
 * La troisième couvre les adresses anglaises, **préchargements compris** : sans
 * elle, un préchargement de `/en/regles` échapperait au middleware, ne serait
 * pas réécrit et viserait une route inexistante (404 mis en cache, navigation
 * client cassée). Pas de repli par les `rewrites` de `next.config.ts` : elles
 * passent **après** le middleware, qui verrait `/en/api/…` sans le garder.
 */
export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|txt|xml|webmanifest)$).*)", // NOSONAR typescript:S7780 — `config.matcher` doit rester un littéral simple, que Next analyse statiquement à la compilation
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    "/api/:path*",
    "/en/:path*",
  ],
};
