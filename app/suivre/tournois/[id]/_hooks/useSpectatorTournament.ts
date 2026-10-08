import { useEffect, useState } from "react";
import type { TournamentSheetSource } from "@/app/(secured)/tournois/[id]/_components/TournamentSheet";
import { getClientPowerInput, subscribeClientPower } from "@/lib/shared/hooks/useClientPower";
import {
  createSpectatorPoller,
  INITIAL_SPECTATOR_STATE,
  type SpectatorPoller,
  type SpectatorState,
} from "../_lib/spectator-poller";

/** Rien à relire après un geste : la page sans compte n'en a aucun. */
const NO_REFRESH = async () => undefined;

/**
 * Suivi d'un tournoi sans compte : le relecteur (`_lib/spectator-poller.ts`)
 * branché sur le navigateur et sur la visibilité de l'onglet
 * (`useClientPower`). Rend la même forme que `useTournamentLive` : la fiche est
 * commune, seule la source change.
 */
export function useSpectatorTournament(tournamentId: number): TournamentSheetSource {
  const [state, setState] = useState<SpectatorState>(INITIAL_SPECTATOR_STATE);

  // Un relecteur par tournoi : le composant n'est pas remonté d'un identifiant
  // à l'autre, l'état repart donc de zéro avec lui.
  useEffect(() => {
    setState(INITIAL_SPECTATOR_STATE);
    const poller: SpectatorPoller = createSpectatorPoller(
      tournamentId,
      {
        fetch: (url, init) => fetch(url, init),
        now: () => Date.now(),
        setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
        clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
        isHidden: () => getClientPowerInput().attention === "HIDDEN",
      },
      setState,
    );
    const unsubscribe = subscribeClientPower(poller.attentionChanged);
    void poller.start();
    return () => {
      unsubscribe();
      poller.dispose();
    };
  }, [tournamentId]);

  return {
    tournament: state.detail,
    refresh: NO_REFRESH,
    isLive: state.isLive,
    tier: "STANDARD",
    fatal: state.fatal,
    // Le témoin annonce l'âge maximal de l'affichage, cache serveur compris.
    cadenceMs: state.freshnessMs ?? state.cadenceMs,
    retrying: state.retrying,
  };
}
