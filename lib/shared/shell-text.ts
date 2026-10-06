/**
 * Textes de la coquille partagée (`messages/<langue>/shell.json`) : lien
 * d'évitement, en-têtes, pieds de page, menus, notifications, confirmation,
 * pages d'erreur — `docs/features/I18N.md` § Coquille partagée.
 *
 * Les composants **serveur** de la coquille les lisent par `getTranslations("shell")`
 * (`next-intl`, rien n'est envoyé au navigateur). Les composants **client**, eux,
 * passent par {@link shellText} — via `useShellText()` —, qui formate avec
 * `lib/shared/message-format.ts` sans charger `next-intl` dans le navigateur.
 *
 * Le français est inclus d'office : c'est la langue de toute page sans
 * préfixe, d'un composant rendu hors fournisseur (tests) et le repli de
 * `global-error`, qui remplace la mise en page racine.
 */
import frShell from "@/messages/fr/shell.json";
import type { Locale } from "@/lib/shared/locales";
import { messageAt, scopedText, type Leaves, type ScopedText, type ScopedTranslate } from "@/lib/shared/scoped-text";

export type ShellMessages = typeof frShell;

/** Chemin pointé de chaque texte (`toast.close`, `a11yMenu.settings.focus.label`). */
export type ShellKey = Leaves<ShellMessages>;

export const FR_SHELL_MESSAGES: ShellMessages = frShell;

/** Texte brut d'une clé, arguments ICU remplis. */
export type ShellTranslate = ScopedTranslate<ShellKey>;

export type ShellText = ScopedText<ShellKey>;

/** Le texte brut d'une clé, sans formatage (`undefined` si elle n'existe pas). */
export function shellMessage(messages: ShellMessages, key: string): string | undefined {
  return messageAt(messages, key);
}

/** Les textes de la coquille dans une langue (messages fournis, ou le français). */
export function shellText(locale: Locale, messages: ShellMessages = FR_SHELL_MESSAGES): ShellText {
  return scopedText(locale, messages);
}
