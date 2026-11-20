import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { notFoundMetadata } from "@/components/error-page/NotFoundContent";
import { getCurrentUser } from "@/lib/server/auth";
import { matchPageExists, matchPageMetadata } from "@/lib/server/match-page";
import { can } from "@/lib/shared/permissions";

type LayoutProps = {
  params: Promise<{ id: string; matchId: string }>;
};

/** Encart d'un lien de page de match, avec les droits du lecteur connecté (`matchPageMetadata`). */
export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { id, matchId } = await params;
  const user = await getCurrentUser().catch(() => null);
  const rights = user ? { canManage: can(user, "tournaments") } : null;
  // Match absent : la page rend la 404 (voir la mise en page), l'onglet aussi.
  if (rights && (await matchPageExists(id, matchId, rights)) === false) return notFoundMetadata();
  return matchPageMetadata(id, matchId, false, async () => rights);
}

/**
 * Page d'un match (`docs/features/MATCH_PAGE.md`) : 404 quand le match n'est
 * pas de ce tournoi, ou que le tournoi n'est pas visible pour ce lecteur. Sans
 * session, l'espace sécurisé renvoie déjà vers la page sans compte : rien
 * n'est lu ici pour lui. Une session illisible (base injoignable) n'est pas un
 * 404 : la page s'affiche et dit son erreur, comme la fiche.
 */
export default async function MatchPageLayout({
  children,
  params,
}: Readonly<LayoutProps & { children: React.ReactNode }>) {
  const { id, matchId } = await params;
  const user = await getCurrentUser().catch(() => null);
  if (user && (await matchPageExists(id, matchId, { canManage: can(user, "tournaments") })) === false) notFound();
  return children;
}
