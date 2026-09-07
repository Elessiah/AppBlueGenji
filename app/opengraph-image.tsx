import { ImageResponse } from "next/og";
import { ShareCard, SHARE_CARD_SIZE, SHARE_CARD_CONTENT_TYPE } from "@/components/og/share-card";
import { SITE_NAME, SITE_SHARE_CARD } from "@/lib/shared/share-metadata";

/**
 * Image d'aperçu par défaut du site.
 *
 * Contrairement à ce qu'on attendrait d'une convention par ailleurs héritée
 * (`icon`), sa position à la racine d'`app/` ne la fait **pas** descendre aux
 * pages imbriquées : elle n'habille que `/`. Les autres la désignent par la
 * route qu'elle expose (`DEFAULT_SHARE_IMAGE`, posée dans la mise en page
 * racine et par `pageMetadata`), et un segment qui pose la sienne — la fiche
 * d'un tournoi — garde la sienne.
 */
export const alt = SITE_NAME;
export const size = SHARE_CARD_SIZE;
export const contentType = SHARE_CARD_CONTENT_TYPE;

export default function Image() {
  return new ImageResponse(<ShareCard {...SITE_SHARE_CARD} />, size);
}
