import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { tournamentPageMetadata } from "@/lib/server/tournament-metadata";
import { SEARCH_HEADER } from "@/lib/shared/csp";
import { localeHref } from "@/lib/shared/locales";
import {
  forwardedSearch,
  memberTournamentPath,
  parseTournamentId,
  spectatorTournamentPath,
} from "@/lib/shared/spectator-view";
import { tournamentsClientMessages } from "@/lib/shared/tournaments-text";
import { tournamentPageMessages } from "@/lib/shared/tournament-page-text";
import { tournamentActionsMessages } from "@/lib/shared/tournament-actions-text";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { TournamentsTextProvider } from "@/components/i18n/tournaments-text";
import { TournamentPageTextProvider } from "@/components/i18n/tournament-page-text";
import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";
import { SpectatorViewProvider } from "@/components/spectator-view";

type LayoutProps = {
  params: Promise<{ id: string }>;
};

/**
 * L'encart d'un lien de tournoi, le même que celui de la fiche connectée
 * (`tournamentPageMetadata`) : c'est ici qu'aboutit un robot d'aperçu, que
 * l'espace sécurisé redirige comme tout visiteur sans session. Aucun droit
 * n'est lu — un tournoi non publié retombe sur l'encart du site.
 *
 * `noindex` : la page est faite pour suivre un tournoi dont on a reçu le lien,
 * pas pour faire entrer les pseudos des joueurs dans les moteurs de recherche.
 *
 * Un membre connecté est redirigé vers sa fiche : pour lui, la carte n'est pas
 * lue. La session est mémoïsée pour la requête (`getCurrentUser`), la mise en
 * page la relit sans nouvelle requête. Aucun droit n'est jamais accordé ici.
 */
export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { id } = await params;
  const metadata = await tournamentPageMetadata(id, spectatorTournamentPath, async () =>
    (await getCurrentUser().catch(() => null)) ? null : { canManage: false },
  );
  return { ...metadata, robots: { index: false, follow: false } };
}

/**
 * Page sans compte d'un tournoi (`docs/features/SPECTATOR_VIEW.md`).
 *
 * Un espace à part, et non une variante de l'espace sécurisé : ni session lue
 * pour décider de ce qui s'affiche, ni route d'écriture appelée, une seule
 * lecture publique. Un membre connecté qui arrive ici est renvoyé vers sa
 * fiche, où sont ses actions — comme un visiteur sans session l'est ici depuis
 * `/tournois/[id]`.
 */
export default async function SpectatorTournamentLayout({
  children,
  params,
}: Readonly<LayoutProps & { children: React.ReactNode }>) {
  const { id } = await params;
  const tournamentId = parseTournamentId(id);
  if (tournamentId === null) notFound();

  const locale = await requestLocale();
  // Une base injoignable ne bloque pas la page : sans session lisible, on la
  // sert telle qu'au visiteur sans compte.
  const user = await getCurrentUser().catch(() => null);
  if (user) {
    const search = forwardedSearch((await headers()).get(SEARCH_HEADER));
    redirect(localeHref(`${memberTournamentPath(tournamentId)}${search}`, locale));
  }

  const catalog = locale === "en" ? messagesFor(locale) : null;
  return (
    <TournamentsTextProvider locale={locale} messages={catalog ? tournamentsClientMessages(catalog) : undefined}>
      <TournamentPageTextProvider locale={locale} messages={catalog ? tournamentPageMessages(catalog) : undefined}>
        <TournamentActionsTextProvider locale={locale} messages={catalog ? tournamentActionsMessages(catalog) : undefined}>
          <SpectatorViewProvider>
            <PublicPageShell>
              <div className="page-shell">{children}</div>
            </PublicPageShell>
          </SpectatorViewProvider>
        </TournamentActionsTextProvider>
      </TournamentPageTextProvider>
    </TournamentsTextProvider>
  );
}
