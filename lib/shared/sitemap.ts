/**
 * Ce que le site déclare aux moteurs de recherche.
 *
 * Le site n'avait ni `robots.txt` ni `sitemap.xml` — vérifié en production, les
 * deux répondaient `404`. Un moteur n'y trouvait donc aucune porte d'entrée :
 * il devait deviner la vitrine en suivant les liens de l'accueil, et rien ne lui
 * disait où était la limite entre ce qui se lit et ce qui demande un compte.
 *
 * Ce registre est la liste de ce qu'un robot **peut indexer**, et rien d'autre.
 * Trois exclusions, chacune pour sa raison :
 *
 * - **l'espace sécurisé** (`/tournois`, `/equipes`, `/joueurs`, `/profil`) porte
 *   `robots: noindex` : un visiteur non connecté n'y voit qu'une carte
 *   « Connexion requise », il n'y a rien à référencer. Annoncer au sitemap une
 *   page qu'on demande par ailleurs d'ignorer est une contradiction que Google
 *   signale comme telle ;
 * - **`/connexion`** pour la même raison, avec en plus ses variantes
 *   `?redirect=` qui multiplient l'URL à l'infini ;
 * - **`/partenaires`**, qui n'est plus qu'une redirection permanente vers
 *   `/#sponsors` : un sitemap annonce des destinations, pas des renvois.
 *
 * Le module est pur — il ne connaît ni Next.js ni l'URL du site — pour que la
 * liste se relise et se teste sans monter un serveur. L'appelant
 * (`app/sitemap.ts`) rend les chemins absolus.
 */
import { TOURNAMENT_RULE_MODES } from "./tournament-rules";

/** Rythme de changement annoncé au robot, dans le vocabulaire du protocole. */
export type SitemapChangeFrequency = "daily" | "weekly" | "monthly" | "yearly";

export type SitemapRoute = {
  /** Chemin absolu du site, barre oblique de tête comprise. */
  path: string;
  changeFrequency: SitemapChangeFrequency;
  /** Poids relatif dans le site, de 0 à 1. Ne vaut qu'entre pages du site. */
  priority: number;
};

/**
 * Les pages de la vitrine, dans l'ordre où elles comptent.
 *
 * Les priorités ne sont pas décoratives : elles disent au robot par où
 * commencer quand il ne peut pas tout parcourir. L'accueil et l'association
 * portent l'identité, les règles portent le contenu qu'on vient chercher, le
 * légal ferme la marche — il doit être atteignable, pas mis en avant.
 */
const SHOWCASE_ROUTES: readonly SitemapRoute[] = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  { path: "/association", changeFrequency: "monthly", priority: 0.8 },
  { path: "/regles", changeFrequency: "monthly", priority: 0.7 },
  { path: "/bot", changeFrequency: "monthly", priority: 0.6 },
  { path: "/recrutement", changeFrequency: "weekly", priority: 0.6 },
  { path: "/benevoles", changeFrequency: "monthly", priority: 0.5 },
  { path: "/mentions-legales", changeFrequency: "yearly", priority: 0.2 },
  { path: "/rgpd", changeFrequency: "yearly", priority: 0.2 },
  { path: "/privacy-policy-bot", changeFrequency: "yearly", priority: 0.1 },
  { path: "/terms-of-service-bot", changeFrequency: "yearly", priority: 0.1 },
];

/**
 * Toutes les pages indexables du site.
 *
 * Les pages de règles descendent du **registre des modes**, pas d'une seconde
 * liste écrite à la main : ajouter un mode de tournoi ajoute sa page (elles sont
 * déjà pré-générées depuis ce même registre), et le sitemap suit sans qu'on y
 * pense — une liste recopiée aurait dérivé au premier mode ajouté, et la panne
 * aurait été muette.
 *
 * Les pages de documentation du bot suivent la même règle, mais leur registre
 * vit côté serveur (il lit des fichiers sur disque) : l'appelant passe les
 * identifiants, ce module garde la décision de forme. On ne liste que
 * `/bot/docs/<section>` et **jamais** `/bot/docs` tout court, qui rend la
 * première section — la page le dit déjà en désignant `/bot/docs/guide` comme
 * son adresse canonique, et un sitemap ne doit pas la contredire.
 */
export function publicSitemapRoutes(botDocSlugs: readonly string[] = []): SitemapRoute[] {
  const rules: SitemapRoute[] = TOURNAMENT_RULE_MODES.map((mode) => ({
    path: `/regles/${mode.slug}`,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  const botDocs: SitemapRoute[] = botDocSlugs.map((slug) => ({
    path: `/bot/docs/${slug}`,
    changeFrequency: "weekly",
    priority: 0.4,
  }));

  return [...SHOWCASE_ROUTES, ...rules, ...botDocs];
}

/**
 * Ce que `robots.txt` interdit d'explorer.
 *
 * La liste est **courte, et volontairement** : on n'y met que ce qui n'a pas de
 * page pour parler à sa place. Interdire l'exploration de l'espace sécurisé
 * serait un contresens classique — un robot à qui l'on interdit de lire la page
 * ne lit pas non plus le `noindex` qu'elle porte, et peut donc indexer l'URL
 * seule, sans titre. On laisse ces pages accessibles pour que la directive soit
 * lue et obéie.
 *
 * Restent les routes d'API : elles ne rendent pas de page, ne portent aucune
 * balise, et leur exploration n'apporte rien à personne.
 */
export const SITEMAP_DISALLOWED_PATHS: readonly string[] = ["/api/"];
