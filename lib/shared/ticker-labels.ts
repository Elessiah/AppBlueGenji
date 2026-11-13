import type { Messages } from "@/lib/shared/i18n-messages";

/** Libellés du bandeau et de son bouton pause (espace `landing.ticker`). */
export type TickerControls = Pick<Messages["landing"]["ticker"], "label" | "resume" | "pause" | "resumeShort" | "pauseShort">;

/**
 * Le français des cinq libellés du bandeau, recopié de `messages/fr/landing.json`
 * (`ticker.*`, égalité vérifiée par `tests/lib/shared/ticker-labels.test.ts`) :
 * le bandeau le lit quand l'écran ne lui en passe pas d'autres, sans importer le
 * dictionnaire entier de l'accueil dans le paquet de chaque liste qui le monte.
 */
export const FR_TICKER_LABELS: TickerControls = {
  label: "Fil d'actualité",
  resume: "Relancer le défilement du bandeau",
  pause: "Mettre en pause le défilement du bandeau",
  resumeShort: "Relancer",
  pauseShort: "Pause",
};

/**
 * L'anglais des cinq libellés, recopié de `messages/en/landing.json` (même
 * contrôle) : l'anglais de la liste des tournois, chargé à part
 * (`englishTournamentsList`), n'emporte pas le dictionnaire de l'accueil.
 */
export const EN_TICKER_LABELS: TickerControls = {
  label: "News feed",
  resume: "Resume the scrolling banner",
  pause: "Pause the scrolling banner",
  resumeShort: "Resume",
  pauseShort: "Pause",
};

/** Les cinq libellés du bandeau, pris dans l'espace `landing.ticker` d'une langue. */
export function tickerControls(ticker: Messages["landing"]["ticker"]): TickerControls {
  return { label: ticker.label, resume: ticker.resume, pause: ticker.pause, resumeShort: ticker.resumeShort, pauseShort: ticker.pauseShort };
}
