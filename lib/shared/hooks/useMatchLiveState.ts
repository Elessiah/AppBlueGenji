"use client";

import { useEffect, useState } from "react";
import {
  nextMatchLiveChangeAt,
  resolveMatchLiveState,
  type MatchLiveInput,
  type MatchLiveState,
} from "@/lib/shared/live-streams";
import { matchStartAtTime } from "@/lib/shared/match-schedule";

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

  // Dépendances réduites à des **primitives**. `MatchLiveInput` accepte aussi
  // bien une chaîne ISO qu'une `Date` — les lignes SQL en portent, et le module
  // pur est partagé avec le serveur. Or une `Date` est une nouvelle référence à
  // chaque rendu : mise en dépendance d'effet, elle relancerait `setNow`, qui
  // provoquerait le rendu suivant, en boucle serrée jusqu'au « Maximum update
  // depth exceeded ». On ne garde donc que l'instant et un booléen.
  const { status, liveTrigger } = match;
  const onAir = match.liveStartedAt !== null && match.liveStartedAt !== undefined;
  const startAt = matchStartAtTime({ startAt: match.startAt });

  // Recale l'horloge à chaque nouvelle version du match : sans cela, un match
  // reçu par le flux resterait interprété avec l'heure du rendu précédent.
  useEffect(() => {
    setNow(Date.now());
  }, [status, liveTrigger, onAir, startAt]);

  useEffect(() => {
    // Vue reconstruite depuis les primitives, et non `match` : la garder hors
    // des dépendances est justement ce qui évite la boucle ci-dessus. Poser
    // `liveStartedAt: null` est fidèle — seul `START_TIME` produit une
    // frontière, et son état ne consulte jamais l'antenne manuelle.
    const at = nextMatchLiveChangeAt({ status, liveTrigger, liveStartedAt: null, startAt }, now);
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
  }, [status, liveTrigger, startAt, now]);

  // Au rendu, en revanche, on repasse le match tel quel : aucune dépendance
  // n'est en jeu, et l'antenne manuelle compte pour les modes qui la lisent.
  return resolveMatchLiveState(match, now);
}
