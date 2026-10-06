/**
 * Textes d'un espace de noms formatés **sans** `next-intl` (`lib/shared/message-format.ts`).
 *
 * Socle commun de la coquille (`shell-text.ts`) et de l'accueil (`landing-text.ts`) :
 * leurs composants client sont rendus sur des pages entières, et charger le
 * formateur de `next-intl` dans le navigateur pour eux seuls coûterait ~12 Ko
 * compressés (`docs/features/I18N.md` § Coquille partagée). Le test
 * d'équivalence (`tests/lib/shared/message-format.test.ts`) formate chaque
 * message par ce formateur **et** par `next-intl`, et refuse tout écart.
 */
import type { Locale } from "@/lib/shared/locales";
import { formatMessage, formatMessageParts, type MessageValues, type TagRenderer } from "@/lib/shared/message-format";

/** Chemin pointé de chaque texte d'un arbre de messages (`toast.close`, `hero.stats.players`). */
export type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type ScopedTranslate<K extends string> = (key: K, values?: MessageValues) => string;

export type ScopedText<K extends string> = {
  readonly locale: Locale;
  readonly t: ScopedTranslate<K>;
  /** Texte riche : chaque `<balise>` est rendue par `tags[balise]`. */
  rich<T>(key: K, values: MessageValues, tags: Readonly<Record<string, TagRenderer<T>>>): Array<string | T>;
};

/** Le texte brut d'une clé, sans formatage (`undefined` si elle n'existe pas). */
export function messageAt(messages: object, key: string): string | undefined {
  let node: unknown = messages;
  for (const segment of key.split(".")) {
    node = node !== null && typeof node === "object" ? (node as Record<string, unknown>)[segment] : undefined;
  }
  return typeof node === "string" ? node : undefined;
}

/** Les textes d'un espace de noms dans une langue. */
export function scopedText<M extends object>(locale: Locale, messages: M): ScopedText<Leaves<M>> {
  // Une clé absente est un défaut de typage ou de parité (tests) : on montre la
  // clé plutôt que de faire tomber la page entière.
  const source = (key: string) => messageAt(messages, key) ?? key;
  return {
    locale,
    t: (key, values) => formatMessage(locale, source(key), values),
    rich: (key, values, tags) => formatMessageParts(locale, source(key), values, tags),
  };
}
