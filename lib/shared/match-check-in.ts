/**
 * Option « Check-in des matchs » d'un tournoi — règle pure, partagée
 * client/serveur (`docs/features/MATCH_CHECK_IN_SETTING.md`).
 *
 * Allumée (le défaut), chaque match en autogestion reçoit son check-in à H-15
 * (`MATCH_LOBBY_BRIEF`) et chaque match programmé son rappel 10 h, qui porte
 * le lien du salon de check-in. Éteinte, ni l'un ni l'autre ne part, et aucun
 * message ne parle du check-in ; le reste (rappel 24 h, annonces d'horaire,
 * « Nouveau match », départ de match) ne change pas, ni les salons Discord.
 *
 * L'option se lit **à l'envoi** : la basculer en plein tournoi vaut pour tout
 * ce qui n'est pas encore parti. Seul ce qui est dû **pendant l'arrêt** (depuis
 * `match_check_in_paused_at`, ou depuis toujours sans arrêt daté) se tait pour
 * de bon : rallumée, l'option ne le rattrape pas (réservé sans message par la
 * remise en marche, `setMatchCheckIn`), et ce qui était dû avant l'arrêt sans
 * être encore parti part à la remise en marche ({@link checkInReminderFate}).
 */
import { canToggleLiveTournamentOption } from "./tournament-state";
import type { TournamentState } from "./types";

/** L'option telle que la base la porte. */
export type MatchCheckInSetting = {
  enabled: boolean;
  /** Dernier arrêt ; `null` = jamais éteinte depuis la création, ou créée éteinte. */
  pausedAt: Date | null;
};

/** Instant lu en base ; absent ou illisible = `null`. */
export function readDbInstant(value: Date | string | null | undefined): Date | null {
  if (value === undefined || value === null) return null;
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isFinite(instant.getTime()) ? instant : null;
}

/** Lit les deux colonnes (`match_check_in`, `match_check_in_paused_at`) ; absentes = allumée. */
export function readMatchCheckIn(
  flag: number | string | boolean | null | undefined,
  pausedAt?: Date | string | null,
): MatchCheckInSetting {
  const enabled = flag === undefined || flag === null ? true : Number(flag) !== 0;
  return { enabled, pausedAt: readDbInstant(pausedAt) };
}

/**
 * Sort du rappel 10 h dû à `dueAt` : `send` (option allumée), `silence` (dû
 * pendant l'arrêt — réservé sans message, jamais rattrapé) ou `hold` (dû avant
 * l'arrêt, pas encore parti : ni envoyé ni réservé, il part à la remise en
 * marche). Sans arrêt daté, tout l'avant compte pour l'arrêt.
 */
export function checkInReminderFate(setting: MatchCheckInSetting, dueAt: Date): "send" | "silence" | "hold" {
  if (setting.enabled) return "send";
  return setting.pausedAt !== null && dueAt.getTime() < setting.pausedAt.getTime() ? "hold" : "silence";
}

/**
 * L'option se bascule à tout moment jusqu'à la clôture, tournoi en cours
 * compris : un tournoi terminé n'a plus de match à prévenir (règle commune des
 * options d'organisation, `canToggleLiveTournamentOption`). L'écran et l'API
 * lisent tous deux cette fonction : ils ne divergent pas.
 */
export function canToggleMatchCheckIn(state: TournamentState): boolean {
  return canToggleLiveTournamentOption(state);
}
