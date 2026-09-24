import type { Metadata } from "next";
import { segmentTitle } from "@/lib/shared/page-metadata";

/**
 * Le formulaire de création n'est pas la liste : sans ce titre, il héritait
 * de « Tournois ».
 */
export const metadata: Metadata = { title: segmentTitle("Créer un tournoi") };

export default function CreateTournamentLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
