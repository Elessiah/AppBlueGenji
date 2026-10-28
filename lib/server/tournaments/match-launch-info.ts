/**
 * Lecture de la modale de lancement : les matchs du lecteur — joueur d'une des
 * deux engagées ou un de leurs casters — qui approchent de leur heure, sont en
 * lancement ou se jouent, avec les contacts que chaque partie doit avoir sous
 * la main.
 *
 * **Exposition bornée.** Les contacts (tag Discord certifié, BattleTag — en
 * Overwatch seulement, `withGameBattletag`) ne sont
 * rendus qu'aux parties d'un match : dans la modale, **en lancement ou lancé** ;
 * par le bouton « Contacts » d'une carte, dès que ses deux adversaires sont
 * connus pour ses joueurs et pour les arbitres (permission `tournaments`), le
 * temps du match seulement pour ses casters (`exposesMatchContacts`). Ceux **des
 * casters** sortent le temps du match — vers les équipes **et vers chaque autre
 * caster du match** —, et dès que les adversaires sont connus pour un arbitre
 * (`exposesCaster`, `exposesCasterContacts`).
 *
 * Ces présentations, toutes ensemble, sont la clause `sharesMatchLobby` de
 * `canViewDiscordTag` et `sharesLiveMatch` de `canViewBattletag`, que ce
 * module est seul à établir.
 * Un match terminé sort de la liste, et ses contacts avec lui.
 *
 * Voir `docs/features/MATCH_LAUNCH.md`.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { withConnection } from "@/lib/server/database";
import { parseRoles, toIso } from "@/lib/server/serialization";
import { visibleBattletag } from "@/lib/shared/battletag-visibility";
import { battletagRelevantFor } from "@/lib/shared/certification-prompt";
import { visibleDiscordTag } from "@/lib/shared/discord-identity";
import {
  autoLaunchAt,
  canDeclareTeamReady,
  exposesCasterContacts,
  isAutoLaunchDue,
  exposesMatchContacts,
  matchLaunchPhase,
  readsContactsEarly,
  pickLaunchContacts,
  type ContactCandidate,
  type LaunchCaster,
  type LaunchContact,
  type LaunchReferee,
  type LaunchSide,
  type LaunchSideContact,
  type MatchLaunchInfo,
  type MatchLaunchViewerRole,
} from "@/lib/shared/match-launch";
import type { MatchCasterLink } from "./match-casters";
import { loadCasterLinks } from "./match-casters";
import { can, type PlatformRole } from "@/lib/shared/permissions";
import type { TeamRole, TournamentGame } from "@/lib/shared/types";
import { localUploadUrl } from "@/lib/shared/uploads";
import {
  maintainMatchLaunches,
  releaseIneligibleCast,
  releaseIneligibleReferee,
  rowLaunchState,
  rowReadiness,
  toLaunchInput,
  type LaunchMatchBaseRow,
} from "./match-launch";
import { castEligibilityBlock, refereeEligibilityBlock } from "./cast-eligibility";
import { matchHostTeamId } from "@/lib/shared/match-referee";
import { seedJoins } from "./match-host-seeds";
import { discardBotLogs, flushBotLogs } from "./bot-logs";
import { cachedTournamentList } from "./list-cache";
import { publishMatchUpdatedEvent } from "./notifications";

/**
 * Horizon d'anticipation : un match dont l'heure tombe dans l'heure est déjà
 * rendu (sans contacts), pour que la page ouvre la modale à la seconde dite par
 * une minuterie plutôt qu'au prochain passage de l'interrogation.
 */
export const LAUNCH_LOOKAHEAD_MINUTES = 60;

/** Le lecteur tel que ce module le lit. */
export type LaunchViewer = { id: number; isAdmin?: boolean; roles?: readonly PlatformRole[] };

type CandidateBaseRow = LaunchMatchBaseRow & {
  tournament_name: string;
  /** Jeu du tournoi : le BattleTag des casters et de l'arbitre ne sort qu'en Overwatch. */
  tournament_game: TournamentGame;
  team1_name: string | null;
  team2_name: string | null;
  team1_logo_url: string | null;
  team2_logo_url: string | null;
  team1_solo_user_id: number | null;
  team2_solo_user_id: number | null;
  /** Rang de chaque engagée au classement d'endurance (BlueGenji Survie, phase finale) ; `null` ailleurs. */
  team1_seed: number | null;
  team2_seed: number | null;
};

type CandidateRow = CandidateBaseRow & {
  casters: MatchCasterLink[];
  /** Arbitre désigné encore éligible (relu à chaque lecture, `keepEligibleReferees`). */
  refereeEligible: boolean;
};

type MemberRow = RowDataPacket & {
  team_id: number;
  user_id: number;
  pseudo: string;
  roles_json: unknown;
  discord_pseudo: string | null;
  discord_verified_at: Date | string | null;
  overwatch_battletag: string | null;
  blizzard_sub: string | null;
  visible_overwatch: number;
};

