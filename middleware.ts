import { NextResponse, type NextRequest } from "next/server";

import { CSP_HEADER, CSP_NONCE_HEADER, PATHNAME_HEADER, contentSecurityPolicy } from "@/lib/shared/csp";

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
  return response;
}

/**
 * Périmètre du middleware.
 *
 * Tout sauf `/api/`, les fichiers déjà bâtis et les icônes : une politique n'a
 * rien à dire d'une réponse JSON ou d'une image, et la route de flux
 * (`/api/tournaments/[id]/stream`) tient une connexion ouverte que rien ne doit
 * venir envelopper.
 *
 * Les préchargements du routeur sont exclus par `missing` : ils ne rendent pas
 * de document, donc leur nonce ne servirait à personne — et chacun en aurait
 * consommé un.
 */
export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|txt|xml)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
