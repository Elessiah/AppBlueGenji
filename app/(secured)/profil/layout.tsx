import type { Metadata } from "next";
import { segmentTitle } from "@/lib/shared/page-metadata";

/**
 * Titre de l'écran « Mon profil » — voir `app/(secured)/tournois/layout.tsx`
 * pour la raison d'une mise en page.
 */
export const metadata: Metadata = { title: segmentTitle("Mon profil") };

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
