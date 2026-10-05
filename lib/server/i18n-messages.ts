/**
 * Catalogue des messages de chaque langue — serveur seulement.
 *
 * Importé statiquement : le catalogue reste dans le paquet serveur, et le
 * navigateur n'en reçoit que les espaces de noms qu'un sous-arbre client
 * demande (`components/i18n/IntlMessages.tsx`).
 *
 * Le typage `Record<Locale, Messages>` fait du français la référence : une clé
 * anglaise manquante ou en trop casse `npm run typecheck`.
 */
import enCommon from "@/messages/en/common.json";
import frCommon from "@/messages/fr/common.json";
import type { Locale } from "@/lib/shared/locales";
import type { Messages } from "@/lib/shared/i18n-messages";

const CATALOG: Readonly<Record<Locale, Messages>> = {
  fr: { common: frCommon },
  en: { common: enCommon },
};

export function messagesFor(locale: Locale): Messages {
  return CATALOG[locale];
}
