/**
 * Catalogue des messages de chaque langue — serveur seulement.
 *
 * Importé statiquement : le catalogue reste dans le paquet serveur, et le
 * navigateur n'en reçoit que les espaces de noms qu'un sous-arbre client
 * demande (`components/i18n/IntlMessages.tsx`).
 *
 * Le typage `Record<Locale, Messages>` fait du français la référence : une clé
 * anglaise manquante casse `npm run typecheck`. Une clé **en trop** passe (un
 * import JSON n'est pas un littéral) : c'est le test de parité qui la refuse
 * (`tests/lib/shared/i18n-messages-parity.test.ts`).
 */
import enCommon from "@/messages/en/common.json";
import frCommon from "@/messages/fr/common.json";
import enShell from "@/messages/en/shell.json";
import frShell from "@/messages/fr/shell.json";
import type { Locale } from "@/lib/shared/locales";
import type { Messages } from "@/lib/shared/i18n-messages";

const CATALOG: Readonly<Record<Locale, Messages>> = {
  fr: { common: frCommon, shell: frShell },
  en: { common: enCommon, shell: enShell },
};

export function messagesFor(locale: Locale): Messages {
  return CATALOG[locale];
}
