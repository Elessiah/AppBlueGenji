import frTournamentImage from "@/messages/fr/tournamentImage.json";
import { tournamentImageText, type TournamentImageText } from "@/lib/shared/tournament-actions-text";
import { useTournamentImageTextFrom } from "@/components/i18n/tournament-actions-text";
import type { TournamentImageChange } from "@/lib/shared/tournament-image";

/**
 * Français du sélecteur d'image d'un tournoi (lot 8b-2), partagé par la
 * fenêtre d'image de la fiche et le formulaire de création. L'anglais vient du
 * fournisseur, sous `/en` seulement.
 */
export const FR_IMAGE_TEXT: TournamentImageText = tournamentImageText("fr", frTournamentImage);

/** Textes du sélecteur d'image, dans la langue de la page. */
export function useImageText(): TournamentImageText {
  return useTournamentImageTextFrom(FR_IMAGE_TEXT);
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
