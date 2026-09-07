"use client";

import type { CSSProperties, ReactNode } from "react";
import styles from "./BoardPanel.module.css";

interface BoardPanelProps {
  /** Couleur d'accent du volet (celle du tableau ou du mode). */
  accent: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  /** Identifiant du corps, cible de l'`aria-controls` de l'en-tête. */
  panelId: string;
  /** Pastilles neutres à droite du titre (nombre de matchs, avancement…). */
  meta?: ReactNode;
  /** Marque poussée à droite, dans l'accent (« ★ Votre match »). */
  flag?: string | null;
  /**
   * Cadre mis en avant **même replié** : le volet contient quelque chose qui
   * concerne le lecteur, et il doit se repérer sans avoir à tout déplier.
   */
  highlighted?: boolean;
  children: ReactNode;
}

/**
 * Volet repliable d'un plateau de tournoi.
 *
 * Le chrome (chevron, titre, pastilles, marque du lecteur, `aria-expanded` /
 * `aria-controls`) était écrit dans `BracketSections` ; les manches de BlueGenji
 * Survie en demandent exactement le même, et deux copies auraient divergé au
 * premier réglage. Ce composant ne porte **que** l'habillage : ce qu'un volet
 * contient et lequel s'ouvre restent la décision de l'appelant.
 */
export function BoardPanel({
  accent,
  title,
  open,
  onToggle,
  panelId,
  meta,
  flag = null,
  highlighted = false,
  children,
}: BoardPanelProps) {
  return (
    <div
      className={`${styles.panel} ${open || highlighted ? styles.panelActive : ""}`}
      style={{ "--panel-accent": accent } as CSSProperties}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={`${styles.head} ${open ? styles.headOpen : ""}`}
      >
        <span aria-hidden className={`${styles.caret} ${open ? styles.caretOpen : ""}`}>
          ▶
        </span>
        <span className={styles.title}>{title}</span>
        {meta && <span className={styles.meta}>{meta}</span>}
        {flag && <span className={styles.flag}>{flag}</span>}
      </button>

      {open && (
        <div id={panelId} role="region" aria-label={title} className={styles.body}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Pastille neutre d'en-tête de volet — `done` la passe au vert des manches jouées. */
export function PanelPill({ children, done = false }: { children: ReactNode; done?: boolean }) {
  return <span className={`${styles.pill} ${done ? styles.pillDone : ""}`}>{children}</span>;
}
