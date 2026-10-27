"use client";

import type { CSSProperties } from "react";
import styles from "./RankingViews.module.css";

/**
 * Geste d'abandon d'une ligne de classement : « Abandonner » / « Forfait » sur
 * une ligne en lice, « Annuler l'abandon » sur une ligne forfait, ou « 🔒 »
 * quand l'annulation est fermée (une manche postérieure porte une saisie).
 *
 * **Un seul `<button>`, au même emplacement**, quel que soit le geste : tant
 * que la ligne reste à sa place, le rafraîchissement change le libellé et le
 * geste du même nœud DOM, et le focus que la modale lui rend y reste — deux
 * boutons distincts faisaient tomber le focus sur `<body>`. Une ligne qui
 * change de rang est déplacée (clé `teamId`), ce qui fait perdre le focus, et
 * une ligne peut ne plus porter de geste : `focusRowAfterChange` rend alors le
 * focus au geste de la ligne, ou à la ligne (`data-row-focus`).
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
 * Durée de la veille du focus après le geste. Le nouvel état peut s'afficher
 * après la fin de `refresh()` (rendu groupé du flux, `snapshotRenderDelayMs`) :
 * une seule vérification à la trame suivante passait avant le déplacement de
 * la ligne. Bornée : ce n'est pas une boucle de fond.
 */
export const FOCUS_WATCH_MS = 3000;

/**
 * Après un abandon ou son annulation, pendant `FOCUS_WATCH_MS` : chaque fois
 * que le focus tombe sur `<body>` (le geste a disparu de la ligne, ou la ligne
 * a changé de place), il revient au geste de la ligne, sinon à la ligne
 * elle-même. La veille s'arrête dès que le lecteur porte le focus ailleurs.
 */
export function focusRowAfterChange(teamId: number, now: () => number = () => performance.now()): void {
  if (typeof document === "undefined") return;
  const deadline = now() + FOCUS_WATCH_MS;
  const row = () => document.querySelector<HTMLElement>(`[data-row-focus="${teamId}"]`);
  const tick = () => {
    const active = document.activeElement;
    if (active === null || active === document.body || !active.isConnected) {
      const target = document.querySelector<HTMLElement>(`[data-row-action="${teamId}"]`) ?? row();
      target?.focus({ preventScroll: true });
    } else if (!row()?.contains(active)) {
      return;
    }
    if (now() < deadline) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
