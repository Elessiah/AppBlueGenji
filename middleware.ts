import { NextResponse, type NextRequest } from "next/server";

import { rejectCrossSiteRequest } from "@/lib/server/request-origin";
import { CSP_HEADER, CSP_NONCE_HEADER, PATHNAME_HEADER, contentSecurityPolicy } from "@/lib/shared/csp";
import { apiWriteNeedsProvenance } from "@/lib/shared/request-origin";
import { SUSPENSION_NOTICE_COOKIE } from "@/lib/shared/account-suspension";

/** Cookie de l'invite Google One Tap (retirée), effacé chez qui le porte encore. */
export const LEGACY_GOOGLE_ONE_TAP_COOKIE = "g_state";

/**
 * Pose la politique de sécurité du contenu, avec un nonce par requête.
 *
 * C'est le seul endroit où elle peut être posée : `headers()` de
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
 */
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) return guardApiRequest(request);

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));

  const policy = contentSecurityPolicy(nonce, {
    dev: process.env.NODE_ENV === "development",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);
  requestHeaders.set("content-security-policy", policy);
  // Le chemin demandé, que Next n'expose à aucun composant serveur — seul
  // `usePathname()` le connaît, et il est client. Or la mise en avant de
  // recrutement se tait sur `/recrutement`, et cette décision doit être prise
  // **avant** le rendu : la prendre après l'hydratation ferait clignoter la
  // modale sur la page même où elle n'a rien à faire.
  requestHeaders.set(PATHNAME_HEADER, request.nextUrl.pathname);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CSP_HEADER, policy);
  // Le cookie `g_state` que posait le script de l'invite Google One Tap,
  // retirée depuis : il n'a plus de lecteur, et `/rgpd` ne déclare plus aucun
  // cookie tiers. Effacé au premier document demandé, sur n'importe quelle page
  // — un compte connecté ne repasse jamais par `/connexion`.
  if (request.cookies.has(LEGACY_GOOGLE_ONE_TAP_COOKIE)) {
    response.cookies.delete(LEGACY_GOOGLE_ONE_TAP_COOKIE);
  }
  // L'exposé d'une suspension (`lib/server/oauth-flow.ts`) se lit **une fois** :
  // la page le relit dans la requête, que ce retrait ne touche pas, et la
  // réponse l'efface. Gardé ses dix minutes, il rouvrait la décision — motif
  // compris — à quiconque rouvrait le lien depuis l'historique d'un ordinateur
  // partagé, ou annonçait encore suspendu un compte levé entre-temps.
  if (request.nextUrl.pathname === "/connexion" && request.cookies.has(SUSPENSION_NOTICE_COOKIE)) {
    response.cookies.set(SUSPENSION_NOTICE_COOKIE, "", { path: "/connexion", maxAge: 0 });
  }
  return response;
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
 * Deux entrées, pour deux rôles. La première couvre les **pages** — tout

 * sauf `/api/`, les fichiers déjà bâtis et les icônes : une politique n'a rien
 * à dire d'une réponse JSON ou d'une image. Les préchargements du routeur en
 * sont exclus par `missing` : ils ne rendent pas de document, donc leur nonce
 * ne servirait à personne — et chacun en aurait consommé un.
 *
 * La seconde couvre `/api/`, pour le seul contrôle de provenance des écritures
 * ({@link guardApiRequest}) : aucune politique n'y est posée, et une lecture —
 * la route de flux (`/api/tournaments/[id]/stream`) tient une connexion ouverte
 * — ressort telle qu'elle est entrée.
 */
export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|txt|xml|webmanifest)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    "/api/:path*",
  ],
};
