"use client";

import { useEffect, useState } from "react";
import {
  nextTournamentStateChangeAt,
  type TournamentStateInput,
} from "@/lib/shared/tournament-state";

/**
 * L'instant courant, **recalé à chaque bascule d'état d'un tournoi donné**.
 *
 * Même principe que `useScheduledBuckets` (la liste) et `useMatchLiveState` (un
 * match), appliqué cette fois à **une** fiche : tout ce qu'un écran déduit des
 * dates d'un tournoi — les inscriptions qui ouvrent, celles qui closent, le coup
 * d'envoi — change à une seconde connue d'avance, et sans la moindre écriture
 * en base. Le flux SSE ne peut donc pas l'annoncer : il ne pousse un instantané
 * que si quelqu'un a écrit, et l'entretien qui finit par lancer le tournoi est
 * étranglé à quinze secondes et n'a lieu que s'il passe du trafic.
 *
 * Sans ce minuteur, une commande dont la fenêtre se ferme au coup d'envoi —
 * le retrait d'un engagé (`lib/shared/entrant-removal.ts`) — resterait offerte
 * après l'heure, pour être refusée en 409 au clic. La page a pourtant déjà les
 * dates qu'il faut pour le savoir.
 *
 * Un seul `setTimeout`, posé sur la prochaine frontière à venir ; rien du tout
 * quand il n'y en a plus (tournoi terminé, ou déjà en cours).
 */
export function useTournamentNow(tournament: TournamentStateInput): number {
  const [now, setNow] = useState(() => Date.now());

  // Dépendances réduites à des **primitives**, comme dans `useMatchLiveState` et
  // pour la même raison : `TournamentStateInput` accepte aussi bien une chaîne
  // ISO qu'une `Date`, et une `Date` est une nouvelle référence à chaque rendu.
  // Mise en dépendance d'effet, elle relancerait `setNow`, qui provoquerait le
  // rendu suivant, en boucle serrée.
  const { state } = tournament;
  const finishedAt = timeOrNull(tournament.finishedAt);
  const registrationOpenAt = timeOf(tournament.registrationOpenAt);
  const registrationCloseAt = timeOf(tournament.registrationCloseAt);
  const startAt = timeOf(tournament.startAt);

  // Recale l'horloge à chaque nouvelle version du tournoi : sans cela, une fiche
  // reçue par le flux resterait interprétée avec l'heure du rendu précédent.
  useEffect(() => {
    setNow(Date.now());
  }, [state, finishedAt, registrationOpenAt, registrationCloseAt, startAt]);

  useEffect(() => {
    const at = nextTournamentStateChangeAt(
      {
        state,
        finishedAt: finishedAt === null ? null : new Date(finishedAt),
        registrationOpenAt: new Date(registrationOpenAt),
        registrationCloseAt: new Date(registrationCloseAt),
        startAt: new Date(startAt),
      },
      now,
    );
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
  }, [state, finishedAt, registrationOpenAt, registrationCloseAt, startAt, now]);

  return now;
}

function timeOf(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function timeOrNull(value: string | Date | null | undefined): number | null {
  return value === null || value === undefined ? null : timeOf(value);
}
