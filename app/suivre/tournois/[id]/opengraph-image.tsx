/**
 * Image d'aperçu de la page sans compte : la même carte que la fiche connectée
 * (`app/(secured)/tournois/[id]/opengraph-image.tsx`), qui applique elle-même la
 * règle de visibilité sans aucun droit. `revalidate` est redéclaré ici : c'est
 * une option de segment, que Next lit littéralement dans le fichier de la route.
 */
export { default, alt, size, contentType } from "@/app/(secured)/tournois/[id]/opengraph-image";

export const revalidate = 300;
