"use client";

import { useEffect, useRef, useState, useTransition, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { RANKING_MAX_SHOWN, rankingRowId } from "@/lib/shared/ranking-page";
import styles from "./page.module.css";

type RankingMoreProps = {
  /** Lignes affichées (= rang de la dernière). */
  shown: number;
  /** Page suivante (`?n=` + ancre), `null` quand tout est affiché ou le plafond atteint. */
  href: string | null;
  /** Il reste des équipes au-delà des lignes affichées (même au plafond). */
  hasMore: boolean;
};

/** Ce qui suit les lignes affichées : une page de plus, la fin, ou le plafond. */
export type RankingMoreState = "more" | "end" | "capped";

/** Le plafond atteint, dit à l'écran comme à la lecture vocale. */
export const RANKING_CAP_NOTE = `Affichage limité aux ${RANKING_MAX_SHOWN} premières équipes.`;

/** Texte annoncé après un ajout — exporté pour les tests. */
export function rankingAddedMessage(added: number, state: RankingMoreState): string {
  const count = added === 1 ? "1 équipe ajoutée." : `${added} équipes ajoutées.`;
  if (state === "end") return `${count} Fin du classement.`;
  if (state === "capped") return `${count} ${RANKING_CAP_NOTE}`;
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
export function RankingMore({ shown, href, hasMore }: Readonly<RankingMoreProps>) {
  const router = useRouter();
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
    setMessage(rankingAddedMessage(shown - start, state));
  }, [shown, state]);

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
        <a href={href} className={styles.moreLink} onClick={onClick} aria-disabled={pending || undefined}>
          {pending ? "Chargement…" : "Afficher plus"}
        </a>
      ) : null}
      {state === "capped" ? <p className={styles.moreNote}>{RANKING_CAP_NOTE}</p> : null}
    </div>
  );
}
