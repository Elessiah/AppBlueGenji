/**
 * Textes de l'accueil (`messages/<langue>/landing.json`) — lot 2 de la
 * traduction, `docs/features/I18N.md` § Accueil.
 *
 * Même mécanique que la coquille (`shell-text.ts`) : formatés par
 * `lib/shared/message-format.ts`, **sans** `next-intl` dans le navigateur. Le
 * français est inclus d'office — langue de toute page sans préfixe et d'un
 * composant rendu hors fournisseur (tests, pages pas encore traduites qui
 * réutilisent un composant de l'accueil : `Ticker`, `CountdownStrip`,
 * `AboutSection`, `SponsorsGrid`).
 *
 * Côté serveur, `landingServerText(locale)` (`lib/server/i18n-landing.ts`) ;
 * côté client, `useLandingText()` (`components/i18n/landing-text.tsx`).
 */
import frLanding from "@/messages/fr/landing.json";
import type { Locale } from "@/lib/shared/locales";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";

export type LandingMessages = typeof frLanding;
export type LandingKey = Leaves<LandingMessages>;
export type LandingText = ScopedText<LandingKey>;

export const FR_LANDING_MESSAGES: LandingMessages = frLanding;

/** Les textes de l'accueil dans une langue (messages fournis, ou le français). */
export function landingText(locale: Locale, messages: LandingMessages = FR_LANDING_MESSAGES): LandingText {
  return scopedText(locale, messages);
}

/** Étiquette BCP 47 des formats de date et de nombre de l'accueil. */
/**
 * Espaces que lisent les composants **clients** de l'accueil (`useLandingText`).
 * Seuls eux voyagent jusqu'au navigateur sous `/en` : `meta`, `board`,
 * `calendar`, `leaderCal`, `about` et `join` ne servent qu'au rendu serveur
 * (`landingServerText`). Un composant client qui lirait un autre espace doit
 * l'ajouter ici (`tests/lib/shared/landing-client-messages.test.ts`).
 */
export const LANDING_CLIENT_NAMESPACES = [
  "common",
  "hero",
  "countdown",
  "discord",
  "live",
  "ticker",
  "leaderboard",
  "sponsors",
] as const satisfies ReadonlyArray<keyof LandingMessages>;

export type LandingClientNamespace = (typeof LANDING_CLIENT_NAMESPACES)[number];
export type LandingClientMessages = Pick<LandingMessages, LandingClientNamespace>;

/** La part des messages d'une langue que lisent les composants clients. */
export function landingClientMessages(messages: LandingMessages): LandingClientMessages {
  return Object.fromEntries(LANDING_CLIENT_NAMESPACES.map((ns) => [ns, messages[ns]])) as LandingClientMessages;
}

export const LANDING_INTL_LOCALE: Readonly<Record<Locale, string>> = { fr: "fr-FR", en: "en-US" };
