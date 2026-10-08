import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { messagesFor } from "@/lib/server/i18n-messages";
import { requestLocale } from "@/lib/server/request-locale";
import { tournamentPageMetadata } from "@/lib/server/tournament-metadata";
import { memberTournamentPath } from "@/lib/shared/spectator-view";
import { tournamentPageMessages } from "@/lib/shared/tournament-page-text";
import { TournamentPageTextProvider } from "@/components/i18n/tournament-page-text";
import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";
import { tournamentActionsMessages } from "@/lib/shared/tournament-actions-text";

type MetadataProps = {
  params: Promise<{ id: string }>;
};

/**
 * Ce qu'un lien de tournoi raconte là où on le colle (`tournamentPageMetadata`).
 *
 * La fiche est une page cliente : elle ne peut pas exporter `generateMetadata`,
 * d'où cette mise en page. Un robot d'aperçu, sans session, n'arrive plus ici :
 * l'espace sécurisé le renvoie vers la page sans compte
 * (`/suivre/tournois/[id]`), qui porte le même encart. Un membre qui colle le
 * lien le voit donc pareil, que le robot suive ou non la redirection.
 */
export async function generateMetadata({ params }: MetadataProps): Promise<Metadata> {
  const { id } = await params;
  return tournamentPageMetadata(id, memberTournamentPath, async () => {
    const user = await getCurrentUser();
    return { canManage: user ? can(user, "tournaments") : false };
  });
}

/**
 * Pose les textes de la fiche : rien en français (déjà dans le paquet),
 * l'espace `tournament` (sans ses parties serveur) sous `/en` seulement.
 */
export default async function TournamentDetailLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await requestLocale();
  const catalog = locale === "en" ? messagesFor(locale) : null;
  const messages = catalog ? tournamentPageMessages(catalog) : undefined;
  // Gestes (lot 8b) : refus, boutons, fenêtres d'action — anglais sous `/en` seulement.
  const actions = catalog ? tournamentActionsMessages(catalog) : undefined;
  return (
    <TournamentPageTextProvider locale={locale} messages={messages}>
      <TournamentActionsTextProvider locale={locale} messages={actions}>
        {children}
      </TournamentActionsTextProvider>
    </TournamentPageTextProvider>
  );
}
