/**
 * Langue des messages privés Discord adressés à une personne
 * (`docs/features/BOT_DM_LANGUAGE.md`).
 *
 * Règle de l'association (2026-10-13) : un message privé part dans la langue
 * du compte du site (`bg_users.locale`) quand elle est connue, sinon **un seul**
 * message qui porte le français puis l'anglais. Les messages de salon (#live,
 * canal de logs, salons du staff) restent en français.
 *
 * Le site rédige ce qu'il envoie : chaque message privé est une fonction de la
 * langue ({@link LocalizedDm}), rendue ici pour chaque destinataire. Le bot ne
 * fait que distribuer — sauf le code de connexion, qu'il rédige lui-même sur la
 * langue que le site lui transmet (`sendDiscordLoginCode`).
 *
 * Module pur, importable partout.
 */
import { DEFAULT_LOCALE, localeHref, type Locale } from "./locales";

/**
 * Séparateur entre le français et l'anglais d'un message bilingue. Le bot écrit
 * le même pour ses propres messages (`src/notifications/dmLanguage.ts` de
 * blueGenjiBot) : un joueur reconnaît la coupure d'où qu'elle vienne.
 */
export const BILINGUAL_DM_SEPARATOR = "\n\n**— English —**\n";

/** Un message privé, rédigé dans la langue demandée. */
export type LocalizedDm = (locale: Locale) => string;

/**
 * Plafond d'un message privé côté bot (`MAX_MESSAGE_LENGTH` de blueGenjiBot),
 * qui coupe ce qui dépasse.
 */
export const DM_MAX_LENGTH = 1800;

/**
 * Le français, le séparateur, puis l'anglais : un seul message. Si les deux ne
 * tiennent pas ensemble sous {@link DM_MAX_LENGTH}, le français part seul —
 * entier, plutôt qu'un anglais coupé au milieu d'une phrase par le bot.
 */
export function bilingualDm(text: LocalizedDm): string {
  const french = text("fr");
  const both = french + BILINGUAL_DM_SEPARATOR + text("en");
  return both.length > DM_MAX_LENGTH ? french : both;
}

/**
 * Le message à envoyer à une personne.
 * @param locale Langue du compte, `null` quand elle est inconnue (bilingue).
 */
export function renderDm(text: LocalizedDm, locale: Locale | null): string {
  return locale === null ? bilingualDm(text) : text(locale);
}

/**
 * Une adresse absolue du site, dans la langue du message : `/en/…` pour une
 * page traduite (`localeHref`), inchangée en français, pour une page non
 * traduite ou pour un texte qui n'est pas une adresse. Réservée aux adresses
 * du site : une adresse d'un autre site serait préfixée elle aussi.
 */
export function localizedSiteUrl(url: string, locale: Locale): string;
export function localizedSiteUrl(url: string | null, locale: Locale): string | null;
export function localizedSiteUrl(url: string | null, locale: Locale): string | null {
  if (url === null || locale === DEFAULT_LOCALE) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const localized = localeHref(`${parsed.pathname}${parsed.search}${parsed.hash}`, locale);
  return `${parsed.origin}${localized}`;
}
