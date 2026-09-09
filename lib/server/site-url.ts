/**
 * Sous quel nom le site est servi.
 *
 * `APP_URL` était déjà lue à trois endroits pour rédiger les liens des messages
 * Discord — c'est ce qu'a clos `tournaments/app-url.ts`. Les métadonnées de
 * partage en ont besoin à leur tour, et pour autre chose qu'un tournoi : une
 * URL canonique, une `metadataBase` (à laquelle Next rapporte toute image
 * d'aperçu déclarée en chemin relatif). Cette lecture-ci est donc la racine, et
 * `tournaments/app-url.ts` en descend.
 *
 * Deux fonctions parce qu'il y a deux exigences, pas parce que c'est plus joli :
 *
 * - {@link siteBaseUrl} rend `null` quand la variable n'est pas réglée. Un
 *   message Discord préfère ne pas porter de lien qu'en porter un inventé.
 * - {@link siteMetadataBase} doit rendre une URL **toujours**, `metadataBase`
 *   n'acceptant pas l'absence : sans elle, Next avertit à chaque page et sert
 *   des `og:image` relatives, que les robots d'aperçu ne savent pas résoudre.
 *   Le repli localhost n'est juste qu'en développement — mais en production,
 *   `APP_URL` est de toute façon requise par l'OAuth Google.
 */

/** Repli quand `APP_URL` n'est pas réglée : le port de `next dev`. */
const DEV_FALLBACK_URL = "http://localhost:3000";

/** Racine publique du site, sans barre oblique finale. `null` si inconnue. */
export function siteBaseUrl(): string | null {
  const base = process.env.APP_URL?.trim().replace(/\/+$/, "");
  return base ? base : null;
}

/**
 * Racine à laquelle Next rapporte les URL relatives des métadonnées.
 *
 * Une `APP_URL` illisible ne doit pas faire échouer le rendu de toutes les
 * pages du site : on retombe alors sur le repli, comme si elle était absente.
 */
export function siteMetadataBase(): URL {
  const base = siteBaseUrl();
  if (base) {
    try {
      return new URL(base);
    } catch {
      // Valeur inutilisable (« mon-site.fr » sans protocole, par exemple).
    }
  }
  return new URL(DEV_FALLBACK_URL);
}

/**
 * Racine publique, **toujours** rendue — repli compris.
 *
 * {@link siteBaseUrl} rend `null` quand `APP_URL` manque, ce qui convient à un
 * message Discord (mieux vaut pas de lien qu'un lien inventé) mais pas à ce qui
 * doit produire une URL absolue quoi qu'il arrive : un `sitemap.xml` n'accepte
 * que des adresses complètes, et un `@id` de données structurées relatif ne
 * désigne rien. On y reprend donc le repli de {@link siteMetadataBase}, sans sa
 * barre oblique finale.
 *
 * **Quand la valeur est lue dépend de l'appelant, et il faut le savoir.** Sur
 * une page prérendue (`/regles/[slug]`, qui a un `generateStaticParams`), elle
 * est capturée **à la compilation** : une compilation sans `APP_URL` figerait
 * `http://localhost:3000` dans le HTML publié. Ce n'est pas propre à cette
 * fonction — Next résout déjà `alternates.canonical` et `metadataBase` au même
 * moment sur ces pages —, mais c'est la raison pour laquelle `robots.ts` et
 * `sitemap.ts` sont, eux, rendus à la demande : sur un fichier entier, une
 * racine fausse ne dégrade pas le résultat, elle l'invalide.
 */
export function siteCanonicalBase(): string {
  return siteMetadataBase().href.replace(/\/+$/, "");
}

/** URL absolue d'un chemin du site, ou `null` si la racine est inconnue. */
export function siteUrl(path: string): string | null {
  const base = siteBaseUrl();
  if (!base) return null;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
