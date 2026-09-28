"use client";

import type { ReactNode } from "react";
import { useId, useState } from "react";
import s from "./tournois.module.css";

interface SectionProps {
  ix: string;
  title: string;
  accent?: string;
  count: number;
  /** Ancre de la section, visée par le sommaire de la page. */
  id?: string;
  /** Ouverture initiale, quand la section gère elle-même son état. */
  defaultOpen?: boolean;
  /**
   * Ouverture pilotée par la page : le sommaire doit pouvoir déplier une
   * section repliée (« Terminés ») avant d'y mener, sans quoi le lien
   * aboutirait sur un en-tête sans contenu.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  dataCols?: "1" | "2" | "3";
  /** Variante d'en-tête : « Mes tournois » se distingue des sections publiques. */
  tone?: "default" | "mine";
  children: ReactNode;
}

/**
 * Section repliable de `/tournois`. Elle n'a **pas** d'état vide : la page ne
 * la rend que si elle contient au moins un tournoi, et le sommaire dit les
 * zéros (voir `_lib/page-sections.ts`).
 */
export function Section({
  ix,
  title,
  accent,
  count,
  id,
  defaultOpen = true,
  open,
  onOpenChange,
  dataCols,
  tone = "default",
  children,
}: SectionProps) {
  const [ownExpanded, setOwnExpanded] = useState(defaultOpen);
  const expanded = open ?? ownExpanded;
  const bodyId = useId();

  const toggle = () => {
    if (open === undefined) setOwnExpanded(!expanded);
    onOpenChange?.(!expanded);
  };

  return (
    <section id={id} className={s.section} data-cols={dataCols} data-tone={tone}>
      {/* Un `<h2>` n'est pas du contenu phrasé : posé à l'intérieur d'un
          `<button>`, il n'y était pas autorisé. C'est le bouton qui va dans le
          titre, jamais l'inverse — mais le `<h2>` engloberait alors aussi
          l'index et le compte (« 01 EN COURS 46 »), bruit qu'un `aria-label`
          retranche au seul titre ; le bouton, lui, garde le texte complet. */}
      <h2 className={s.sectionH2} aria-label={accent ? `${title} ${accent}` : title}>
        <button
          className={s.sectionHead}
          aria-expanded={expanded}
          // Sans élément à désigner une fois repliée, une section fermée par
          // défaut (« Terminés ») pointerait vers un id absent du DOM.
          aria-controls={expanded ? bodyId : undefined}
          onClick={toggle}
        >
          <span className={s.sectionIx}>{ix}</span>
          <span className={s.sectionTtl}>
            {title}
            {accent && <span className={s.sectionAccent}> {accent}</span>}
          </span>
          <span className={s.sectionCount}>{count}</span>
          <svg
            className={s.sectionCaret}
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path d="M10 6L8 9L6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </h2>

      {expanded && (
        <div id={bodyId} className={s.sectionBody}>
          {children}
        </div>
      )}
    </section>
  );
}
