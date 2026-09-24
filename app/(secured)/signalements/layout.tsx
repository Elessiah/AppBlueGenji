import type { Metadata } from "next";
import { segmentTitle } from "@/lib/shared/page-metadata";

/**
 * Titre de la page d'un signalement, lue par les personnes qu'il vise — voir
 * `app/(secured)/tournois/layout.tsx` pour la raison d'une mise en page.
 */
export const metadata: Metadata = { title: segmentTitle("Signalement") };

export default function ConcernedReportLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
