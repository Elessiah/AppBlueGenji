"use client";

import type { ReactNode } from "react";
import { onceLoader } from "@/lib/shared/lazy-component";
import type { Locale } from "@/lib/shared/locales";
import type { TournamentActionsClientMessages } from "@/lib/shared/tournament-actions-text";
import { tournamentPageMessages, type TournamentSheetMessages } from "@/lib/shared/tournament-page-text";
import { tournamentsSharedMessages, type TournamentsSharedMessages } from "@/lib/shared/tournaments-text";
import { EnglishGateFallback } from "./english-gate-fallback";
import { primeEnglish } from "./english-loaders";
import { TournamentActionsTextProvider } from "./tournament-actions-text";
import { TournamentPageTextProvider } from "./tournament-page-text";
import { TournamentsTextProvider } from "./tournaments-text";
import { useEnglishMessages } from "./use-english-messages";

/**
 * L'anglais de la fiche d'un tournoi : son espace (sans les vues), ses gestes et
 * les textes qu'elle partage avec la liste (libellés d'état, aide des règles).
 */
export type TournamentSheetEnglish = {
  page: TournamentSheetMessages;
  actions: TournamentActionsClientMessages;
  shared: TournamentsSharedMessages;
};

/**
 * L'anglais de la fiche, chargé à part (son propre morceau, immuable, gardé par
 * le cache HTTP) quand la mise en page ne l'a pas sérialisé — une navigation,
 * un préchargement ou un `router.refresh()` : une réponse du routeur n'est pas
 * gardée par le navigateur, et chaque geste qui rafraîchit la fiche renvoyait
 * sinon les ~40 Ko du dictionnaire. Une fois pour la session.
 */
export const englishTournamentSheet = /* @__PURE__ */ onceLoader<TournamentSheetEnglish>(() =>
  Promise.all([
    import("@/messages/en/tournament.json"),
    import("@/messages/en/tournamentErrors.json"),
    import("@/messages/en/tournamentActions.json"),
    import("@/messages/en/tournamentsShared.json"),
    import("@/messages/en/labels.json"),
  ]).then(([tournament, errors, actions, shared, labels]) => ({
    page: tournamentPageMessages({ tournament: tournament.default }),
    actions: { errors: errors.default, actions: actions.default },
    shared: tournamentsSharedMessages({ tournamentsShared: shared.default, labels: labels.default }),
  })),
);

/**
 * Les fournisseurs de la fiche (espace connecté et page sans compte) : en
 * français, rien à attendre ; sous `/en`, l'anglais reçu de la mise en page
 * (chargement complet d'une page), sinon celui de la session, sinon son
 * morceau — l'écran d'attente le temps de l'essai, un échec retombant sur le
 * français (`useEnglishMessages`).
 */
export function TournamentSheetTextGate({
  locale,
  messages,
  children,
}: Readonly<{ locale: Locale; messages?: TournamentSheetEnglish; children: ReactNode }>) {
  primeEnglish(englishTournamentSheet, locale, messages);
  const { english, waiting } = useEnglishMessages(locale, englishTournamentSheet, messages);
  if (waiting) return <EnglishGateFallback />;
  // Un échec rend la fiche en français : la langue suit alors le texte.
  const shown: Locale = english ? locale : "fr";
  return (
    <TournamentsTextProvider locale={shown} messages={english?.shared}>
      <TournamentPageTextProvider locale={shown} messages={english?.page}>
        <TournamentActionsTextProvider locale={shown} messages={english?.actions}>
          {children}
        </TournamentActionsTextProvider>
      </TournamentPageTextProvider>
    </TournamentsTextProvider>
  );
}
