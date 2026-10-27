/**
 * Fenêtre « Arbitrage » d'un match, lue par le staff seul (permission
 * `tournaments`) — `docs/features/MATCH_REFEREE.md` : l'arbitre désigné
 * nommé, l'autogestion, la première carte, la manche du match (pour
 * l'autogestion groupée) et les comptes qui peuvent arbitrer.
 *
 * Lue **à l'ouverture**, jamais dans l'instantané diffusé ni dans le contexte
 * du lecteur : l'instantané ne dit que « Arbitre désigné », et un nom glissé
 * dans le contexte resterait périmé jusqu'à la reconnexion du flux.
 */
import type { RowDataPacket } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { visibleText } from "@/lib/shared/visible-text";
import { refereeEligibilityBlock, type CastEligibilityRow } from "./cast-eligibility";

/** Un compte de l'arbitrage, tel que la fenêtre le nomme. */
export type RefereePanelUser = { userId: number; pseudo: string };

export type RefereePanel = {
  matchId: number;
  /** Arbitre désigné ; `eligible: false` : il ne remplit plus la condition (tu ailleurs). */
  referee: (RefereePanelUser & { eligible: boolean }) | null;
  selfManaged: boolean;
  firstMap: string | null;
  /** La manche du match, pour l'autogestion groupée. */
  round: { phaseId: number; roundNumber: number; bracket: string };
  /** Comptes qui remplissent la condition d'arbitrage, par pseudo. */
  candidates: RefereePanelUser[];
};

type PanelMatchRow = RowDataPacket & {
  id: number;
  phase_id: number;
  round_number: number;
  bracket: string;
  self_managed: number;
  first_map: string | null;
  referee_user_id: number | null;
};

type StaffRow = CastEligibilityRow & { id: number; pseudo: string };

/** La fenêtre du match `matchId`, `null` s'il n'existe pas. */
export async function loadRefereePanel(matchId: number): Promise<RefereePanel | null> {
  return withConnection(async (connection) => {
    const [matches] = await connection.execute<PanelMatchRow[]>(
      `SELECT id, phase_id, round_number, bracket, self_managed, first_map, referee_user_id
         FROM bg_matches WHERE id = ? LIMIT 1`,
      [matchId],
    );
    const match = matches[0];
    if (!match) return null;
    // Le staff tient en quelques comptes : rôles relus en base, condition
    // rejouée ici (`refereeEligibilityBlock`), jamais prise d'une session.
    const [staff] = await connection.execute<StaffRow[]>(
      `SELECT id, pseudo, discord_verified_at, discord_pseudo, blizzard_sub, overwatch_battletag,
              is_deleted, is_admin, platform_roles_json
         FROM bg_users
        WHERE is_deleted = 0 AND (is_admin = 1 OR platform_roles_json IS NOT NULL OR id = ?)`,
      [match.referee_user_id ?? 0],
    );
    const byId = new Map(staff.map((row) => [Number(row.id), row]));
    const refereeId = match.referee_user_id === null ? null : Number(match.referee_user_id);
    const refereeRow = refereeId === null ? undefined : byId.get(refereeId);
    const firstMap = match.first_map ? visibleText(match.first_map) : "";
    return {
      matchId: Number(match.id),
      referee:
        refereeId === null
          ? null
          : {
              userId: refereeId,
              pseudo: refereeRow ? visibleText(refereeRow.pseudo) : "—",
              eligible: refereeEligibilityBlock(refereeRow) === null,
            },
      selfManaged: Number(match.self_managed) === 1,
      firstMap: firstMap === "" ? null : firstMap,
      round: { phaseId: Number(match.phase_id), roundNumber: Number(match.round_number), bracket: String(match.bracket) },
      candidates: staff
        .filter((row) => refereeEligibilityBlock(row) === null)
        .map((row) => ({ userId: Number(row.id), pseudo: visibleText(row.pseudo) }))
        .sort((a, b) => a.pseudo.localeCompare(b.pseudo, "fr")),
    };
  });
}
