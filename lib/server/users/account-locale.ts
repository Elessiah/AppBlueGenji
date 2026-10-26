/**
 * Langue du compte (`bg_users.locale`, lot 9-3 de la traduction, décision D5).
 *
 * **Ce qu'elle choisit** : la langue des notifications push que le site envoie
 * au joueur (`lib/server/push-subscriptions.ts`) et celle des messages privés
 * Discord qui lui sont adressés (`notifyUsers`, code de connexion —
 * `docs/features/BOT_DM_LANGUAGE.md`) ; les salons Discord restent en français
 * (D6). Les pages, elles, suivent toujours leur adresse (`/en/...`) — la langue
 * du compte ne redirige personne.
 *
 * **Comment elle est posée**, règle retenue pour surprendre le moins :
 *
 * - à chaque **connexion**, la langue de la page d'où le joueur se connecte
 *   (`/connexion` ou `/en/connexion` : langue scellée dans l'aller-retour
 *   OAuth, ou envoyée avec le code Discord) — c'est la langue dans laquelle il
 *   utilise le site. Un départ OAuth venu d'ailleurs que d'une page du site
 *   (lien d'un autre site, favori) connecte sans la changer
 *   (`localeFromPage`, `lib/server/oauth-state.ts`) ;
 * - par un **choix explicite** dans « Mon profil », qui vaut jusqu'à la
 *   prochaine connexion faite dans l'autre langue (l'écran le dit).
 *
 * Défaut `fr` : un compte qui ne s'est pas reconnecté depuis garde le
 * français. Effacée avec le compte, remise au défaut à l'anonymisation
 * (`account-erasure.ts`), exportée avec les données du compte.
 */
import { getDatabase } from "@/lib/server/database";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/shared/locales";

/** Code de refus d'une langue inconnue (`PUT /api/profile/locale`). */
export const INVALID_LOCALE = "INVALID_LOCALE";

/**
 * Enregistre la langue du compte. Une seule instruction, sans lecture
 * préalable ; un compte supprimé n'est jamais touché (`is_deleted = 0`).
 * Rend `true` si une ligne vivante porte désormais cette langue.
 */
export async function recordAccountLocale(userId: number, locale: Locale): Promise<boolean> {
  if (!Number.isInteger(userId) || userId <= 0 || !isLocale(locale)) return false;
  const db = await getDatabase();
  const [result] = await db.execute(`UPDATE bg_users SET locale = ? WHERE id = ? AND is_deleted = 0`, [locale, userId]);
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/**
 * La même écriture **sans jamais faire échouer** ce qui l'appelle : une
 * connexion ne doit pas tomber parce que la langue n'a pas pu s'écrire (base
 * qui n'a pas encore joué l'`ALTER`, par exemple). L'échec reste au journal.
 */
export async function recordLoginLocale(userId: number, locale: Locale): Promise<void> {
  try {
    await recordAccountLocale(userId, locale);
  } catch (error) {
    console.error("[account-locale] langue de connexion non enregistrée", error);
  }
}

/** Une valeur lue en base (ou absente) ramenée à une langue connue. */
export function accountLocaleFromRow(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * Langue d'un compte pour un message privé Discord (`BOT_DM_LANGUAGE.md`) :
 * `null` quand le compte n'existe pas (ou plus) ou que la lecture échoue — le
 * message part alors bilingue, jamais ne tombe.
 */
export async function accountLocaleOf(userId: number): Promise<Locale | null> {
  return readDmLocale(`SELECT locale FROM bg_users WHERE id = ? AND is_deleted = 0 LIMIT 1`, userId);
}

/**
 * Langue du compte du site rattaché à ce compte Discord, pour le code de
 * connexion : `null` sans compte rattaché (première connexion) — message
 * bilingue. Seul le bot la reçoit, pour rédiger le message : la réponse de la
 * route n'en dit rien.
 */
export async function accountLocaleForDiscordId(discordId: string): Promise<Locale | null> {
  return readDmLocale(`SELECT locale FROM bg_users WHERE discord_id = ? AND is_deleted = 0 LIMIT 1`, discordId);
}

async function readDmLocale(sql: string, key: number | string): Promise<Locale | null> {
  try {
    const db = await getDatabase();
    const [rows] = await db.query(sql, [key]);
    const row = (rows as { locale?: unknown }[])[0];
    return row ? accountLocaleFromRow(row.locale) : null;
  } catch (error) {
    console.error("[account-locale] langue du compte illisible, message privé bilingue", error);
    return null;
  }
}
