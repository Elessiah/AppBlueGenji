/**
 * Garde-fous de débit des routes API.
 *
 * Le site tient sur un Raspberry Pi. Le cache
 * (`lib/server/cache.ts`) rend les lectures répétées presque gratuites, mais
 * « presque » n'est pas « rien » : chaque requête coûte encore une
 * désérialisation, une résolution de session, une réponse à sérialiser. Un
 * navigateur qui martèle F5 — ou un onglet parti en boucle — doit finir par se
 * heurter à un mur poli plutôt que par faire tomber le site pour les
 * quatre-vingt-dix-neuf autres.
 *
 * Les plafonds sont **larges** : personne n'y touche en naviguant normalement.
 * Ils bornent l'anormal, ils ne disciplinent pas l'usage.
 */
import { NextResponse } from "next/server";
import {
  ANONYMOUS_IDENTITY,
  consumeRateLimit,
  rateLimitIdentity,
  type RateLimitRule,
} from "./rate-limit";
import { clientIpFromForwardedFor, parseTrustedProxyHops } from "@/lib/shared/site-visits";

/**
 * Le proxy de cette installation écrit-il `X-Real-IP` ?
 *
 * Répond `false` par défaut, et ce défaut est le fond de l'affaire — voir
 * {@link requestClientIp}. La valeur est lue à chaque appel, pas figée à
 * l'import : un test qui la change doit pouvoir le faire sans recharger le
 * module, et le coût d'une lecture d'environnement est nul devant celui d'une
 * requête.
 */
function trustsRealIpHeader(): boolean {
  return process.env.TRUSTED_PROXY_REAL_IP === "true";
}

/**
 * IP du client telle que l'a vue le proxy de confiance.
 *
 * Même lecture que le compteur de fréquentation (`X-Forwarded-For` parcouru
 * depuis la droite sur `TRUSTED_PROXY_HOPS` relais) : un en-tête forgé par le
 * client ne doit pas permettre de se fabriquer une identité neuve à chaque
 * requête, sans quoi le plafond ne borne plus rien.
 *
 * **`X-Real-IP` n'est plus un repli silencieux**, et le raisonnement vaut d'être
 * gardé parce qu'il est contre-intuitif. Ce repli ne se déclenchait que là où
 * `X-Forwarded-For` manquait — c'est-à-dire précisément là où **aucun relais de
 * confiance n'avait écrit quoi que ce soit**, donc là où l'en-tête est forgeable
 * par l'appelant. Il n'aidait jamais un déploiement correctement mandaté (dans
 * lequel il est mort, `X-Forwarded-For` étant toujours présent) et offrait à un
 * appelant non mandaté un **seau neuf à chaque requête** : il affaiblissait le
 * plafond au lieu de le servir, exactement à l'envers de son intention.
 *
 * Il est donc devenu un choix déclaré, `TRUSTED_PROXY_REAL_IP=true`, que seul
 * l'exploitant d'une installation dont le proxy pose `X-Real-IP` et **pas**
 * `X-Forwarded-For` a une raison de poser. Sans déclaration, une identité qu'on
 * ne peut pas établir n'est pas plafonnée — ce que ce module tient déjà par
 * ailleurs : on préfère ne pas compter que compter faux.
 */
export function requestClientIp(req: Request): string | null {
  const forwarded = clientIpFromForwardedFor(
    req.headers.get("x-forwarded-for"),
    parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS),
  );
  if (forwarded !== null) return forwarded;
  return trustsRealIpHeader() ? req.headers.get("x-real-ip") : null;
}

/** Lectures d'un utilisateur connecté : liste et détail des tournois. */
export const TOURNAMENT_READ_RULE: RateLimitRule = {
  name: "tournament-read",
  limit: 90,
  windowMs: 60_000,
};

/** Lectures publiques de la vitrine, par IP. */
export const LANDING_READ_RULE: RateLimitRule = {
  name: "landing-read",
  limit: 180,
  windowMs: 60_000,
};

