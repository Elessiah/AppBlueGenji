import type { Metadata } from "next";
import { segmentTitle } from "@/lib/shared/page-metadata";

/**
 * Le formulaire de création n'est pas l'annuaire : sans ce titre, il
 * héritait de « Équipes ».
 */
export const metadata: Metadata = { title: segmentTitle("Créer une équipe") };

export default function CreateTeamLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
