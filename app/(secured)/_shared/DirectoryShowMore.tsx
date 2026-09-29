"use client";

import type { RefObject } from "react";
import { DIRECTORY_PAGE_SIZE } from "@/lib/shared/progressive-list";
import s from "./annuaire.module.css";

/**
 * « Voir plus » d'un annuaire : absent quand tout est affiché. Le libellé dit
 * combien de cartes s'ajoutent et combien restent ; le nom accessible commence
 * par le texte visible (WCAG 2.5.3) et nomme l'annuaire.
 *
 * Au clic, le focus passe au **premier lien de la première carte ajoutée**
 * (WCAG 2.4.3) : le dernier clic retire le bouton, et le focus serait sinon
 * retombé sur `<body>`.
 */
export function DirectoryShowMore({
  hidden,
  shown,
  noun,
  gridRef,
  onShowMore,
}: {
  hidden: number;
  /** Cartes rendues avant le clic : index de la première carte ajoutée. */
  shown: number;
  /** Nom au pluriel des éléments listés (« joueurs », « équipes »). */
  noun: string;
  /** Grille dont chaque enfant est une carte. */
  gridRef: RefObject<HTMLElement | null>;
  onShowMore: () => void;
}) {
  if (hidden <= 0) return null;
  const step = Math.min(hidden, DIRECTORY_PAGE_SIZE);
  const label = `Voir plus (${step} sur ${hidden} restant${hidden > 1 ? "s" : ""})`;

  const handleClick = () => {
    onShowMore();
    // Après le rendu des nouvelles cartes.
    window.setTimeout(() => {
      // Une recherche différée arrivée entre-temps peut avoir ramené la liste à
      // sa première page : la carte visée n'existe plus, on rejoint alors la
      // première, jamais `<body>`.
      const grid = gridRef.current;
      const card = grid?.children.item(shown) ?? grid?.children.item(0);
      card
        ?.querySelector<HTMLElement>("a[href], button:not([disabled])")
        ?.focus();
    }, 0);
  };

  return (
    <div className={s.showMoreRow}>
      <button
        type="button"
        onClick={handleClick}
        className={s.showMoreBtn}
        aria-label={`${label} · ${noun}`}
      >
        {label}
      </button>
    </div>
  );
}
