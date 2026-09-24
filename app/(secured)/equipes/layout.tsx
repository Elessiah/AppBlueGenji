import type { Metadata } from "next";
import { segmentTitle } from "@/lib/shared/page-metadata";

/**
 * Titre de l'annuaire des équipes et, faute de mieux, de ses sous-pages —
 * voir `app/(secured)/tournois/layout.tsx` pour la raison d'une mise en page.
 */
export const metadata: Metadata = { title: segmentTitle("Équipes") };

export default function TeamsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
