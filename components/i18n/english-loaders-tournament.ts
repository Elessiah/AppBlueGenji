"use client";

import { onceLoader } from "@/lib/shared/lazy-component";
import type { TournamentActionsClientMessages } from "@/lib/shared/tournament-actions-text";
import type { TournamentSheetMessages } from "@/lib/shared/tournament-page-text";
import type { TournamentsSharedMessages } from "@/lib/shared/tournaments-text";

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
