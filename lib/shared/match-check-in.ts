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
 * ce qui n'est pas encore parti. Rallumée, elle ne rattrape rien de ce qui
 * était dû pendant l'arrêt (entre `match_check_in_paused_at` et la remise en
 * marche `resumedAt` : `lobby-brief`, `setMatchCheckIn`).
 */
import { canToggleLiveTournamentOption } from "./tournament-state";
import type { TournamentState } from "./types";

/** L'option telle que la base la porte. */
export type MatchCheckInSetting = {
  enabled: boolean;
  /** Dernière remise en marche ; `null` = jamais rallumée depuis la création. */
  resumedAt: Date | null;
};

/** Lit les deux colonnes (`match_check_in`, `match_check_in_resumed_at`) ; absentes = allumée. */
export function readMatchCheckIn(
  flag: number | string | boolean | null | undefined,
  resumedAt: Date | string | null | undefined,
): MatchCheckInSetting {
  const enabled = flag === undefined || flag === null ? true : Number(flag) !== 0;
  if (resumedAt === undefined || resumedAt === null) return { enabled, resumedAt: null };
  const instant = resumedAt instanceof Date ? resumedAt : new Date(resumedAt);
  // Une date illisible ne fait pas taire le check-in : elle vaut « jamais éteinte ».
  return { enabled, resumedAt: Number.isFinite(instant.getTime()) ? instant : null };
}

/**
 * Un message du check-in dû à `dueAt` part-il ? Oui si l'option est allumée
 * et que sa dernière remise en marche ne lui est pas postérieure : rallumer
 * l'option ne fait pas partir d'un coup ce qui était dû pendant qu'elle était
 * éteinte.
 */
export function checkInSendable(setting: MatchCheckInSetting, dueAt: Date): boolean {
  if (!setting.enabled) return false;
  return setting.resumedAt === null || setting.resumedAt.getTime() <= dueAt.getTime();
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
