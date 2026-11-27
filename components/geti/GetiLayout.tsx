"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import styles from "./geti.module.css";

const PendingContext = createContext<(pending: boolean) => void>(() => {});

/** Signale qu'un changement de filtre attend son rendu : la liste se grise et se déclare occupée. */
export function useGetiPending(): (pending: boolean) => void {
  return useContext(PendingContext);
}

/**
 * Grille filtres + résultats. Un changement de filtre met 1 à 3 s à revenir sur
 * un réseau lent : pendant ce temps la grille porte `aria-busy` et
 * `data-pending`, pour que l'ancienne liste ne passe pas pour la réponse.
 */
export function GetiLayout({ single = false, children }: Readonly<{ single?: boolean; children: ReactNode }>) {
  const [pending, setPending] = useState(false);
  const setter = useMemo(() => setPending, []);
  return (
    <PendingContext.Provider value={setter}>
      <div
        className={styles.layout}
        data-single={single ? "true" : undefined}
        data-pending={pending ? "true" : undefined}
        aria-busy={pending}
      >
        {children}
      </div>
    </PendingContext.Provider>
  );
}
