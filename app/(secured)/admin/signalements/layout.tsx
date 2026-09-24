import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { segmentTitle } from "@/lib/shared/page-metadata";
import { can } from "@/lib/shared/permissions";

export const metadata: Metadata = { title: segmentTitle("Signalements") };

/**
 * Le panneau n'existe que pour la permission `moderation` : pour tout autre
 * compte, la page est introuvable (404, jamais 403 — rien à révéler). Les
 * routes qu'il appelle refont le contrôle ; celui-ci évite seulement de rendre
 * un écran vide qui n'afficherait que des refus.
 */
export default async function ReportsAdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!can(user, "moderation")) notFound();
  return <>{children}</>;
}
