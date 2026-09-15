/**
 * Politique de sécurité du contenu (CSP) du site, et son mode de pose.
 *
 * Le projet a longtemps décidé de n'en poser aucune, pour une raison qui
 * tenait : « Next injecte ses propres scripts en ligne, une politique écrite à
 * l'aveugle casserait la page sans qu'aucun test ne le voie ». Les deux
 * moitiés de cette phrase se traitent séparément.
 *
 * Les scripts en ligne de Next se **nomment** : un nonce tiré par requête et
 * posé dans l'en-tête suffit à ce que Next l'appose lui-même sur chacun de ses
 * `<script>`. Mesuré sur l'accueil : 141 balises sur 142 le portent, la
 * cent-quarante-deuxième étant le JSON-LD (`type="application/ld+json"`), que
 * le navigateur ne considère pas comme du script exécutable et n'inspecte donc
 * pas. Il n'y a rien à deviner de ce côté.
 *
 * Reste l'aveuglement, et c'est le mode qui y répond : la politique part en
 * **`Content-Security-Policy-Report-Only`**. Le navigateur applique tout le
 * raisonnement, signale ce qu'il aurait refusé, et ne refuse rien. La page ne
 * peut pas casser ; ce que les tests ne voient pas, les rapports le disent.
 * Passer en application se fera d'un seul mot ({@link CSP_MODE}), une fois les
 * rapports silencieux — et la machinerie aura déjà tourné en production.
 *
 * **Deux choses restent à régler avant ce mot, et les deux sont mesurées, pas
 * supposées** — c'est précisément ce que le mode rapport a apporté :
 *
 * 1. **Les pages prérendues n'ont pas de nonce, et ne peuvent pas en avoir.**
 *    Un nonce change à chaque réponse ; un HTML bâti à la compilation est le
 *    même pour tout le monde. `/connexion` porte 18 balises `<script>` dont
 *    **8 en ligne**, aucune nommée ; `/partenaires` en porte 13 dont 8. Or un
 *    nonce présent dans la politique fait **ignorer** `'unsafe-inline'` : en
 *    application, ces huit-là seraient refusées. Cela vaut pour les cinq
 *    routes prérendues (`/connexion`, `/partenaires`, `/regles/[slug]`,
 *    `/_not-found`, `/opengraph-image`). Les rendre dynamiques lèverait
 *    l'obstacle, mais `/regles/[slug]` est pré-générée à dessein
 *    (`generateStaticParams`) : c'est un arbitrage à trancher, pas un détail
 *    d'en-tête.
 * 2. **L'avatar d'un compte Google est servi par Google** — voir `img-src`
 *    ci-dessous et `ERREUR.txt`.
 *
 * Pour le reste, le site s'y prête mieux qu'il n'y paraît : **aucune iframe**,
 * polices auto-hébergées, appels à Google partant du **serveur**, et toutes
 * les autres images passant par son origine (relais de logos partenaires,
 * `/api/uploads/…`). `'self'` couvre le reste.
 */

/** Les deux façons de poser la politique : la faire appliquer, ou l'écouter. */
export type CspMode = "enforce" | "report-only";

/**
 * Mode de pose de la politique.
 *
 * `"report-only"` tant que les rapports ne sont pas silencieux. Le jour où ils
 * le sont, ce mot devient `"enforce"` : c'est le seul changement à faire.
 */
export const CSP_MODE: CspMode = "report-only";

/**
 * En-tête correspondant au mode courant.
 *
 * Une table plutôt qu'un ternaire, et pas par goût : TypeScript réduit une
 * constante de module à la valeur littérale qu'on lui donne, si bien que la
 * comparaison `CSP_MODE === "enforce"` se compile en « ces deux types n'ont
 * aucun recouvrement » — une erreur, sur du code pourtant juste. Une table
 * indexée par le mode ne compare rien, et rend le jour du basculement
 * strictement égal à un mot changé plus haut.
 */
const CSP_HEADERS: Record<CspMode, string> = {
  enforce: "content-security-policy",
  "report-only": "content-security-policy-report-only",
};

/** En-tête de réponse à poser, dérivé du mode. */
export const CSP_HEADER = CSP_HEADERS[CSP_MODE];

/** Chemin de collecte des violations, cité par la politique elle-même. */
export const CSP_REPORT_PATH = "/api/csp-report";

/** Nom de l'en-tête de requête par lequel le nonce atteint les composants serveur. */
export const CSP_NONCE_HEADER = "x-nonce";

/**
 * Rédige la politique.
 *
 * Deux directives méritent leur justification, les autres se lisent seules :
 *
 * - `script-src` porte le nonce **et** `'strict-dynamic'` : sans lui, un script
 *   nommé qui en charge un autre verrait le second refusé, alors que Next
 *   charge précisément ses morceaux de cette façon. `'unsafe-inline'` figure
 *   en queue à l'usage des navigateurs qui ignorent le nonce — ceux qui le
 *   comprennent l'écartent d'office, donc il n'affaiblit rien.
 * - `style-src` garde `'unsafe-inline'`, sans échappatoire : le site pose des
 *   styles en ligne (`style={{…}}`) à de nombreux endroits, et un nonce ne
 *   couvre pas un attribut `style`. La restreindre demanderait de réécrire ces
 *   endroits en CSS Modules ; c'est un chantier, pas une ligne d'en-tête.
 *
 * @param nonce Nonce de la requête, déjà encodé en base64.
 * @param options `dev` autorise `'unsafe-eval'`, dont le rafraîchissement à chaud de Next a besoin.
 * @returns La politique, prête à être posée en en-tête.
 */
export function contentSecurityPolicy(nonce: string, options: { dev: boolean }): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "'unsafe-inline'",
    ...(options.dev ? ["'unsafe-eval'"] : []),
  ];

  const directives: string[] = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    // L'avatar d'un compte Google est servi par Google : `createOrGetGoogleUser`
    // stocke l'URL de `picture` telle quelle, et `UserAvatar` la rend en
    // `unoptimized`, donc le navigateur du visiteur va la chercher là-bas. Le
    // mode rapport l'a signalé dès le premier chargement, ce qu'aucune lecture
    // du code n'avait vu. L'hôte est donc admis — une politique qui décrit un
    // site qui n'existe pas ne pourra jamais être appliquée, et c'est
    // l'application qui est le but. Le proxifier comme on proxifie déjà les
    // logos partenaires reste la bonne fin de l'histoire (voir `ERREUR.txt`) ;
    // ce jour-là, cette ligne redevient `'self' data: blob:`.
    "img-src 'self' data: blob: https://lh3.googleusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // Aucune iframe dans le site, ni de son côté ni du nôtre : les deux se
    // ferment. `frame-ancestors` double `X-Frame-Options: SAMEORIGIN`, que les
    // navigateurs récents ignorent au profit de la CSP.
    "frame-src 'none'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    // `base-uri` n'a pas d'équivalent ailleurs : une balise `<base>` injectée
    // réécrirait toutes les URL relatives de la page, formulaire compris.
    "base-uri 'self'",
    "form-action 'self'",
    `report-uri ${CSP_REPORT_PATH}`,
  ];

  return directives.join("; ");
}
