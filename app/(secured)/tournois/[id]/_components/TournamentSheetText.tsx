import { TournamentSheetTextGate, type TournamentSheetEnglish } from "@/components/i18n/tournament-sheet-text-gate";
import { englishOnDocumentLoad, englishOnDocumentRequest } from "@/lib/server/layout-messages";
import type { Messages } from "@/lib/shared/i18n-messages";
import type { Locale } from "@/lib/shared/locales";
import { tournamentActionsMessages } from "@/lib/shared/tournament-actions-text";
import { tournamentPageMessages } from "@/lib/shared/tournament-page-text";

function sheetEnglish(messages: Messages): TournamentSheetEnglish {
  return { page: tournamentPageMessages(messages), actions: tournamentActionsMessages(messages) };
}

/**
 * L'anglais de la fiche d'un tournoi que sa mise en page sérialise : l'espace
 * `tournament` (sans ses parties serveur ni les vues, qui voyagent avec elles)
 * et les gestes (lot 8b : refus, boutons, fenêtres d'action), sous `/en` et
 * **au seul chargement complet** d'une page — une réponse du routeur
 * (navigation, préchargement, `router.refresh()` après un geste) n'en porte
 * aucun, le client gardant celui de la session ou le chargeant par son morceau
 * (`TournamentSheetTextGate`). Espace connecté : lecteur connecté seulement
 * (`englishOnDocumentLoad`, la carte « Connexion requise » remplace sinon la
 * page) ; page sans compte (`spectator`) : tout chargement complet, pour que
 * son rendu serveur soit déjà en anglais.
 */
export function tournamentSheetEnglish(locale: Locale, spectator = false): Promise<TournamentSheetEnglish | undefined> {
  return (spectator ? englishOnDocumentRequest : englishOnDocumentLoad)(locale, sheetEnglish);
}

/**
 * Textes de la fiche d'un tournoi, communs à ses deux espaces (connecté et sans
 * compte) : rien en français (déjà dans le paquet), l'anglais reçu de
 * {@link tournamentSheetEnglish} sous `/en`. Un espace de textes ajouté à la
 * fiche s'ajoute ici, et les deux pages le reçoivent.
 */
export function TournamentSheetText({
  locale,
  messages,
  children,
}: Readonly<{ locale: Locale; messages?: TournamentSheetEnglish; children: React.ReactNode }>) {
  return (
    <TournamentSheetTextGate locale={locale} messages={messages}>
      {children}
    </TournamentSheetTextGate>
  );
}