type UserRow = RowDataPacket & {
  id: number;
  pseudo: string;
  discord_pseudo: string | null;
  discord_verified_at: Date | string | null;
  overwatch_battletag: string | null;
  blizzard_sub: string | null;
  visible_overwatch: number;
  is_deleted: number;
  is_admin: number;
  platform_roles_json: unknown;
};

type ViewerTeams = Map<number, { roles: TeamRole[]; solo: boolean }>;

/** Équipes que le lecteur représente : appartenances en cours et entrée solo. */
async function loadViewerTeams(connection: PoolConnection, userId: number): Promise<ViewerTeams> {
  const teams: ViewerTeams = new Map();
  const [members] = await connection.execute<
    (RowDataPacket & { team_id: number; roles_json: unknown })[]
  >(`SELECT team_id, roles_json FROM bg_team_members WHERE user_id = ? AND left_at IS NULL`, [userId]);
  for (const row of members) {
    teams.set(Number(row.team_id), { roles: parseRoles(row.roles_json), solo: false });
  }
  const [solo] = await connection.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_teams WHERE solo_user_id = ?`,
    [userId],
  );
  for (const row of solo) teams.set(Number(row.id), { roles: [], solo: true });
  return teams;
}

/**
 * Un tournoi est-il en cours sur le site ? Sans lui, aucun match n'est à
 * présenter, à personne : la modale interroge sa route toutes les minutes sur
 * chaque onglet ouvert d'un compte connecté, et chaque appel faisait trois
 * lectures pour rendre une liste vide.
 *
 * La réponse est **la même pour tous** : elle est mutualisée avec les listes de
 * tournois, et vidée avec elles à chaque écriture sur un tournoi
 * (`publishUpdatedEvent`) — un tournoi qui démarre est donc vu aussitôt. Le
 * retard ne tient qu'à une bascule d'état que personne n'a encore écrite, et
 * aucun match n'existe alors en base pour ce tournoi.
 */
function hasRunningTournament(withLaunchPhase: boolean): Promise<boolean> {
  // La modale ne lit que les tournois qui ont la phase de lancement (option
  // désactivée par défaut) : sans ce filtre, un seul tournoi en cours sans
  // l'option ferait payer à chaque onglet la lecture complète, pour rien.
  const filter = withLaunchPhase ? " AND match_launch_phase = 1" : "";
  return cachedTournamentList(withLaunchPhase ? "running-launch-phase-exists" : "running-exists", () =>
    withConnection(async (connection) => {
      const [rows] = await connection.execute<(RowDataPacket & { running: number })[]>(
        `SELECT EXISTS (SELECT 1 FROM bg_tournaments WHERE state = 'RUNNING'${filter}) AS running`,
      );
      return Number(rows[0]?.running ?? 0) === 1;
    }),
  );
}

/**
 * Matchs à présenter au lecteur : ceux d'une équipe qu'il représente (membre
 * en cours ou entrée solo) ou qu'il caste. Les équipes du lecteur sont lues
 * **dans** la requête : un lecteur qui n'a aucun match — le cas courant — ne
 * coûte qu'une lecture, et ses rôles ne sont relus que s'il en a un. Les
 * casters des matchs retenus suivent, en une lecture.
 */
async function loadCandidates(
  connection: PoolConnection,
  userId: number,
  matchId: number | null,
  referee = false,
): Promise<CandidateRow[]> {
  // Deux lectures : la modale de lancement (tous les matchs du lecteur qui
  // approchent, sur les seuls tournois qui ont la phase de lancement), et le
  // bouton « Contacts » d'une carte (un seul match, quelle que soit l'option et
  // quel que soit son horaire, « À planifier » compris : dès que les deux
  // adversaires sont connus). La règle de qui en est partie ne change pas.
  // Pour la modale, un match à planifier n'a rien à présenter : ni heure à
  // guetter, ni « Prêt » à donner.
  const scope =
    matchId === null
      ? `AND (m.start_at IS NULL OR m.start_at <= NOW() + INTERVAL ${LAUNCH_LOOKAHEAD_MINUTES} MINUTE)
         AND t.match_launch_phase = 1
         AND (m.start_at IS NOT NULL OR t.referee_scheduling = 0)`
      : `AND m.id = ?`;
  const viewerTeams = `(SELECT tm.team_id FROM bg_team_members tm
                        WHERE tm.user_id = ? AND tm.left_at IS NULL
                        UNION SELECT st.id FROM bg_teams st WHERE st.solo_user_id = ?)`;
  const [rows] = await connection.execute<(CandidateBaseRow & RowDataPacket)[]>(
    `SELECT
       m.id, m.tournament_id, t.state AS tournament_state, t.referee_scheduling, t.match_launch_phase,
       m.status, m.is_bye,
       m.team1_id, m.team2_id, t1.is_ghost AS team1_is_ghost, t2.is_ghost AS team2_is_ghost,
       m.start_at, m.lobby_opened_at, m.launch_pairing, m.launched_at, m.team1_ready_at, m.team2_ready_at,
       m.host_team_id, m.referee_user_id, m.referee_ready_at, m.self_managed,
       es1.\`rank\` AS team1_seed, es2.\`rank\` AS team2_seed,
       t.name AS tournament_name, t.game AS tournament_game,
       t1.name AS team1_name, t2.name AS team2_name,
       t1.logo_url AS team1_logo_url, t2.logo_url AS team2_logo_url,
       t1.solo_user_id AS team1_solo_user_id, t2.solo_user_id AS team2_solo_user_id
     FROM bg_matches m
     JOIN bg_tournaments t ON t.id = m.tournament_id
     LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
     LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
     ${seedJoins("m")}
     WHERE t.state = 'RUNNING'
       AND m.status IN ('READY', 'AWAITING_CONFIRMATION')
       AND m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL
       ${scope}
       AND (${referee && matchId !== null ? "1 = 1 OR " : ""}EXISTS (
              SELECT 1 FROM bg_match_casters mc WHERE mc.match_id = m.id AND mc.user_id = ?)
            OR m.referee_user_id = ?
            OR m.team1_id IN ${viewerTeams}
            OR m.team2_id IN ${viewerTeams})
     ORDER BY m.start_at IS NULL, m.start_at, m.id`,
    matchId === null
      ? [userId, userId, userId, userId, userId, userId]
      : [matchId, userId, userId, userId, userId, userId, userId],
  );
  const casters = await loadCasterLinks(
    connection,
    rows.map((row) => Number(row.id)),
  );
  return rows.map((row) => Object.assign(row, { casters: casters.get(Number(row.id)) ?? [], refereeEligible: false }));
}

