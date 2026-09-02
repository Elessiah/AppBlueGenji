import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { tournamentAudience } from "@/lib/server/tournament-broadcast";
import {
  cachedLanding,
  LANDING_LIVE_TTL_MS,
  LANDING_TTL_MS,
} from "@/lib/server/landing-cache";
import { listTournamentBuckets } from "@/lib/server/tournaments-service";
import {
  inferGameLabel,
  inferPhaseLabel,
  type LandingCalendarEvent,
  type LandingLeaderboardRow,
  type LandingLive,
  type LandingLiveMatch,
  type LandingStats,
  type LandingTickerPayload,
} from "@/lib/shared/landing";
import type { BracketType, MatchStatus, TournamentBuckets, TournamentCard } from "@/lib/shared/types";
import { findBroadcastingTournament } from "@/lib/server/tournaments/live-streams";
import {
  isMatchLive,
  normalizeStreamUrl,
  resolveMatchLiveState,
  type MatchLiveTrigger,
} from "@/lib/shared/live-streams";
import { loadTeamRanking } from "@/lib/server/stats-service";
import { entrantHref } from "@/lib/shared/participants";

const DEFAULT_STATS: LandingStats = {
  players: 0,
  teams: 0,
  tournaments: 0,
};

const DEFAULT_TICKER: LandingTickerPayload = {
  items: [
    "RÉSULTAT · En attente de nouveaux matches",
    "INSCRIPTIONS · Prochains brackets à venir",
    "COMMUNAUTÉ · Rejoindre le Discord BlueGenji",
  ],
};

type StatsRow = RowDataPacket & {
  players: number;
  teams: number;
  tournaments: number;
};

/** Compteurs de la vitrine. Mutualisés et invalidés par `landing-cache.ts`. */
export async function getLandingStats(): Promise<LandingStats> {
  return cachedLanding("stats", LANDING_TTL_MS, loadLandingStats);
}

async function loadLandingStats(): Promise<LandingStats> {
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<StatsRow[]>(`
      SELECT
        (SELECT COUNT(*) FROM bg_users) AS players,
        (SELECT COUNT(*) FROM bg_teams WHERE solo_user_id IS NULL) AS teams,
        (SELECT COUNT(*) FROM bg_tournaments) AS tournaments
    `);
    const row = rows[0];
    return {
      players: Number(row?.players ?? 0),
      teams: Number(row?.teams ?? 0),
      tournaments: Number(row?.tournaments ?? 0),
    };
  } catch {
    return DEFAULT_STATS;
  }
}

type LiveMatchRow = RowDataPacket & {
  id: number;
  bracket: BracketType;
  round_number: number;
  match_number: number;
  status: MatchStatus;
  team1_id: number | null;
  team2_id: number | null;
  team1_name: string | null;
  team2_name: string | null;
  team1_solo_user_id: number | null;
  team2_solo_user_id: number | null;
  team1_score: number | null;
  team2_score: number | null;
  start_at: Date | string | null;
  live_trigger: MatchLiveTrigger | null;
  live_url: string | null;
  live_started_at: Date | string | null;
};

/**
 * Fiche de l'engagé d'une des deux places d'un match.
 *
 * Passe par `entrantHref` plutôt que de recomposer le chemin : c'est la même
 * règle que sur la page de tournoi, une entrée solo menant au profil du joueur
 * et non à une fiche d'équipe qui n'existe pas.
 */
function entrantHrefFor(teamId: number | null, soloUserId: number | null): string | null {
  if (teamId === null) return null;
  return entrantHref(Number(teamId), soloUserId === null ? null : { [Number(teamId)]: Number(soloUserId) });
}

/** Vue « diffusion » d'une ligne de match, pour le module pur partagé. */
function toLiveInput(row: LiveMatchRow) {
  return {
    status: row.status,
    liveTrigger: row.live_trigger,
    liveStartedAt: row.live_started_at,
    startAt: row.start_at,
  };
}

