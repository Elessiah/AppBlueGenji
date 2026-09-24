import type { Metadata } from "next";
import { segmentTitle } from "@/lib/shared/page-metadata";

/**
 * Le titre de la page (WCAG 2.4.2) : la liste est une page cliente, qui ne peut
 * pas exporter `metadata` — d'où cette mise en page, qui n'existe que pour ça.
 * Les quatre espaces connectés s'intitulaient tous « BlueGenji Esport ».
 *
 * Un titre, et **rien d'autre** : pas de `pageMetadata()`. Une mise en page
 * transmet ses métadonnées à tout le segment, et l'URL canonique comme
 * l'`og:url` de la liste seraient descendues sur chaque fiche — un lien vers
 * `/equipes/12` se serait annoncé comme `/equipes`. Le titre, lui, reste
 * juste pour une sous-page qui n'en déclare pas (« Équipes » sur une fiche
 * d'équipe) ; la fiche d'un tournoi pose le sien. Il passe par
 * `segmentTitle()`, sans quoi les sous-pages perdraient le nom du site.
 */
export const metadata: Metadata = { title: segmentTitle("Tournois") };

export default function TournamentsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
