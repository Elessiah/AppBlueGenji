/**
 * Lancement d'un match : « Prêt » des parties, lancement forcé ou d'office,
 * inscription des casters (co-cast d'un stream ou stream à part) et
 * désignation de l'équipe hôte.
 *
 * Toute la règle vit dans le module pur `lib/shared/match-launch.ts` ; ce
 * fichier l'applique à la base, sous le verrou de la ligne du match, et publie
 * l'événement qui réveille les pages ouvertes — les « Prêt » voyagent ensuite
 * dans l'instantané du flux SSE, comme le reste du plateau.
 *
 * Voir `docs/features/MATCH_LAUNCH.md`.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { parseRoles, toIso } from "@/lib/server/serialization";
import {
  allPartiesReady,
  canDeclareTeamReady,
  castBlockReason,
  currentLaunchState,
  isAutoLaunchDue,
  launchPairingKey,
  launchReadiness,
  launchStateIsCurrent,
  matchLaunchPhase,
  type CastBlock,
  type CasterIdentity,
  type LaunchViewerRole,
  type MatchLaunchInput,
} from "@/lib/shared/match-launch";
import { normalizeStreamUrl } from "@/lib/shared/live-streams";
import type { MatchStatus, TeamRole } from "@/lib/shared/types";
import { casterIdentityOf, loadCastEligibility, type CasterIdentityRow } from "./cast-eligibility";
import { announceCastChange, discardCastChanges, flushCastChanges, queueCastChange } from "./cast-notices";
import {
  lockMatchCasters,
  lockMatchStreams,
  pruneMatchStreams,
  type MatchCasterLink,
  type MatchStreamRow,
} from "./match-casters";
import { retryOnDeadlock } from "./deadlock-retry";
import { publishMatchUpdatedEvent } from "./notifications";

/** La ligne d'un match telle que le lancement la lit, sans ses casters. */
export type LaunchMatchBaseRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  tournament_state: string;
  /** Option du tournoi : matchs planifiés par l'arbitrage (1). */
  referee_scheduling: number | null;
  /** Option du tournoi : phase de lancement (« Prêt », modale) allumée (1). */
  match_launch_phase: number | null;
  status: MatchStatus;
  is_bye: number;
  team1_id: number | null;
  team2_id: number | null;
  team1_is_ghost: number | null;
  team2_is_ghost: number | null;
  start_at: Date | string | null;
  lobby_opened_at: Date | string | null;
  launch_pairing: string | null;
  launched_at: Date | string | null;
  team1_ready_at: Date | string | null;
  team2_ready_at: Date | string | null;
  host_team_id: number | null;
};

/**
 * La ligne d'un match avec ses casters (`bg_match_casters`), relus avec elle :
 * sous verrou par `lockLaunchMatch`, par lot pour la modale.
 */
export type LaunchMatchRow = LaunchMatchBaseRow & { casters: MatchCasterLink[] };

const LAUNCH_MATCH_COLUMNS = `
  m.id, m.tournament_id, t.state AS tournament_state, t.referee_scheduling, t.match_launch_phase,
  m.status, m.is_bye,
  m.team1_id, m.team2_id, t1.is_ghost AS team1_is_ghost, t2.is_ghost AS team2_is_ghost,
  m.start_at, m.lobby_opened_at, m.launch_pairing, m.launched_at, m.team1_ready_at,
  m.team2_ready_at, m.host_team_id`;

const LAUNCH_MATCH_FROM = `
  FROM bg_matches m
  JOIN bg_tournaments t ON t.id = m.tournament_id
  LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
  LEFT JOIN bg_teams t2 ON t2.id = m.team2_id`;

