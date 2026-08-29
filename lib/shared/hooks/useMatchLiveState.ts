"use client";

import { useEffect, useState } from "react";
import {
  nextMatchLiveChangeAt,
  resolveMatchLiveState,
  type MatchLiveInput,
  type MatchLiveState,
} from "@/lib/shared/live-streams";

/**
 * État de diffusion d'un match, **rebasculé à la seconde dite**.
 *
 * Le mode `START_TIME` est le seul dont l'état change sans écriture : à
 * 20 h 30, un match programmé passe à l'antenne alors que rien n'a bougé en
 * base. Le flux SSE ne peut donc pas l'annoncer, et sonder à la seconde pour
 * une frontière connue d'avance serait absurde — on pose un unique `setTimeout`
 * sur l'horaire exact, comme `useScheduledBuckets` le fait pour les cartes de
 * tournoi.
 *
 * Aucun minuteur n'est armé pour les autres modes, ni pour une frontière déjà
 * franchie : sur un plateau de 128 matchs, seuls ceux réellement programmés
 * dans le futur en consomment un.
 */
export function useMatchLiveState(match: MatchLiveInput): MatchLiveState {
  const [now, setNow] = useState(() => Date.now());

  // Recale l'horloge à chaque nouvelle version du match : sans cela, un match
  // reçu par le flux resterait interprété avec l'heure du rendu précédent.
  const { status, liveTrigger, liveStartedAt, startAt } = match;
  useEffect(() => {
    setNow(Date.now());
  }, [status, liveTrigger, liveStartedAt, startAt]);

  useEffect(() => {
    const at = nextMatchLiveChangeAt({ status, liveTrigger, liveStartedAt, startAt }, now);
    if (at === null) return;

    // `setTimeout` sature au-delà de ~24,8 jours et se déclencherait alors
    // immédiatement, en boucle : on plafonne, quitte à se réveiller pour rien.
    const delay = Math.min(Math.max(0, at - Date.now()), 2_147_483_647);

    // `Math.max(at, …)` garantit de dépasser la frontière : une horloge encore
    // en deçà au réveil — minuteur déclenché tôt, recalage NTP en arrière,
    // sortie de veille — redonnerait sinon la même frontière avec un délai nul,
    // et le couple minuteur/rendu tournerait en boucle serrée.
    const timer = setTimeout(() => setNow(Math.max(at, Date.now())), delay);
    return () => clearTimeout(timer);
  }, [status, liveTrigger, liveStartedAt, startAt, now]);

  return resolveMatchLiveState({ status, liveTrigger, liveStartedAt, startAt }, now);
}