/** Membre lu → candidat contact (aussi lu par l'invitation à certifier, `certification-prompt.ts`). */
export function toCandidate(row: {
  user_id: number;
  pseudo: string;
  roles: TeamRole[];
  discord_pseudo: string | null;
  discord_verified_at: Date | string | null;
  overwatch_battletag: string | null;
  blizzard_sub: string | null;
}): ContactCandidate {
  return {
    userId: Number(row.user_id),
    pseudo: row.pseudo,
    roles: row.roles,
    discordTag: row.discord_pseudo,
    discordVerified: row.discord_verified_at !== null,
    battletag: row.overwatch_battletag,
    blizzardLinked: row.blizzard_sub !== null,
  };
}

/**
 * Applique les règles de visibilité **à la sortie**, même si le choix des
 * contacts n'a gardé qu'un tag certifié : la règle vit dans
 * `canViewDiscordTag` / `canViewBattletag`, pas dans ce module.
 */
function filterContact(
  contact: LaunchContact,
  viewer: LaunchViewer,
  visibleOverwatch: boolean,
): LaunchContact {
  return {
    ...contact,
    discordTag: visibleDiscordTag(contact.discordTag, viewer, {
      userId: contact.userId,
      verified: contact.discordTag !== null,
      sharesMatchLobby: true,
    }),
    battletag: visibleBattletag(contact.battletag, viewer, {
      userId: contact.userId,
      visible: visibleOverwatch,
      sharesLiveMatch: true,
    }),
  };
}

function viewerRole(
  row: CandidateRow,
  userId: number,
  teams: ViewerTeams,
  casters: readonly MatchCasterLink[],
  referee: boolean,
): { role: MatchLaunchViewerRole; canDeclareReady: boolean } | null {
  // Ordre de `resolveMatchParty` : joueur, caster, arbitre désigné.
  // Le rôle de joueur prime, comme dans `resolveMatchParty`.
  for (const [role, teamId] of [
    ["TEAM1", row.team1_id],
    ["TEAM2", row.team2_id],
  ] as const) {
    const membership = teamId === null ? undefined : teams.get(Number(teamId));
    if (membership) {
      return { role, canDeclareReady: membership.solo || canDeclareTeamReady(membership.roles) };
    }
  }
  // `casters` : ceux que la lecture garde (un caster inéligible n'en est plus).
  if (casters.some((caster) => caster.userId === userId)) {
    return { role: "CASTER", canDeclareReady: true };
  }
  if (row.refereeEligible && Number(row.referee_user_id) === userId) {
    return { role: "MATCH_REFEREE", canDeclareReady: true };
  }
  // Un arbitre n'a pas de « Prêt » à donner : il lit les contacts, rien de plus.
  if (referee) return { role: "REFEREE", canDeclareReady: false };
  return null;
}

/**
 * Lance d'office ce qui doit l'être avant de répondre : la modale interroge
 * toutes les quelques secondes, et sans ce passage un lancement d'office
 * attendrait que quelqu'un ouvre la liste des tournois.
 */
