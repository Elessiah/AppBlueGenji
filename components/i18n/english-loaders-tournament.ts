"use client";

import { onceLoader } from "@/lib/shared/lazy-component";
import type { TournamentActionsClientMessages } from "@/lib/shared/tournament-actions-text";
import type { TournamentSheetMessages } from "@/lib/shared/tournament-page-text";
import type { TournamentsClientMessages, TournamentsSharedMessages } from "@/lib/shared/tournaments-text";
import { EN_TICKER_LABELS } from "@/lib/shared/ticker-labels";

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
 *
 * Module à part de la porte (`tournament-sheet-text-gate.tsx`) : le survol d'un
 * lien de tournoi le précharge (`english-page-loaders.ts`) sans emporter le
 * français de la fiche. Rien d'autre que des `import()` et des types ici.
 */
export const englishTournamentSheet = /* @__PURE__ */ onceLoader<TournamentSheetEnglish>(() =>
  Promise.all([
    import("@/messages/en/tournament.json"),
    import("@/messages/en/tournamentErrors.json"),
    import("@/messages/en/tournamentActions.json"),
    import("@/messages/en/tournamentsShared.json"),
    import("@/messages/en/labels.json"),
  ]).then(([tournament, errors, actions, shared, labels]) => ({
    page: tournament.default,
    actions: { errors: errors.default, actions: actions.default },
    shared: { ...shared.default, labels: labels.default },
  })),
);

/**
 * L'anglais de la liste `/tournois` (liste, bandeau, cartes, textes communs avec
 * la fiche et libellés du bandeau), chargé à part quand la page ne l'a pas
 * sérialisé (navigation, préchargement, `router.refresh()`) : la réponse du
 * routeur n'emporte plus ses ~6 Ko. Une fois pour la session.
 */
export const englishTournamentsList = /* @__PURE__ */ onceLoader<TournamentsClientMessages>(() =>
  Promise.all([
    import("@/messages/en/tournaments.json"),
    import("@/messages/en/tournamentsShared.json"),
    import("@/messages/en/labels.json"),
  ]).then(([tournaments, shared, labels]) => ({
    list: tournaments.default.list,
    ticker: tournaments.default.ticker,
    cards: tournaments.default.cards,
    ...shared.default,
    labels: labels.default,
    tickerControls: EN_TICKER_LABELS,
  })),
);
