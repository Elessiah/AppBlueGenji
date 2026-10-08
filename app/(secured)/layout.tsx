import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { ArenaShell } from "@/components/arena-shell";
import { AuthGate } from "./_shared/AuthGate";
import { SiteFooterBar } from "@/components/legal/SiteFooterBar";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { PATHNAME_HEADER } from "@/lib/shared/csp";
import { localeHref } from "@/lib/shared/locales";
import { spectatorTournamentPath, tournamentIdFromMemberPath } from "@/lib/shared/spectator-view";

/**
 * L'espace sécurisé répond `200` aux visiteurs non connectés — une carte
 * « Connexion requise », pas la page — au lieu de rediriger (voir
 * {@link AuthGate}). Il n'est donc plus derrière un `307` qui l'excluait de
 * lui-même de l'indexation : on le dit.
 *
 * Une exception : la **fiche d'un tournoi** (`/tournois/[id]`) renvoie le
 * visiteur sans session vers sa page sans compte (`/suivre/tournois/[id]`,
 * `docs/features/SPECTATOR_VIEW.md`), qui porte le même encart d'aperçu — un
 * lien partagé sur Discord montre donc le tournoi, à l'humain comme au robot.
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
    // Fiche de tournoi : le tournoi se suit sans compte. Le chemin est celui
    // posé par le middleware, sans préfixe de langue ; l'ancre `#match-…` suit
    // d'elle-même la redirection (le navigateur la conserve).
    const tournamentId = tournamentIdFromMemberPath((await headers()).get(PATHNAME_HEADER));
    if (tournamentId !== null) {
      redirect(localeHref(spectatorTournamentPath(tournamentId), await requestLocale()));
    }
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
