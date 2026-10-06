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
import { formatMessage, formatMessageParts, type MessageValues, type TagRenderer } from "@/lib/shared/message-format";

export type ShellMessages = typeof frShell;

/** Chemin pointé de chaque texte (`toast.close`, `a11yMenu.settings.focus.label`). */
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type ShellKey = Leaves<ShellMessages>;

export const FR_SHELL_MESSAGES: ShellMessages = frShell;

/** Texte brut d'une clé, arguments ICU remplis. */
export type ShellTranslate = (key: ShellKey, values?: MessageValues) => string;

export type ShellText = {
  readonly locale: Locale;
  readonly t: ShellTranslate;
  /** Texte riche : chaque `<balise>` est rendue par `tags[balise]`. */
  rich<T>(key: ShellKey, values: MessageValues, tags: Readonly<Record<string, TagRenderer<T>>>): Array<string | T>;
};

/** Le texte brut d'une clé, sans formatage (`undefined` si elle n'existe pas). */
export function shellMessage(messages: ShellMessages, key: string): string | undefined {
  let node: unknown = messages;
  for (const segment of key.split(".")) {
    node = node !== null && typeof node === "object" ? (node as Record<string, unknown>)[segment] : undefined;
  }
  return typeof node === "string" ? node : undefined;
}

/** Les textes de la coquille dans une langue (messages fournis, ou le français). */
export function shellText(locale: Locale, messages: ShellMessages = FR_SHELL_MESSAGES): ShellText {
  // Une clé absente est un défaut de typage ou de parité (tests) : on montre la
  // clé plutôt que de faire tomber la page entière.
  const source = (key: ShellKey) => shellMessage(messages, key) ?? key;
  return {
    locale,
    t: (key, values) => formatMessage(locale, source(key), values),
    rich: (key, values, tags) => formatMessageParts(locale, source(key), values, tags),
  };
}
