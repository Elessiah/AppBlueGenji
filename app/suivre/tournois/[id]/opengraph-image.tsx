import { SHARE_CARD_SIZE, SHARE_CARD_CONTENT_TYPE } from "@/components/og/share-card";
import { SITE_NAME } from "@/lib/shared/share-metadata";

/**
 * Image d'aperçu de la page sans compte : la même carte que la fiche connectée
 * (`app/(secured)/tournois/[id]/opengraph-image.tsx`), qui applique elle-même la
 * règle de visibilité sans aucun droit. Les constantes de segment sont
 * redéclarées ici : Next les lit dans le fichier de la route.
 */
export { default } from "@/app/(secured)/tournois/[id]/opengraph-image";

export const alt = `Aperçu du tournoi — ${SITE_NAME}`;
export const size = SHARE_CARD_SIZE;
export const contentType = SHARE_CARD_CONTENT_TYPE; // NOSONAR typescript:S7763 — export de convention de Next (`opengraph-image`), déclaré en constante du module
export const revalidate = 300;
