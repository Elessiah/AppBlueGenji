/**
 * Le tournoi tel que le public le voit, pour une page rendue **sans session**,
 * jamais une lecture hors cache ni hors plafond. Voir
 * `docs/features/SPECTATOR_VIEW.md`.
 *
 * - l'**encart d'un lien** (`/suivre/tournois/[id]`, `/regles/<mode>?tournoi=`)
 *   ne lit que la carte (`publicTournamentCard`) : une requête indexée, jamais
 *   l'instantané entier ;
 * - les **réglages** de `/regles/<mode>?tournoi=` lisent la réponse publique
 *   mutualisée (`publicTournamentSnapshot`), au même prix pour le réseau.
 *
 * Chaque lecture **en base** compte dans le plafond des lectures publiques
 * (`SPECTATOR_READ_RULE`) : une boucle sur des identifiants ne coûte plus une
 * lecture de carte par requête sans limite ; une carte servie depuis un cache ne
 * prend aucun jeton. Au plafond : `null`, l'encart ou la page générale.
 */
import { headers } from "next/headers";
import { clientIpFromHeaders, clientNetworkKey, enforceRateLimit, SPECTATOR_READ_RULE } from "@/lib/server/api-guard";
import { currentSpectatorLoadLevel } from "@/lib/server/spectator-load";
import {
  publicTournamentCard,
  publicTournamentSnapshot,
  type PublicTournamentView,
} from "@/lib/server/spectator-snapshot";
import type { TournamentCard } from "@/lib/shared/types";

/** Réseau du rendu, ou `null` s'il a atteint le plafond des lectures publiques. */
async function admittedClient(): Promise<{ client: string | null } | null> {
  const client = clientNetworkKey(clientIpFromHeaders(await headers()));
  return enforceRateLimit(SPECTATOR_READ_RULE, client) ? null : { client };
}

/** Carte du tournoi pour l'encart d'un lien, ou `null` (introuvable, plafond, panne). */
export async function publicTournamentCardForRequest(tournamentId: number): Promise<TournamentCard | null> {
  const client = clientNetworkKey(clientIpFromHeaders(await headers()));
  // Un jeton du plafond seulement quand la carte **touche la base** : une carte
  // servie par la copie ou le cache de carte ne coûte rien, et la page d'un
  // match (deux mises en page, deux lectures) n'épuise plus le plafond deux
  // fois plus vite.
  return publicTournamentCard(tournamentId, () => !enforceRateLimit(SPECTATOR_READ_RULE, client));
}

/** Carte et réglages du tournoi pour `/regles/<mode>?tournoi=`, ou `null`. */
export async function publicTournamentSnapshotForRequest(tournamentId: number): Promise<PublicTournamentView | null> {
  const admitted = await admittedClient();
  if (admitted === null) return null;
  return publicTournamentSnapshot(tournamentId, currentSpectatorLoadLevel(), admitted.client);
}
