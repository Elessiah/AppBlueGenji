"use client";

import { useRef } from "react";
import { type BackdropGesture, backdropHandlers } from "@/lib/shared/backdrop-dismiss";

/**
 * Gestionnaires à poser sur le **voile** d'une modale pour la fermer d'un clic
 * à côté du panneau : `<div role="presentation" {...backdrop}>`.
 *
 * Toutes les modales du site écrivaient `onClick={onClose}` sur le voile et
 * `stopPropagation()` sur le panneau. Ça ne protège de rien : un `click` part
 * vers l'ancêtre commun de l'appui et du relâchement, si bien qu'une sélection
 * de texte commencée dans un champ et relâchée à côté du panneau produit un
 * clic… sur le voile, qui refermait la modale et jetait la saisie. Le clic ne
 * vaut fermeture que si l'appui **et** le relâchement ont eu lieu sur le voile
 * lui-même (`backdropHandlers`, `lib/shared/backdrop-dismiss.ts`).
 *
 * `disabled` (une opération en cours) neutralise la fermeture sans retirer les
 * gestionnaires.
 */
export function useBackdropDismiss(onDismiss: () => void, disabled = false) {
  const gesture = useRef<BackdropGesture>({ press: null, release: null });
  return backdropHandlers(gesture.current, onDismiss, disabled);
}