function roundLabelFor(bracket: BracketType, roundNumber: number, matchCount: number): string {
  if ((bracket === "UPPER" || bracket === "GRAND") && matchCount === 1) {
    return "Finale";
  }
  if (matchCount === 2) return "Demi-finale";
  if (matchCount === 4) return "Quarts de finale";
  return `Round ${roundNumber}`;
}

/**
 * Direct de la vitrine : le tournoi en cours et son match du moment.
 *
 * Sans argument, il part de la liste publique — mutualisée elle aussi. On ne
 * prend volontairement plus de paniers en entrée : le résultat en dépendrait
 * alors que la clé de cache, elle, ne peut pas les représenter, et un appelant
 * passant une liste filtrée recevrait silencieusement le direct de quelqu'un
 * d'autre. Les appelants qui ont déjà la liste publique sous la main n'y
 * perdent rien : `listTournamentBuckets` la leur resert depuis le cache.
 */
export async function getLandingLive(): Promise<LandingLive | null> {
  return cachedLanding("live", LANDING_LIVE_TTL_MS, () => loadLandingLive());
}

async function loadLandingLive(): Promise<LandingLive | null> {
  try {
    // Toujours la liste publique, jamais des paniers reçus en argument : le
    // résultat en dépendrait alors que la clé de cache ne peut pas les
    // représenter, et un appelant passant une liste filtrée recevrait
    // silencieusement le direct de quelqu'un d'autre.
    const tournamentBuckets = await listTournamentBuckets(null);
    if (tournamentBuckets.running.length === 0) return null;

    // Le tournoi réellement à l'antenne prime sur le plus récent : sans cela, la
    // carte live et le bouton « Regarder le live » pourraient désigner deux
    // tournois différents quand plusieurs tournent en parallèle.
    const broadcasting = await findBroadcastingTournament().catch(() => null);
    const tournament =
      (broadcasting
        ? tournamentBuckets.running.find((card) => card.id === broadcasting.tournamentId)
        : null) ?? tournamentBuckets.running[0];

    const db = await getDatabase();
    const [rows] = await db.execute<LiveMatchRow[]>(
      `SELECT
        m.id,
        m.bracket,
        m.round_number,
        m.match_number,
        m.status,
        m.team1_id,
        m.team2_id,
        t1.name AS team1_name,
        t2.name AS team2_name,
        t1.solo_user_id AS team1_solo_user_id,
        t2.solo_user_id AS team2_solo_user_id,
        m.team1_score,
        m.team2_score,
        m.start_at,
        m.live_trigger,
        m.live_url,
        m.live_started_at
       FROM bg_matches m
       LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
       LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
       WHERE m.tournament_id = ?
       ORDER BY FIELD(m.bracket, 'UPPER', 'LOWER', 'GRAND', 'THIRD_PLACE') ASC,
                m.round_number ASC,
                m.match_number ASC`,
      [tournament.id],
    );

    // Un match à l'antenne est la mise en avant recherchée ; à défaut on retombe
    // sur le premier match jouable ou en attente de confirmation.
    const currentRow =
      rows.find((row) => isMatchLive(toLiveInput(row))) ??
      rows.find((row) => row.status === "READY" || row.status === "AWAITING_CONFIRMATION") ??
      null;
    const currentMatch: LandingLiveMatch | null = currentRow
      ? {
          id: Number(currentRow.id),
          team1Name: currentRow.team1_name,
          team2Name: currentRow.team2_name,
          team1Href: entrantHrefFor(currentRow.team1_id, currentRow.team1_solo_user_id),
          team2Href: entrantHrefFor(currentRow.team2_id, currentRow.team2_solo_user_id),
          team1Score: currentRow.team1_score === null ? null : Number(currentRow.team1_score),
          team2Score: currentRow.team2_score === null ? null : Number(currentRow.team2_score),
          bracket: currentRow.bracket,
          roundLabel: roundLabelFor(
            currentRow.bracket,
            Number(currentRow.round_number),
            rows.filter((row) => row.bracket === currentRow.bracket).length,
          ),
          liveState: resolveMatchLiveState(toLiveInput(currentRow)),
          liveUrl: normalizeStreamUrl(currentRow.live_url),
        }
      : null;

    return {
      tournament,
      currentMatch,
      viewers: tournamentAudience(tournament.id),
      game: inferGameLabel(tournament.name),
      phase: inferPhaseLabel(currentMatch),
      stream:
        broadcasting && broadcasting.tournamentId === tournament.id
          ? {
              tournamentId: tournament.id,
              tournamentName: tournament.name,
              url: broadcasting.url,
            }
          : null,
    };
  } catch {
    return null;
  }
}