async function maintainIfDue(connection: PoolConnection, rows: CandidateRow[]): Promise<boolean> {
  const now = Date.now();
  const due = new Set<number>();
  for (const row of rows) {
    if (matchLaunchPhase(toLaunchInput(row), now) !== "LOBBY") continue;
    const opened = rowLaunchState(row).lobbyOpenedAt;
    if (opened === null || isAutoLaunchDue(opened, now)) {
      due.add(Number(row.tournament_id));
    }
  }
  for (const tournamentId of due) {
    await connection.beginTransaction();
    try {
      const changed = await maintainMatchLaunches(connection, tournamentId);
      await connection.commit();
      flushBotLogs(connection);
      if (changed > 0) publishMatchUpdatedEvent(tournamentId);
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      discardBotLogs(connection);
      console.error("[match-launch] entretien impossible", error);
    }
  }
  return due.size > 0;
}

type LaunchPhase = ReturnType<typeof matchLaunchPhase>;
type VisibleLaunch = { row: CandidateRow; phase: LaunchPhase; exposes: boolean };

/** Ce qu'il faut pour rédiger la présentation d'un match au lecteur. */
type LaunchContext = {
  viewer: LaunchViewer;
  users: Map<number, UserRow>;
  rosters: Map<number, MemberRow[]>;
  /** Casters gardés par la lecture : un caster inéligible (ou devenu joueur) en est tu. */
  casters: readonly MatchCasterLink[];
  readiness: ReturnType<typeof rowReadiness>;
  /** Contacts : seulement pour les matchs où `exposesMatchContacts` les ouvre. */
  exposes: boolean;
  /**
   * Contacts **du caster** : le temps du match seulement (lancement ouvert, ou
   * lancé) — symétrique de ce que le caster reçoit des équipes (décision de
   * l'utilisateur, 2026-10-19). Avant, la carte présente les contacts des
   * équipes sans les siens. Un arbitre (rôle `REFEREE`, par la carte seulement,
   * tournoi en cours) les lit dès que les deux adversaires sont connus et
   * jusqu'à la fin du match, comme ceux des équipes (décision de l'utilisateur,
   * 2026-10-21) — `exposesCasterContacts`, et seulement si `exposes` les ouvre :
   * ce drapeau porte seul la décision pour le caster.
   */
  exposesCaster: boolean;
};


/** Le lecteur représente-t-il une des deux engagées du match ? */
function viewerPlaysMatch(row: CandidateRow, teams: ViewerTeams): boolean {
  return [row.team1_id, row.team2_id].some((teamId) => teamId !== null && teams.has(Number(teamId)));
}

/** Un côté du match tel que la ligne le décrit. */
function rowSide(row: CandidateRow, index: 1 | 2) {
  const first = index === 1;
  return {
    teamId: first ? row.team1_id : row.team2_id,
    isGhost: Number((first ? row.team1_is_ghost : row.team2_is_ghost) ?? 0) === 1,
    soloUserId: first ? row.team1_solo_user_id : row.team2_solo_user_id,
    name: first ? row.team1_name : row.team2_name,
    logoUrl: first ? row.team1_logo_url : row.team2_logo_url,
  };
}

/**
 * Comptes et rosters à lire : les casters de tout match présenté, et les
 * joueurs des seuls matchs dont les contacts sont exposés.
 */
function collectContactIds(visible: readonly VisibleLaunch[]): {
  rosterTeamIds: Set<number>;
  userIds: Set<number>;
} {
  const exposed = visible.filter(({ exposes }) => exposes);
  const rosterTeamIds = new Set<number>();
  const userIds = new Set<number>();
  for (const { row } of visible) {
    for (const caster of row.casters) userIds.add(caster.userId);
    if (row.referee_user_id !== null) userIds.add(Number(row.referee_user_id));
  }
  for (const { row } of exposed) {
    for (const index of [1, 2] as const) {
      const { teamId, isGhost, soloUserId } = rowSide(row, index);
      if (teamId === null || isGhost) continue;
      if (soloUserId !== null) userIds.add(Number(soloUserId));
      else rosterTeamIds.add(Number(teamId));
    }
  }
  return { rosterTeamIds, userIds };
}

/** Rosters en cours des équipes, comptes supprimés exclus (aussi lus par `certification-prompt.ts`). */
export async function loadRosters(
  connection: Pick<PoolConnection, "execute">,
  rosterTeamIds: Set<number>,
): Promise<Map<number, MemberRow[]>> {
  const rosters = new Map<number, MemberRow[]>();
  if (rosterTeamIds.size === 0) return rosters;
  const ids = [...rosterTeamIds];
  const [members] = await connection.execute<MemberRow[]>(
    `SELECT tm.team_id, u.id AS user_id, u.pseudo, tm.roles_json, u.discord_pseudo,
            u.discord_verified_at, u.overwatch_battletag, u.blizzard_sub, u.visible_overwatch
     FROM bg_team_members tm
     JOIN bg_users u ON u.id = tm.user_id
     WHERE tm.team_id IN (${ids.map(() => "?").join(", ")})
       AND tm.left_at IS NULL AND u.is_deleted = 0`,
    ids,
  );
  for (const member of members) {
    const list = rosters.get(Number(member.team_id)) ?? [];
    list.push(member);
    rosters.set(Number(member.team_id), list);
  }
  return rosters;
}

