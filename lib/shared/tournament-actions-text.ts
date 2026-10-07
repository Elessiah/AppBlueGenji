/**
 * Textes des **gestes** d'un tournoi (lot 8b), formatés sans `next-intl`
 * (`lib/shared/scoped-text.ts`), comme la consultation (lot 8a) :
 *
 * - `tournamentErrors` : un code d'API → une phrase (`_lib/error-map.ts`),
 *   lu par la fiche, la création et l'édition ;
 * - `tournamentActions` : boutons, notices, notifications et confirmations
 *   rendus **avec** la fiche (`_lib/actions-text.ts`) ;
 * - `tournamentDialogs` : fenêtres d'action chargées à la demande
 *   (`dynamic()`), dont le français voyage avec leur morceau
 *   (`_lib/dialogs-text.ts`) ;
 * - `tournamentImage` : sélecteur d'image, partagé par la fenêtre d'image de
 *   la fiche et le formulaire de création (lot 8b-2) ;
 * - `tournamentForm` : formulaires de création et d'édition (lot 8b-2).
 *
 * Aucun JSON n'est importé ici (types seulement) : chaque module importe le
 * français de **son** espace, pour que le bundler le range dans le bon morceau.
 * L'anglais des refus, des gestes, de l'image et des formulaires n'arrive que
 * sous `/en`, sérialisé par la mise en page (`TournamentActionsTextProvider`) —
 * chaque route n'y met que les espaces qu'elle lit ; celui des fenêtres voyage
 * avec leurs morceaux (`_lib/dialogs-text.ts`).
 */
import type frErrors from "@/messages/fr/tournamentErrors.json";
import type frActions from "@/messages/fr/tournamentActions.json";
import type frDialogs from "@/messages/fr/tournamentDialogs.json";
import type frImage from "@/messages/fr/tournamentImage.json";
import type frForm from "@/messages/fr/tournamentForm.json";
import type { Messages } from "@/lib/shared/i18n-messages";
import type { Locale } from "@/lib/shared/locales";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";

export type TournamentErrorMessages = typeof frErrors;
export type TournamentActionMessages = typeof frActions;
export type TournamentDialogMessages = typeof frDialogs;
export type TournamentImageMessages = typeof frImage;
export type TournamentFormMessages = typeof frForm;

/** Table des refus dans une langue : brute, pour savoir si un code y figure. */
export type TournamentErrorsText = { readonly locale: Locale; readonly messages: TournamentErrorMessages };
export type TournamentActionsText = ScopedText<Leaves<TournamentActionMessages>>;
export type TournamentDialogsText = ScopedText<Leaves<TournamentDialogMessages>>;
export type TournamentImageText = ScopedText<Leaves<TournamentImageMessages>>;
export type TournamentFormText = ScopedText<Leaves<TournamentFormMessages>>;

/**
 * Ce que la mise en page sérialise sous `/en` (rien en français). Un espace
 * absent est hérité du fournisseur parent : l'édition, sous la fiche, n'ajoute
 * que `form`.
 */
export type TournamentActionsClientMessages = {
  errors?: TournamentErrorMessages;
  actions?: TournamentActionMessages;
  image?: TournamentImageMessages;
  form?: TournamentFormMessages;
};

type ActionsCatalog = Pick<
  Messages,
  "tournamentErrors" | "tournamentActions" | "tournamentImage" | "tournamentForm"
>;

/** Les espaces rendus avec la fiche (`/tournois/[id]`) : refus, gestes, image (fenêtres : leur morceau). */
export function tournamentActionsMessages(messages: ActionsCatalog): TournamentActionsClientMessages {
  return {
    errors: messages.tournamentErrors,
    actions: messages.tournamentActions,
    image: messages.tournamentImage,
  };
}

/** Les espaces du formulaire de création : refus, image, formulaire. */
export function tournamentFormMessages(messages: ActionsCatalog): TournamentActionsClientMessages {
  return {
    errors: messages.tournamentErrors,
    image: messages.tournamentImage,
    form: messages.tournamentForm,
  };
}

/**
 * L'espace propre au formulaire d'édition : le formulaire seul. Les refus et
 * l'image viennent du fournisseur de la fiche (`[id]/layout.tsx`), qui
 * l'enveloppe déjà — les reposer enverrait deux fois ~30 Ko d'anglais.
 */
export function tournamentEditFormMessages(messages: Pick<Messages, "tournamentForm">): TournamentActionsClientMessages {
  return { form: messages.tournamentForm };
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

export function tournamentImageText(locale: Locale, messages: TournamentImageMessages): TournamentImageText {
  return scopedText(locale, messages);
}

export function tournamentFormText(locale: Locale, messages: TournamentFormMessages): TournamentFormText {
  return scopedText(locale, messages);
}
