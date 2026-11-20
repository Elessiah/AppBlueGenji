import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { permissionMetadata } from "@/components/error-page/NotFoundContent";
import { PodiumTiersOff } from "@/components/podium-tiers";
import { getCurrentUser } from "@/lib/server/auth";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { segmentTitle } from "@/lib/shared/page-metadata";
import { can } from "@/lib/shared/permissions";
import { segmentAccess } from "@/lib/shared/segment-access";

/** Accès au segment, lu par l'onglet et par la mise en page. */
function planningAccess(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  return segmentAccess(user, (reader) => can(reader, "planning"));
}

/**
 * Le titre de l'onglet n'est posé que pour un lecteur autorisé ; un compte
 * sans la permission lit celui de la page introuvable qu'il reçoit, un
 * visiteur sans session aucun (l'espace rend « Connexion requise »).
 */
export async function generateMetadata(): Promise<Metadata> {
  return permissionMetadata(planningAccess(await getCurrentUser()), async () => {
    const { planning } = messagesFor(await requestLocale());
    return { title: segmentTitle(planning.meta.title) };
  });
}

/**
 * Le planning des casts et arbitres n'existe que pour la permission
 * `planning` (arbitres, casters, prods, administrateurs —
 * `docs/features/CAST_PLANNING.md`) : pour tout autre compte connecté, vue
 * joueur comprise, la page est introuvable (404). Sans session, l'espace
 * sécurisé montre déjà « Connexion requise ». Ce garde n'est pas une
 * frontière : la page refait le contrôle, et chaque route aussi.
 */
export default async function PlanningLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const access = planningAccess(await getCurrentUser());
  if (access === "anonymous") return null;
  if (access === "denied") notFound();
  // Écran de travail du staff : les noms y restent sobres, sans marche du podium.
  return <PodiumTiersOff>{children}</PodiumTiersOff>;
}
