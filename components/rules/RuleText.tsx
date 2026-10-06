import { Fragment, type ReactNode } from "react";
import type { Locale } from "@/lib/shared/locales";
import { formatMessageParts, type MessageValues } from "@/lib/shared/message-format";

/**
 * Rend un texte des règles (`messages/<langue>/rules.json`) : arguments ICU
 * remplis (`ruleTextValues`), `<b>…</b>` monté en `<strong>`.
 *
 * Composant serveur, sans `next-intl` : les règles sont des listes (sections,
 * puces) que `t()` ne sait pas parcourir, et le formateur réduit de la coquille
 * (`lib/shared/message-format.ts`) les lit tels quels — son équivalence avec
 * `next-intl` est vérifiée message par message
 * (`tests/lib/shared/message-format.test.ts`). Les segments sont des éléments
 * React, jamais du HTML injecté.
 */
export function RuleText({
  text,
  locale,
  values,
}: Readonly<{ text: string; locale: Locale; values?: MessageValues }>) {
  const parts = formatMessageParts<ReactNode>(locale, text, values, {
    b: (children) => <strong>{keyed(children)}</strong>,
  });
  return <>{keyed(parts)}</>;
}

function keyed(parts: ReadonlyArray<ReactNode>): ReactNode {
  return parts.map((part, index) =>
    typeof part === "string" ? part : <Fragment key={index /* NOSONAR S6479 — morceaux d'un texte immuable */}>{part}</Fragment>,
  );
}
