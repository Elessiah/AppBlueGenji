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
import enLanding from "@/messages/en/landing.json";
import frLanding from "@/messages/fr/landing.json";
import enShell from "@/messages/en/shell.json";
import frShell from "@/messages/fr/shell.json";
import enRules from "@/messages/en/rules.json";
import frRules from "@/messages/fr/rules.json";
import enRanking from "@/messages/en/ranking.json";
import frRanking from "@/messages/fr/ranking.json";
import enStats from "@/messages/en/stats.json";
import frStats from "@/messages/fr/stats.json";
import enLabels from "@/messages/en/labels.json";
import frLabels from "@/messages/fr/labels.json";
import type { Locale } from "@/lib/shared/locales";
import type { Messages } from "@/lib/shared/i18n-messages";

const CATALOG: Readonly<Record<Locale, Messages>> = {
  fr: { common: frCommon, landing: frLanding, shell: frShell, rules: frRules, ranking: frRanking, stats: frStats, labels: frLabels },
  en: { common: enCommon, landing: enLanding, shell: enShell, rules: enRules, ranking: enRanking, stats: enStats, labels: enLabels },
};

export function messagesFor(locale: Locale): Messages {
  return CATALOG[locale];
}
