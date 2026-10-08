"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * « Cette page est lue sans compte » (`/suivre/tournois/[id]`,
 * `docs/features/SPECTATOR_VIEW.md`).
 *
 * La fiche de tournoi est la même dans les deux espaces ; ses actions se
 * décident déjà sur les droits du lecteur, que le visiteur sans compte n'a pas.
 * Ce contexte ne règle donc que ce qui ne dépend d'aucun droit, et qui mènerait
 * ce visiteur vers une page de connexion ou lui montrerait ce que la politique
 * de confidentialité réserve aux membres :
 *
 * - les noms d'équipe et de joueur ne sont plus des liens (`EntityLink`) — leurs
 *   fiches sont dans l'espace connecté ;
 * - les codes de replay ne s'affichent pas (`MatchMapDetails`) ;
 * - l'en-tête ramène à l'accueil, pas à la liste des tournois, et son témoin dit
 *   la cadence de relecture plutôt que l'état du flux.
 */
const SpectatorViewContext = createContext(false);

export function SpectatorViewProvider({ children }: Readonly<{ children: ReactNode }>) {
  return <SpectatorViewContext.Provider value={true}>{children}</SpectatorViewContext.Provider>;
}

/** La page est-elle lue sans compte ? */
export function useSpectatorView(): boolean {
  return useContext(SpectatorViewContext);
}
