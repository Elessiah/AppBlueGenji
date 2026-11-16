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
 * **fraîche** en cache (ou en vol) ne prend aucun jeton, une lecture qui touche
 * la base (réponse échue à reconstruire, carte absente du cache, « introuvable »
 * jamais gardé) en prend un. Au plafond : la copie échue de moins de 150 s si
 * elle existe (sans jeton, sans base), sinon `null` — l'encart ou la page générale.
 */
import { headers } from "next/headers";
import {
  clientIpFromHeaders,
  clientNetworkKey,
  enforceRateLimit,
  SHARE_EMBED_RENDER_RULE,
  SPECTATOR_READ_RULE,
} from "@/lib/server/api-guard";
import { refundTokenBucket, takeTokenBucket } from "@/lib/server/rate-limit";
import {
  MAX_QUEUED_EMBED_RENDERS,
  MAX_QUEUED_EMBED_RENDERS_PER_CLIENT,
  type ShareRenderAdmission,
} from "@/lib/server/share-image-cache";
import { currentSpectatorLoadLevel } from "@/lib/server/spectator-load";
import {
  publicTournamentCard,
  publicTournamentImageView,
  publicTournamentShare,
  publicTournamentSnapshot,
  type PublicTournamentShare,
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

/** Réseau de la requête en cours (`clientNetworkKey`), `null` : inconnu. */
export async function shareRequestClient(): Promise<string | null> {
  return clientNetworkKey(clientIpFromHeaders(await headers()));
}

/**
 * Carte et résumé d'aperçu d'un tournoi pour l'encart d'une page de match ou
 * l'image d'un tournoi ou d'un match (`SHARE_EMBEDS.md`), ou `null`. Même
 * règle que les réglages : la réponse publique mutualisée, un jeton du plafond
 * seulement quand elle n'est pas déjà en cache. `client` : le réseau déjà lu
 * par l'appelant (sinon lu ici).
 */
export async function publicTournamentShareForRequest(
  tournamentId: number,
  client?: string | null,
): Promise<PublicTournamentShare | null> {
  const network = client === undefined ? await shareRequestClient() : client;
  return publicTournamentShare(tournamentId, currentSpectatorLoadLevel(), network, () => !enforceRateLimit(SPECTATOR_READ_RULE, network));
}

/**
 * Ce que l'image d'un tournoi dessine (`publicTournamentImageView`), ou
 * `null`. La carte et la réponse publique lues par une même requête ne paient
 * qu'**un** jeton du plafond des lectures : le verdict du premier est gardé.
 */
export async function publicTournamentImageViewForRequest(
  tournamentId: number,
  client?: string | null,
): Promise<PublicTournamentShare | null> {
  const network = client === undefined ? await shareRequestClient() : client;
  let admitted: boolean | undefined;
  const admitOnce = () => (admitted ??= !enforceRateLimit(SPECTATOR_READ_RULE, network));
  return publicTournamentImageView(tournamentId, currentSpectatorLoadLevel(), network, admitOnce);
}

/**
 * Seau des requêtes **sans réseau lisible** (aucun relais de confiance :
 * `next start` exposé, relais mal réglé) : ailleurs une identité inconnue
 * n'est pas plafonnée, mais un rendu Satori est trop cher pour rester ouvert ;
 * au pire, ces requêtes partagent un seau et reçoivent la carte neutre.
 */
export const UNKNOWN_NETWORK_RENDER_KEY = "unknown-network";

/**
 * Garde d'un **nouveau** rendu d'image d'aperçu pour le réseau `client`
 * (`SHARE_EMBED_RENDER_RULE`, file bornée par réserve et par réseau) : `admit`
 * n'est appelé qu'avant un vrai rendu ; `false` : refusé (la route sert la
 * carte neutre). `refund` rend le jeton d'un rendu qui n'a rien dessiné.
 */
export function shareEmbedRenderAdmission(client: string | null): ShareRenderAdmission {
  const key = client ?? UNKNOWN_NETWORK_RENDER_KEY;
  return {
    client: key,
    admit: () => takeTokenBucket(SHARE_EMBED_RENDER_RULE, key).allowed,
    refund: () => refundTokenBucket(SHARE_EMBED_RENDER_RULE, key),
    maxQueued: MAX_QUEUED_EMBED_RENDERS,
    maxQueuedPerClient: MAX_QUEUED_EMBED_RENDERS_PER_CLIENT,
  };
}
