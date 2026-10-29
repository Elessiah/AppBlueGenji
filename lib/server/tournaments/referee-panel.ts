/**
 * Fenêtre « Arbitrage » d'un match, lue par le staff seul (permission
 * `tournaments`) — `docs/features/MATCH_REFEREE.md` : l'arbitre désigné
 * nommé, l'autogestion, la première carte, la manche du match (pour
 * l'autogestion groupée), les comptes qui peuvent arbitrer et les oppositions
 * d'arbitre retenues (`./referee-objection`).
 *
 * Lue **à l'ouverture**, jamais dans l'instantané diffusé ni dans le contexte
 * du lecteur : l'instantané ne dit que « Arbitre désigné », et un nom glissé
 * dans le contexte resterait périmé jusqu'à la reconnexion du flux.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import type { RefereeIneligibility } from "@/lib/shared/match-referee";
import { parseStoredSlots } from "@/lib/shared/round-maps";
import { visibleText } from "@/lib/shared/visible-text";
import { refereeEligibilityBlock, type CastEligibilityRow } from "./cast-eligibility";

/** Un compte de l'arbitrage, tel que la fenêtre le nomme. */
export type RefereePanelUser = { userId: number; pseudo: string };

export type RefereePanel = {
  matchId: number;
  /**
   * Arbitre désigné ; `eligible: false` : il ne remplit plus la condition (tu
   * ailleurs), `reason` dit pourquoi (`null` quand il la remplit).
   */
  referee: (RefereePanelUser & { eligible: boolean; reason: RefereeIneligibility | null }) | null;
  /**
   * Ce qui empêche le **lecteur** d'arbitrer ce match (`null` : il le peut) :
   * la fenêtre n'offre « Arbitrer ce match » qu'à qui le peut, et dit pourquoi
   * aux autres — la règle de `takeMatchReferee` (`writeReferee`).
   */
  viewerBlock: RefereeIneligibility | null;
  selfManaged: boolean;
  firstMap: string | null;
  /**
   * La manche du match, pour l'autogestion groupée, et l'état de ses matchs
   * encore à jouer (exemptions exclues, ceux que `setRoundSelfManaged`
   * touche) : `open` en tout, `selfManaged` en autogestion, `refereed` avec un
   * arbitre — la fenêtre n'offre que le geste utile.
   */
  round: { phaseId: number; roundNumber: number; bracket: string; open: number; selfManaged: number; refereed: number };
  /**
   * Cartes réglées pour la manche (`ROUND_MAPS.md`), vides sans réglage : la
   * saisie de la première carte est alors fermée et la fenêtre les montre en
   * lecture seule.
   */
  roundSlots: string[][];
  /** Comptes qui remplissent la condition d'arbitrage, par pseudo (sans opposition retenue). */
  candidates: RefereePanelUser[];
  /** Arbitres (permission `tournaments`) dont l'opposition est retenue, par pseudo. */
  objections: RefereePanelUser[];
  /** Arbitres dont le staff peut retenir l'opposition, par pseudo — une opposition déjà retenue comprise : la retenir de nouveau rejoue le retrait de ses matchs. */
  objectable: RefereePanelUser[];
};

type PanelMatchRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  phase_id: number;
  round_number: number;
  bracket: string;
  self_managed: number;
  first_map: string | null;
  referee_user_id: number | null;
  team1_id: number | null;
  team2_id: number | null;
  status: string;
  launched_at: Date | string | null;
};

type RoundStateRow = RowDataPacket & { open: number | string; self_managed: number | string | null; refereed: number | string | null };

type StaffRow = CastEligibilityRow & { id: number; pseudo: string; referee_objection_at: Date | string | null };

const byPseudo = (a: RefereePanelUser, b: RefereePanelUser) => a.pseudo.localeCompare(b.pseudo, "fr");
const panelUser = (row: StaffRow): RefereePanelUser => ({ userId: Number(row.id), pseudo: visibleText(row.pseudo) });

