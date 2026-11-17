import type { ReportAction, ReportTargetRef } from "@/lib/shared/content-reports";
import type { ContestOutcome } from "@/lib/shared/logo-quarantine";
import { pickRescueTarget } from "@/lib/shared/focus-rescue";

/**
 * Nom d'un geste du panneau des signalements (`BUSY_BUTTONS.md`) : pendant un
 * envoi, seul le bouton du geste **en attente** s'annonce occupé
 * (`aria-busy`), les autres sont refusés sans annonce d'attente. Le même nom
 * sert de `data-gesture` au bouton, pour lui rendre le focus après la relecture
 * du dossier (ou à ce qui le remplace).
 */
export const REFRESH_GESTURE = "refresh";

const targetKey = (target: ReportTargetRef) => `${target.type}-${target.id}`;

export const reportGesture = {
  action: (action: ReportAction) => `action:${action}`,
  hide: (target: ReportTargetRef) => `hide:${targetKey(target)}`,
  remove: (target: ReportTargetRef) => `remove:${targetKey(target)}`,
  restore: (quarantineId: number) => `restore:${quarantineId}`,
  purge: (quarantineId: number) => `purge:${quarantineId}`,
  outcome: (quarantineId: number, outcome: ContestOutcome) => `outcome:${quarantineId}:${outcome}`,
};


/** Le dernier bouton de geste pressé dans le dossier : son geste et sa zone. */
export type PressedGesture = { gesture: string; scope: string | null };

/** Lit le bouton de geste pressé (`data-gesture`) et sa zone (`data-focus-scope`). */
export function pressedGestureOf(target: EventTarget | null): PressedGesture | null {
  // Un nœud texte ou la fenêtre n'ont pas de `closest` : rien à lire.
  const closest = (target as Partial<Element> | null)?.closest;
  if (typeof closest !== "function") return null;
  const button = (target as Element).closest("[data-gesture]");
  if (!button) return null;
  const gesture = button.getAttribute("data-gesture");
  if (!gesture) return null;
  return { gesture, scope: button.closest("[data-focus-scope]")?.getAttribute("data-focus-scope") ?? null };
}

/**
 * Le bouton cliqué devient le bouton **pressé** (celui dont le focus se rend
 * après la relecture) seulement si son geste part : `pending` le nomme. Le
 * premier clic qui arme « Supprimer… », un clic refusé pendant un autre geste
 * ou « Actualiser » (hors du dossier) n'en font pas un. `null` : rien ne part.
 */
export function gestureStarted(clicked: PressedGesture | null, pending: string | null): PressedGesture | null {
  return pending !== null && clicked?.gesture === pending ? clicked : null;
}

/** Zone des gestes de traitement, en tête du dossier : le repli du focus. */
export const ACTIONS_SCOPE = "actions";

const firstButtonIn = (scope: string) => `[data-focus-scope="${scope}"] button`;

/**
 * Où rendre le focus quand la relecture du dossier a retiré le bouton pressé
 * (« Prendre en charge » devient « Remettre en attente », « Masquer le logo »
 * laisse place à « Rétablir le logo ») : le même geste s'il est encore là,
 * sinon le premier bouton de sa zone (la cible), sinon le premier geste de
 * traitement du dossier. `null` : rien à viser.
 */
export function focusAfterGesture(root: ParentNode, pressed: PressedGesture): HTMLElement | null {
  // Même choix de cible que `useFocusRescue` (`pickRescueTarget`) ; le
  // déclencheur, lui, suit le geste en attente du dossier (`ReportDetail`).
  const selectors = [
    `[data-gesture="${pressed.gesture}"]`,
    ...(pressed.scope ? [firstButtonIn(pressed.scope)] : []),
    firstButtonIn(ACTIONS_SCOPE),
  ];
  return pickRescueTarget({ querySelector: (selector) => root.querySelector<HTMLElement>(selector) }, selectors);
}
