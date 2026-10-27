import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { matchPageExists, matchPageMetadata } from "@/lib/server/match-page";
import { can } from "@/lib/shared/permissions";

type LayoutProps = {
  params: Promise<{ id: string; matchId: string }>;
};

/** Encart d'un lien de page de match, avec les droits du lecteur connecté (`matchPageMetadata`). */
export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { id, matchId } = await params;
  return matchPageMetadata(id, matchId, false, async () => {
    const user = await getCurrentUser();
    return user ? { canManage: can(user, "tournaments") } : null;
  });
}

/**
 * Page d'un match (`docs/features/MATCH_PAGE.md`) : 404 quand le match n'est
 * pas de ce tournoi, ou que le tournoi n'est pas visible pour ce lecteur. Sans
 * session, l'espace sécurisé renvoie déjà vers la page sans compte : rien
 * n'est lu ici pour lui.
 */
export default async function MatchPageLayout({
  children,
  params,
}: Readonly<LayoutProps & { children: React.ReactNode }>) {
  const { id, matchId } = await params;
  const user = await getCurrentUser();
  if (user && (await matchPageExists(id, matchId, { canManage: can(user, "tournaments") })) === false) notFound();
  return children;
}
