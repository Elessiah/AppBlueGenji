import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/server/auth";
import { getTeamPageIdentity } from "@/lib/server/teams-service";
import { parseEntityPageId, teamPageTitle } from "@/lib/shared/entity-page-titles";

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

/**
 * Le titre de la fiche d'une équipe (WCAG 2.4.2) : son nom, et non « Équipes »,
 * hérité de l'annuaire — deux onglets sur deux équipes portaient le même.
 *
 * La fiche est une page cliente, d'où cette mise en page, qui n'existe que pour
 * ça. Un titre, **rien d'autre** : ni encart ni URL canonique, que la fiche
 * n'a jamais eus (voir `app/(secured)/tournois/layout.tsx`).
 *
 * Le nom n'est lu que pour un lecteur connecté : la fiche est refusée aux
 * autres (`GET /api/teams/[id]` répond 401, la garde rend la carte « Connexion
 * requise »), et l'onglet ne doit pas dire ce que la page tait. Une base
 * injoignable retombe sur le titre générique plutôt que de faire échouer la
 * page, qui affiche alors sa propre erreur.
 */
export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { id } = await params;
  const teamId = parseEntityPageId(id);
  if (teamId === null) return { title: teamPageTitle(null) };

  const team = await getCurrentUser()
    .then((user) => (user ? getTeamPageIdentity(teamId) : null))
    .catch(() => null);

  return { title: teamPageTitle(team) };
}

export default function TeamDetailLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