/** La fenêtre du match `matchId` lue par `viewerUserId`, `null` s'il n'existe pas. */
export async function loadRefereePanel(matchId: number, viewerUserId: number): Promise<RefereePanel | null> {
  return withConnection(async (connection) => {
    const [matches] = await connection.execute<PanelMatchRow[]>(
      `SELECT id, tournament_id, phase_id, round_number, bracket, self_managed, first_map, referee_user_id,
              team1_id, team2_id, status, launched_at
         FROM bg_matches WHERE id = ? LIMIT 1`,
      [matchId],
    );
    const match = matches[0];
    if (!match) return null;
    // Le staff tient en quelques comptes : rôles relus en base, condition
    // rejouée ici (`refereeEligibilityBlock`), jamais prise d'une session.
    const [staff] = await connection.execute<StaffRow[]>(
      `SELECT id, pseudo, discord_verified_at, discord_pseudo, blizzard_sub, overwatch_battletag,
              overwatch_battletag_typed, is_deleted, is_admin, platform_roles_json, referee_objection_at
         FROM bg_users
        WHERE is_deleted = 0
          AND (is_admin = 1 OR platform_roles_json IS NOT NULL OR id IN (?, ?) OR referee_objection_at IS NOT NULL)`,
      [match.referee_user_id ?? 0, viewerUserId],
    );
    const byId = new Map(staff.map((row) => [Number(row.id), row]));
    const players = await loadMatchPlayers(connection, match);
    const [roundRows] = await connection.execute<(RowDataPacket & { slots_json: string | null })[]>(
      `SELECT slots_json FROM bg_tournament_round_maps
        WHERE tournament_id = ? AND phase_id = ? AND bracket = ? AND round_number = ? LIMIT 1`,
      [match.tournament_id, match.phase_id, match.bracket, match.round_number],
    );
    const [roundStateRows] = await connection.execute<RoundStateRow[]>(
      `SELECT COUNT(*) AS open,
              SUM(self_managed = 1) AS self_managed,
              SUM(self_managed = 0 AND referee_user_id IS NOT NULL) AS refereed
         FROM bg_matches
        WHERE tournament_id = ? AND phase_id = ? AND round_number = ? AND bracket = ?
          AND status <> 'COMPLETED' AND is_bye = 0`,
      [match.tournament_id, match.phase_id, match.round_number, match.bracket],
    );
    const roundState = roundStateRows[0];
    // Avant le départ, l'arbitre qui joue désormais le match ne compte plus —
    // la règle de l'instantané (`refereeKept`), que le bandeau du staff lit déjà.
    const beforeStart = match.status !== "COMPLETED" && match.launched_at === null;
    const refereeId = match.referee_user_id === null ? null : Number(match.referee_user_id);
    const refereeRow = refereeId === null ? undefined : byId.get(refereeId);
    const firstMap = match.first_map ? visibleText(match.first_map) : "";
    const objected = (row: StaffRow) => (row.referee_objection_at ?? null) !== null;
    // Un arbitre : la permission `tournaments`, quelle que soit son identité.
    const referees = staff.filter((row) => refereeEligibilityBlock(row) !== "NOT_REFEREE");
    // L'ordre de `writeReferee` : condition, opposition, joueur du match.
    const ineligibility = (row: StaffRow | undefined, userId: number, countsPlayer: boolean): RefereeIneligibility | null => {
      if (!row) return "ACCOUNT_GONE";
      const block = refereeEligibilityBlock(row);
      if (block) return block;
      if (objected(row)) return "REFEREE_OBJECTION";
      if (countsPlayer && players.has(userId)) return "REFEREE_IS_PLAYER";
      return null;
    };
    // Le lecteur, lui, ne prend jamais un match qu'il joue, lancé ou non.
    const viewerBlock = ineligibility(byId.get(viewerUserId), viewerUserId, true);
    const refereeReason = refereeId === null ? null : ineligibility(refereeRow, refereeId, beforeStart);
    return {
      matchId: Number(match.id),
      referee:
        refereeId === null
          ? null
          : {
              userId: refereeId,
              pseudo: refereeRow ? visibleText(refereeRow.pseudo) : "—",
              eligible: refereeReason === null,
              reason: refereeReason,
            },
      viewerBlock,
      selfManaged: Number(match.self_managed) === 1,
      firstMap: firstMap === "" ? null : firstMap,
      round: {
        phaseId: Number(match.phase_id),
        roundNumber: Number(match.round_number),
        bracket: String(match.bracket),
        open: Number(roundState?.open ?? 0),
        selfManaged: Number(roundState?.self_managed ?? 0),
        refereed: Number(roundState?.refereed ?? 0),
      },
      roundSlots: parseStoredSlots(roundRows[0]?.slots_json),
      candidates: staff
        // Un joueur du match ne l'arbitre pas (`REFEREE_IS_PLAYER`) : pas
        // proposé ; une opposition retenue ferme l'arbitrage (`REFEREE_OBJECTION`).
        .filter((row) => refereeEligibilityBlock(row) === null && !players.has(Number(row.id)) && !objected(row))
        .map(panelUser)
        .sort(byPseudo),
      // Toute opposition retenue, même sur un compte qui n'arbitre plus : elle
      // doit rester visible et pouvoir être levée (la route le permet).
      objections: staff.filter(objected).map(panelUser).sort(byPseudo),
      objectable: referees.map(panelUser).sort(byPseudo),
    };
  });
}

/** Comptes qui jouent le match : membres actifs des deux engagées, ou l'engagé solo. */
async function loadMatchPlayers(
  connection: PoolConnection,
  match: Pick<PanelMatchRow, "team1_id" | "team2_id">,
): Promise<Set<number>> {
  const teamIds = [match.team1_id, match.team2_id].filter((id): id is number => id !== null).map(Number);
  if (teamIds.length === 0) return new Set();
  const placeholders = teamIds.map(() => "?").join(", ");
  const [rows] = await connection.execute<(RowDataPacket & { user_id: number })[]>(
    `SELECT user_id FROM bg_team_members WHERE left_at IS NULL AND team_id IN (${placeholders})
     UNION
     SELECT solo_user_id AS user_id FROM bg_teams WHERE solo_user_id IS NOT NULL AND id IN (${placeholders})`,
    [...teamIds, ...teamIds],
  );
  return new Set(rows.map((row) => Number(row.user_id)));
}
