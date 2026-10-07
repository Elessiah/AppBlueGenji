/**
 * Textes des **gestes** d'un tournoi (lot 8b) — trois espaces, formatés sans
 * `next-intl` (`lib/shared/scoped-text.ts`), comme la consultation (lot 8a) :
 *
 * - `tournamentErrors` : un code d'API → une phrase (`_lib/error-map.ts`),
 *   lu par la fiche, la création et l'édition ;
 * - `tournamentActions` : boutons, notices, notifications et confirmations
 *   rendus **avec** la fiche (`_lib/actions-text.ts`) ;
 * - `tournamentDialogs` : fenêtres d'action chargées à la demande
 *   (`dynamic()`), dont le français voyage avec leur morceau
 *   (`_lib/dialogs-text.ts`).
 *
 * Aucun JSON n'est importé ici (types seulement) : chaque module importe le
 * français de **son** espace, pour que le bundler le range dans le bon morceau.
 * L'anglais des refus et des gestes n'arrive que sous `/en`, sérialisé par la
 * mise en page (`TournamentActionsTextProvider`) ; celui des fenêtres voyage
 * avec leurs morceaux (`_lib/dialogs-text.ts`).
 */
import type frErrors from "@/messages/fr/tournamentErrors.json";
import type frActions from "@/messages/fr/tournamentActions.json";
import type frDialogs from "@/messages/fr/tournamentDialogs.json";
import type { Messages } from "@/lib/shared/i18n-messages";
import type { Locale } from "@/lib/shared/locales";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";

export type TournamentErrorMessages = typeof frErrors;
export type TournamentActionMessages = typeof frActions;
export type TournamentDialogMessages = typeof frDialogs;

/** Table des refus dans une langue : brute, pour savoir si un code y figure. */
export type TournamentErrorsText = { readonly locale: Locale; readonly messages: TournamentErrorMessages };
export type TournamentActionsText = ScopedText<Leaves<TournamentActionMessages>>;
export type TournamentDialogsText = ScopedText<Leaves<TournamentDialogMessages>>;

/** Ce que la mise en page sérialise sous `/en` (rien en français). */
export type TournamentActionsClientMessages = {
  errors: TournamentErrorMessages;
  actions?: TournamentActionMessages;
};

/** Les espaces rendus avec la fiche (`/tournois/[id]`) : refus et gestes. */
export function tournamentActionsMessages(
  messages: Pick<Messages, "tournamentErrors" | "tournamentActions">,
): TournamentActionsClientMessages {
  return { errors: messages.tournamentErrors, actions: messages.tournamentActions };
}

export function tournamentErrorsText(locale: Locale, messages: TournamentErrorMessages): TournamentErrorsText {
  return { locale, messages };
}

export function tournamentActionsText(locale: Locale, messages: TournamentActionMessages): TournamentActionsText {
  return scopedText(locale, messages);
}

export function tournamentDialogsText(locale: Locale, messages: TournamentDialogMessages): TournamentDialogsText {
  return scopedText(locale, messages);
}
