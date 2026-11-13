import { TEAM_VOICE_TOGGLE_RULE } from "@/lib/server/api-guard";
import { putTournamentToggle, staffToggleLog } from "@/lib/server/tournament-toggle-route";
import { setTeamVoiceChannels } from "@/lib/server/tournaments/match-voice";

/**
 * Allume ou éteint l'option « Salons vocaux d'équipe »
 * (`docs/features/MATCH_VOICE.md`). Corps : `{ enabled: boolean }`.
 *
 * Permission `tournaments`. L'option se modifie à tout moment jusqu'à la
 * clôture, tournoi en cours compris (décision de l'utilisateur, 2026-11-02) :
 * un tournoi terminé est refusé (409 `TOURNAMENT_FINISHED`), comme le
 * formulaire le verrouille. Débit plafonné par compte (`TEAM_VOICE_TOGGLE_RULE`).
 * Journalisé seulement s'il change la valeur : auteur anonyme sur Discord,
 * rien dans pm2. Déroulé commun : `putTournamentToggle`.
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  return putTournamentToggle(req, context, {
    rule: TEAM_VOICE_TOGGLE_RULE,
    invalidCode: "INVALID_TEAM_VOICE_CHANNELS",
    failedCode: "TEAM_VOICE_CHANNELS_UPDATE_FAILED",
    apply: (tournamentId, enabled) => setTeamVoiceChannels(tournamentId, enabled),
    announce: staffToggleLog("TEAM_VOICE_ON", "TEAM_VOICE_OFF"),
  });
}
