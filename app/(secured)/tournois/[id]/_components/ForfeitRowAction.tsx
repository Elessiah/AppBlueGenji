"use client";

import type { CSSProperties } from "react";
import styles from "./RankingViews.module.css";

/**
 * Geste d'abandon d'une ligne de classement : « Abandonner » / « Forfait » sur
 * une ligne en lice, « Annuler l'abandon » sur une ligne forfait, ou « 🔒 »
 * quand l'annulation est fermée (une manche postérieure porte une saisie).
 *
 * **Un seul `<button>`, au même emplacement**, quel que soit le geste : après
 * confirmation, le rafraîchissement change le libellé et le geste du même nœud
 * DOM, si bien que le focus que la modale lui rend y reste — deux boutons
 * distincts faisaient tomber le focus sur `<body>`. Quand la ligne n'a plus de
 * geste, `focusRowAfterChange` le rend à la ligne (`data-row-focus`).
 */
export type ForfeitRowActionProps =
  | {
      kind: "button";
      teamId: number;
      label: string;
      title: string;
      ariaLabel: string;
      style: CSSProperties;
      onClick: () => void;
    }
  | { kind: "locked"; teamId: number; label: string; title: string };

export function ForfeitRowAction(props: Readonly<ForfeitRowActionProps>) {
  if (props.kind === "locked") {
    return (
      <span className={styles.forfeitLocked} title={props.title} data-row-action={props.teamId} tabIndex={-1}>
        <span aria-hidden="true">🔒</span> {props.label}
        <span className="sr-only"> {props.title}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="btn tap-target"
      title={props.title}
      aria-label={props.ariaLabel}
      style={props.style}
      data-row-action={props.teamId}
    >
      {props.label}
    </button>
  );
}

/**
 * Après un abandon ou son annulation : si le focus est tombé sur `<body>` (le
 * geste a disparu de la ligne, ou la ligne a changé de place), il revient au
 * geste de la ligne, sinon à la ligne elle-même.
 */
export function focusRowAfterChange(teamId: number): void {
  if (typeof document === "undefined") return;
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    const target =
      document.querySelector<HTMLElement>(`[data-row-action="${teamId}"]`) ??
      document.querySelector<HTMLElement>(`[data-row-focus="${teamId}"]`);
    target?.focus({ preventScroll: true });
  });
}
