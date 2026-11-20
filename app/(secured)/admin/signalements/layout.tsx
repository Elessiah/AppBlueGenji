import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { permissionMetadata } from "@/components/error-page/NotFoundContent";
import { PodiumTiersOff } from "@/components/podium-tiers";
import { getCurrentUser } from "@/lib/server/auth";
import { segmentTitle } from "@/lib/shared/page-metadata";
import { can } from "@/lib/shared/permissions";
import { segmentAccess } from "@/lib/shared/segment-access";

/** Accès au segment, lu par l'onglet et par la mise en page. */
function moderationAccess(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  return segmentAccess(user, (reader) => can(reader, "moderation"));
}

/**
 * Le titre de l'onglet n'est posé que pour la modération ; un autre compte lit
 * celui de la page introuvable qu'il reçoit, un visiteur sans session aucun.
 */
export async function generateMetadata(): Promise<Metadata> {
  return permissionMetadata(moderationAccess(await getCurrentUser()), () => ({
    title: segmentTitle("Signalements"),
  }));
}

/**
 * Le panneau n'existe que pour la permission `moderation` : pour tout autre
 * compte, la page est introuvable (404, jamais 403 — rien à révéler). Les
 * routes qu'il appelle refont le contrôle ; celui-ci évite seulement de rendre
 * un écran vide qui n'afficherait que des refus.
 */
export default async function ReportsAdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const access = moderationAccess(await getCurrentUser());
  if (access === "anonymous") return null;
  if (access === "denied") notFound();
  // Écran d'administration : les noms y restent sobres, sans marche du podium.
  return <PodiumTiersOff>{children}</PodiumTiersOff>;
}