async function loadUsers(connection: PoolConnection, userIds: Set<number>): Promise<Map<number, UserRow>> {
  const users = new Map<number, UserRow>();
  if (userIds.size === 0) return users;
  const ids = [...userIds];
  const [found] = await connection.execute<UserRow[]>(
    `SELECT id, pseudo, discord_pseudo, discord_verified_at, overwatch_battletag, blizzard_sub,
            visible_overwatch, is_deleted, is_admin, platform_roles_json
     FROM bg_users WHERE id IN (${ids.map(() => "?").join(", ")})`,
    ids,
  );
  for (const user of found) users.set(Number(user.id), user);
  return users;
}

/**
 * Un caster n'est une partie du match que tant qu'il remplit la condition
 * de son inscription : elle est rejouée ici, à chaque lecture et pour chaque
 * caster, sans quoi un compte privé de `live` (ou d'identité) garderait les
 * contacts. L'inscription n'est retirée qu'avant le lancement, là où elle
 * retient un « Prêt » ; un match lancé garde son caster, seulement tu.
 *
 * Rend, par match, les casters gardés, et range dans `revokedCasts` les
 * inscriptions à retirer.
 */
function keepEligibleCasters(
  visible: readonly VisibleLaunch[],
  users: Map<number, UserRow>,
  revokedCasts: { matchId: number; casterId: number }[],
  casterPlays: (row: CandidateRow, casterId: number) => boolean = () => false,
): Map<number, MatchCasterLink[]> {
  const now = Date.now();
  const kept = new Map<number, MatchCasterLink[]>();
  for (const { row } of visible) {
    // Phase jugée **allumée** — la règle même de `releaseIneligibleCast` : sur
    // un tournoi sans phase de lancement, un match à l'heure passée se lit
    // lancé avant que l'entretien ne l'écrive, et c'est la dernière occasion
    // de retirer l'inscription, qu'un match lancé garde ensuite. Un report en
    // attente vaut lancé, des deux côtés : rien n'est mis en file pour rien.
    const recorded = matchLaunchPhase({ ...toLaunchInput(row), launchPhase: true }, now);
    const keptHere: MatchCasterLink[] = [];
    for (const caster of row.casters) {
      // Un caster devenu joueur du match ne donnera jamais son « Prêt » de
      // caster : avant le lancement, dès qu'une lecture le constate (le sien,
      // ou les rosters lus pour les contacts), il est tu et son inscription
      // retirée, comme un caster inéligible — sous verrou, `releaseIneligibleCast`
      // rejoue la même règle. Lancé, il garde sa place.
      const playsMatch = recorded !== "LAUNCHED" && casterPlays(row, caster.userId);
      if (castEligibilityBlock(users.get(caster.userId)) !== null || playsMatch) {
        if (recorded !== "LAUNCHED") revokedCasts.push({ matchId: Number(row.id), casterId: caster.userId });
      } else {
        keptHere.push(caster);
      }
    }
    kept.set(Number(row.id), keptHere);
  }
  return kept;
}

/**
 * L'arbitre désigné n'est une partie du match que tant qu'il remplit la
 * condition d'arbitrage (`refereeEligibilityBlock`) et ne le joue pas : rejouée
 * à chaque lecture, comme celle des casters. Avant le lancement, un arbitre
 * qui ne la remplit plus est rangé dans `revokedReferees` (retrait d'office
 * sous verrou, `releaseIneligibleReferee`) ; un match lancé le garde, tu.
 */
function keepEligibleReferees(
  visible: readonly VisibleLaunch[],
  users: Map<number, UserRow>,
  revokedReferees: { matchId: number; refereeId: number }[],
  plays: (row: CandidateRow, userId: number) => boolean,
): void {
  const now = Date.now();
  for (const { row } of visible) {
    if (row.referee_user_id === null) continue;
    const refereeId = Number(row.referee_user_id);
    const recorded = matchLaunchPhase({ ...toLaunchInput(row), launchPhase: true }, now);
    const playsMatch = recorded !== "LAUNCHED" && plays(row, refereeId);
    row.refereeEligible = refereeEligibilityBlock(users.get(refereeId)) === null && !playsMatch;
    if (!row.refereeEligible && recorded !== "LAUNCHED") revokedReferees.push({ matchId: Number(row.id), refereeId });
  }
}

/**
 * Contacts d'une engagée, choisis puis filtrés **à la sortie**. Hors Overwatch
 * (décision de l'utilisateur 38, 2026-10-28), le BattleTag ne joint personne :
 * il ne pèse pas sur le choix (seul le tag Discord certifié départage, comme
 * `teamHasContact` de l'invitation à certifier) et ne sort pas — ni lui, ni
 * s'il est vérifié (`withGameBattletag`, minimisation).
 */
