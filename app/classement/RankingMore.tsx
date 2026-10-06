"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type MouseEvent } from "react";
import { useAppLocale } from "@/components/i18n/locale-context";
import { useLocaleHref, useLocaleRouter } from "@/components/i18n/locale-navigation";
import { RANKING_MAX_SHOWN, rankingRowId } from "@/lib/shared/ranking-page";
import { rankingMoreText, type RankingMoreMessages, type RankingMoreText } from "@/lib/shared/ranking-text";
import styles from "./page.module.css";

type RankingMoreProps = {
  /** Lignes affichées (= rang de la dernière). */
  shown: number;
  /** Page suivante (`?n=` + ancre, sans préfixe de langue), `null` quand tout est affiché ou le plafond atteint. */
  href: string | null;
  /** Il reste des équipes au-delà des lignes affichées (même au plafond). */
  hasMore: boolean;
  /**
   * Textes du bouton, dans la langue de la page — seul espace de `ranking` qui
   * voyage jusqu'au navigateur (`docs/features/I18N.md` § Classement).
   */
  messages: RankingMoreMessages;
};

/** Ce qui suit les lignes affichées : une page de plus, la fin, ou le plafond. */
export type RankingMoreState = "more" | "end" | "capped";

/** Le plafond atteint, dit à l'écran comme à la lecture vocale. */
export function rankingCapNote(text: RankingMoreText): string {
  // Chaîne, et non nombre : `{max}` reste « 1000 » dans les deux langues, comme avant.
  return text.t("capped", { max: String(RANKING_MAX_SHOWN) });
}

/** Texte annoncé après un ajout — exporté pour les tests. */
export function rankingAddedMessage(text: RankingMoreText, added: number, state: RankingMoreState): string {
  const count = text.t("added", { count: added });
  if (state === "end") return `${count} ${text.t("end")}`;
  if (state === "capped") return `${count} ${rankingCapNote(text)}`;
  return count;
}

/**
 * « Afficher plus » du classement. Sans JavaScript, un simple lien : la page
 * se recharge avec `?n=` et descend sur la première ligne ajoutée. Avec, la
 * navigation reste côté client (rendu serveur rafraîchi, sans rechargement ni
 * défilement), le focus va à la première nouvelle ligne et une région `<output>` (rôle `status`)
 * annonce le nombre de lignes ajoutées.
 *
 * Toujours rendu sous le tableau, même sans page suivante : la région vivante
 * doit exister avant l'annonce, et l'état survit au rafraîchissement.
 */
export function RankingMore({ shown, href, hasMore, messages }: Readonly<RankingMoreProps>) {
  const router = useLocaleRouter();
  const locale = useAppLocale();
  const toLocale = useLocaleHref();
  const text = useMemo(() => rankingMoreText(locale, messages), [locale, messages]);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const from = useRef<number | null>(null);

  let state: RankingMoreState = "end";
  if (hasMore) state = href === null ? "capped" : "more";

  useEffect(() => {
    const start = from.current;
    if (start === null || shown <= start) return;
    from.current = null;
    document.getElementById(rankingRowId(start + 1))?.focus();
    setMessage(rankingAddedMessage(text, shown - start, state));
  }, [shown, state, text]);

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    // Nouvel onglet, fenêtre, téléchargement : le navigateur s'en charge.
    if (!href || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (pending) return;
    from.current = shown;
    setMessage("");
    startTransition(() => router.push(href.split("#")[0], { scroll: false }));
  }

  return (
    <div className={styles.more}>
      <output className="sr-only">{message}</output>
      {href ? (
        <a href={toLocale(href)} className={styles.moreLink} onClick={onClick} aria-disabled={pending || undefined}>
          {pending ? text.t("loading") : text.t("showMore")}
        </a>
      ) : null}
      {state === "capped" ? <p className={styles.moreNote}>{rankingCapNote(text)}</p> : null}
    </div>
  );
}
