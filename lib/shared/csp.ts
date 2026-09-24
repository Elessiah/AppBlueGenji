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
 * Reste l'aveuglement, et c'est le mode qui y a répondu : la politique est
 * partie en **`Report-Only`**, où le navigateur applique tout le raisonnement,
 * signale ce qu'il aurait refusé et ne refuse rien. Elle est depuis **en
 * application** ({@link CSP_MODE}) : les deux obstacles que ce mode avait
 * révélés sont levés, et voici comment, parce que les deux réponses sont moins
 * évidentes que les problèmes.
 *
 * **1. Les pages prérendues n'avaient pas de nonce, et ne pouvaient pas en
 * avoir.** Un nonce change à chaque réponse ; un HTML bâti à la compilation est
 * le même pour tout le monde. Or un nonce présent dans la politique fait
 * **ignorer** `'unsafe-inline'` : en application, leurs scripts en ligne
 * auraient été refusés — sur `/connexion`, la page qui ouvre les sessions.
 *
 * La liste de ces pages a été fausse longtemps, et c'est le cœur de l'affaire.
 * On la lisait sur le résumé de `next build` ; elle se lit dans
 * `.next/prerender-manifest.json`, qui seul dit ce qui est réellement bâti à la
 * compilation. Elle annonçait cinq routes ; il y en avait **trois**, dont une
 * inoffensive :
 *
 * | route | en ligne | nommés | |
 * |---|---|---|---|
 * | `/connexion` | 8 | 0 | le vrai problème |
 * | `/_not-found` | 7 | 0 | hydratation morte sur les 404 |
 * | `/partenaires` | 8 | 0 | **inoffensif** : la route répond `308`, son corps n'est jamais rendu |
 *
 * Les deux qui n'y étaient pas n'y étaient pas pour des raisons différentes.
 * **`/regles/[slug]`** s'affiche `●` au résumé mais n'écrit aucun HTML et ne
 * figure pas au manifeste : elle est rendue à la demande, ce que la production
 * confirmait déjà — deux requêtes rendent deux nonces différents, et ses 26
 * scripts en ligne sont tous nommés. L'arbitrage qu'on croyait devoir trancher
 * à son sujet (« elle est pré-générée à dessein ») n'a jamais existé.
 * **`/opengraph-image`** rend un PNG : `script-src` n'a rien à y dire, et elle
 * reste prérendue — c'est la seule qui le soit encore, et tant mieux, la
 * fabriquer à chaque requête coûterait cher pour chaque robot d'aperçu.
 *
 * La levée ne se fait donc **pas** route par route : elle se fait à la cause.
 * Le HTML de chaque page dépend d'un en-tête de requête — le nonce —, Next ne
 * compte pas cette lecture comme une dépendance dynamique, et `app/layout.tsx`
 * la lui **déclare** d'un `await headers()`. Une liste de routes à annoter
 * aurait dérivé comme celle-ci a dérivé ; une dépendance déclarée à la racine
 * couvre la page qu'on ajoutera demain. Résultat au manifeste : plus une seule
 * page prérendue, `/opengraph-image` exceptée.
 *
 * Le coût est mesuré, `/partenaires` encore statique ayant servi de témoin sur
 * la même compilation, à chaud : médiane **8,3 ms** contre **3,8 ms**, soit
 * ~4,5 ms de rendu serveur par requête, sans accès base ni entrée-sortie, et à
 * paquet client inchangé. Ce qui se perd est la mise en cache du **document**,
 * qui passe sous `private, no-cache, no-store` — déjà le régime de toutes les
 * autres pages, l'en-tête de session s'y trouvant.
 *
 * **2. L'avatar d'un compte Google était servi par Google** — levé par ailleurs
 * (voir `img-src` ci-dessous), la photo étant désormais copiée chez nous.
 *
 * Pour le reste, le site s'y prête mieux qu'il n'y paraît : polices
 * auto-hébergées, la quasi-totalité des appels à Google partant du
 * **serveur**, et toutes les autres images passant par son origine (relais de
 * logos partenaires, `/api/uploads/…`). `'self'` couvre le reste.
 *
 * **3. Google One Tap est la seule iframe du site, et elle est nommée.** Le
 * script `accounts.google.com/gsi/client` rend son invite dans un cadre qui
 * lui appartient — ni `<script src>` ni `fetch` ordinaires n'y suffisent,
 * contrairement à l'échange de code OAuth classique, qui ne quitte jamais le
 * serveur. Quatre directives s'ouvrent donc, et seulement à cette origine :
 * `script-src` (le script lui-même, avec `strict-dynamic` : un hôte seul n'y
 * suffit pas), `frame-src` (le cadre de l'invite), `connect-src` (les appels
 * du script à Google) et `style-src` (la feuille de styles de l'invite,
 * chargée par un `<link>` que `'unsafe-inline'` ne couvre pas — vu en la
 * faisant refuser, avant d'y penser). Rien d'autre ne les emprunte, donc rien d'autre
 * ne peut se faire passer pour Google Identity Services par cette ouverture.
 *
 * L'invite n'est plus chargée que par `/connexion`, et pourtant ces ouvertures
 * restent posées sur **toutes** les pages : une navigation client ne relit pas
 * d'en-tête, le document garde la politique de la page par laquelle on est
 * arrivé. Les réserver à `/connexion` casserait l'invite pour qui y vient par
 * un lien depuis l'accueil — c'est-à-dire presque tout le monde.
 *
 * **Si une page casse après un ajout**, le réflexe est de lire le collecteur
 * (`/api/csp-report`) avant de toucher à la politique : en application, un
 * refus est visible tout de suite, et c'est le seul avantage que ce mode a sur
 * l'autre. Repasser en `Report-Only` reste un mot, le temps d'un diagnostic.
 */

/** Les deux façons de poser la politique : la faire appliquer, ou l'écouter. */
export type CspMode = "enforce" | "report-only";

/**
 * Mode de pose de la politique.
 *
 * `"enforce"` : le navigateur **refuse** ce que la politique interdit. On y est
 * passé après que le mode rapport eut tourné en production et que ses deux
 * obstacles eurent été levés (voir l'en-tête du module). Repasser à
 * `"report-only"` reste un mot, le temps d'un diagnostic — c'est la sortie de
 * secours, pas une position de repli permanente.
 */
export const CSP_MODE: CspMode = "enforce";

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

/**
 * Nom de l'en-tête de requête par lequel le **chemin demandé** atteint les
 * composants serveur.
 *
 * Next ne l'expose nulle part côté serveur — `usePathname()` est un hook
 * client. Le middleware le connaît (`request.nextUrl.pathname`) et le pose,
 * pour que la mise en page racine puisse décider avant de rendre. Il vit ici
 * parce que le middleware est déjà le seul écrivain de ces en-têtes et que ce
 * module est le seul que middleware et composants serveur partagent.
 */
export const PATHNAME_HEADER = "x-pathname";

/** Nom de l'en-tête de requête par lequel le nonce atteint les composants serveur. */
export const CSP_NONCE_HEADER = "x-nonce";

/**
 * Origine de Google Identity Services (One Tap), ouverte à quatre directives
 * (`script-src`, `style-src`, `connect-src`, `frame-src`) — une seule
 * constante plutôt que quatre littéraux, pour qu'un changement d'origine ou
 * une cinquième ouverture ne demande jamais de les retrouver un par un.
 */
const GOOGLE_IDENTITY_ORIGIN = "https://accounts.google.com";

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
 *   endroits en CSS Modules ; c'est un chantier, pas une ligne d'en-tête. Elle
 *   ouvre aussi `https://accounts.google.com` : l'invite One Tap charge sa
 *   propre feuille de styles (`gsi/style`) par un `<link>`, que
 *   `'unsafe-inline'` ne couvre pas — constaté en la faisant refuser, pas
 *   déduit de la documentation de Google.
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
    // Google Identity Services (One Tap) : `strict-dynamic` ignore les hôtes
    // pour tout script chargé *par* un script nommé, mais le premier — le
    // `<script src>` de `gsi/client` lui-même — doit encore porter le nonce
    // pour être accepté (posé côté composant, `components/auth/google-one-tap.tsx`).
    // L'hôte reste listé pour les navigateurs qui ignorent `strict-dynamic`.
    GOOGLE_IDENTITY_ORIGIN,
    ...(options.dev ? ["'unsafe-eval'"] : []),
  ];

  const directives: string[] = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    `style-src 'self' 'unsafe-inline' ${GOOGLE_IDENTITY_ORIGIN}`,
    // `https://lh3.googleusercontent.com` a été admis ici le temps d'une PR :
    // l'avatar d'un compte Google était servi par Google, et le mode rapport
    // l'avait signalé dès le premier chargement — ce qu'aucune lecture du code
    // n'avait vu. La photo est désormais **copiée** chez nous à la connexion
    // (`lib/server/user-avatar-import.ts`), et `visibleAvatarUrl` écarte toute
    // URL qui ne serait pas la nôtre : plus aucune image du site ne vient d'une
    // origine étrangère, donc la ligne est redevenue ce qu'elle décrit.
    //
    // Elle sert maintenant de détecteur : si un écran réintroduisait une image
    // tierce, le collecteur le dirait au premier chargement.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // `accounts.google.com` : les appels que `gsi/client` fait lui-même
    // (résolution du compte, jeton). Rien d'autre côté site ne quitte `'self'`.
    `connect-src 'self' ${GOOGLE_IDENTITY_ORIGIN}`,
    "media-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // Une seule origine ouverte, et nommée : le cadre de l'invite Google One
    // Tap. Aucune autre iframe n'existe dans le site, ni de son côté ni du
    // nôtre — celle-ci mise à part, les deux se ferment.
    // `frame-ancestors` double `X-Frame-Options: SAMEORIGIN`, que les
    // navigateurs récents ignorent au profit de la CSP.
    `frame-src ${GOOGLE_IDENTITY_ORIGIN}`,
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
