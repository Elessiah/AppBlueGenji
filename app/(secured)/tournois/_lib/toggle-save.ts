import { CodedError } from "@/lib/shared/field-errors";
import type { TournamentFormText } from "@/lib/shared/tournament-actions-text";

/** Réglages à route dédiée : leur route et leurs textes de refus (clés de traduction typées). */
export const TOGGLE_ROUTES = {
  planning: {
    route: "referee-scheduling",
    invalid: "INVALID_REFEREE_SCHEDULING",
    errors: {
      TOURNAMENT_NOT_FOUND: "edit.planningErrors.TOURNAMENT_NOT_FOUND",
      TOURNAMENT_FINISHED: "edit.planningErrors.TOURNAMENT_FINISHED",
      INVALID_REFEREE_SCHEDULING: "edit.planningErrors.INVALID_REFEREE_SCHEDULING",
      fallback: "edit.planningErrors.fallback",
    },
  },
  voice: {
    route: "voice-channels",
    invalid: "INVALID_TEAM_VOICE_CHANNELS",
    errors: {
      TOURNAMENT_NOT_FOUND: "edit.voiceErrors.TOURNAMENT_NOT_FOUND",
      TOURNAMENT_FINISHED: "edit.voiceErrors.TOURNAMENT_FINISHED",
      INVALID_TEAM_VOICE_CHANNELS: "edit.voiceErrors.INVALID_TEAM_VOICE_CHANNELS",
      fallback: "edit.voiceErrors.fallback",
    },
  },
  checkIn: {
    route: "match-check-in",
    invalid: "INVALID_MATCH_CHECK_IN",
    errors: {
      TOURNAMENT_NOT_FOUND: "edit.checkInErrors.TOURNAMENT_NOT_FOUND",
      TOURNAMENT_FINISHED: "edit.checkInErrors.TOURNAMENT_FINISHED",
      INVALID_MATCH_CHECK_IN: "edit.checkInErrors.INVALID_MATCH_CHECK_IN",
      fallback: "edit.checkInErrors.fallback",
    },
  },
} as const;

export type ToggleKind = keyof typeof TOGGLE_ROUTES;

/** Refus d'une bascule : un conflit de verrou se dit à part, un code inconnu tombe sur le repli du réglage. */
export function toggleErrorText(text: TournamentFormText, kind: ToggleKind, code: string): string {
  if (code === "CONCURRENT_UPDATE_RETRY") return text.t("edit.concurrentRetry");
  const { errors } = TOGGLE_ROUTES[kind];
  const key = Object.entries(errors).find(([known]) => known === code)?.[1] ?? errors.fallback;
  return text.t(key);
}

/**
 * Enregistre un réglage par sa route dédiée (`PUT /api/admin/tournaments/[id]/<route>`) ;
 * rend le corps de la réponse, ou lève le refus en `CodedError`.
 */
export async function putToggle(
  tournamentId: number,
  kind: ToggleKind,
  enabled: boolean,
  text: TournamentFormText,
): Promise<{ changed?: boolean; movedToPlanning?: number }> {
  const response = await fetch(`/api/admin/tournaments/${tournamentId}/${TOGGLE_ROUTES[kind].route}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    changed?: boolean;
    movedToPlanning?: number;
  };
  if (response.ok) return result;
  const code = result.error ?? "UNKNOWN";
  throw new CodedError(code, toggleErrorText(text, kind, code));
}

/** Enregistre un réglage sans effet de bord à annoncer ; rend `true` s'il a changé (`MATCH_VOICE.md`, `MATCH_CHECK_IN_SETTING.md`). */
export async function saveSimpleToggle(
  tournamentId: number,
  kind: "voice" | "checkIn",
  enabled: boolean,
  text: TournamentFormText,
): Promise<boolean> {
  return (await putToggle(tournamentId, kind, enabled, text)).changed === true;
}
