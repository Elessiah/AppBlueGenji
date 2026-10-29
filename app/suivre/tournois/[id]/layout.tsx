import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { publicTournamentCardForRequest } from "@/lib/server/spectator-request";
import { tournamentPageMetadata } from "@/lib/server/tournament-metadata";
import { PATHNAME_HEADER, SEARCH_HEADER } from "@/lib/shared/csp";
import { memberPathForSpectatorPath } from "@/lib/shared/spectator-member-path";
import { localeHref } from "@/lib/shared/locales";
import {
  forwardedSearch,
  parseTournamentId,
  spectatorTournamentPath,
} from "@/lib/shared/spectator-view";
import { tournamentsClientMessages } from "@/lib/shared/tournaments-text";
import { PublicPageShell } from "@/components/cyber/landing/PublicPageShell";
import { TournamentsTextProvider } from "@/components/i18n/tournaments-text";
import { SpectatorViewProvider } from "@/components/spectator-view";
import { MemberRelay } from "./_components/MemberRelay";
import { TournamentSheetText } from "@/app/(secured)/tournois/[id]/_components/TournamentSheetText";

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
 *
 * La carte vient de `publicTournamentCardForRequest` (`spectator-request.ts`) :
 * la copie de la réponse publique si elle est récente, sinon la carte seule,
 * gardée quelques secondes — jamais une reconstruction de l'instantané entier
 * payée par le réseau d'un robot d'aperçu. L'état en est recalculé depuis les
 * dates.
 */
export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { id } = await params;
  const metadata = await tournamentPageMetadata(
    id,
    spectatorTournamentPath,
    async () => ((await getCurrentUser().catch(() => null)) ? null : { canManage: false }),
    publicTournamentCardForRequest,
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
  let relay = false;
  if (user) {
    const requestHeaders = await headers();
    const requestPath = requestHeaders.get(PATHNAME_HEADER);
    if (requestPath === null) {
      // Mise en page préchargée, servie sans le chemin demandé : le renvoi
      // revient au navigateur, qui le connaît (`MemberRelay`).
      relay = true;
    } else {
      const search = forwardedSearch(requestHeaders.get(SEARCH_HEADER));
      // Page d'un match : la page du match de son espace (`MATCH_PAGE.md`).
      redirect(localeHref(`${memberPathForSpectatorPath(requestPath, tournamentId)}${search}`, locale));
    }
  }

  const catalog = locale === "en" ? messagesFor(locale) : null;
  return (
    <TournamentsTextProvider locale={locale} messages={catalog ? tournamentsClientMessages(catalog) : undefined}>
      <TournamentSheetText locale={locale}>
        <SpectatorViewProvider>
          <PublicPageShell>
            {relay && <MemberRelay tournamentId={tournamentId} />}
            <div className="page-shell">{children}</div>
          </PublicPageShell>
        </SpectatorViewProvider>
      </TournamentSheetText>
    </TournamentsTextProvider>
  );
}