function nullableId(value: number | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * L'état de lancement de la ligne **valable pour son appariement courant**
 * (`currentLaunchState`) : ce qui a été posé pour une paire d'équipes que le
 * moteur a depuis remplacée sur place ne compte pas.
 */
export function rowLaunchState(row: LaunchMatchBaseRow) {
  return currentLaunchState(
    {
      launchPairing: row.launch_pairing ?? null,
      lobbyOpenedAt: toIso(row.lobby_opened_at),
      launchedAt: toIso(row.launched_at),
      team1ReadyAt: toIso(row.team1_ready_at),
      team2ReadyAt: toIso(row.team2_ready_at),
    },
    nullableId(row.team1_id),
    nullableId(row.team2_id),
  );
}

export function toLaunchInput(row: LaunchMatchBaseRow): MatchLaunchInput {
  return {
    status: row.status,
    team1Id: nullableId(row.team1_id),
    team2Id: nullableId(row.team2_id),
    startAt: toIso(row.start_at),
    launchedAt: rowLaunchState(row).launchedAt,
    refereeScheduling: Number(row.referee_scheduling ?? 0) === 1,
    launchPhase: Number(row.match_launch_phase ?? 0) === 1,
  };
}

/** Colonne « prêt » de chaque équipe d'un lancement (les casters ont la leur, `bg_match_casters.ready_at`). */
const READY_AT_COLUMNS: Record<Exclude<LaunchViewerRole, "CASTER">, string> = {
  TEAM1: "team1_ready_at",
  TEAM2: "team2_ready_at",
};

/**
 * Les « Prêt » de la ligne. `casters` remplace ceux de la ligne quand
 * l'appelant les a filtrés (la modale tait un caster inéligible).
 */
export function rowReadiness(row: LaunchMatchRow, casters: readonly MatchCasterLink[] = row.casters) {
  const launch = rowLaunchState(row);
  const current = launchStateIsCurrent(row.launch_pairing ?? null, nullableId(row.team1_id), nullableId(row.team2_id));
  return launchReadiness({
    team1ReadyAt: launch.team1ReadyAt,
    team2ReadyAt: launch.team2ReadyAt,
    team1IsGhost: Number(row.team1_is_ghost ?? 0) === 1,
    team2IsGhost: Number(row.team2_is_ghost ?? 0) === 1,
    casters: casters.map((caster) => ({
      userId: caster.userId,
      readyAt: current ? toIso(caster.readyAt) : null,
    })),
  });
}

/**
 * Rattache l'état de lancement de la ligne à son appariement courant avant
 * toute écriture : si l'empreinte stockée décrit une autre paire d'équipes, les
 * « Prêt », l'ouverture et le lancement qu'elle portait sont effacés en base,
 * puis l'empreinte est réécrite. Sans ce ménage, un « Prêt » posé maintenant
 * côtoierait en base celui de l'équipe d'avant, que la lecture rejetterait
 * pourtant — et l'empreinte neuve le ressusciterait.
 */
async function adoptCurrentPairing(connection: PoolConnection, row: LaunchMatchRow): Promise<void> {
  const key = launchPairingKey(nullableId(row.team1_id), nullableId(row.team2_id));
  if (key === null || row.launch_pairing === key) return;
  await connection.execute(
    `UPDATE bg_matches
     SET launch_pairing = ?, lobby_opened_at = NULL, launched_at = NULL,
         team1_ready_at = NULL, team2_ready_at = NULL
     WHERE id = ?`,
    [key, row.id],
  );
  row.launch_pairing = key;
  row.lobby_opened_at = null;
  row.launched_at = null;
  row.team1_ready_at = null;
  row.team2_ready_at = null;
  if (row.casters.length === 0) return;
  await connection.execute(`UPDATE bg_match_casters SET ready_at = NULL WHERE match_id = ?`, [row.id]);
  for (const caster of row.casters) caster.readyAt = null;

  // Un caster peut s'inscrire sur un match dont les créneaux sont encore vides
  // — l'inscription ne peut alors rien vérifier. Si l'appariement qui arrive
  // compte son équipe, il joue ce match : il ne peut plus le caster.
  const playing: number[] = [];
  for (const caster of row.casters) {
    if (await resolveTeamParty(connection, row, caster.userId)) playing.push(caster.userId);
  }
  if (playing.length === 0) return;
  await connection.execute(
    `DELETE FROM bg_match_casters WHERE match_id = ? AND user_id IN (${playing.map(() => "?").join(", ")})`,
    [row.id, ...playing],
  );
  row.casters = row.casters.filter((caster) => !playing.includes(caster.userId));
  await pruneMatchStreams(connection, Number(row.id));
  for (const casterId of playing) {
    // Annoncé comme tout retrait d'office (journal du staff, avis au caster),
    // après le commit de la transaction appelante : `inTransaction` ici,
    // `flushBotLogs` pour l'entretien.
    queueCastChange(connection, { kind: "AUTO_RELEASED", matchId: Number(row.id), casterId, reason: "JOINED_TEAM" });
  }
}

/** Colonnes propres à la ligne du match, relues sous verrou par `lockLaunchMatch`. */
const LAUNCH_MATCH_OWN_COLUMNS = `
  m.id, m.tournament_id, m.status, m.is_bye, m.team1_id, m.team2_id,
  m.start_at, m.lobby_opened_at, m.launch_pairing, m.launched_at, m.team1_ready_at,
  m.team2_ready_at, m.host_team_id`;

/**
 * Relit le match **sous verrou** de sa seule ligne : les tables jointes ne sont
 * que lues, et verrouiller la ligne du tournoi ferait attendre tout le moteur
 * derrière un clic sur « Prêt ».
 *
 * Deux requêtes et non une jointure en `FOR UPDATE OF m` : la production tourne
 * sous **MariaDB**, qui ne connaît pas la clause `OF` (erreur de syntaxe, qui
 * faisait échouer tout lancement anticipé de tournoi), et un `FOR UPDATE` nu
 * sur la jointure verrouillerait aussi le tournoi et les deux équipes. La ligne
 * du match est donc lue seule sous verrou — lecture *courante*, jamais
 * périmée —, puis l'état du tournoi et le statut fantôme des engagées par une
 * lecture ordinaire : le premier est verrouillé par le moteur quand il compte
 * (la transaction qui le modifie le voit), le second ne change pas.
 *
 * Ses casters sont relus ensuite, **sous verrou** eux aussi (`lockMatchCasters`,
 * table seule) : toute écriture sur un caster passe par le verrou du match, et
 * une lecture ordinaire rendrait l'instantané de la transaction, d'avant un
 * caster inscrit entre-temps.
 */
async function lockLaunchMatch(
  connection: PoolConnection,
  matchId: number,
): Promise<LaunchMatchRow | null> {
  const [rows] = await connection.execute<LaunchMatchBaseRow[]>(
    `SELECT ${LAUNCH_MATCH_OWN_COLUMNS} FROM bg_matches m WHERE m.id = ? LIMIT 1 FOR UPDATE`,
    [matchId],
  );
  const base = rows[0];
  if (!base) return null;

  const [context] = await connection.execute<
    (RowDataPacket & {
      tournament_state: string | null;
      referee_scheduling: number | null;
      match_launch_phase: number | null;
      team1_is_ghost: number | null;
      team2_is_ghost: number | null;
    })[]
  >(
    `SELECT
       (SELECT state FROM bg_tournaments WHERE id = ?) AS tournament_state,
       (SELECT referee_scheduling FROM bg_tournaments WHERE id = ?) AS referee_scheduling,
       (SELECT match_launch_phase FROM bg_tournaments WHERE id = ?) AS match_launch_phase,
       (SELECT is_ghost FROM bg_teams WHERE id = ?) AS team1_is_ghost,
       (SELECT is_ghost FROM bg_teams WHERE id = ?) AS team2_is_ghost`,
    [
      base.tournament_id,
      base.tournament_id,
      base.tournament_id,
      nullableId(base.team1_id),
      nullableId(base.team2_id),
    ],
  );
  // Même effet que l'ancienne jointure interne : un match dont le tournoi a
  // disparu n'est pas un match à lancer.
  const tournamentState = context[0]?.tournament_state ?? null;
  if (tournamentState === null) return null;
  const row: LaunchMatchRow = Object.assign(base, { casters: await lockMatchCasters(connection, matchId) });
  row.tournament_state = tournamentState;
  row.referee_scheduling = context[0]?.referee_scheduling ?? 0;
  row.match_launch_phase = context[0]?.match_launch_phase ?? 0;
  row.team1_is_ghost = context[0]?.team1_is_ghost ?? null;
  row.team2_is_ghost = context[0]?.team2_is_ghost ?? null;
  return row;
}

async function inTransaction<T>(run: (connection: PoolConnection) => Promise<T>): Promise<T> {
  return withConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      const result = await run(connection);
      await connection.commit();
      flushCastChanges(connection);
      return result;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      discardCastChanges(connection);
      throw error;
    }
  });
}

