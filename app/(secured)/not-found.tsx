import type { Metadata } from "next";
import { NotFoundContent, notFoundMetadata } from "@/components/error-page/NotFoundContent";

export async function generateMetadata(): Promise<Metadata> {
  return notFoundMetadata();
}

/**
 * Page introuvable **dans l'espace sécurisé** : un `notFound()` jeté par une
 * mise en page de l'espace (`/admin/signalements`, `/devdoc`, `/planning`) est
 * rattrapé par la limite du segment parent, déjà rendue sous `SiteShell`, qui
 * porte la navigation. La page introuvable de la racine ajoutait alors son
 * propre en-tête (deux barres de navigation à 375 px) : celle-ci n'affiche que
 * la carte et ses chemins de retour.
 */
export default async function SecuredNotFound() {
  return NotFoundContent();
}
