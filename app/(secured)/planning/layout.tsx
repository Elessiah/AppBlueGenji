import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PodiumTiersOff } from "@/components/podium-tiers";
import { getCurrentUser } from "@/lib/server/auth";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { segmentTitle } from "@/lib/shared/page-metadata";
import { can } from "@/lib/shared/permissions";

/** Le titre de l'onglet n'est posé que pour un lecteur autorisé : la page 404 n'annonce rien. */
export async function generateMetadata(): Promise<Metadata> {
  if (!can(await getCurrentUser(), "planning")) return {};
  const { planning } = messagesFor(await requestLocale());
  return { title: segmentTitle(planning.meta.title) };
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
  const user = await getCurrentUser();
  if (!user) return null;
  if (!can(user, "planning")) notFound();
  // Écran de travail du staff : les noms y restent sobres, sans marche du podium.
  return <PodiumTiersOff>{children}</PodiumTiersOff>;
}
