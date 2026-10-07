import frTournamentImage from "@/messages/fr/tournamentImage.json";
import enTournamentImage from "@/messages/en/tournamentImage.json";
import { tournamentImageText, type TournamentImageText } from "@/lib/shared/tournament-actions-text";
import { useTournamentActionsLocale } from "@/components/i18n/tournament-actions-text";
import type { TournamentImageChange } from "@/lib/shared/tournament-image";

/**
 * Textes du sélecteur d'image d'un tournoi (lot 8b-2), partagé par la fenêtre
 * d'image de la fiche (chargée à la demande, staff seulement) et le formulaire
 * de création. Ses **deux** langues voyagent avec ces morceaux, comme celles
 * des fenêtres d'action : servi par la mise en page, l'anglais partirait avec
 * chaque lecture de `/en/tournois/[id]`. Le fournisseur ne donne que la langue.
 */
export const FR_IMAGE_TEXT: TournamentImageText = tournamentImageText("fr", frTournamentImage);
const EN_IMAGE_TEXT: TournamentImageText = tournamentImageText("en", enTournamentImage);

/** Textes du sélecteur d'image, dans la langue de la page. */
export function useImageText(): TournamentImageText {
  return useTournamentActionsLocale() === "en" ? EN_IMAGE_TEXT : FR_IMAGE_TEXT;
}

/** Codes que la route d'image et le contrôle local formulent (`tournamentImageErrorMessage`). */
const IMAGE_ERROR_CODES = [
  "FILE_MISSING",
  "IMAGE_TOO_LARGE",
  "IMAGE_FORMAT_INVALID",
  "IMAGE_DIMENSIONS_INVALID",
  "IMAGE_ANIMATED_NOT_SUPPORTED",
  "INVALID_IMAGE_FIT",
  "INVALID_IMAGE_FOCUS",
  "TOURNAMENT_IMAGE_MISSING",
  "TOURNAMENT_NOT_FOUND",
] as const;

/** Refus d'une image (`tournamentImageErrorMessage`), dans la langue du texte. */
export function imageErrorText(text: TournamentImageText, code: string): string {
  const known = IMAGE_ERROR_CODES.find((candidate) => candidate === code);
  if (known) return text.t(`errors.${known}`);
  if (code === "FORBIDDEN" || code === "UNAUTHORIZED") return text.t("errors.forbidden");
  return text.t("errors.fallback");
}

/** Réussite d'un changement d'image (`imageChangeSuccessMessage`), dans la langue du texte. */
export function imageSuccessText(text: TournamentImageText, change: TournamentImageChange): string | null {
  switch (change.kind) {
    case "UPLOAD":
      return text.t("success.upload");
    case "UPDATE":
      return text.t("success.update");
    case "DELETE":
      return text.t("success.delete");
    default:
      return null;
  }
}
