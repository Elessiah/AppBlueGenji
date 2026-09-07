import { ImageResponse } from "next/og";
import { ShareCard, SHARE_CARD_SIZE, SHARE_CARD_CONTENT_TYPE } from "@/components/og/share-card";
import { getVisibleTournamentSnapshot } from "@/lib/server/tournaments-service";
import { SITE_NAME, SITE_SHARE_CARD, tournamentShareCard } from "@/lib/shared/share-metadata";

/**
 * Image d'aperçu d'un tournoi — la carte qui s'affiche sous le lien partagé.
 *
 * C'est une **route à part**, pas un rendu de la page : elle est servie sans
 * passer par les mises en page, donc sans la garde de l'espace sécurisé. Elle
 * porte par conséquent sa propre application de la règle de visibilité — la
 * même que la fiche, par la même porte — au lieu de compter sur celle d'un
 * appelant qui, ici, n'existe pas.
 *
 * Un tournoi illisible retombe sur la carte du site : une image d'erreur ferait
 * un encart cassé, et une 404 laisserait Discord afficher un encart sans image.
 * Le robot qui la demande n'est jamais authentifié — elle ne montre donc que ce
 * que la liste publique montre déjà.
 */
export const alt = SITE_NAME;
export const size = SHARE_CARD_SIZE;
export const contentType = SHARE_CARD_CONTENT_TYPE;

/**
 * L'effectif engagé figure sur la carte : elle vieillit. Cinq minutes suffisent
 * — les plateformes gardent de toute façon l'image en cache bien plus longtemps
 * — et bornent le coût d'un lien collé dans un gros salon.
 */
export const revalidate = 300;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tournamentId = Number(id);

  const snapshot =
    Number.isInteger(tournamentId) && tournamentId > 0
      ? await getVisibleTournamentSnapshot(tournamentId).catch(() => null)
      : null;

  if (!snapshot) {
    return new ImageResponse(<ShareCard {...SITE_SHARE_CARD} />, size);
  }

  return new ImageResponse(<ShareCard {...tournamentShareCard(snapshot.card)} />, size);
}