/**
 * Recul de la photo de référence servant la tendance, en **jours** : la borne
 * est posée par MySQL (`DATE_SUB(NOW(), …)`), les dates de match étant écrites
 * par la base — une seule horloge, donc pas de fenêtre décalée par l'écart de
 * fuseau entre l'app et la base.
 */
const TREND_WINDOW_DAYS = 7;

export async function getLandingLeaderboard(limit = 8): Promise<LandingLeaderboardRow[]> {
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  return cachedLanding(`leaderboard:${safeLimit}`, LANDING_TTL_MS, () =>
    loadLandingLeaderboard(safeLimit),
  );
}

async function loadLandingLeaderboard(safeLimit: number): Promise<LandingLeaderboardRow[]> {
  try {
    const [currentRows, previousRows] = await Promise.all([
      loadTeamRanking({ includeUnplayed: true }),
      // Le classement d'il y a une semaine : **même chargeur**, donc la flèche
      // compare deux photos du même calcul plutôt que deux barèmes.
      loadTeamRanking({ includeUnplayed: true, completedMoreThanDaysAgo: TREND_WINDOW_DAYS }),
    ]);
    const previousRanks = new Map(previousRows.map((row, index) => [row.teamId, index + 1]));

    return currentRows.slice(0, safeLimit).map((row, index) => {
      const rank = index + 1;
      const teamId = row.teamId;
      const points = row.points;
      const previousRank = previousRanks.get(teamId);
      let trend: "up" | "down" | "flat" = "flat";
      let trendValue = 0;
      if (previousRank !== undefined) {
        const delta = previousRank - rank;
        if (delta > 0) {
          trend = "up";
          trendValue = delta;
        } else if (delta < 0) {
          trend = "down";
          trendValue = Math.abs(delta);
        }
      }
      return {
        rank,
        teamId,
        teamName: row.teamName,
        logoUrl: row.logoUrl,
        wins: row.wins,
        losses: row.losses,
        points,
        trend,
        trendValue,
      };
    });
  } catch {
    return [];
  }
}

function toCalendarEvent(card: TournamentCard): LandingCalendarEvent {
  return {
    tournamentId: card.id,
    name: card.name,
    startAt: card.startAt,
    registrationOpenAt: card.registrationOpenAt,
    registrationCloseAt: card.registrationCloseAt,
    state: card.state,
    maxTeams: card.maxTeams,
    registeredTeams: card.registeredTeams,
  };
}

export async function getLandingCalendar(bucketsOrLimit?: TournamentBuckets | number, limitParam?: number): Promise<LandingCalendarEvent[]> {
  let buckets: TournamentBuckets | undefined;
  let limit = limitParam ?? 5;

  // Handle overload: if first param is a number, it's the old API (limit only)
  if (typeof bucketsOrLimit === "number") {
    limit = bucketsOrLimit;
  } else if (bucketsOrLimit) {
    buckets = bucketsOrLimit;
    if (limitParam !== undefined) {
      limit = limitParam;
    }
  }

  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  try {
    const tournamentBuckets = buckets ?? await listTournamentBuckets(null);
    return [...tournamentBuckets.upcoming, ...tournamentBuckets.registration, ...tournamentBuckets.running]
      .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime())
      .slice(0, safeLimit)
      .map(toCalendarEvent);
  } catch {
    return [];
  }
}

type TickerEntry = { text: string; sortAt: number };

type MatchResultRow = RowDataPacket & {
  updated_at: Date;
  tournament_name: string;
  team1_name: string | null;
  team2_name: string | null;
  team1_score: number | null;
  team2_score: number | null;
  team1_id: number | null;
  team2_id: number | null;
};

