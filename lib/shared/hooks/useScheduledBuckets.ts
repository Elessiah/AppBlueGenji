"use client";

import { useEffect, useMemo, useState } from "react";
import type { TournamentBuckets } from "@/lib/shared/types";
import { nextBucketsChangeAt, rescheduleBuckets } from "@/lib/shared/tournament-schedule";

/**
 * Paniers de tournois reclassés à l'heure du client, et **remis à jour à la
 * seconde dite** sans la moindre requête.
 *
 * C'est la réponse au cas le plus frustrant de la liste : les inscriptions
 * ouvrent à 20 h 00, la page a été chargée à 19 h 58, et il faut recharger pour
 * voir le tournoi changer de section. Toute l'information nécessaire est
 * pourtant déjà là — seule l'heure manquait.
 *
 * Un seul minuteur pour toute la page, posé sur la prochaine bascule à venir :
 * pas de sondage à la seconde, et rien du tout si plus rien ne doit bouger.
 */
export function useScheduledBuckets(buckets: TournamentBuckets): TournamentBuckets {
  const [now, setNow] = useState(() => Date.now());

  // Recale l'horloge à chaque nouvelle réponse du serveur : sans cela, une
  // liste rechargée resterait interprétée avec l'heure du rendu précédent.
  useEffect(() => {
    setNow(Date.now());
  }, [buckets]);

  useEffect(() => {
    const at = nextBucketsChangeAt(buckets, now);
    if (at === null) return;

    // `setTimeout` sature au-delà de ~24,8 jours et se déclencherait alors
    // immédiatement, en boucle : on plafonne, quitte à se réveiller pour rien.
    const delay = Math.min(Math.max(0, at - Date.now()), 2_147_483_647);

    // `Math.max(at, …)` garantit de dépasser la frontière. Une horloge encore en
    // deçà au réveil — minuteur déclenché tôt, recalage NTP en arrière, sortie
    // de veille — redonnerait sinon la même frontière, avec un délai nul : le
    // couple minuteur/rendu tournerait en boucle serrée jusqu'à ce que l'heure
    // rattrape.
    const timer = setTimeout(() => setNow(Math.max(at, Date.now())), delay);
    return () => clearTimeout(timer);
  }, [buckets, now]);

  return useMemo(() => rescheduleBuckets(buckets, now), [buckets, now]);
}
