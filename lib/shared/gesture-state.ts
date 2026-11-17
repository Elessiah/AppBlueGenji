/**
 * Un écran à plusieurs gestes nommés et **un** envoi à la fois
 * (`docs/features/BUSY_BUTTONS.md`) : seul le bouton du geste **en attente**
 * s'annonce occupé (`aria-busy`), les autres sont refusés sans annonce
 * d'attente. Partagé par le panneau des signalements et la fiche d'équipe.
 */

/** État d'un bouton de geste : occupé s'il attend, refusé si un autre geste attend. */
export function gestureState(pending: string | null, gesture: string): { busy: boolean; blocked: boolean } {
  return { busy: pending === gesture, blocked: pending !== null };
}
