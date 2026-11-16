"use client";

import { useEffect, useState } from "react";
import { useClock } from "@/lib/shared/hooks/useClock";
import { isTournamentPublished } from "@/lib/shared/tournament-visibility";

/** Relecture de l'heure : un tournoi qui devient public sous les yeux du lecteur le devient à l'écran. */
const PUBLISHED_CLOCK_MS = 30_000;

/**
 * Marge prise sur l'horloge du lecteur **tant que l'heure du serveur n'est pas
 * connue** : le serveur seul décide de la publication (`/suivre/` répond
 * « introuvable » avant). Une horloge qui avance de quelques minutes ferait
 * sinon partager un lien dont l'encart, lu par le robot avant l'heure côté
 * serveur, resterait vide dans Discord.
 */
export const SHARE_PUBLISHED_MARGIN_MS = 5 * 60_000;

/**
 * Marge gardée sur l'heure du serveur une fois lue : l'en-tête `Date` est à la
 * seconde près, et la réponse a mis un instant à venir.
 */
export const SERVER_CLOCK_SAFETY_MS = 2_000;

/** Ressource statique légère dont seul l'en-tête `Date` est lu. */
const SERVER_CLOCK_PROBE_URL = "/favicon.png";

/** Écart (ms) serveur − poste, lu une fois par chargement de page ; `null` : inconnu. */
let knownServerSkew: number | null = null;
let skewRead: Promise<number | null> | null = null;

/** Oublie l'écart lu (tests). */
export function resetServerClockSkew(): void {
  knownServerSkew = null;
  skewRead = null;
}

/** Écart lu dans l'en-tête `Date` d'une réponse reçue à `receivedAt`, `null` illisible. */
export function skewFromDateHeader(serverDate: string | null, receivedAt: number): number | null {
  const server = serverDate === null ? Number.NaN : Date.parse(serverDate);
  return Number.isFinite(server) ? server - receivedAt : null;
}

/** Lit l'heure du serveur (une seule requête par page, partagée). */
function readServerSkew(): Promise<number | null> {
  skewRead ??= fetch(SERVER_CLOCK_PROBE_URL, { method: "HEAD", cache: "no-store" })
    .then((response) => skewFromDateHeader(response.headers.get("date"), Date.now()))
    .catch(() => null)
    .then((skew) => {
      knownServerSkew = skew;
      return skew;
    });
  return skewRead;
}

/**
 * Publié à l'instant `now` (horloge du poste) ? Avec l'écart du serveur
 * connu, à l'heure du serveur (moins {@link SERVER_CLOCK_SAFETY_MS}) ; sinon
 * avec la marge {@link SHARE_PUBLISHED_MARGIN_MS}.
 */
export function publishedForReader(
  card: Parameters<typeof isTournamentPublished>[0],
  now: number,
  skew: number | null,
): boolean {
  const at = skew === null ? now - SHARE_PUBLISHED_MARGIN_MS : now + skew - SERVER_CLOCK_SAFETY_MS;
  return isTournamentPublished(card, new Date(at));
}

/**
 * L'heure de publication tombe-t-elle dans la marge autour de `now` ? Seul
 * cas où lire l'heure du serveur change la réponse.
 */
export function nearPublication(card: Parameters<typeof isTournamentPublished>[0], now: number): boolean {
  const visibleAt = new Date(card.startVisibilityAt).getTime();
  return Number.isFinite(visibleAt) && Math.abs(visibleAt - now) <= SHARE_PUBLISHED_MARGIN_MS;
}

/**
 * Le tournoi est-il publié **maintenant** (`SHARE_EMBEDS.md`) ? À l'heure du
 * serveur quand elle est connue (lue une fois, par l'en-tête `Date` d'une
 * ressource statique, et seulement près de l'heure de publication), sinon avec
 * la marge d'horloge ({@link SHARE_PUBLISHED_MARGIN_MS}) : le bouton
 * « Partager » apparaît à l'instant de la publication sans qu'une horloge en
 * avance ne le montre trop tôt. Tant qu'il ne l'est pas, l'horloge
 * (`useClock`, 30 s) relance le rendu. **Une fois publié, l'horloge
 * s'arrête** : un tournoi publié ne se dépublie pas. Sans carte, aucune
 * horloge.
 */
export function useTournamentPublished(card: Parameters<typeof isTournamentPublished>[0] | null): boolean {
  const [skew, setSkew] = useState<number | null>(knownServerSkew);
  const published = card !== null && publishedForReader(card, Date.now(), skew);
  const probe = card !== null && !published && skew === null && nearPublication(card, Date.now());
  useClock(PUBLISHED_CLOCK_MS, card !== null && !published);
  useEffect(() => {
    if (!probe) return;
    let alive = true;
    void readServerSkew().then((read) => {
      if (alive && read !== null) setSkew(read);
    });
    return () => {
      alive = false;
    };
  }, [probe]);
  return published;
}