/**
 * Ouvertures du flux temps réel, par utilisateur.
 *
 * Distinct du plafond de flux *simultanés* (`MAX_STREAMS_PER_USER`) : celui-ci
 * borne le rythme d'ouverture, que le premier laisse passer puisqu'une
 * fermeture libère aussitôt la place. Large : un onglet ouvre un flux et le
 * garde, une reconnexion en rafale est plafonnée par l'attente exponentielle.
 */
export const STREAM_OPEN_RULE: RateLimitRule = {
  name: "tournament-stream-open",
  limit: 30,
  windowMs: 60_000,
};

/**
 * Enregistrement d'une visite, par IP.
 *
 * Plafond de **requêtes**, distinct du plafond d'**insertions** appliqué par
 * `site-visits-service` : celui-ci borne le travail fait avant même de savoir
 * s'il y a une visite à enregistrer (résolution de session, lecture de la
 * fenêtre). Large — un visiteur normal envoie deux pings par heure.
 */
export const VISIT_REQUEST_RULE: RateLimitRule = {
  name: "site-visits-request",
  limit: 60,
  windowMs: 60_000,
};

/**
 * Lectures relayées vers le bot (`/api/bot/*`), par IP.
 *
 * Ces routes ne touchent pas la base : elles rouvrent une requête vers le bot,
 * qui tourne sur la même machine. Le coupe-circuit de `bot-integration` couvre
 * la panne, pas l'affluence — d'où ce plafond, large comme les autres, sur une
 * page de vitrine ouverte sans compte.
 */
export const BOT_READ_RULE: RateLimitRule = {
  name: "bot-read",
  limit: 60,
  windowMs: 60_000,
};

/**
 * Ouvertures du flux d'activité du bot, par IP.
 *
 * Par IP et non par utilisateur : `/bot` est une page de vitrine, ouverte aux
 * visiteurs sans compte. Distinct du plafond de flux *simultanés*
 * (`lib/server/bot-feed-guard.ts`), qui borne ce qui reste ouvert quand
 * celui-ci ne voit qu'un rythme.
 */
export const BOT_FEED_OPEN_RULE: RateLimitRule = {
  name: "bot-feed-open",
  limit: 30,
  windowMs: 60_000,
};

/**
 * Rapports de violation de la politique de sécurité du contenu, par IP.
 *
 * Large, parce que le navigateur décide seul quand envoyer : une page qui
 * viole la politique à trois endroits produit trois rapports par chargement,
 * sans que le visiteur y soit pour rien. Le plafond ne protège donc pas une
 * intention, il borne le travail que peut coûter une origine — le
 * dédoublonnage côté journal fait le reste.
 */
export const CSP_REPORT_RULE: RateLimitRule = {
  name: "csp-report",
  limit: 60,
  windowMs: 60_000,
};

/**
 * Signalements de problème, par utilisateur.
 *
 * Étroit, à rebours des autres plafonds : chaque appel envoie un message privé
 * à tous les arbitres. Un joueur en signale un, éventuellement deux quand la
 * situation évolue — au-delà, c'est du bruit qu'aucun arbitre ne peut trier en
 * pleine soirée de tournoi.
 */
export const ISSUE_REPORT_RULE: RateLimitRule = {
  name: "tournament-issue-report",
  limit: 5,
  windowMs: 10 * 60_000,
};

/**
 * Demandes d'un code de connexion Discord, **par compte Discord visé**.
 *
 * Étroit, comme le signalement de problème et pour une raison voisine : chaque
 * appel envoie un message privé à quelqu'un — ici, à la personne dont on
 * prétend être. Un joueur en demande un, deux si le premier s'est perdu.
 *
 * Le plafond porte sur l'identifiant Discord **résolu par le bot**, et non sur
 * l'IP : c'est le seul axe qu'un attaquant ne peut pas faire tourner, puisqu'il
 * lui faut précisément viser sa victime. Il borne donc deux choses à la fois —
 * le harcèlement par messages privés, et le nombre de codes neufs qu'on peut
 * mettre en jeu (chacun rouvrant un quota d'essais).
 */