function sideContacts(
  candidates: readonly ContactCandidate[],
  visibleOverwatch: ReadonlyMap<number, boolean>,
  game: TournamentGame,
  ctx: LaunchContext,
): LaunchSideContact[] {
  const relevant = battletagRelevantFor(game);
  const pool = relevant ? candidates : candidates.map((c) => ({ ...c, battletag: null, blizzardLinked: false }));
  return pickLaunchContacts(pool).map((picked) => {
    const contact = filterContact(picked, ctx.viewer, visibleOverwatch.get(picked.userId) ?? false);
    return withGameBattletag(
      game,
      { userId: contact.userId, pseudo: contact.pseudo, roles: contact.roles, discordTag: contact.discordTag },
      { battletag: contact.battletag, battletagVerified: contact.battletagVerified },
    );
  });
}

/** Contacts d'une entrée solo : le joueur lui-même, s'il existe encore. */
function soloContacts(soloUserId: number, game: TournamentGame, ctx: LaunchContext): LaunchSideContact[] {
  const user = ctx.users.get(Number(soloUserId));
  if (!user || Number(user.is_deleted) !== 0) return [];
  const visibility = new Map([[Number(user.id), Number(user.visible_overwatch) === 1]]);
  return sideContacts([toCandidate({ ...user, user_id: user.id, roles: [] })], visibility, game, ctx);
}

/** Contacts d'une équipe : choisis dans son roster en cours. */
function rosterContacts(teamId: number, game: TournamentGame, ctx: LaunchContext): LaunchSideContact[] {
  const members = ctx.rosters.get(teamId) ?? [];
  const visibility = new Map(members.map((m) => [Number(m.user_id), Number(m.visible_overwatch) === 1]));
  const candidates = members.map((m) => toCandidate({ ...m, roles: parseRoles(m.roles_json) }));
  return sideContacts(candidates, visibility, game, ctx);
}

function buildLaunchSide(row: CandidateRow, index: 1 | 2, ctx: LaunchContext): LaunchSide {
  const side = rowSide(row, index);
  const teamId = Number(side.teamId);
  const game = row.tournament_game;
  let contacts: LaunchSideContact[] = [];
  if (ctx.exposes && !side.isGhost) {
    contacts = side.soloUserId === null ? rosterContacts(teamId, game, ctx) : soloContacts(side.soloUserId, game, ctx);
  }
  return {
    teamId,
    name: side.name ?? "—",
    logoUrl: localUploadUrl(side.logoUrl),
    isGhost: side.isGhost,
    isSolo: side.soloUserId !== null,
    ready: index === 1 ? ctx.readiness.team1Ready : ctx.readiness.team2Ready,
    contacts,
    contactsShown: ctx.exposes && !side.isGhost,
  };
}

/**
 * Le BattleTag d'un caster, de l'arbitre désigné (décision de l'utilisateur 35)
 * ou d'un contact d'équipe (décision 38) sert à l'inviter dans la partie : il
 * ne sort qu'en Overwatch. Hors Overwatch, les deux champs ne sont pas même
 * envoyés (minimisation) : ni BattleTag, ni la pastille qui dirait s'il est
 * vérifié.
 */
function withGameBattletag<T extends object>(
  game: TournamentGame,
  entry: T,
  battletag: { battletag: string | null; battletagVerified: boolean },
): T & Partial<typeof battletag> {
  return battletagRelevantFor(game) ? { ...entry, ...battletag } : entry;
}

function buildLaunchCaster(caster: MatchCasterLink, game: TournamentGame, ctx: LaunchContext): LaunchCaster | null {
  const user = ctx.users.get(caster.userId);
  if (!user || Number(user.is_deleted) !== 0) return null;
  const discordTag = user.discord_verified_at !== null ? user.discord_pseudo : null;
  const contact = ctx.exposesCaster
    ? filterContact(
        {
          userId: Number(user.id),
          pseudo: user.pseudo,
          roles: [],
          discordTag,
          battletag: user.overwatch_battletag,
          battletagVerified: user.blizzard_sub !== null,
        },
        ctx.viewer,
        Number(user.visible_overwatch) === 1,
      )
    : null;
  return withGameBattletag(
    game,
    {
      userId: Number(user.id),
      pseudo: user.pseudo,
      discordTag: contact?.discordTag ?? null,
      ready: ctx.readiness.casters.some((entry) => entry.userId === caster.userId && entry.ready),
      contactsShown: ctx.exposesCaster,
      isViewer: Number(user.id) === ctx.viewer.id,
    },
    { battletag: contact?.battletag ?? null, battletagVerified: contact?.battletagVerified ?? false },
  );
}

