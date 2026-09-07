import { Suspense } from "react";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/server/auth";
import { getUserActiveTeam } from "@/lib/server/teams-service";
import { ArenaNav } from "@/components/arena-nav";
import { AuthGate } from "./_shared/AuthGate";

/**
 * L'espace sécurisé répond `200` aux visiteurs non connectés — une carte
 * « Connexion requise », pas la page — au lieu de rediriger (voir
 * {@link AuthGate}). Il n'est donc plus derrière un `307` qui l'excluait de
 * lui-même de l'indexation : on le dit.
 *
 * Les fiches de tournoi héritent de ce `noindex` et le gardent : leur intérêt
 * est l'aperçu des liens partagés, que les robots d'encart lisent sans se
 * soucier de cette directive — l'indexation, elle, ne trouverait que la carte
 * de connexion.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function SecuredLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // Les enfants ne sont pas rendus : rien du contenu protégé n'atteint la
  // réponse. Seules les métadonnées du segment demandé le font, et c'est
  // exactement ce qu'on veut — c'est ce que lit le robot d'aperçu de Discord.
  if (!user) {
    return (
      <main className="page-shell">
        <Suspense>
          <AuthGate />
        </Suspense>
      </main>
    );
  }

  const activeTeam = await getUserActiveTeam(user.id);

  return (
    <>
      <ArenaNav pseudo={user.pseudo} avatarUrl={user.avatarUrl} activeTeam={activeTeam} />
      <main className="page-shell">{children}</main>
    </>
  );
}
