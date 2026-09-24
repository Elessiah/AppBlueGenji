import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/server/auth";
import { getPlayerPageIdentity } from "@/lib/server/users-service";
import { parseEntityPageId, playerPageTitle } from "@/lib/shared/entity-page-titles";

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

/**
 * Le titre de la fiche d'un joueur (WCAG 2.4.2) : son pseudo, et non
 * « Joueurs », hérité de l'annuaire — deux onglets sur deux joueurs portaient
 * le même.
 *
 * Même mécanique que la fiche d'équipe (`app/(secured)/equipes/[id]/layout.tsx`) :
 * un titre et rien d'autre, lu pour un lecteur connecté seulement — la fiche est
 * refusée aux autres, l'onglet ne doit pas nommer quelqu'un que la page tait —,
 * et un compte anonymisé s'annonce « Compte supprimé » plutôt que par son pseudo
 * d'emprunt (`playerPageTitle`).
 */
export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { id } = await params;
  const userId = parseEntityPageId(id);
  if (userId === null) return { title: playerPageTitle(null) };

  const player = await getCurrentUser()
    .then((user) => (user ? getPlayerPageIdentity(userId) : null))
    .catch(() => null);

  return { title: playerPageTitle(player) };
}

export default function PlayerDetailLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
