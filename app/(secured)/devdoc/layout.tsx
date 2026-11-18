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
  if (!can(await getCurrentUser(), "dev")) return {};
  const { devdoc } = messagesFor(await requestLocale());
  return { title: segmentTitle(devdoc.meta.title) };
}

/**
 * La documentation développeur n'existe que pour la permission `dev`
 * (administrateurs et rôle `DEV`, `docs/features/DEVDOC.md`) : pour tout autre
 * compte connecté, la page est introuvable (404), comme le panneau des
 * signalements. Sans session, l'espace sécurisé montre déjà « Connexion
 * requise ». Ce garde n'est pas une frontière (les segments enfants sont rendus
 * en parallèle) : la page refait le contrôle avant de lire le moindre fichier.
 */
export default async function DevDocLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!can(user, "dev")) notFound();
  return <PodiumTiersOff>{children}</PodiumTiersOff>;
}
