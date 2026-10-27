import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { SiteShell } from "@/components/site-shell";
import { AuthGate } from "./_shared/AuthGate";
import { SiteFooterBar } from "@/components/legal/SiteFooterBar";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { PATHNAME_HEADER, SEARCH_HEADER } from "@/lib/shared/csp";
import { localeHref } from "@/lib/shared/locales";
import { forwardedSearch, spectatorTournamentPath, tournamentIdFromMemberPath } from "@/lib/shared/spectator-view";

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

  // `children` n'est pas affiché, mais Next rend **quand même** les mises en
  // page et la page des segments enfants (en parallèle) et sérialise leur
  // charge RSC dans la réponse — vérifié sur `next dev` (revue de sécurité du
  // lot 9-2). Ce garde n'est donc pas une frontière : tout composant serveur
  // enfant qui lit une donnée privée vérifie lui-même la session
  // (`isDocumentLoad`, `getCurrentUser` des métadonnées d'une fiche, `can` de
  // `admin/signalements`) ; les pages, clientes, ne lisent rien sans l'API.
  // Les métadonnées du segment demandé partent aussi, et c'est voulu — c'est
  // ce que lit le robot d'aperçu de Discord.
  if (!user) {
    // Fiche de tournoi : le tournoi se suit sans compte. Chemin et requête sont
    // ceux posés par le middleware (sans préfixe de langue). L'ancre
    // `#match-…` suit une redirection de navigation complète (le navigateur la
    // conserve) ; une navigation client la perd — c'est pourquoi les liens de
    // la vitrine mènent directement à `/suivre/…` (`tournamentHref`,
    // `tournamentMatchHref`).
    const requestHeaders = await headers();
    const tournamentId = tournamentIdFromMemberPath(requestHeaders.get(PATHNAME_HEADER));
    if (tournamentId !== null) {
      redirect(localeHref(`${spectatorTournamentPath(tournamentId)}${forwardedSearch(requestHeaders.get(SEARCH_HEADER))}`, await requestLocale()));
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
    <SiteShell user={user} mainClassName="page-shell">
      {children}
    </SiteShell>
  );
}