/** Partie que le lecteur représente dans ce match, et sa qualité à y agir. */
export type MatchParty = { role: LaunchViewerRole; canDeclareReady: boolean };

/**
 * Le lecteur est-il partie de ce match — joueur d'une des deux engagées
 * (appartenance **en cours**, ou entrée solo), ou un de ses casters ?
 */
export async function resolveMatchParty(
  connection: PoolConnection,
  match: { team1_id: number | null; team2_id: number | null; casters: readonly Pick<MatchCasterLink, "userId">[] },
  userId: number,
): Promise<MatchParty | null> {
  // Le rôle de joueur prime : qui joue le match ne le caste pas, même si une
  // inscription faite avant que son équipe n'arrive est encore en base.
  const team = await resolveTeamParty(connection, match, userId);
  if (team) return team;
  if (match.casters.some((caster) => caster.userId === userId)) {
    // Une inscription ne vaut que tant que son titulaire remplit la condition
    // du cast : un compte privé de `live` ou d'identité ne déclare plus rien.
    if ((await loadCastEligibility(connection, userId)) !== null) return null;
    return { role: "CASTER", canDeclareReady: true };
  }
  return null;
}

/** Le lecteur joue-t-il ce match — appartenance en cours, ou entrée solo ? */
async function resolveTeamParty(
  connection: PoolConnection,
  match: { team1_id: number | null; team2_id: number | null },
  userId: number,
): Promise<MatchParty | null> {
  const team1Id = nullableId(match.team1_id);
  const team2Id = nullableId(match.team2_id);
  const teamIds = [team1Id, team2Id].filter((id): id is number => id !== null);
  if (teamIds.length === 0) return null;
  const placeholders = teamIds.map(() => "?").join(", ");

  const [solo] = await connection.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_teams WHERE solo_user_id = ? AND id IN (${placeholders}) LIMIT 1`,
    [userId, ...teamIds],
  );
  if (solo.length > 0) {
    return { role: Number(solo[0].id) === team1Id ? "TEAM1" : "TEAM2", canDeclareReady: true };
  }

  const [members] = await connection.execute<
    (RowDataPacket & { team_id: number; roles_json: unknown })[]
  >(
    `SELECT team_id, roles_json FROM bg_team_members
     WHERE user_id = ? AND left_at IS NULL AND team_id IN (${placeholders})
     LIMIT 1`,
    [userId, ...teamIds],
  );
  if (members.length === 0) return null;
  const roles: TeamRole[] = parseRoles(members[0].roles_json);
  return {
    role: Number(members[0].team_id) === team1Id ? "TEAM1" : "TEAM2",
    canDeclareReady: canDeclareTeamReady(roles),
  };
}

/**
 * Lance le match si toutes les parties attendues sont prêtes. Appelée après
 * chaque écriture qui peut compléter la liste (un « Prêt », le départ d'un caster).
 */
async function launchIfAllReady(connection: PoolConnection, matchId: number): Promise<boolean> {
  const row = await lockLaunchMatch(connection, matchId);
  if (!row) return false;
  await adoptCurrentPairing(connection, row);
  if (matchLaunchPhase(toLaunchInput(row), Date.now()) !== "LOBBY") return false;
  if (!allPartiesReady(rowReadiness(row))) return false;
  await connection.execute(`UPDATE bg_matches SET launched_at = NOW() WHERE id = ?`, [matchId]);
  return true;
}

/**
 * Déclare (ou retire) le « Prêt » de la partie du lecteur. Le retrait n'est
 * possible que tant que le match n'est pas lancé : une fois parti, il l'est.
 *
 * @throws `MATCH_NOT_FOUND` | `TOURNAMENT_NOT_RUNNING` | `MATCH_ALREADY_LAUNCHED`
 *   | `MATCH_NOT_IN_LOBBY` | `NOT_MATCH_PARTY` | `NOT_TEAM_READY_ROLE`
 */
export async function setMatchReady(
  matchId: number,
  userId: number,
  ready: boolean,
): Promise<{ launched: boolean }> {
  const { tournamentId, launched } = await inTransaction(async (connection) => {
    const row = await lockLaunchMatch(connection, matchId);
    if (!row) throw new Error("MATCH_NOT_FOUND");
    if (row.tournament_state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");
    const phase = matchLaunchPhase(toLaunchInput(row), Date.now());
    if (phase === "LAUNCHED") throw new Error("MATCH_ALREADY_LAUNCHED");
    if (phase !== "LOBBY") throw new Error("MATCH_NOT_IN_LOBBY");

    await adoptCurrentPairing(connection, row);
    const party = await resolveMatchParty(connection, row, userId);
    if (!party) throw new Error("NOT_MATCH_PARTY");
    if (!party.canDeclareReady) throw new Error("NOT_TEAM_READY_ROLE");

    if (party.role === "CASTER") {
      // Chaque caster a son « Prêt » : le sien seul change.
      await connection.execute(
        `UPDATE bg_match_casters SET ready_at = ${ready ? "NOW()" : "NULL"} WHERE match_id = ? AND user_id = ?`,
        [matchId, userId],
      );
      await connection.execute(
        `UPDATE bg_matches SET lobby_opened_at = COALESCE(lobby_opened_at, NOW()) WHERE id = ?`,
        [matchId],
      );
    } else {
      // Nom de colonne tiré d'une table fermée, jamais de l'entrée.
      const column = READY_AT_COLUMNS[party.role];
      await connection.execute(
        `UPDATE bg_matches
         SET ${column} = ${ready ? "NOW()" : "NULL"},
             lobby_opened_at = COALESCE(lobby_opened_at, NOW())
         WHERE id = ?`,
        [matchId],
      );
    }
    const launchedNow = ready ? await launchIfAllReady(connection, matchId) : false;
    return { tournamentId: Number(row.tournament_id), launched: launchedNow };
  });
  publishMatchUpdatedEvent(tournamentId, { landingLive: true });
  return { launched };
}

/**
 * Lance le match sans attendre les « Prêt » manquants (arbitrage). Possible
 * dès que le match est jouable, heure de début atteinte ou non — et même **à
 * planifier** : forcer est un geste d'arbitrage, il vaut planification.
 *
 * @throws `MATCH_NOT_FOUND` | `TOURNAMENT_NOT_RUNNING` | `MATCH_ALREADY_LAUNCHED`
 *   | `MATCH_NOT_LAUNCHABLE`
 */
export async function forceLaunchMatch(matchId: number): Promise<void> {
  const tournamentId = await inTransaction(async (connection) => {
    const row = await lockLaunchMatch(connection, matchId);
    if (!row) throw new Error("MATCH_NOT_FOUND");
    if (row.tournament_state !== "RUNNING") throw new Error("TOURNAMENT_NOT_RUNNING");
    // Jugé phase **allumée** : « déjà lancé » veut dire `launched_at` posé. Sur
    // un tournoi sans lancement, un match à l'heure passée que l'entretien n'a
    // pas encore écrit serait sinon refusé (`MATCH_ALREADY_LAUNCHED`) sans que
    // rien ne soit enregistré ; forcer l'enregistre.
    const phase = matchLaunchPhase({ ...toLaunchInput(row), launchPhase: true }, Date.now());
    if (phase === "LAUNCHED") throw new Error("MATCH_ALREADY_LAUNCHED");
    if (phase === "NONE") throw new Error("MATCH_NOT_LAUNCHABLE");
    await adoptCurrentPairing(connection, row);
    await connection.execute(
      `UPDATE bg_matches
       SET launched_at = NOW(), lobby_opened_at = COALESCE(lobby_opened_at, NOW())
       WHERE id = ?`,
      [matchId],
    );
    return Number(row.tournament_id);
  });
  publishMatchUpdatedEvent(tournamentId, { landingLive: true });
}

/** Identité d'un caster telle que la règle de `castBlockReason` la lit. */
export async function loadCasterIdentity(
  connection: PoolConnection,
  userId: number,
): Promise<CasterIdentity> {
  const [rows] = await connection.execute<CasterIdentityRow[]>(
    `SELECT discord_verified_at, discord_pseudo, blizzard_sub, overwatch_battletag, is_deleted
     FROM bg_users WHERE id = ? LIMIT 1`,
    [userId],
  );
  return casterIdentityOf(rows[0]);
}

/**
 * Ce qui empêche un lecteur de s'inscrire comme caster, `null` s'il le peut.
 * L'identité n'est lue que quand elle peut changer la réponse : sans la
 * permission `live`, le refus est acquis.
 */
export async function loadViewerCastBlock(
  userId: number,
  hasLivePermission: boolean,
): Promise<CastBlock | null> {
  if (!hasLivePermission) return castBlockReason(false, { discordVerified: false, blizzardLinked: false });
  const identity = await withConnection((connection) => loadCasterIdentity(connection, userId));
  return castBlockReason(true, identity);
}

/**
 * Où un caster s'inscrit : **co-cast** d'un stream existant du match
 * (`streamId`, aucun lien de plus), ou stream **à part** (`liveUrl`, son propre
 * lien, facultatif — `null` : pas encore de lien public).
 */
export type CastTarget = { streamId: number } | { liveUrl: string | null };

/** Lien d'un stream à part : vide = sans lien ; un lien non reconnu est refusé. */
function castStreamUrl(rawUrl: string | null): string | null {
  if (rawUrl === null || rawUrl.trim() === "") return null;
  const url = normalizeStreamUrl(rawUrl);
  if (url === null) throw new Error("INVALID_STREAM_URL");
  return url;
}

/**
 * Le stream est-il montré (`mapMatch`, `firstStreamUrlSql`) ? Celui du staff,
 * ou celui d'un match lancé, l'est toujours ; avant le lancement, celui qu'aucun
 * caster éligible ne tient est tu — le rejoindre ferait réapparaître la chaîne
 * d'un caster que le site ne montre plus. Les casters sont ceux relus sous
 * verrou avec le match.
 */
async function streamShown(connection: PoolConnection, row: LaunchMatchRow, stream: MatchStreamRow): Promise<boolean> {
  if (stream.staff || row.launched_at !== null) return true;
  for (const caster of row.casters) {
    if (caster.streamId === stream.id && (await loadCastEligibility(connection, caster.userId)) === null) return true;
  }
  return false;
}

/**
 * Inscrit le lecteur comme caster du match, sans plafond : sur un stream
 * existant (co-cast) ou sur un stream qu'il ouvre (`target`).
 * `hasLivePermission` est la permission `live`, établie par la route. Un
 * caster déjà inscrit sur le match n'est pas réinscrit (rien ne change, pas
 * même son stream : il se retire d'abord pour en changer).
 *
 * @throws `NOT_CASTER` | `CASTER_IDENTITY_REQUIRED` | `MATCH_NOT_FOUND`
 *   | `MATCH_ALREADY_COMPLETED` | `MATCH_NOT_LAUNCHABLE` | `CASTER_IS_PLAYER`
 *   | `STREAM_NOT_FOUND` | `INVALID_STREAM_URL`
 */
export async function claimMatchCast(
  matchId: number,
  userId: number,
  hasLivePermission: boolean,
  target?: CastTarget,
): Promise<void> {
  const castTarget: CastTarget = target ?? { liveUrl: null };
  // Le lien est jugé avant toute lecture : un refus ne coûte rien.
  const liveUrl = "liveUrl" in castTarget ? castStreamUrl(castTarget.liveUrl) : null;
  // Deux inscriptions simultanées se croisent sur les verrous d'intervalle
  // d'InnoDB : l'interblocage se rejoue.
  const { tournamentId, claimed } = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      const block = castBlockReason(hasLivePermission, await loadCasterIdentity(connection, userId));
      if (block) throw new Error(block);

      const row = await lockLaunchMatch(connection, matchId);
      if (!row) throw new Error("MATCH_NOT_FOUND");
      if (row.status === "COMPLETED") throw new Error("MATCH_ALREADY_COMPLETED");
      if (Number(row.is_bye) === 1) throw new Error("MATCH_NOT_LAUNCHABLE");
      if (row.casters.some((caster) => caster.userId === userId)) {
        return { tournamentId: Number(row.tournament_id), claimed: false };
      }
      const party = await resolveMatchParty(connection, row, userId);
      if (party) throw new Error("CASTER_IS_PLAYER");

      let streamId: number;
      if ("streamId" in castTarget) {
        const streams = await lockMatchStreams(connection, matchId);
        const stream = streams.find((candidate) => candidate.id === castTarget.streamId);
        if (!stream || !(await streamShown(connection, row, stream))) throw new Error("STREAM_NOT_FOUND");
        streamId = castTarget.streamId;
      } else {
        const [created] = await connection.execute<ResultSetHeader>(
          `INSERT INTO bg_match_streams (match_id, live_url) VALUES (?, ?)`,
          [matchId, liveUrl],
        );
        streamId = Number(created.insertId);
      }
      await connection.execute(
        `INSERT INTO bg_match_casters (match_id, user_id, stream_id, ready_at) VALUES (?, ?, ?, NULL)`,
        [matchId, userId, streamId],
      );
      return { tournamentId: Number(row.tournament_id), claimed: true };
    }),
  );
  // Un lien neuf peut changer ce que montrent l'accueil et ses bandeaux.
  publishMatchUpdatedEvent(tournamentId, { landingLive: liveUrl !== null });
  // Après le commit : journal du staff. Aucune place n'est reprise à personne.
  if (claimed) announceCastChange({ kind: "CLAIMED", matchId, replacedCasterId: null });
}

/**
 * Retire un caster du match (`casterId`, par défaut le lecteur) — le sien, ou
 * n'importe lequel pour l'arbitrage (`canManage`, permission `tournaments`).
 * Un stream que plus personne ne tient disparaît avec lui (`pruneMatchStreams`).
 * Si toutes les autres parties étaient prêtes et n'attendaient que lui, le
 * match part.
 *
 * @throws `MATCH_NOT_FOUND` | `NOT_MATCH_CASTER`
 */
export async function releaseMatchCast(
  matchId: number,
  userId: number,
  canManage: boolean,
  casterId: number = userId,
): Promise<void> {
  const { tournamentId, releasedCasterId } = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      const row = await lockLaunchMatch(connection, matchId);
      if (!row) throw new Error("MATCH_NOT_FOUND");
      if (casterId !== userId && !canManage) throw new Error("NOT_MATCH_CASTER");
      if (!row.casters.some((caster) => caster.userId === casterId)) {
        return { tournamentId: Number(row.tournament_id), releasedCasterId: null };
      }

      await connection.execute(`DELETE FROM bg_match_casters WHERE match_id = ? AND user_id = ?`, [matchId, casterId]);
      await pruneMatchStreams(connection, matchId);
      if (row.tournament_state === "RUNNING") await launchIfAllReady(connection, matchId);
      return { tournamentId: Number(row.tournament_id), releasedCasterId: casterId };
    }),
  );
  publishMatchUpdatedEvent(tournamentId, { landingLive: true });
  if (releasedCasterId !== null) {
    announceCastChange({ kind: "RELEASED", matchId, casterId: releasedCasterId, byStaff: releasedCasterId !== userId });
  }
}

/**
 * Retire l'inscription d'un caster qui ne remplit plus la condition de
 * `castBlockReason` (permission `live` retirée, tag décertifié, Battle.net
 * détaché, compte supprimé). Tout est **relu sous verrou** : si l'inscription a
 * changé de titulaire, si le match a été lancé ou joué, ou si le compte est redevenu
 * éligible entre la lecture et l'écriture, rien n'est fait. Comme au retrait volontaire, un match qui
 * n'attendait plus que ce caster part.
 *
 * @returns vrai si l'inscription a été retirée.
 */
export async function releaseIneligibleCast(matchId: number, casterId: number): Promise<boolean> {
  let tournamentId: number | null = null;
  let reason: "INELIGIBLE" | "JOINED_TEAM" = "INELIGIBLE";
  await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      const row = await lockLaunchMatch(connection, matchId);
      if (!row?.casters.some((caster) => caster.userId === casterId)) return;
      // Seul un match qui attend encore son lancement est concerné. Un match
      // lancé n'attend plus aucun « Prêt » (l'inscription y reste, la lecture
      // des contacts la tait) ; un match joué entre la lecture et ce verrou est
      // de l'histoire, qu'on ne réécrit pas.
      if (row.status === "COMPLETED") return;
      // Phase allumée : lancé = `launched_at` posé, y compris sans phase de
      // lancement (heure passée, entretien pas encore passé : pas encore lancé).
      const phase = matchLaunchPhase({ ...toLaunchInput(row), launchPhase: true }, Date.now());
      if (phase !== "TO_PLAN" && phase !== "SCHEDULED" && phase !== "LOBBY") return;
      // Un caster devenu joueur du match (équipe rejointe après l'inscription,
      // que `CASTER_IS_PLAYER` ne contrôle qu'à l'inscription) ne donnera jamais
      // son « Prêt » de caster : son inscription bloquerait le départ jusqu'au
      // lancement d'office.
      // Le motif dit au caster : les conditions du cast d'abord, l'équipe ensuite.
      if ((await loadCastEligibility(connection, casterId)) === null) {
        if ((await resolveTeamParty(connection, row, casterId)) === null) return;
        reason = "JOINED_TEAM";
      }

      await connection.execute(`DELETE FROM bg_match_casters WHERE match_id = ? AND user_id = ?`, [matchId, casterId]);
      await pruneMatchStreams(connection, matchId);
      if (row.tournament_state === "RUNNING") await launchIfAllReady(connection, matchId);
      tournamentId = Number(row.tournament_id);
    }),
  );
  if (tournamentId === null) return false;
  publishMatchUpdatedEvent(tournamentId, { landingLive: true });
  announceCastChange({ kind: "AUTO_RELEASED", matchId, casterId, reason });
  return true;
}

/**
 * Désigne l'équipe qui héberge la partie ; `null` rend la main au défaut
 * (équipe 1). Aucune garde d'état : c'est une information d'organisation.
 *
 * @throws `MATCH_NOT_FOUND` | `INVALID_HOST_TEAM`
 */
export async function setMatchHost(matchId: number, teamId: number | null): Promise<void> {
  const tournamentId = await inTransaction(async (connection) => {
    const row = await lockLaunchMatch(connection, matchId);
    if (!row) throw new Error("MATCH_NOT_FOUND");
    if (
      teamId !== null &&
      teamId !== nullableId(row.team1_id) &&
      teamId !== nullableId(row.team2_id)
    ) {
      throw new Error("INVALID_HOST_TEAM");
    }
    await connection.execute(`UPDATE bg_matches SET host_team_id = ? WHERE id = ?`, [
      teamId,
      matchId,
    ]);
    return Number(row.tournament_id);
  });
  publishMatchUpdatedEvent(tournamentId);
}

/**
 * Le match a-t-il atteint son lancement (heure passée ou absente, pas encore
 * lancé) ? Jugé phase de lancement **allumée**, quelle que soit l'option du
 * tournoi : c'est le moment où un tournoi sans lancement part d'office.
 */
function enteredLaunch(row: LaunchMatchBaseRow, now: number): boolean {
  return matchLaunchPhase({ ...toLaunchInput(row), launchPhase: true }, now) === "LOBBY";
}

/**
 * Entretien du lancement d'un tournoi en cours, appelé par la synchronisation
 * passive (`syncTournamentState`) dans **sa** transaction :
 *
 * - pose `lobby_opened_at` sur les matchs qui viennent d'entrer en lancement
 *   (c'est l'origine du délai de lancement d'office) ;
 * - lance ceux dont toutes les parties sont prêtes — deux fantômes le sont
 *   d'office, et personne ne cliquerait pour elles ;
 * - lance d'office ceux dont le délai est écoulé ;
 * - sur un tournoi **sans phase de lancement** (`match_launch_phase = 0`),
 *   lance aussitôt tout match qui atteint son heure (ou jouable sans heure).
 *
 * La phase est décidée en mémoire par le module pur, jamais réécrite en SQL :
 * la requête ne fait que réduire les candidats.
 *
 * @returns le nombre de matchs modifiés.
 */
export async function maintainMatchLaunches(
  connection: PoolConnection,
  tournamentId: number,
): Promise<number> {
  const [rows] = await connection.execute<LaunchMatchBaseRow[]>(
    `SELECT ${LAUNCH_MATCH_COLUMNS} ${LAUNCH_MATCH_FROM}
     WHERE m.tournament_id = ? AND m.status = 'READY'
       AND m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL
       -- Un match à planifier n'a rien à entretenir (\`TO_PLAN\`) : l'écarter ici
       -- évite de le relire, puis de l'écarter en mémoire, à chaque passe.
       AND (m.start_at IS NOT NULL OR t.referee_scheduling = 0)
       AND (m.launched_at IS NULL
            OR NOT (m.launch_pairing <=> CONCAT(m.team1_id, ':', m.team2_id)))
     ORDER BY m.id`,
    [tournamentId],
  );
  const now = Date.now();
  let changed = 0;
  for (const candidate of rows) {
    // Les candidats sont parcourus par identifiant croissant (`ORDER BY`) : deux
    // entretiens du même tournoi — balayage passif et relève de la modale —
    // prennent ainsi leurs verrous dans le même ordre, sans interblocage.
    //
    // Premier tri sur la lecture ordinaire, puis **relecture sous verrou**
    // avant toute écriture : un « Prêt » validé entre les deux serait sinon
    // effacé par la remise à zéro d'un appariement lu périmé, ou un lancement
    // décidé sur un « Prêt » tout juste retiré.
    //
    // La phase est jugée **comme si le lancement était allumé** : sur un
    // tournoi qui l'a éteint, le match que la règle dit déjà « lancé » n'a pas
    // encore son `launched_at` — c'est ici qu'il le reçoit, à la première
    // passe, comme un lancement d'office sans délai. Diffusions, annonces et
    // notifications, qui lisent `launched_at`, partent ainsi à l'identique.
    if (!enteredLaunch(candidate, now)) continue;
    const row = await lockLaunchMatch(connection, Number(candidate.id));
    if (row?.status !== "READY" || !enteredLaunch(row, now)) continue;
    const stale = row.launch_pairing !== launchPairingKey(nullableId(row.team1_id), nullableId(row.team2_id));
    await adoptCurrentPairing(connection, row);
    const launch =
      Number(row.match_launch_phase ?? 0) !== 1 ||
      allPartiesReady(rowReadiness(row)) ||
      isAutoLaunchDue(toIso(row.lobby_opened_at), now);
    if (launch) {
      await connection.execute(
        `UPDATE bg_matches
         SET launched_at = NOW(), lobby_opened_at = COALESCE(lobby_opened_at, NOW())
         WHERE id = ? AND launched_at IS NULL`,
        [row.id],
      );
      changed += 1;
    } else if (row.lobby_opened_at === null) {
      await connection.execute(
        `UPDATE bg_matches SET lobby_opened_at = NOW() WHERE id = ? AND lobby_opened_at IS NULL`,
        [row.id],
      );
      changed += 1;
    } else if (stale) {
      changed += 1;
    }
  }
  return changed;
}
