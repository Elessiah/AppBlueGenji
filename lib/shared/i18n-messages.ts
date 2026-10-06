/**
 * Forme des messages de traduction (`messages/<langue>/<espace>.json`).
 *
 * Un fichier par **espace de noms** (une zone du site : `common`, `nav`,
 * `rules`…) et par langue. Le français est la référence des types : l'anglais
 * doit avoir exactement les mêmes clés (vérifié à la compilation par
 * `lib/server/i18n-messages.ts`, et arguments ICU compris par le test de
 * parité `tests/lib/shared/i18n-messages-parity.test.ts`).
 *
 * Ajouter un espace : créer les deux fichiers, l'ajouter à
 * {@link MESSAGE_NAMESPACES}, à {@link Messages} et au catalogue serveur.
 */
import type frCommon from "@/messages/fr/common.json";
import type frLanding from "@/messages/fr/landing.json";
import type frShell from "@/messages/fr/shell.json";
import type frRules from "@/messages/fr/rules.json";
import type frRanking from "@/messages/fr/ranking.json";
import type frStats from "@/messages/fr/stats.json";
import type frLabels from "@/messages/fr/labels.json";
import type frShare from "@/messages/fr/share.json";
import type frLogin from "@/messages/fr/login.json";
import type frBot from "@/messages/fr/bot.json";
import type frAssociation from "@/messages/fr/association.json";
import type frVolunteers from "@/messages/fr/volunteers.json";
import type frRecruitment from "@/messages/fr/recruitment.json";

export const MESSAGE_NAMESPACES = ["common", "landing", "shell", "rules", "ranking", "stats", "labels", "share", "login", "bot", "association", "volunteers", "recruitment"] as const;
export type MessageNamespace = (typeof MESSAGE_NAMESPACES)[number];

export type Messages = {
  common: typeof frCommon;
  /** Accueil (lot 2) — `lib/shared/landing-text.ts`, `components/i18n/landing-text.tsx`. */
  landing: typeof frLanding;
  /** Coquille partagée (en-têtes, pieds de page, menus, notifications, pages d'erreur) — `components/i18n/shell-text.tsx`. */
  shell: typeof frShell;
  /** Pages `/regles` et `/regles/[slug]` : registre des modes, schémas, sommaire — `lib/shared/tournament-rules.ts`. */
  rules: typeof frRules;
  /** Page `/classement` (lot 4) — `lib/shared/ranking-text.ts`. */
  ranking: typeof frRanking;
  /** Bloc de statistiques des fiches équipe et joueur (lot 4) — `lib/shared/stats-text.ts`. */
  stats: typeof frStats;
  /** Libellés de domaine partagés : format, jeu, état d'un tournoi (lot 4) — `lib/shared/tournament-labels.ts`. */
  labels: typeof frLabels;
  /** Cartes d'aperçu des liens partagés (images Open Graph) — `lib/shared/page-share-cards.ts`. */
  share: typeof frShare;
  login: typeof frLogin;
  /** Pages `/bot` et `/bot/docs` (lot 5a) — `lib/shared/bot-text.ts`. */
  bot: typeof frBot;
  /** Page `/association` (lot 5b) — `lib/shared/association-text.ts`. */
  association: typeof frAssociation;
  /** Page `/benevoles` (lot 5b). */
  volunteers: typeof frVolunteers;
  /** Page `/recrutement` et mise en avant du recrutement (lot 5b) — `lib/shared/recruitment-text.ts`. */
  recruitment: typeof frRecruitment;
};

/**
 * Les seuls espaces de noms qu'un sous-arbre client utilise.
 *
 * Un composant serveur lit ses messages sans rien envoyer au navigateur ; un
 * composant client, lui, reçoit son dictionnaire **sérialisé dans la page**.
 * On n'y met donc que ce qu'il lit (cible : moins de 10 Ko par page publique).
 */
export function pickMessages<N extends MessageNamespace>(messages: Messages, namespaces: readonly N[]): Pick<Messages, N> {
  const picked = {} as Pick<Messages, N>;
  for (const namespace of namespaces) picked[namespace] = messages[namespace];
  return picked;
}
