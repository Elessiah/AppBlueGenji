import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { requestLocale } from "@/lib/server/request-locale";
import { tournamentPageMetadata } from "@/lib/server/tournament-metadata";
import { memberTournamentPath } from "@/lib/shared/spectator-view";
import { TournamentSheetText } from "./_components/TournamentSheetText";

type MetadataProps = {
  params: Promise<{ id: string }>;
};

/**
 * Ce qu'un lien de tournoi raconte là où on le colle (`tournamentPageMetadata`).
 *
 * La fiche est une page cliente : elle ne peut pas exporter `generateMetadata`,
 * d'où cette mise en page. Un visiteur sans session — robot d'aperçu compris —
 * n'est pas servi ici : l'espace sécurisé le renvoie vers la page sans compte
 * (`/suivre/tournois/[id]`), qui porte le même encart. Pour lui, la carte du
 * tournoi n'est donc même pas lue : la redirection jetterait la requête.
 */
export async function generateMetadata({ params }: MetadataProps): Promise<Metadata> {
  const { id } = await params;
  return tournamentPageMetadata(id, memberTournamentPath, async () => {
    const user = await getCurrentUser();
    return user ? { canManage: can(user, "tournaments") } : null;
  });
}

/** Pose les textes de la fiche (`TournamentSheetText`, communs à la page sans compte). */
export default async function TournamentDetailLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <TournamentSheetText locale={await requestLocale()}>{children}</TournamentSheetText>;
}
