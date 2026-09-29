"use client";

import { useEffect, useState } from "react";
import {
  outlineAnchorIds,
  type RulesOutlineEntry,
} from "@/lib/shared/rules-page-outline";
import styles from "./RulesToc.module.css";

import { readingLinePx } from "@/lib/shared/sticky-header";

/**
 * Section en cours : la dernière dont le titre a franchi la ligne de lecture.
 * Rendu `null` tant que rien ne l'a franchie (haut de page).
 */
function currentAnchor(ids: string[]): string | null {
  const line = readingLinePx(getComputedStyle(document.documentElement).scrollPaddingTop);
  let current: string | null = null;
  for (const id of ids) {
    const element = document.getElementById(id);
    if (!element) continue;
    if (element.getBoundingClientRect().top - line <= 0) current = id;
    else break;
  }
  return current;
}

/**
 * Sommaire des pages de règles : colonne collante sur grand écran, bloc de
 * liens en tête de contenu sur mobile. Il dit **où l'on est** (`aria-current`)
 * — c'est ce qui manquait à une page de neuf blocs de même poids. Sans
 * JavaScript, il reste une liste de liens d'ancre qui fonctionne.
 */
export function RulesToc({ entries }: { entries: RulesOutlineEntry[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const ids = outlineAnchorIds(entries);
    let frame = 0;
    const update = () => {
      frame = 0;
      setActive(currentAnchor(ids));
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [entries]);

  return (
    <nav className={styles.toc} aria-label="Sommaire des règles">
      <p className={styles.heading} aria-hidden="true">
        Sommaire
      </p>
      <ol className={styles.list}>
        {entries.map((entry) => {
          const childActive = entry.children?.some((child) => child.id === active) ?? false;
          return (
            <li key={entry.id}>
              <a
                href={`#${entry.id}`}
                className={styles.link}
                aria-current={entry.id === active ? "location" : undefined}
                data-within={childActive ? "true" : undefined}
              >
                {entry.label}
              </a>
              {entry.children && entry.children.length > 0 && (
                <ol className={styles.children}>
                  {entry.children.map((child) => (
                    <li key={child.id}>
                      <a
                        href={`#${child.id}`}
                        className={styles.childLink}
                        aria-current={child.id === active ? "location" : undefined}
                      >
                        {child.label}
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
