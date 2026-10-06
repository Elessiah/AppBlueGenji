/**
 * Typage de `next-intl` pour le site : langues permises et clés de messages.
 * `useTranslations("common")` refuse alors une clé absente du français.
 */
import type { Messages } from "./i18n-messages";
import type { Locale } from "./locales";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
