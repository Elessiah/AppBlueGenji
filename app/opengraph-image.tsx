import { ImageResponse } from "next/og";
import { ShareCard, SHARE_CARD_SIZE, SHARE_CARD_CONTENT_TYPE } from "@/components/og/share-card";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/shared/share-metadata";

/**
 * Image d'aperçu par défaut du site.
 *
 * Posée à la racine de `app/`, elle vaut pour **toutes** les pages qui n'en
 * déclarent pas une à elles : la vitrine, les règles, l'association, les pages
 * légales. Une seule image à tenir, et aucune page ne peut être oubliée.
 */
export const alt = SITE_NAME;
export const size = SHARE_CARD_SIZE;
export const contentType = SHARE_CARD_CONTENT_TYPE;

export default function Image() {
  return new ImageResponse(
    <ShareCard eyebrow="BlueGenji Esport" title={SITE_NAME} subtitle={SITE_TAGLINE} />,
    size,
  );
}
