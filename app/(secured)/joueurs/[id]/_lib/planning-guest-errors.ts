import { FR_PLAYERS_TEXT, type PlayersText } from "@/components/i18n/players-text";

/** Refus de `/api/admin/users/[id]/planning-guest` traduits (`players.planningGuest.errors`). */
const PLANNING_GUEST_ERROR_CODES = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INVALID_ID",
  "USER_NOT_FOUND",
  "CANNOT_MODIFY_SELF",
  "INVALID_PAYLOAD",
  "PLANNING_GUEST_ADMIN",
  "CONCURRENT_UPDATE_RETRY",
  "PROFILE_RELOAD_FAILED",
]);

/**
 * Le refus en phrase, dans la langue de la page (`text`, français par défaut) ;
 * jamais le code brut.
 */
export function planningGuestErrorMessage(code: string, text: PlayersText = FR_PLAYERS_TEXT): string {
  if (PLANNING_GUEST_ERROR_CODES.has(code)) return text.t(`planningGuest.errors.${code}` as Parameters<PlayersText["t"]>[0]);
  return text.t("planningGuest.errors.fallback");
}
