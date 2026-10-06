import type { Metadata } from "next";
import { memberAreaShareMetadata, segmentTitle } from "@/lib/shared/page-metadata";

/**
 * Titre de l'annuaire des joueurs et, faute de mieux, de ses sous-pages —
 * voir `app/(secured)/tournois/layout.tsx` pour la raison d'une mise en page.
 */
// Encart générique (`memberAreaShareMetadata`) : le robot d'aperçu n'a pas de
// session — ni nom ni pseudo, rien que le `<head>` anonyme ne montre déjà.
export const metadata: Metadata = { title: segmentTitle("Joueurs"), ...memberAreaShareMetadata("players") };

export default function PlayersLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
