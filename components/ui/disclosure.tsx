"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import styles from "./disclosure.module.css";

type DisclosureProps = Readonly<{
  /** Titre du bouton (le titre de section du plan de la page). */
  title: string;
  /** Pastille du nombre d'éléments repliés (« Matchs passés (12) »). */
  count?: number;
  /** Niveau du titre qui porte le bouton. */
  level?: 2 | 3;
  /**
   * Ouverture à la première visite : **repliée** par défaut (réglage d'un écran
   * qui montre d'abord l'utile, `docs/features/CAST_PLANNING.md`).
   */
  defaultOpen?: boolean;
  /**
   * Clé de mémoire de l'état, par lecteur (`localStorage` ; sans
   * stockage — navigation privée, accès bloqué — l'état reste celui par défaut).
   */
  storageKey?: string;
  /** Garde le contenu monté une fois replié (état local d'un formulaire à ne pas perdre). */
  keepMounted?: boolean;
  /** À côté du titre, hors du bouton (un « i » d'aide). */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}>;

function readStored(key: string): boolean | null {
  try {
    const stored = globalThis.localStorage?.getItem(key);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // Stockage indisponible : l'état par défaut reste.
  }
  return null;
}

function writeStored(key: string, open: boolean): void {
  try {
    globalThis.localStorage?.setItem(key, open ? "1" : "0");
  } catch {
    // Stockage indisponible : le choix vaut pour cette visite seulement.
  }
}

/**
 * Section repliable : un bouton `aria-expanded` / `aria-controls` dans un
 * titre, clavier natif (Entrée, Espace). Repliée par défaut ; le choix du
 * lecteur peut être gardé sur son appareil (`storageKey`).
 */
export function Disclosure({
  title,
  count,
  level = 2,
  defaultOpen = false,
  storageKey,
  keepMounted = false,
  aside,
  className,
  children,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const Heading = level === 2 ? "h2" : "h3";

  // Lu après le montage : le premier rendu est toujours l'état par défaut (hydratation).
  useEffect(() => {
    if (storageKey === undefined) return;
    const stored = readStored(storageKey);
    if (stored !== null) setOpen(stored);
  }, [storageKey]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (storageKey !== undefined) writeStored(storageKey, next);
  };

  return (
    <section className={[styles.root, className].filter(Boolean).join(" ")} data-open={open || undefined}>
      <div className={styles.head}>
        <Heading className={styles.heading}>
          <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={open || keepMounted ? bodyId : undefined} onClick={toggle}>
            <svg className={styles.caret} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{title}</span>
            {count !== undefined && <span className={styles.count}>({count})</span>}
          </button>
        </Heading>
        {aside}
      </div>
      {(open || keepMounted) && (
        <div id={bodyId} className={styles.body} hidden={!open}>
          {children}
        </div>
      )}
    </section>
  );
}
