import type { Locale } from "@/lib/shared/locales";
import type { LocalizedPushContent, PushContent } from "@/lib/shared/push-notifications";

/**
 * Rédige un contenu push transmis à `notifyUsers` / `pushToUsers` dans une
 * langue (lot 9-3 : le contenu est une fonction de la langue du destinataire).
 * Par défaut le français, langue de tout compte qui n'en a pas choisi.
 */
export function resolvePush(content: PushContent | LocalizedPushContent, locale: Locale = "fr"): PushContent {
  return typeof content === "function" ? content(locale) : content;
}
