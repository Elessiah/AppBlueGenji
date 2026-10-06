/**
 * `next-intl/server` sous Jest (`moduleNameMapper`, `jest.config.cjs`).
 *
 * Le vrai module ne fonctionne que dans le rendu serveur de Next (condition
 * d'export `react-server`, configuration par requête) ; sous Jest, il lève
 * « not supported in Client Components ». Ce double traduit avec le **vrai**
 * catalogue, en français — la langue d'une page sans préfixe. Un test qui veut
 * l'anglais simule ce module lui-même (`jest.mock("next-intl/server", …)`).
 */
import { createTranslator } from "next-intl";
import { messagesFor } from "@/lib/server/i18n-messages";
import { SITE_TIME_ZONE } from "@/lib/shared/locales";

export async function getTranslations(namespace?: "common" | "common.languageSwitcher") {
  return createTranslator({
    locale: "fr",
    messages: messagesFor("fr"),
    timeZone: SITE_TIME_ZONE,
    namespace,
  });
}

export async function getLocale() {
  return "fr";
}

export function getRequestConfig<T>(factory: T): T {
  return factory;
}
