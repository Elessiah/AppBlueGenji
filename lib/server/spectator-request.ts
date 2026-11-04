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
 * lecture de carte par requête sans limite ; une carte ou une réponse publique
 * **fraîche** en cache (ou en vol) ne prend aucun jeton — une copie échue servie
 * en repli, ou un « introuvable » (jamais gardé), en prend un. Au plafond : `null`, l'encart ou la page générale.
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

/** Carte du tournoi pour l'encart d'un lien, ou `null` (introuvable, plafond, panne). */
export async function publicTournamentCardForRequest(tournamentId: number): Promise<TournamentCard | null> {
  const client = clientNetworkKey(clientIpFromHeaders(await headers()));
  // Un jeton du plafond seulement quand la carte **touche la base** : une carte
  // servie par la copie ou le cache de carte ne coûte rien, et la page d'un
  // match d'un tournoi publié (deux mises en page, deux lectures) n'épuise plus
  // le plafond deux fois plus vite. Un « introuvable » n'est pas gardé : chaque
  // lecture en reprend un.
  return publicTournamentCard(tournamentId, () => !enforceRateLimit(SPECTATOR_READ_RULE, client));
}

/** Carte et réglages du tournoi pour `/regles/<mode>?tournoi=`, ou `null`. */
export async function publicTournamentSnapshotForRequest(tournamentId: number): Promise<PublicTournamentView | null> {
  const client = clientNetworkKey(clientIpFromHeaders(await headers()));
  // Même règle que la carte : un jeton seulement quand la réponse publique
  // n'est pas déjà en cache — naviguer d'un mode à l'autre n'épuise pas le plafond.
  return publicTournamentSnapshot(tournamentId, currentSpectatorLoadLevel(), client, () => !enforceRateLimit(SPECTATOR_READ_RULE, client));
}
