/**
 * Catégories du journal Discord et nature (`kind`) de chaque appel à
 * `POST /internal/log` (`docs/features/LOG_BATCHING.md`).
 *
 * - **Catégorie** : le type de geste. Un lot ne mêle jamais deux catégories :
 *   elle fait partie de la clé du lot.
 * - **Nature** (`kind`) : `log` — trace silencieuse (le bot la poste en
 *   `@silent`) ; `alert` — appelle quelqu'un à agir (le bot notifie).
 *   Elle découle de la catégorie, jamais de l'appelant : une catégorie ne peut
 *   pas être tantôt trace, tantôt alerte.
 *
 * Module pur. Les en-têtes sont des libellés fixes, jamais un nom de joueur
 * (`RGPD_LOGS_AND_VISITS.md`).
 */

/** Nature d'un appel à `/internal/log` : trace silencieuse ou appel à agir. */
export type BotLogKind = "log" | "alert";

/** Catégories du journal, de la plus précise au repli. */
export const BOT_LOG_CATEGORIES = [
  "referees",
  "referee-digest",
  "referee-self-action",
  "staff-removal",
  "casts",
  "results",
  "tournament",
  "registrations",
  "schedule",
  "maps",
  "admin",
  "moderation",
  "signups",
  "general",
] as const;

export type BotLogCategory = (typeof BOT_LOG_CATEGORIES)[number];

/** Catégorie des lignes qui n'en déclarent pas. */
export const DEFAULT_BOT_LOG_CATEGORY: BotLogCategory = "general";

/** Nature de chaque catégorie : `alert` seulement quand la ligne appelle à agir. */
export const BOT_LOG_CATEGORY_KINDS: Record<BotLogCategory, BotLogKind> = {
  referees: "log",
  // Le relevé des matchs à venir sans arbitre : un arbitre doit s'y positionner.
  "referee-digest": "alert",
  // Un arbitre a tranché un match qu'il joue : les autres membres du staff
  // doivent vérifier la décision (`dispute-self-resolution.ts`).
  "referee-self-action": "alert",
  // Un arbitre ou un caster a été retiré d'un match (retrait, remplacement,
  // retrait d'office, opposition retenue) : un créneau se libère, le staff
  // doit le voir et, au besoin, le repourvoir.
  "staff-removal": "alert",
  casts: "log",
  results: "log",
  tournament: "log",
  registrations: "log",
  schedule: "log",
  maps: "log",
  admin: "log",
  moderation: "log",
  signups: "log",
  general: "log",
};

/** En-tête français posé en tête de chaque message d'un lot. */
export const BOT_LOG_CATEGORY_HEADERS: Record<BotLogCategory, string> = {
  referees: "🧑‍⚖️ Arbitrage",
  "referee-digest": "🔔 Matchs à arbitrer",
  "referee-self-action": "⚠️ Arbitrage à vérifier",
  "staff-removal": "⚠️ Retrait d'arbitre ou de caster",
  casts: "🎙️ Casts",
  results: "🏁 Résultats",
  tournament: "🏆 Tournoi",
  registrations: "📝 Inscriptions",
  schedule: "📅 Programme",
  maps: "🗺️ Cartes",
  admin: "🛠️ Administration",
  moderation: "🛡️ Modération",
  signups: "👋 Nouveaux comptes",
  general: "📋 Journal",
};

/** Nature de l'appel `/internal/log` d'une catégorie. */
export function botLogKind(category: BotLogCategory): BotLogKind {
  return BOT_LOG_CATEGORY_KINDS[category];
}

/** En-tête d'une catégorie. */
export function botLogHeader(category: BotLogCategory): string {
  return BOT_LOG_CATEGORY_HEADERS[category];
}
