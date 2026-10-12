import frPlayers from "@/messages/fr/players.json";
import type { PlayersText } from "@/components/i18n/players-text";

/**
 * Refus des écrans joueurs, dits dans la langue de la page (lot 9).
 *
 * L'annuaire et la fiche affichaient le **code** du refus tel quel en
 * notification (`PLAYER_NOT_FOUND`, `PLAYERS_LOAD_FAILED`) : un code connu
 * devient une phrase, un code inconnu la phrase du repli du geste
 * (`fallbackCode`), jamais le jeton.
 */
export function playerErrorMessage(text: PlayersText, code: string | null | undefined, fallbackCode?: string): string {
  const known = (value: string | null | undefined): value is keyof typeof frPlayers.errors =>
    typeof value === "string" && value !== "fallback" && Object.hasOwn(frPlayers.errors, value);
  if (known(code)) return text.t(`errors.${code}`);
  if (known(fallbackCode)) return text.t(`errors.${fallbackCode}`);
  return text.t("errors.fallback");
}
