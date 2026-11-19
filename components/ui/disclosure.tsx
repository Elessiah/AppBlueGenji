"use client";

import { ChevronRight } from "lucide-react";
import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import styles from "./disclosure.module.css";

type DisclosureProps = Readonly<{
  /** Titre du bouton (le titre de section du plan de la page). */
  title: string;
  /** Pastille du nombre d'éléments repliés (« Matchs passés (12) »). */
  count?: number;
  /**
   * Ouverture à la première visite : **repliée** par défaut (réglage d'un écran
   * qui montre d'abord l'utile, `docs/features/CAST_PLANNING.md`).
   */
  defaultOpen?: boolean;
  /**
   * Clé de mémoire de l'état, par appareil (`localStorage` ; sans
   * stockage — navigation privée, accès bloqué — l'état reste celui par défaut).
   * Un écran où plusieurs comptes se relaient sur un même appareil y met
   * l'identifiant du lecteur.
   */
  storageKey?: string;
  /** Garde le contenu monté une fois replié (état local d'un formulaire à ne pas perdre). */
  keepMounted?: boolean;
  /**
   * À côté du titre, hors du bouton : un `<InfoHint>` **nu** (sans
   * `InfoHintRow`) — l'en-tête est déjà la rangée, son explication y passe à la
   * ligne sur toute la largeur.
   */
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

/** Écoute les autres onglets : le choix posé ailleurs se retrouve ici. */
function subscribeStorage(onChange: () => void): () => void {
  globalThis.addEventListener?.("storage", onChange);
  return () => globalThis.removeEventListener?.("storage", onChange);
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
 * lecteur peut être gardé sur son appareil (`storageKey`) —
 * `docs/features/DISCLOSURE.md`.
 */
export function Disclosure({
  title,
  count,
  defaultOpen = false,
  storageKey,
  keepMounted = false,
  aside,
  className,
  children,
}: DisclosureProps) {
  // Le choix fait dans cette visite l'emporte ; sinon la mémoire de l'appareil ; sinon le défaut.
  const [chosen, setChosen] = useState<boolean | null>(null);
  // Le rendu serveur et l'hydratation lisent « rien » (l'état par défaut, sans écart) ;
  // le client relit la mémoire avant la première peinture, sans saut de mise en page.
  const stored = useSyncExternalStore(
    subscribeStorage,
    () => (storageKey === undefined ? null : readStored(storageKey)),
    () => null,
  );
  const open = chosen ?? stored ?? defaultOpen;
  const bodyId = useId();

  const toggle = () => {
    const next = !open;
    setChosen(next);
    if (storageKey !== undefined) writeStored(storageKey, next);
  };

  return (
    <section className={[styles.root, className].filter(Boolean).join(" ")} data-open={open || undefined} data-aside={aside ? "" : undefined}>
      <div className={styles.head}>
        <h2 className={styles.heading}>
          <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={open || keepMounted ? bodyId : undefined} onClick={toggle}>
            <ChevronRight className={styles.caret} size={16} strokeWidth={2} aria-hidden="true" />
            <span>{title}</span>
            {count !== undefined && <span className={styles.count}>({count})</span>}
          </button>
        </h2>
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
