import { Suspense } from "react";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/server/auth";
import { ArenaShell } from "@/components/arena-shell";
import { AuthGate } from "./_shared/AuthGate";
import { SiteFooterBar } from "@/components/legal/SiteFooterBar";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";

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

export default async function SecuredLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();

  // Les enfants ne sont pas rendus : rien du contenu protégé n'atteint la
  // réponse. Seules les métadonnées du segment demandé le font, et c'est
  // exactement ce qu'on veut — c'est ce que lit le robot d'aperçu de Discord.
  if (!user) {
    // Dans la langue de l'adresse : anglaise sous une route traduite
    // (`/en/tournois`), française partout ailleurs (le middleware renvoie les
    // autres `/en/…` vers le français).
    const { authGate } = messagesFor(await requestLocale()).login;
    return (
      <>
        <main className="page-shell">
          <Suspense>
            <AuthGate text={authGate} />
          </Suspense>
        </main>
        <SiteFooterBar authenticated={false} />
      </>
    );
  }

  return (
    <ArenaShell user={user} mainClassName="page-shell">
      {children}
    </ArenaShell>
  );
}
