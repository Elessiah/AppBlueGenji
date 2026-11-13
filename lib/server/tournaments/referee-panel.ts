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
import type { RowDataPacket } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import type { RefereeIneligibility } from "@/lib/shared/match-referee";
import type { TournamentGame } from "@/lib/shared/types";
import { parseStoredSlots } from "@/lib/shared/round-maps";
import { visibleText } from "@/lib/shared/visible-text";
import { castBeforeLaunch } from "@/lib/shared/match-launch";
import { refereeEligibilityBlock, type CastEligibilityRow } from "./cast-eligibility";
import { loadMatchPlayerIds } from "./match-players";

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
  /** `busy` : il arbitre un match non terminé (ton de la confirmation). */
  objectable: (RefereePanelUser & { busy: boolean })[];
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
  launch_pairing: string | null;
  tournament_game: TournamentGame;
};

type RoundStateRow = RowDataPacket & {
  open: number | string;
  self_managed: number | string | null;
  refereed: number | string | null;
  slots_json: string | null;
};

type StaffRow = CastEligibilityRow & { id: number; pseudo: string; referee_objection_at: Date | string | null };

const byPseudo = (a: RefereePanelUser, b: RefereePanelUser) => a.pseudo.localeCompare(b.pseudo, "fr");
const panelUser = (row: StaffRow): RefereePanelUser => ({ userId: Number(row.id), pseudo: visibleText(row.pseudo) });

/** La fenêtre du match `matchId` lue par `viewerUserId`, `null` s'il n'existe pas. */
export async function loadRefereePanel(matchId: number, viewerUserId: number): Promise<RefereePanel | null> {
  return withConnection(async (connection) => {
    const [matches] = await connection.execute<PanelMatchRow[]>(
      `SELECT m.id, m.tournament_id, m.phase_id, m.round_number, m.bracket, m.self_managed, m.first_map, m.referee_user_id,
              m.team1_id, m.team2_id, m.status, m.launched_at, m.launch_pairing, t.game AS tournament_game
         FROM bg_matches m JOIN bg_tournaments t ON t.id = m.tournament_id WHERE m.id = ? LIMIT 1`,
      [matchId],
    );
    const match = matches[0];
    if (!match) return null;
    // Le staff tient en quelques comptes : rôles relus en base, condition
    // rejouée ici (`refereeEligibilityBlock`), jamais prise d'une session.
    // Un rôle retiré laisse `'[]'`, pas `NULL` (`users/roles.ts`) : ces comptes
    // sont écartés en SQL plutôt que décodés un à un à chaque ouverture.
    // `JSON_LENGTH` : MySQL comparerait `<> '[]'` à une chaîne JSON (toujours vrai).
    const [staff] = await connection.execute<StaffRow[]>(
      `SELECT id, pseudo, discord_verified_at, discord_pseudo, blizzard_sub, overwatch_battletag,
              overwatch_battletag_typed, is_deleted, is_admin, platform_roles_json, referee_objection_at
         FROM bg_users
        WHERE is_deleted = 0
          AND (is_admin = 1 OR JSON_LENGTH(platform_roles_json) > 0
               OR id IN (?, ?) OR referee_objection_at IS NOT NULL)`,
      [match.referee_user_id ?? 0, viewerUserId],
    );
    const byId = new Map(staff.map((row) => [Number(row.id), row]));
    const players = await loadMatchPlayerIds(connection, match);
    // État de la manche et ses cartes, sur la même clé de manche : **une**
    // requête (l'agrégat rend toujours une ligne, cartes absentes = `NULL`) ;
    // la clé de manche est unique (`uq_bg_round_maps_round`) : la sous-requête
    // ne rend jamais deux lignes, `LIMIT 1` ne fait que le dire.
    const roundKey = [match.tournament_id, match.phase_id, match.bracket, match.round_number];
    const [roundStateRows] = await connection.execute<RoundStateRow[]>(
      `SELECT COUNT(*) AS open,
              SUM(self_managed = 1) AS self_managed,
              SUM(self_managed = 0 AND referee_user_id IS NOT NULL) AS refereed,
              (SELECT rm.slots_json FROM bg_tournament_round_maps rm
                WHERE rm.tournament_id = ? AND rm.phase_id = ? AND rm.bracket = ? AND rm.round_number = ?
                LIMIT 1) AS slots_json
         FROM bg_matches
        WHERE tournament_id = ? AND phase_id = ? AND bracket = ? AND round_number = ?
          AND status <> 'COMPLETED' AND is_bye = 0`,
      [...roundKey, ...roundKey],
    );
    const roundState = roundStateRows[0];
    // Avant le départ, l'arbitre qui joue désormais le match ne compte plus —
    // la règle de l'instantané (`refereeKept`), que le bandeau du staff lit déjà :
    // un lancement d'un appariement d'avant ne compte pas (`castBeforeLaunch`).
    const beforeStart = castBeforeLaunch(match);
    const game = match.tournament_game;
    const refereeId = match.referee_user_id === null ? null : Number(match.referee_user_id);
    const refereeRow = refereeId === null ? undefined : byId.get(refereeId);
    const firstMap = match.first_map ? visibleText(match.first_map) : "";
    const objected = (row: StaffRow) => (row.referee_objection_at ?? null) !== null;
    // Un arbitre : la permission `tournaments`, quelle que soit son identité.
    const referees = staff.filter((row) => refereeEligibilityBlock(row, game) !== "NOT_REFEREE");
    // Ceux qui arbitrent un match non terminé, tous tournois confondus : ce
    // qu'une opposition retenue leur retirerait (ton de sa confirmation).
    const busyReferees = new Set<number>();
    if (referees.length > 0) {
      const [busyRows] = await connection.execute<(RowDataPacket & { referee_user_id: number })[]>(
        `SELECT DISTINCT referee_user_id FROM bg_matches
          WHERE status <> 'COMPLETED' AND referee_user_id IN (${referees.map(() => "?").join(", ")})`,
        referees.map((row) => Number(row.id)),
      );
      for (const row of busyRows) busyReferees.add(Number(row.referee_user_id));
    }
    // L'ordre de `writeReferee` : condition, opposition, joueur du match.
    const ineligibility = (row: StaffRow | undefined, userId: number, countsPlayer: boolean): RefereeIneligibility | null => {
      if (!row) return "ACCOUNT_GONE";
      const block = refereeEligibilityBlock(row, game);
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
      roundSlots: parseStoredSlots(roundState?.slots_json),
      candidates: staff
        // Un joueur du match ne l'arbitre pas (`REFEREE_IS_PLAYER`) : pas
        // proposé ; une opposition retenue ferme l'arbitrage (`REFEREE_OBJECTION`).
        .filter((row) => refereeEligibilityBlock(row, game) === null && !players.has(Number(row.id)) && !objected(row))
        .map(panelUser)
        .sort(byPseudo),
      // Toute opposition retenue, même sur un compte qui n'arbitre plus : elle
      // doit rester visible et pouvoir être levée (la route le permet).
      objections: staff.filter(objected).map(panelUser).sort(byPseudo),
      objectable: referees.map((row) => ({ ...panelUser(row), busy: busyReferees.has(Number(row.id)) })).sort(byPseudo),
    };
  });
}
