/**
 * Le tournoi tel que le public le voit, pour une page rendue **sans session**
 * (encart de `/suivre/tournois/[id]`, réglages de `/regles/<mode>?tournoi=`) :
 * la réponse publique mutualisée (`publicTournamentSnapshot`), payée par le
 * réseau qui demande la page comme par la route publique — jamais une lecture
 * hors cache. Voir `docs/features/SPECTATOR_VIEW.md`.
 */
import { headers } from "next/headers";
import { clientIpFromHeaders, clientNetworkKey } from "@/lib/server/api-guard";
import { currentSpectatorLoadLevel } from "@/lib/server/spectator-load";
import { publicTournamentSnapshot } from "@/lib/server/spectator-snapshot";
import type { TournamentSnapshot } from "@/lib/shared/types";

export async function publicTournamentSnapshotForRequest(tournamentId: number): Promise<TournamentSnapshot | null> {
  const client = clientNetworkKey(clientIpFromHeaders(await headers()));
  return publicTournamentSnapshot(tournamentId, currentSpectatorLoadLevel(), client);
}
