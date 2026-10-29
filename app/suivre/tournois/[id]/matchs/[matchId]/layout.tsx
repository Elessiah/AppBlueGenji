import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { matchPageExists, matchPageMetadata } from "@/lib/server/match-page";
import { publicTournamentCardForRequest } from "@/lib/server/spectator-request";

type LayoutProps = {
  params: Promise<{ id: string; matchId: string }>;
};

/** Encart d'un lien de page de match sans compte : aucun droit lu (`matchPageMetadata`). */
export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { id, matchId } = await params;
  const metadata = await matchPageMetadata(
    id,
    matchId,
    true,
    async () => ((await getCurrentUser().catch(() => null)) ? null : { canManage: false }),
    // La carte publique (copie récente ou carte seule), comme l'encart de la fiche.
    publicTournamentCardForRequest,
  );
  return { ...metadata, robots: { index: false, follow: false } };
}

/**
 * Page sans compte d'un match : 404 quand le match n'est pas de ce tournoi ou
 * que le tournoi n'est pas publié. Un membre connecté est renvoyé vers la page
 * du match de son espace par la mise en page de la fiche sans compte.
 */
export default async function SpectatorMatchPageLayout({
  children,
  params,
}: Readonly<LayoutProps & { children: React.ReactNode }>) {
  const { id, matchId } = await params;
  const user = await getCurrentUser().catch(() => null);
  if (!user && (await matchPageExists(id, matchId, { canManage: false })) === false) notFound();
  return children;
}
