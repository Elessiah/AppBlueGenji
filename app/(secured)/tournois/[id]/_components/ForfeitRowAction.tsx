"use client";

import type { CSSProperties } from "react";
import { powerPolicy } from "@/lib/shared/client-power";
import { getClientPowerInput } from "@/lib/shared/hooks/useClientPower";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
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
  | { kind: "locked"; teamId: number; label: string; note: string };

export function ForfeitRowAction(props: Readonly<ForfeitRowActionProps>) {
  if (props.kind === "locked") {
    return (
      // Forme courte lue avec la ligne (texte masqué) ; le motif complet vit
      // derrière le « i » de la légende sous le classement
      // (`FrozenForfeitLegend`) — un `title` ne s'affichait ni au toucher ni au
      // clavier, un « i » par ligne déformait les cellules étroites, et le
      // motif entier relu à chaque ligne figée allongeait la lecture.
      <span className={styles.forfeitLocked} data-row-action={props.teamId}>
        <span aria-hidden="true">🔒</span> {props.label}
        <span className="sr-only"> {props.note}</span>
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
 * Légende « 🔒 Figé » sous un classement (ou un journal) qui porte au moins une
 * ligne figée : le motif derrière un « i » (INFO_HINTS.md), une fois pour toutes
 * les lignes.
 */
export function FrozenForfeitLegend({
  id,
  label,
  reason,
}: Readonly<{ id: string; label: string; reason: string }>) {
  return (
    <div className={styles.frozenLegend}>
      <InfoHintRow>
        <span className={styles.frozenLegendLabel}>
          <span aria-hidden="true">🔒</span> {label}
        </span>
        <InfoHint id={id} subject={label}>
          <p>{reason}</p>
        </InfoHint>
      </InfoHintRow>
    </div>
  );
}

/**
 * Durée de la veille du focus après le geste. Le nouvel état peut s'afficher
 * après la fin de `refresh()` (rendu groupé du flux, `snapshotRenderDelayMs`) :
 * une seule vérification à la trame suivante passait avant le déplacement de
 * la ligne. Bornée : ce n'est pas une boucle de fond.
 */
export const FOCUS_WATCH_MS = 3000;

/** Espacement des vérifications en mode économe (hors `FULL`) : pas de boucle à chaque trame. */
export const FOCUS_WATCH_RELAXED_MS = 250;

/**
 * Rend la ligne focalisable par script **au moment** de lui rendre le focus,
 * puis lui retire cette propriété au départ du focus : une ligne de classement
 * n'est donc jamais focalisable à la souris ou au toucher hors de cette reprise.
 */
function focusScripted(target: HTMLElement | null): void {
  if (!target) return;
  // Un bouton l'est déjà (`tabIndex >= 0`) : seule une ligne ou un cadenas non focalisable est touché.
  if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) {
    target.setAttribute("tabindex", "-1");
    target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
  }
  target.focus({ preventScroll: true });
}

/**
 * Après un abandon ou son annulation, pendant `FOCUS_WATCH_MS` : chaque fois
 * que le focus tombe sur `<body>` (le geste a disparu de la ligne, ou la ligne
 * a changé de place), il revient au geste de la ligne, sinon à la ligne
 * elle-même. La veille s'arrête dès que le lecteur porte le focus ailleurs, ou
 * dès son premier geste (`pointerdown`, `keydown`) : un clic sur du texte juste
 * après l'abandon ne lui reprend pas le focus. Hors mode `FULL`
 * (`useClientPower()`), elle se vérifie toutes les `FOCUS_WATCH_RELAXED_MS`
 * plutôt qu'à chaque trame.
 */
export function focusRowAfterChange(teamId: number, now: () => number = () => performance.now()): void {
  if (typeof document === "undefined") return;
  const deadline = now() + FOCUS_WATCH_MS;
  const relaxed = powerPolicy(getClientPowerInput()).mode !== "FULL";
  const row = () => document.querySelector<HTMLElement>(`[data-row-focus="${teamId}"]`);
  const stopEvents = ["pointerdown", "keydown"] as const;
  let stopped = false;
  const stop = () => {
    stopped = true;
    for (const type of stopEvents) document.removeEventListener(type, stop, true);
  };
  for (const type of stopEvents) document.addEventListener(type, stop, true);
  const schedule = (callback: () => void) => {
    if (relaxed) setTimeout(callback, FOCUS_WATCH_RELAXED_MS);
    else requestAnimationFrame(callback);
  };
  const tick = () => {
    if (stopped) return;
    const active = document.activeElement;
    if (active === null || active === document.body || !active.isConnected) {
      const gesture = document.querySelector<HTMLElement>(`[data-row-action="${teamId}"]`);
      if (gesture) focusScripted(gesture);
      else focusScripted(row());
    } else if (!row()?.contains(active)) {
      stop();
      return;
    }
    if (now() < deadline) schedule(tick);
    else stop();
  };
  schedule(tick);
}