export const DISCORD_CODE_REQUEST_RULE: RateLimitRule = {
  name: "discord-code-request",
  limit: 3,
  windowMs: 15 * 60_000,
};

/**
 * Demandes d'un code de connexion Discord, **par IP appelante**.
 *
 * Le plafond par compte visé ne peut être posé qu'**après** avoir résolu le
 * pseudo en identifiant — c'est-à-dire après un aller-retour vers le bot, qui
 * interroge Discord à son tour. Cette route anonyme ouvrait donc une requête
 * sortante par appel, sans borne : celui-ci la ferme au plus tôt, avant la
 * moindre dépense.
 *
 * Par IP, faute de compte à qui l'imputer — le même axe que `BOT_READ_RULE`,
 * qui existe pour la même raison, avec la même faiblesse assumée (une identité
 * absente n'est pas plafonnée) : c'est une borne de coût, pas la garantie de
 * sécurité, qui vit en base (`MAX_DISCORD_CODES_PER_WINDOW`).
 *
 * **Large, et délibérément.** Une IP n'est pas une personne : un tournoi joué en
 * réseau local, un internat, un lycée sortent tous par la même adresse, et
 * quarante joueurs qui se connectent au coup d'envoi sont un usage normal, pas
 * une attaque. Les bornes étroites de cette route sont posées sur le compte
 * visé, là où elles désignent quelque chose ; celle-ci ne borne que la dépense
 * (un aller-retour vers le bot), et un plafond qui refuse la connexion à la
 * moitié d'un plateau coûterait plus cher que ce qu'il économise.
 */
export const DISCORD_CODE_REQUEST_IP_RULE: RateLimitRule = {
  name: "discord-code-request-ip",
  limit: 120,
  windowMs: 15 * 60_000,
};

/**
 * Vérifications d'un code de connexion Discord, **par couple (compte visé, IP
 * appelante)**.
 *
 * Première ligne, gratuite — **pas** la garantie. Le secret est tenu par deux
 * bornes en base : le quota d'essais porté par le code lui-même
 * (`MAX_DISCORD_CODE_ATTEMPTS`, réservé par un `UPDATE … WHERE attempts < ?`)
 * et le nombre de codes délivrables à un compte
 * (`MAX_DISCORD_CODES_PER_WINDOW`). Ce plafond-ci vit dans une `Map` d'un seul
 * processus dont le seau se vide entièrement dès qu'on lui fabrique dix mille
 * clés (`rate-limit.ts`, `bucket.clear()`) — et la clé est justement un
 * identifiant que l'appelant choisit. Il écarte le bruit ; il ne prouve rien.
 *
 * **L'IP appelante est dans la clé, et ce n'est pas cosmétique.** Posé sur le
 * seul compte visé — l'axe de la demande de code —, ce plafond désignait la
 * **victime** : la route est anonyme, l'identifiant Discord d'un joueur se lit
 * dans la réponse de `/api/auth/discord/request`, et dix codes bidon suffisaient
 * alors à fermer la connexion Discord d'un joueur nommé pendant un quart
 * d'heure. Le compte visé est bien le seul axe qu'un attaquant ne peut pas
 * faire tourner — mais c'est précisément ce qui fait de lui un mauvais axe
 * *ici* : le refus retombe sur la personne visée, pas sur l'appelant. Le
 * décompte des essais, lui, reste porté par le code en base, où changer d'IP
 * n'y donne pas droit.
 */
export const DISCORD_CODE_VERIFY_RULE: RateLimitRule = {
  name: "discord-code-verify",
  limit: 10,
  windowMs: 15 * 60_000,
};

