/**
 * Textes de l'accueil pour un composant **serveur** (`lib/shared/landing-text.ts`).
 *
 * Synchrone, à la différence de `getTranslations` : les sections serveur de
 * l'accueil (`TournamentBoard`, `LeaderCal`, `JoinCTA`, `AboutSection`) restent
 * des fonctions simples, rendues telles quelles par les tests.
 */
import { messagesFor } from "@/lib/server/i18n-messages";
import { landingText, type LandingText } from "@/lib/shared/landing-text";
import type { Locale } from "@/lib/shared/locales";

export function landingServerText(locale: Locale): LandingText {
  return landingText(locale, messagesFor(locale).landing);
}
