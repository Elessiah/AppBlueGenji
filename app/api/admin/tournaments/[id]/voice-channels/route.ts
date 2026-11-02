import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { readJsonBody } from "@/lib/server/request-body";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { setTeamVoiceChannels } from "@/lib/server/tournaments/match-voice";
import { discordInline } from "@/lib/shared/discord-text";
import { can } from "@/lib/shared/permissions";

/**
 * Allume ou éteint l'option « Salons vocaux d'équipe »
 * (`docs/features/MATCH_VOICE.md`). Corps : `{ enabled: boolean }` — un
 * booléen strict.
 *
 * Permission `tournaments`. Aucune garde sur l'état du tournoi, par décision de
 * l'utilisateur (2026-11-02) : l'option se modifie à tout moment, tournoi en
 * cours compris. Le geste est journalisé (staff anonyme sur Discord, nommé
 * dans pm2) seulement s'il change la valeur.
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "tournaments")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return fail("INVALID_TOURNAMENT_ID", 400);
  }

  const body = (await readJsonBody(req).catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") return fail("INVALID_TEAM_VOICE_CHANNELS", 400);

  try {
    const result = await setTeamVoiceChannels(tournamentId, body.enabled);
    if (result.changed) {
      publishStaffAction(
        result.enabled
          ? `🔊 Salons vocaux d'équipe activés sur « ${discordInline(result.tournamentName)} » par le staff.`
          : `🔊 Salons vocaux d'équipe désactivés sur « ${discordInline(result.tournamentName)} » par le staff.`,
        { id: user.id, pseudo: user.pseudo },
      );
    }
    return ok({ enabled: result.enabled, changed: result.changed });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "TOURNAMENT_NOT_FOUND") return fail(message, 404);
    return fail("TEAM_VOICE_CHANNELS_UPDATE_FAILED", 500);
  }
}