/**
 * L'arbitre désigné tel que les parties du match le lisent : pseudo et, en
 * Overwatch seulement (`withGameBattletag`), BattleTag (`visibleBattletag`,
 * clause `sharesLiveMatch`), jamais son tag Discord. `null` sans arbitre ou
 * arbitre inéligible.
 */
function buildLaunchReferee(row: CandidateRow, ctx: LaunchContext): LaunchReferee | null {
  if (!row.refereeEligible || row.referee_user_id === null) return null;
  const user = ctx.users.get(Number(row.referee_user_id));
  if (!user || Number(user.is_deleted) !== 0) return null;
  return withGameBattletag(
    row.tournament_game,
    {
      userId: Number(user.id),
      pseudo: user.pseudo,
      ready: ctx.readiness.referee?.ready ?? false,
      isViewer: Number(user.id) === ctx.viewer.id,
    },
    {
      // Le BattleTag suit la fenêtre des contacts du match (`ctx.exposes`) : les
      // parties le lisent dès que les deux adversaires sont connus (le temps du
      // match pour un caster), comme les contacts des engagées.
      battletag: ctx.exposes
        ? visibleBattletag(user.overwatch_battletag, ctx.viewer, {
            userId: Number(user.id),
            visible: Number(user.visible_overwatch) === 1,
            sharesLiveMatch: true,
          })
        : null,
      battletagVerified: user.blizzard_sub !== null,
    },
  );
}

function buildLaunchInfo(
  row: CandidateRow,
  phase: LaunchPhase,
  party: { role: MatchLaunchViewerRole; canDeclareReady: boolean; earlyContacts: boolean },
  ctx: LaunchContext,
): MatchLaunchInfo {
  const { readiness } = ctx;
  const casters = ctx.casters
    .map((caster) => buildLaunchCaster(caster, row.tournament_game, ctx))
    .filter((caster): caster is LaunchCaster => caster !== null);
  const self = casters.find((caster) => caster.userId === ctx.viewer.id);
  const referee = buildLaunchReferee(row, ctx);
  const launch = rowLaunchState(row);
  const lobbyOpenedAt = launch.lobbyOpenedAt;
  return {
    matchId: Number(row.id),
    tournamentId: Number(row.tournament_id),
    tournamentName: row.tournament_name,
    phase,
    startAt: toIso(row.start_at),
    lobbyOpenedAt,
    autoLaunchAt: phase === "LOBBY" ? autoLaunchAt(lobbyOpenedAt) : null,
    launchedAt: launch.launchedAt,
    hostTeamId: candidateHostTeamId(row),
    team1: buildLaunchSide(row, 1, ctx),
    team2: buildLaunchSide(row, 2, ctx),
    casters,
    referee,
    selfManaged: Number(row.self_managed ?? 0) === 1,
    viewer: {
      role: party.role,
      canDeclareReady: party.canDeclareReady,
      isReferee: referee?.isViewer ?? false,
      isCaster: self !== undefined,
      earlyContacts: party.earlyContacts,
      ready: {
        CASTER: self?.ready ?? false,
        TEAM1: readiness.team1Ready,
        TEAM2: readiness.team2Ready,
        MATCH_REFEREE: referee?.ready ?? false,
        REFEREE: false,
      }[party.role],
    },
  };
}

/** Matchs du lecteur à présenter dans la modale de lancement. */
export function listViewerMatchLaunches(viewer: LaunchViewer): Promise<MatchLaunchInfo[]> {
  return readViewerLaunches(viewer, null);
}

/**
 * Contacts d'**un** match pour le bouton « Contacts » de sa carte : la même
 * présentation que la modale de lancement, aux mêmes destinataires (les
 * parties du match, caster éligible compris), que le tournoi ait ou non la
 * phase de lancement : dès que les deux adversaires sont connus (à planifier
 * compris) pour un joueur, le temps du match seulement pour le caster.
 *
 * @returns `null` quand le lecteur n'est pas partie du match, qu'il en est le
 *   caster et que le match n'est pas encore parti, ou que le match
 *   n'a pas ses deux adversaires, est terminé, ou son tournoi n'est pas en
 *   cours (`MATCH_CONTACTS_UNAVAILABLE`).
 */
export async function loadViewerMatchContacts(
  viewer: LaunchViewer,
  matchId: number,
): Promise<MatchLaunchInfo | null> {
  const [info] = await readViewerLaunches(viewer, matchId);
  return info ?? null;
}

