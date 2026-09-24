/**
 * Les fournisseurs d'identité par lesquels on entre sur le site.
 *
 * **Il n'y a pas de mot de passe ici.** Un compte n'existe que par les portes
 * énumérées ci-dessous, et c'est ce qui donne à ce module sa raison d'être :
 * trois listes écrites à la main — une pour les boutons de `/connexion`, une
 * pour les routes, une pour la section « Applications connectées » du profil —
 * auraient divergé au premier fournisseur ajouté, et la divergence aurait pris
 * la forme d'un bouton qui mène à une route qui n'existe pas.
 *
 * Module **pur** : aucune requête, aucun secret, aucun accès serveur. Il est lu
 * par le client (les boutons) autant que par le serveur (les routes).
 *
 * **Ce que chaque fournisseur donne, et rien de plus.** La règle de la maison
 * est de ne demander que ce qui sert :
 *
 * - **Google** — `openid profile`. Ni l'adresse, ni le scope qui la demande :
 *   depuis que plus rien ne rattache un compte par son e-mail, elle n'avait
 *   plus un seul lecteur, et une colonne d'adresses est exactement ce qu'une
 *   fuite fait le plus regretter ;
 * - **Discord** — `identify`. L'identifiant et le pseudo, qui *est* le tag que
 *   la certification publie à l'arbitrage ;
 * - **Blizzard** — `openid`. L'identifiant et le BattleTag.
 */

/** Une porte d'entrée du site. */
export type OAuthProvider = "GOOGLE" | "DISCORD" | "BLIZZARD";

/**
 * Tous les fournisseurs, dans l'ordre où les écrans les présentent.
 *
 * Google en tête parce qu'il n'exige rien de particulier ; Discord ensuite,
 * parce que c'est là que vit la communauté ; Blizzard en dernier, réservé à qui
 * joue à Overwatch.
 */
export const OAUTH_PROVIDERS: readonly OAuthProvider[] = ["GOOGLE", "DISCORD", "BLIZZARD"];

/** Nom du fournisseur tel qu'il s'affiche. */
export const OAUTH_PROVIDER_LABELS: Record<OAuthProvider, string> = {
  GOOGLE: "Google",
  DISCORD: "Discord",
  BLIZZARD: "Blizzard",
};

/**
 * Segment d'URL du fournisseur : `/api/auth/<slug>/start`, `/api/auth/<slug>/callback`.
 *
 * Séparé du nom affiché, qui est du texte et peut changer sans que les routes
 * bougent.
 */
export const OAUTH_PROVIDER_SLUGS: Record<OAuthProvider, string> = {
  GOOGLE: "google",
  DISCORD: "discord",
  BLIZZARD: "blizzard",
};

/**
 * Ce que le fournisseur apporte comme **identité affichable**, dit au joueur
 * avant qu'il ne clique.
 *
 * `null` quand il n'apporte qu'un identifiant opaque : c'est le cas de Google,
 * dont le `sub` ne se montre à personne.
 */
export const OAUTH_PROVIDER_HANDLE_LABELS: Record<OAuthProvider, string | null> = {
  GOOGLE: null,
  DISCORD: "Tag Discord",
  BLIZZARD: "BattleTag",
};

/** Ce que l'aller-retour OAuth vient faire : ouvrir une session, ou rattacher. */
export type OAuthIntent = "LOGIN" | "LINK";

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Retrouve le fournisseur depuis son segment d'URL.
 *
 * Rend `null` sur tout le reste — la valeur vient d'une URL, elle n'est jamais
 * de confiance.
 */
export function oauthProviderFromSlug(slug: string | null | undefined): OAuthProvider | null {
  const normalized = (slug ?? "").trim().toLowerCase();
  for (const provider of OAUTH_PROVIDERS) {
    if (OAUTH_PROVIDER_SLUGS[provider] === normalized) return provider;
  }
  return null;
}

/**
 * Adresse à laquelle envoyer le navigateur pour démarrer un aller-retour.
 *
 * Écrite ici plutôt qu'à chaque bouton : `redirect` et `intent` sont deux
 * paramètres qu'on oublie à moitié, et un `intent=link` manquant transforme
 * silencieusement un rattachement en **changement de session** — le joueur
 * croyait ajouter un moyen de connexion, il vient de se connecter sur un autre
 * compte.
 */
export function oauthStartPath(
  provider: OAuthProvider,
  options: { redirect?: string; intent?: OAuthIntent; termsAccepted?: boolean } = {},
): string {
  const params = new URLSearchParams();
  if (options.redirect) params.set("redirect", options.redirect);
  if (options.intent === "LINK") params.set("intent", "link");
  // Les conditions d'utilisation, cochées à l'entrée de `/connexion` : sans
  // elles, la porte refuse de **créer** un compte (`TERMS_REQUIRED`).
  if (options.termsAccepted) params.set("terms", "1");
  const query = params.toString();
  return `/api/auth/${OAUTH_PROVIDER_SLUGS[provider]}/start${query ? `?${query}` : ""}`;
}
