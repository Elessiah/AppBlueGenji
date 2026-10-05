import { getRequestConfig } from "next-intl/server";
import { SITE_TIME_ZONE } from "@/lib/shared/locales";
import { messagesFor } from "./i18n-messages";
import { requestLocale } from "./request-locale";

/**
 * Configuration de `next-intl` par requête, **sans son routage**
 * (`docs/features/I18N.md`) : la langue vient de l'en-tête que pose le
 * middleware d'après l'URL, jamais d'un segment `[locale]` ni d'un cookie.
 * Désignée à `createNextIntlPlugin` dans `next.config.ts`.
 *
 * Le fuseau est fixé pour toutes les langues : une date de match se lit à
 * l'heure de Paris, en anglais comme en français.
 */
export default getRequestConfig(async () => {
  const locale = await requestLocale();
  return { locale, messages: messagesFor(locale), timeZone: SITE_TIME_ZONE };
});