async function readViewerLaunches(viewer: LaunchViewer, matchId: number | null): Promise<MatchLaunchInfo[]> {
  const forCard = matchId !== null;
  if (!(await hasRunningTournament(!forCard))) return [];
  // Arbitre (permission `tournaments`) : par la carte seulement, les mêmes
  // contacts, à la même heure, que les joueurs du match (décision de
  // l'utilisateur, 2026-10-19). La modale de lancement ne lui présente rien.
  const staff = can(viewer, "tournaments");
  const referee = forCard && staff;

  const revokedCasts: { matchId: number; casterId: number }[] = [];
  const revokedReferees: { matchId: number; refereeId: number }[] = [];
  const launches = await withConnection(async (connection) => {
    let rows = await loadCandidates(connection, viewer.id, matchId, referee);
    if (rows.length === 0) return [];
    if (await maintainIfDue(connection, rows)) {
      rows = await loadCandidates(connection, viewer.id, matchId, referee);
      if (rows.length === 0) return [];
    }
    const teams = await loadViewerTeams(connection, viewer.id);

    const now = Date.now();
    const read = rows
      .map((row) => {
        const phase = matchLaunchPhase(toLaunchInput(row), now);
        const early = readsContactsEarly({ playsMatch: viewerPlaysMatch(row, teams), referee: staff });
        return { row, phase, early, exposes: exposesMatchContacts(phase, forCard && early) };
      })
      .filter(({ phase }) => phase !== "NONE");
    // Par la carte, un match sans contacts à montrer n'est pas rendu : le
    // caster d'un match pas encore parti reçoit le même refus qu'un tiers.
    const visible = read.filter(({ phase, exposes }) => (forCard ? exposes : phase !== "TO_PLAN"));
    // Par la carte, son éligibilité est pourtant rejouée sur tout ce qui a été
    // lu : un caster devenu inéligible qui l'ouvre avant l'heure perd son
    // inscription à cette lecture-là, sans attendre celle d'un joueur. La
    // modale, qui interroge en boucle, n'en paie pas le coût.
    const checked = forCard ? read : visible;
    if (
      visible.length === 0 &&
      !checked.some(({ row }) => row.casters.length > 0 || row.referee_user_id !== null)
    ) {
      return [];
    }

    const { rosterTeamIds, userIds } = collectContactIds(checked);
    const rosters = await loadRosters(connection, rosterTeamIds);
    const users = await loadUsers(connection, userIds);
    // Le caster joue-t-il le match ? Pour le lecteur, ses équipes ; pour un
    // autre, les rosters et entrées solo lus pour les contacts.
    const casterPlays = (row: CandidateRow, casterId: number) =>
      (casterId === viewer.id && viewerPlaysMatch(row, teams)) ||
      ([1, 2] as const).some((index) => {
        const side = rowSide(row, index);
        if (side.soloUserId !== null) return Number(side.soloUserId) === casterId;
        return (rosters.get(Number(side.teamId)) ?? []).some((member) => Number(member.user_id) === casterId);
      });
    const kept = keepEligibleCasters(checked, users, revokedCasts, casterPlays);
    keepEligibleReferees(checked, users, revokedReferees, casterPlays);

    const result: MatchLaunchInfo[] = [];
    for (const { row, phase, early, exposes } of visible) {
      const casters = kept.get(Number(row.id)) ?? [];
      const party = viewerRole(row, viewer.id, teams, casters, referee);
      if (!party) continue;
      // À un arbitre qui caste, la modale de lancement renvoie aussi à « Contacts ».
      result.push(
        buildLaunchInfo(row, phase, { ...party, earlyContacts: early }, {
          viewer,
          users,
          rosters,
          casters,
          readiness: rowReadiness(row, casters),
          exposes,
          // Une seule décision pour les contacts du caster : sa règle, plus
          // stricte que celle du match — c'est elle, et elle seule, qui les
          // tait aux équipes avant le match (`exposes` y est déjà vrai). Quand
          // elle est vraie, `exposes` l'est aussi ; le `exposes &&` n'est
          // qu'un filet : jamais le caster sans le match.
          exposesCaster: exposes && exposesCasterContacts(phase, party.role),
        }),
      );
    }
    return result;
  });

  // Les contacts sont déjà retirés de la réponse ; l'inscription l'est ensuite,
  // sous verrou et après relecture, pour que le lancement n'attende plus le
  // « Prêt » d'un caster qui n'en est plus un. Un échec n'y change rien pour
  // ce lecteur : la prochaine lecture retentera.
  for (const cast of revokedCasts) {
    try {
      await releaseIneligibleCast(cast.matchId, cast.casterId);
    } catch (error) {
      console.error("[match-launch] retrait d'un caster non éligible impossible", error);
    }
  }
  for (const entry of revokedReferees) {
    try {
      await releaseIneligibleReferee(entry.matchId, entry.refereeId);
    } catch (error) {
      console.error("[match-launch] retrait d'un arbitre non éligible impossible", error);
    }
  }
  return launches;
}

/** Hôte du match lu par la modale : la règle même de l'instantané (`matchHostTeamId`). */
function candidateHostTeamId(row: CandidateRow): number | null {
  return matchHostTeamId(
    row.host_team_id === null ? null : Number(row.host_team_id),
    Number(row.team1_id),
    Number(row.team2_id),
    {
      team1: row.team1_seed === null ? null : Number(row.team1_seed),
      team2: row.team2_seed === null ? null : Number(row.team2_seed),
    },
  );
}
