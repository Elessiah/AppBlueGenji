import { TournamentActionsTextProvider } from "@/components/i18n/tournament-actions-text";
import { TournamentPageTextProvider } from "@/components/i18n/tournament-page-text";
import { messagesFor } from "@/lib/server/i18n-messages";
import type { Locale } from "@/lib/shared/locales";
import { tournamentActionsMessages } from "@/lib/shared/tournament-actions-text";
import { tournamentPageMessages } from "@/lib/shared/tournament-page-text";

/**
 * Textes de la fiche d'un tournoi, communs à ses deux espaces (connecté et sans
 * compte) : rien en français (déjà dans le paquet), l'espace `tournament` (sans
 * ses parties serveur) et les gestes (lot 8b : refus, boutons, fenêtres
 * d'action) sous `/en` seulement. Un espace de textes ajouté à la fiche
 * s'ajoute ici, et les deux pages le reçoivent.
 */
export function TournamentSheetText({ locale, children }: Readonly<{ locale: Locale; children: React.ReactNode }>) {
  const catalog = locale === "en" ? messagesFor(locale) : null;
  return (
    <TournamentPageTextProvider locale={locale} messages={catalog ? tournamentPageMessages(catalog) : undefined}>
      <TournamentActionsTextProvider locale={locale} messages={catalog ? tournamentActionsMessages(catalog) : undefined}>
        {children}
      </TournamentActionsTextProvider>
    </TournamentPageTextProvider>
  );
}