type RegistrationRow = RowDataPacket & {
  start_at: Date;
  registration_open_at: Date;
  name: string;
  registered_teams: number;
  max_teams: number;
};

type WinnerRow = RowDataPacket & {
  finished_at: Date | null;
  name: string;
  winner_name: string | null;
};

async function loadNewsEntries(db: Awaited<ReturnType<typeof getDatabase>>): Promise<TickerEntry[]> {
  try {
    const [rows] = await db.execute<
      (RowDataPacket & { title: string; created_at: Date })[]
    >(
      `SELECT title, created_at
       FROM bg_news
       ORDER BY created_at DESC
       LIMIT 3`,
    );
    return rows.map((row) => ({
      text: `NEWS · ${row.title}`,
      sortAt: new Date(row.created_at).getTime(),
    }));
  } catch {
    return [];
  }
}

export async function getLandingTicker(): Promise<LandingTickerPayload> {
  return cachedLanding("ticker", LANDING_TTL_MS, loadLandingTicker);
}

async function loadLandingTicker(): Promise<LandingTickerPayload> {
  try {
    const db = await getDatabase();
    const entries: TickerEntry[] = [];

    const [resultRows] = await db.execute<MatchResultRow[]>(
      `SELECT
        m.updated_at,
        t.name AS tournament_name,
        t1.name AS team1_name,
        t2.name AS team2_name,
        m.team1_score,
        m.team2_score,
        m.team1_id,
        m.team2_id
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
       LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
       LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
       WHERE m.status = 'COMPLETED'
       ORDER BY m.updated_at DESC
       LIMIT 3`,
    );

    entries.push(
      ...resultRows.map((row) => ({
        text: `RÉSULTAT · ${row.tournament_name} · ${row.team1_name ?? `Equipe #${row.team1_id}`} ${Number(row.team1_score ?? 0)} — ${row.team2_name ?? `Equipe #${row.team2_id}`} ${Number(row.team2_score ?? 0)}`,
        sortAt: new Date(row.updated_at).getTime(),
      })),
    );

    const [registrationRows] = await db.execute<RegistrationRow[]>(
      `SELECT
        t.start_at,
        t.registration_open_at,
        t.name,
        COUNT(r.id) AS registered_teams,
        t.max_teams
       FROM bg_tournaments t
       LEFT JOIN bg_tournament_registrations r ON r.tournament_id = t.id
       WHERE t.state = 'REGISTRATION'
       GROUP BY t.id, t.start_at, t.registration_open_at, t.name, t.max_teams
       ORDER BY t.registration_open_at DESC`,
    );

    entries.push(
      ...registrationRows.map((row) => ({
        text: `INSCRIPTIONS · ${row.name} · ${Number(row.registered_teams)}/${Number(row.max_teams)} équipes`,
        sortAt: new Date(row.registration_open_at).getTime(),
      })),
    );

    const [winnerRows] = await db.execute<WinnerRow[]>(
      `SELECT
        t.finished_at,
        t.name,
        COALESCE(w.name, CONCAT('Equipe #', r.team_id)) AS winner_name
       FROM bg_tournaments t
       LEFT JOIN bg_tournament_registrations r
         ON r.tournament_id = t.id
        AND r.final_rank = 1
       LEFT JOIN bg_teams w ON w.id = r.team_id
       WHERE t.state = 'FINISHED'
       ORDER BY t.finished_at DESC
       LIMIT 2`,
    );

    entries.push(
      ...winnerRows.map((row) => ({
        text: `VAINQUEUR · ${row.name} · ${row.winner_name ?? "Champion inconnu"}`,
        sortAt: new Date(row.finished_at ?? Date.now()).getTime(),
      })),
    );

    entries.push(...(await loadNewsEntries(db)));

    const items = entries
      .sort((left, right) => right.sortAt - left.sortAt)
      .slice(0, 10)
      .map((entry) => entry.text);

    if (items.length === 0) return DEFAULT_TICKER;
    return { items };
  } catch {
    return DEFAULT_TICKER;
  }
}
