"use client";

import { useEffect, useMemo, useState } from "react";
import type { TournamentBuckets } from "@/lib/shared/types";
import { nextBucketsChangeAt, rescheduleBuckets } from "@/lib/shared/tournament-schedule";

const NO_BUCKETS: TournamentBuckets = { upcoming: [], registration: [], running: [], finished: [] };

/** Rien à reclasser : ni passe de reclassement, ni frontière à chercher. */
const isEmptyBuckets = (buckets: TournamentBuckets) =>
  buckets.upcoming.length === 0 &&
  buckets.registration.length === 0 &&
  buckets.running.length === 0 &&
  buckets.finished.length === 0;

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
  return useScheduledBucketsPair(buckets, NO_BUCKETS)[0];
}

/**
 * Deux jeux de paniers sur **la même horloge et le même minuteur** : une
 * frontière commune ne déclenche qu'un seul rendu de la page, là où deux
 * `useScheduledBuckets` en auraient déclenché deux (`/tournois` reclasse ainsi
 * les invisibles du staff pour son état vide, sans second minuteur).
 */
export function useScheduledBucketsPair(
  first: TournamentBuckets,
  second: TournamentBuckets,
): readonly [TournamentBuckets, TournamentBuckets] {
  // L'horloge est rattachée aux paniers qu'elle a lus : à chaque nouvelle
  // réponse du serveur, elle est recalée **pendant le rendu** (état ajusté
  // plutôt qu'un effet) — sans cela, une liste rechargée resterait interprétée
  // avec l'heure du rendu précédent, et avec un effet, chaque ouverture de
  // porte ou relecture modifiée coûtait un second rendu complet de la page.
  const [clock, setClock] = useState(() => ({ first, second, now: Date.now() }));
  let { now } = clock;
  if (clock.first !== first || clock.second !== second) {
    now = Date.now();
    setClock({ first, second, now });
  }

  useEffect(() => {
    const a = nextBucketsChangeAt(first, now);
    const b = isEmptyBuckets(second) ? null : nextBucketsChangeAt(second, now);
    let at: number | null;
    if (a === null) at = b;
    else if (b === null) at = a;
    else at = Math.min(a, b);
    if (at === null) return;
    const boundary = at;

    // `setTimeout` sature au-delà de ~24,8 jours et se déclencherait alors
    // immédiatement, en boucle : on plafonne, quitte à se réveiller pour rien.
    const delay = Math.min(Math.max(0, boundary - Date.now()), 2_147_483_647);

    // `Math.max(boundary, …)` garantit de dépasser la frontière. Une horloge
    // encore en deçà au réveil — minuteur déclenché tôt, recalage NTP en
    // arrière, sortie de veille — redonnerait sinon la même frontière, avec un
    // délai nul : le couple minuteur/rendu tournerait en boucle serrée jusqu'à
    // ce que l'heure rattrape.
    const timer = setTimeout(
      () => setClock({ first, second, now: Math.max(boundary, Date.now()) }),
      delay,
    );
    return () => clearTimeout(timer);
  }, [first, second, now]);

  const firstView = useMemo(() => rescheduleBuckets(first, now), [first, now]);
  // Un second jeu vide (`useScheduledBuckets`, ou aucun invisible) est rendu
  // tel quel : aucune allocation ni passe de reclassement pour rien.
  const secondView = useMemo(() => (isEmptyBuckets(second) ? second : rescheduleBuckets(second, now)), [second, now]);
  return useMemo(() => [firstView, secondView] as const, [firstView, secondView]);
}
