import type { Metadata } from "next";
import { segmentTitle } from "@/lib/shared/page-metadata";

/**
 * Titre de l'annuaire des joueurs et, faute de mieux, de ses sous-pages —
 * voir `app/(secured)/tournois/layout.tsx` pour la raison d'une mise en page.
 */
export const metadata: Metadata = { title: segmentTitle("Joueurs") };

export default function PlayersLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