/**
 * Certifications de tag Discord, **par compte du site**.
 *
 * L'axe change par rapport à la connexion, et c'est le point à retenir : la
 * route est **authentifiée**, donc il existe enfin quelqu'un à qui imputer
 * l'appel. Ce que le plafond protège n'est plus la victime d'un message privé
 * non sollicité mais la **dépense** — chaque essai résout un tag auprès du bot,
 * qui interroge Discord.
 *
 * Le message privé reste borné par ailleurs, sur le compte Discord visé
 * (`DISCORD_CODE_REQUEST_RULE`) et en base
 * (`MAX_DISCORD_CODES_PER_WINDOW`) : un joueur ne peut pas faire sonner le
 * Discord d'un autre plus souvent en passant par cette route que par la page de
 * connexion.
 *
 * Assez large pour l'usage réel (un joueur se trompe de tag, corrige, réessaie),
 * assez étroit pour qu'une boucle ne coûte rien.
 */
export const DISCORD_VERIFY_TAG_RULE: RateLimitRule = {
  name: "discord-verify-tag",
  limit: 10,
  windowMs: 15 * 60_000,
};

/**
 * Confirmations d'une certification (le code saisi), **par compte du site**.
 *
 * Un seau **distinct** de celui de la demande, et ce n'est pas de la symétrie
 * décorative : les deux gestes se suivent, et partager un seul seau laisse les
 * essais du premier épuiser le quota du second. Un joueur qui se trompe dix fois
 * de tag — chaque essai comptant, même quand la résolution échoue sans rien
 * envoyer — se verrait alors refuser la confirmation d'un code qu'il vient de
 * recevoir, et qui expire en dix minutes. La connexion Discord sépare ses deux
 * règles pour exactement cette raison.
 *
 * Le décompte des essais, lui, reste porté par le code en base
 * (`MAX_DISCORD_CODE_ATTEMPTS`) : ce plafond-ci ne borne que le bruit.
 */
export const DISCORD_VERIFY_CONFIRM_RULE: RateLimitRule = {
  name: "discord-verify-confirm",
  limit: 10,
  windowMs: 15 * 60_000,
};

/**
 * Vérifications d'un `credential` Google One Tap, **par IP appelante**.
 *
 * Comme la demande de code Discord par IP : la route est anonyme (aucun
 * compte connu avant que le jeton ne soit vérifié), donc c'est le seul axe
 * disponible. Ce que le plafond borne n'est pas une session usurpable — la
 * signature du jeton s'en charge — mais la **dépense** : chaque appel peut
 * déclencher une lecture du jeu de clés Google (`cached`, au plus une fois par
 * heure) et, sur un jeton valide, une écriture en base. Large, pour la même
 * raison que `DISCORD_CODE_REQUEST_IP_RULE` : une IP n'est pas une personne.
 */
export const GOOGLE_ONE_TAP_RULE: RateLimitRule = {
  name: "google-one-tap",
  limit: 30,
  windowMs: 15 * 60_000,
};

/**
 * Applique un plafond. Renvoie la réponse 429 à retourner tel quel, ou `null`
 * si la requête peut continuer.
 *
 * **Une identité absente n'est pas plafonnée.** C'est délibéré : sans en-tête
 * de proxy — `next start` exposé directement, reverse-proxy déployé sans
 * `proxy_set_header X-Forwarded-For`, banc d'essai local — *tous* les visiteurs
 * partageraient sinon le même seau, et cent joueurs se verraient refuser la
 * page d'accueil au bout de 180 requêtes cumulées. Le garde-fou provoquerait la
 * panne qu'il doit éviter. On préfère ne pas compter que compter faux : la
 * borne de croissance de la table de fréquentation, elle, reste assurée côté
 * `site-visits-service`, qui plafonne les **insertions**.
 *
 * `Retry-After` est renseigné : un client correct saura attendre plutôt que
 * réessayer aussitôt.
 */
export function enforceRateLimit(
  rule: RateLimitRule,
  identity: string | number | null | undefined,
): NextResponse | null {
  const key = rateLimitIdentity(identity);
  if (key === ANONYMOUS_IDENTITY) return null;

  const state = consumeRateLimit(rule, key);
  if (state.allowed) return null;

  return NextResponse.json(
    { error: "TOO_MANY_REQUESTS" },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, Math.ceil(state.retryAfterMs / 1000))),
        "Cache-Control": "no-store",
      },
    },
  );
}
