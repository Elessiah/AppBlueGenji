import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { tournamentAudience } from "@/lib/server/tournament-broadcast";
import {
  cachedLanding,
  LANDING_LEADERBOARD_KEY_PREFIX,
  LANDING_LIVE_KEY,
  LANDING_LIVE_TTL_MS,
  LANDING_TICKER_KEY,
  LANDING_TTL_MS,
} from "@/lib/server/landing-cache";
import { listTournamentBuckets } from "@/lib/server/tournaments-service";
import {
  compareByStartAt,
  frenchRoundLabel,
  inferPhaseLabel,
  landingRound,
  type LandingRound,
  isFeaturedMatchPhase,
  carouselMatchOrder,
  pickFeaturedMatchIndex,
  type LandingCalendarEvent,
  type LandingLeaderboardRow,
  type LandingLive,
  type LandingLiveMatch,
  type LandingStats,
  type LandingTickerPayload,
} from "@/lib/shared/landing";
import type {
  BracketType,
  MatchStatus,
  TournamentBuckets,
  TournamentCard,
  TournamentGame,
} from "@/lib/shared/types";
import { gameLabel } from "@/lib/shared/tournament-labels";
import { findBroadcastingTournament } from "@/lib/server/tournaments/live-streams";
import { firstStreamUrlSql } from "@/lib/server/tournaments/match-casters";
import {
  isMatchLive,
  normalizeStreamUrl,
  resolveMatchLiveState,
  type MatchLiveTrigger,
} from "@/lib/shared/live-streams";
import { loadTeamRanking } from "@/lib/server/ranking-service";
import { entrantHref } from "@/lib/shared/participants";
import { seedingSource } from "@/lib/shared/seeding";
import { loadFrozenRankingSeeds } from "@/lib/server/tournaments/frozen-seeds";
import { tournamentMatchFormat } from "@/lib/shared/bg-survie/rounds";
import { localUploadUrl } from "@/lib/shared/uploads";
import { launchPairingKey, matchLaunchPhase } from "@/lib/shared/match-launch";
import { toIso } from "@/lib/server/serialization";
import { getDiscordCommunity } from "@/lib/server/discord-community";
import { landingServerText } from "@/lib/server/i18n-landing";
import { DEFAULT_LOCALE, type Locale } from "@/lib/shared/locales";
import { parseMatchFormat } from "@/lib/shared/match-format";
import { tickerOutcomes, tickerScores, type TickerItem, type TickerOutcome } from "@/lib/shared/ticker-items";
import { withoutInvisibles } from "@/lib/shared/visible-text";

const DEFAULT_SITE_COUNTS: SiteCounts = {
  players: 0,
  teams: 0,
  tournaments: 0,
};

/** Bandeau d'un site sans actualité : trois phrases d'attente, dans la langue de la page. */
function defaultTicker(locale: Locale): LandingTickerPayload {
  const { t } = landingServerText(locale);
  return { items: [t("ticker.defaultResult"), t("ticker.defaultRegistration"), t("ticker.defaultCommunity")] };
}

type StatsRow = RowDataPacket & {
  players: number;
  teams: number;
  tournaments: number;
};

/** Compteurs de la vitrine. Mutualisés et invalidés par `landing-cache.ts`. */
export async function getLandingStats(): Promise<LandingStats> {
  return cachedLanding("stats", LANDING_TTL_MS, loadLandingStats);
}

/**
 * Les chiffres du site et ceux du Discord se chargent **côte à côte et se
 * dégradent séparément** : une base injoignable ne doit pas emporter le
 * compteur de membres, ni Discord absent remettre les compteurs du site à zéro.
 *
 * Le décompte Discord porte son propre cache (`discord-community.ts`), hors du
 * préfixe `landing:` : une écriture de tournoi invalide bien cette entrée-ci,
 * mais le rechargement qui suit resservira la valeur Discord déjà en main sans
 * refaire d'appel sortant.
 */
async function loadLandingStats(): Promise<LandingStats> {
  const [counts, discord] = await Promise.all([loadSiteCounts(), getDiscordCommunity()]);
  return { ...counts, discord };
}

type SiteCounts = Omit<LandingStats, "discord">;

/**
 * « Équipes actives » : les équipes que l'annuaire montre — ni entrée solo
 * (`solo_user_id`), ni équipe dissoute (`deleted_at`) ; une équipe fantôme y
 * figure, comme à l'annuaire (`GHOST_TEAMS.md`).
 */
async function loadSiteCounts(): Promise<SiteCounts> {
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<StatsRow[]>(`
      SELECT
        (SELECT COUNT(*) FROM bg_users) AS players,
        (SELECT COUNT(*) FROM bg_teams WHERE solo_user_id IS NULL AND deleted_at IS NULL) AS teams,
        (SELECT COUNT(*) FROM bg_tournaments WHERE start_visibility_at <= NOW()) AS tournaments
    `);
    const row = rows[0];
    return {
      players: Number(row?.players ?? 0),
      teams: Number(row?.teams ?? 0),
      tournaments: Number(row?.tournaments ?? 0),
    };
  } catch {
    return DEFAULT_SITE_COUNTS;
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
  team1_logo_url: string | null;
  team2_logo_url: string | null;
  team1_score: number | null;
  team2_score: number | null;
  team1_seed: number | null;
  team2_seed: number | null;
  manual_seeding: number | null;
  start_at: Date | string | null;
  live_trigger: MatchLiveTrigger | null;
  live_url: string | null;
  live_started_at: Date | string | null;
  launched_at: Date | string | null;
  launch_pairing: string | null;
  referee_scheduling: number | null;
  match_launch_phase: number | null;
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

/**
 * Nom saisi par un joueur, sans invisibles (`UNTRUSTED_NAMES.md`), `null`
 * quand il ne garde rien de visible : la vitrine est lue sans compte, et un nom
 * resté en base peut en porter encore (sosie refusé par `UNIQUE`). Sans NFKC :
 * le nom se lit comme sur sa fiche. Chaque appelant choisit son repli.
 */
function shownEntrantName(name: string | null): string | null {
  if (name === null) return null;
  return withoutInvisibles(name) || null;
}

/** Seed exploitable (entier positif), ou `null` — la colonne est nullable. */
function toSeed(value: number | null): number | null {
  if (value === null) return null;
  const seed = Number(value);
  return Number.isSafeInteger(seed) && seed > 0 ? seed : null;
}

/**
 * Lancement de la ligne, s'il vaut pour son appariement courant : un lancement
 * posé pour une autre paire d'engagés (arbitre revenu en arrière, seeding
 * réordonné) ne compte pas — même règle que `currentLaunchState`, que lit la
 * fiche du tournoi.
 */
function currentLaunchedAt(row: LiveMatchRow): string | null {
  return row.launch_pairing !== null && row.launch_pairing === launchPairingKey(row.team1_id, row.team2_id)
    ? toIso(row.launched_at)
    : null;
}

/** Vue « diffusion » d'une ligne de match, pour le module pur partagé. */
function toLiveInput(row: LiveMatchRow) {
  return {
    status: row.status,
    liveTrigger: row.live_trigger,
    liveStartedAt: row.live_started_at,
    startAt: row.start_at,
    launchedAt: currentLaunchedAt(row),
  };
}

function roundOf(bracket: BracketType, roundNumber: number, matchCount: number): LandingRound {
  return landingRound(bracket, roundNumber, matchCount);
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
  return cachedLanding(LANDING_LIVE_KEY, LANDING_LIVE_TTL_MS, () => loadLandingLive());
}

async function loadLandingLive(): Promise<LandingLive | null> {
  try {
    // Toujours la liste publique, jamais des paniers reçus en argument : le
    // résultat en dépendrait alors que la clé de cache ne peut pas les
    // représenter, et un appelant passant une liste filtrée recevrait
    // silencieusement le direct de quelqu'un d'autre.
    //
    // Le tournoi réellement à l'antenne prime sur le plus récent : sans cela, la
    // carte live et le bouton « Regarder le live » pourraient désigner deux
    // tournois différents quand plusieurs tournent en parallèle. Les deux
    // lectures sont indépendantes : côte à côte, le premier rendu après une
    // invalidation (et chaque visiteur qui l'attend) n'attend qu'un aller-retour.
    const [tournamentBuckets, broadcasting] = await Promise.all([
      listTournamentBuckets(null),
      findBroadcastingTournament().catch(() => null),
    ]);
    if (tournamentBuckets.running.length === 0) return null;
    const picked =
      (broadcasting
        ? tournamentBuckets.running.find((card) => card.id === broadcasting.tournamentId)
        : null) ?? tournamentBuckets.running[0];
    // Nom saisi par le staff, lu sans compte : forme affichable pour le titre
    // de la carte, le nom accessible de son lien et le bouton « Regarder le
    // live » (`UNTRUSTED_NAMES.md`).
    const tournament = { ...picked, name: withoutInvisibles(picked.name) };

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
        t1.logo_url AS team1_logo_url,
        t2.logo_url AS team2_logo_url,
        m.team1_score,
        m.team2_score,
        r1.seed AS team1_seed,
        r2.seed AS team2_seed,
        t.manual_seeding,
        m.start_at,
        m.live_trigger,
        ${firstStreamUrlSql("m")} AS live_url,
        m.live_started_at,
        m.launched_at,
        m.launch_pairing,
        t.referee_scheduling,
        t.match_launch_phase
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
       LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
       LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
       LEFT JOIN bg_tournament_registrations r1
         ON r1.tournament_id = m.tournament_id AND r1.team_id = m.team1_id
       LEFT JOIN bg_tournament_registrations r2
         ON r2.tournament_id = m.tournament_id AND r2.team_id = m.team2_id
       WHERE m.tournament_id = ?
       ORDER BY FIELD(m.bracket, 'UPPER', 'LOWER', 'GRAND', 'THIRD_PLACE') ASC,
                m.round_number ASC,
                m.match_number ASC`,
      [tournament.id],
    );

    // Un match à l'antenne est la mise en avant recherchée ; à défaut, celui qui
    // se joue, puis le prochain daté — jamais un match « À planifier », que la
    // carte présentait comme le match du moment (`pickFeaturedMatchIndex`).
    const now = Date.now();
    const phases = rows.map((row) =>
      matchLaunchPhase(
        {
          status: row.status,
          team1Id: row.team1_id,
          team2Id: row.team2_id,
          startAt: toIso(row.start_at),
          launchedAt: currentLaunchedAt(row),
          refereeScheduling: Number(row.referee_scheduling ?? 0) === 1,
          launchPhase: Number(row.match_launch_phase ?? 0) === 1,
        },
        now,
      ),
    );
    const candidates = rows.map((row, index) => ({
      onAir: isMatchLive(toLiveInput(row)),
      phase: phases[index],
      startAt: toIso(row.start_at),
    }));
    const currentIndex = pickFeaturedMatchIndex(candidates);
    // Le carrousel de la carte : tous les matchs que la mise en avant aurait pu
    // retenir, dans l'ordre chronologique, ouvert sur le match mis en avant.
    const carouselIndexes = carouselMatchOrder(candidates, currentIndex);
    // La colonne `seed` porte l'ordre d'inscription ; elle n'est le **tirage**
    // du tournoi que dans les formats qui seedent depuis elle (ou dès que le
    // staff a réordonné à la main). En Suisse, en Survie, en BG Survie et en
    // multi-phases, le moteur seede depuis le classement du site et fige ce
    // rang au coup d'envoi (`loadFrozenRankingSeeds`) : c'est lui qu'on montre,
    // comme la fiche du tournoi — rien plutôt qu'un seed inventé s'il manque.
    // `manual_seeding` est une colonne du tournoi : toutes les lignes la portent.
    const firstRow = rows[currentIndex] ?? rows[carouselIndexes[0]] ?? null;
    const frozenSeeds =
      firstRow !== null &&
      seedingSource(tournament.format, Number(firstRow.manual_seeding ?? 0) === 1) === "RANKING"
        ? await loadFrozenRankingSeeds(db, tournament.id, tournament.format)
        : null;
    const scoreOf = (value: number | null): number | null => (value === null ? null : Number(value));
    const drawSeedOf = (teamId: number | null, value: number | null): number | null => {
      if (frozenSeeds === null) return toSeed(value);
      return teamId === null ? null : (frozenSeeds.get(Number(teamId)) ?? null);
    };

    const toLandingMatch = (index: number): LandingLiveMatch => {
      const row = rows[index];
      // Un match à l'antenne se joue, quelle que soit sa phase de lancement : la
      // carte ne doit pas dire « En direct » et « Prochain match » à la fois.
      const phase = candidates[index].onAir ? "LAUNCHED" : phases[index];
      const round = roundOf(
        row.bracket,
        Number(row.round_number),
        rows.filter((other) => other.bracket === row.bracket).length,
      );
      return {
        id: Number(row.id),
        // Un nom qui ne garde rien retombe sur le libellé « Équipe 1 / 2 » de la carte.
        team1Name: shownEntrantName(row.team1_name),
        team2Name: shownEntrantName(row.team2_name),
        team1Href: entrantHrefFor(row.team1_id, row.team1_solo_user_id),
        team2Href: entrantHrefFor(row.team2_id, row.team2_solo_user_id),
        // Filtré à la sortie comme partout : la vitrine est lue sans compte,
        // et `next/image` lèverait sur une origine étrangère.
        team1LogoUrl: localUploadUrl(row.team1_logo_url),
        team2LogoUrl: localUploadUrl(row.team2_logo_url),
        team1Score: scoreOf(row.team1_score),
        team2Score: scoreOf(row.team2_score),
        team1Seed: drawSeedOf(row.team1_id, row.team1_seed),
        team2Seed: drawSeedOf(row.team2_id, row.team2_seed),
        bracket: row.bracket,
        roundLabel: frenchRoundLabel(round),
        round,
        // Le format **de cette manche** : « BlueGenji Survie » en joue deux,
        // et une demi-finale ne se joue pas au format de la qualification.
        // Même règle que la fiche du tournoi et que le garde-fou de saisie.
        matchFormat: tournamentMatchFormat(
          tournament.format,
          tournament.matchFormat,
          tournament.endurancePlayoffFormat,
          Number(row.round_number),
        ),
        liveState: resolveMatchLiveState(toLiveInput(row)),
        liveUrl: normalizeStreamUrl(row.live_url),
        launchPhase: isFeaturedMatchPhase(phase) ? phase : "LAUNCHED",
        startAt: toIso(row.start_at),
      };
    };

    const matches = carouselIndexes.map(toLandingMatch);
    const currentMatch: LandingLiveMatch | null =
      currentIndex === -1
        ? null
        : (matches.find((match) => match.id === Number(rows[currentIndex].id)) ?? toLandingMatch(currentIndex));

    return {
      tournament,
      currentMatch,
      matches,
      viewers: tournamentAudience(tournament.id),
      game: gameLabel(tournament.game),
      phase: inferPhaseLabel(currentMatch),
      stream:
        broadcasting?.tournamentId === tournament.id
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

/**
 * `game` restreint le rejeu aux tournois de ce jeu (pastilles Overwatch /
 * Marvel Rivals de `Leaderboard.tsx`) ; `undefined` (« Général ») rejoue tous
 * les jeux ensemble, comme le reste du site.
 */
export async function getLandingLeaderboard(
  limit = 8,
  game?: TournamentGame,
): Promise<LandingLeaderboardRow[]> {
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  // Une entrée **par jeu**, la liste entière, découpée à la lecture : la
  // longueur est choisie par le client (1–50), et une entrée par longueur
  // refaisait tout le rejeu pour n'en garder qu'une tranche. Les rangs et les
  // tendances ne dépendent pas de la longueur : la tranche est la même.
  const rows = await cachedLanding(`${LANDING_LEADERBOARD_KEY_PREFIX}${game ?? "all"}`, LANDING_TTL_MS, () =>
    loadLandingLeaderboard(game),
  );
  return rows.slice(0, safeLimit);
}

async function loadLandingLeaderboard(game: TournamentGame | undefined): Promise<LandingLeaderboardRow[]> {
  try {
    return await loadLeaderboardRows(game);
  } catch {
    return [];
  }
}

/**
 * Le classement tel que le leaderboard **et** la page `/classement` le
 * montrent : rang, cote, bilan et tendance sur une semaine. `limit` absent rend
 * toutes les lignes (la page complète) ; l'erreur remonte à l'appelant, qui
 * choisit comment se dégrader.
 */
export async function loadLeaderboardRows(
  game: TournamentGame | undefined,
  limit?: number,
): Promise<LandingLeaderboardRow[]> {
  // Seules les équipes classées figurent (`isRankedTeam`, filtre unique de
  // `loadTeamRanking`) : « Général » garde celles qui ont disputé au moins un
  // match compté, un onglet par jeu celles qui en ont disputé un **dans ce
  // jeu**. Les rangs se comptent donc sur cet ensemble, sans trou.
  const [currentRows, previousRows] = await Promise.all([
    loadTeamRanking({ game }),
    // Le classement d'il y a une semaine : **même chargeur**, donc la flèche
    // compare deux photos du même calcul plutôt que deux barèmes.
    loadTeamRanking({ completedMoreThanDaysAgo: TREND_WINDOW_DAYS, game }),
  ]);
  const previousRanks = new Map(previousRows.map((row, index) => [row.teamId, index + 1]));
  const shown = limit === undefined ? currentRows : currentRows.slice(0, limit);

  return shown.map((row, index) => {
    const rank = index + 1;
    const previousRank = previousRanks.get(row.teamId);
    // Absente de la photo d'il y a une semaine : elle est entrée au classement
    // depuis (une équipe sans match compté n'y figure pas) — la dire « stable »
    // serait faux.
    let trend: LandingLeaderboardRow["trend"] = previousRank === undefined ? "new" : "flat";
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
      teamId: row.teamId,
      // Lu sans compte (accueil, `/classement`) : déjà la forme affichable
      // (`loadTeamRanking`) ; vide, la vue pose son repli traduit — la ligne
      // est commune aux deux langues.
      teamName: row.teamName || null,
      logoUrl: localUploadUrl(row.logoUrl),
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      points: row.points,
      trend,
      trendValue,
    };
  });
}

function toCalendarEvent(card: TournamentCard): LandingCalendarEvent {
  return {
    tournamentId: card.id,
    name: card.name,
    startAt: card.startAt,
    registrationOpenAt: card.registrationOpenAt,
    registrationCloseAt: card.registrationCloseAt,
    game: card.game,
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
    // Contrairement à `activeTournamentCards`, le panier `running` en est
    // exclu : « Prochains événements » annonce ce qui **arrive**, et un
    // tournoi déjà lancé est daté dans le passé — il a sa carte dans le
    // tableau principal de l'accueil, pas ici.
    return [...tournamentBuckets.upcoming, ...tournamentBuckets.registration]
      .sort(compareByStartAt)
      .slice(0, safeLimit)
      .map(toCalendarEvent);
  } catch {
    return [];
  }
}

/**
 * Une entrée du bandeau, **en données** : la phrase s'écrit à la sortie, dans
 * la langue de la page (`formatTickerEntry`), si bien qu'un seul chargement mis
 * en cache sert les deux langues. Ce qui ne dépend pas de la langue — issue de
 * chaque camp, noms nettoyés (`visibleText`) — est calculé **une fois**, au
 * chargement : le rendu de l'accueil n'y revient pas.
 */
type TickerEntry = { sortAt: number } & (
  | {
      kind: "result";
      /** Nom du tournoi, invisibles retirés. */
      tournament: string;
      /** Nom affichable de chaque camp, `null` quand la ligne a disparu ou que le nom ne garde rien (repli traduit à la sortie). */
      team1: string | null;
      team1Id: number | null;
      score1: number | null;
      team2: string | null;
      team2Id: number | null;
      score2: number | null;
      /** Issue de chaque camp, lue sur le résultat enregistré (`tickerOutcomes`). */
      outcomes: readonly [TickerOutcome, TickerOutcome];
    }
  | { kind: "registration"; name: string; registered: number; max: number }
  | { kind: "winner"; name: string; winner: string | null; winnerTeamId: number | null }
  | { kind: "news"; title: string }
);

/** Issue dite au lecteur d'écran, par camp (`docs/features/TICKER_RESULTS.md`). */
const OUTCOME_SR_KEY = {
  win: "ticker.srWin",
  loss: "ticker.srLoss",
  forfeit: "ticker.srForfeit",
  none: null,
} as const satisfies Record<TickerOutcome, string | null>;

/**
 * L'entrée rédigée, ou `null` quand elle n'a rien à dire dans cette
 * langue : un titre d'actualité est saisi en français par le staff, et
 * l'accueil anglais n'en montre aucun (`docs/features/I18N.md` § Accueil).
 * Un résultat et un champion partent **en données** (camps, issue) : le
 * bandeau habille vainqueur et perdant (`TICKER_RESULTS.md`).
 */
function formatTickerEntry(entry: TickerEntry, locale: Locale): TickerItem | null {
  const { t } = landingServerText(locale);
  // Les noms arrivent déjà nettoyés (`shownEntrantName`) : le repli « Équipe #id »
  // vaut quand la ligne a disparu ou que le nom ne garde rien.
  const team = (name: string | null, id: number | null) => name ?? t("ticker.teamFallback", { id: String(id) });
  switch (entry.kind) {
    case "result": {
      const { outcomes } = entry;
      const side = (name: string | null, id: number | null, score: number | null, outcome: TickerOutcome) => {
        const key = OUTCOME_SR_KEY[outcome];
        return { name: team(name, id), score: score === null ? null : String(score), outcome, sr: key === null ? null : t(key) };
      };
      return {
        kind: "result",
        lead: t("ticker.resultLead", { tournament: entry.tournament }),
        sides: [
          side(entry.team1, entry.team1Id, entry.score1, outcomes[0]),
          side(entry.team2, entry.team2Id, entry.score2, outcomes[1]),
        ],
        // Nul : aucun camp n'a d'issue propre, la note dit qu'il n'y a pas de vainqueur.
        sr: outcomes.every((outcome) => outcome === "none") ? t("ticker.srNoWinner") : null,
      };
    }
    case "registration":
      return t("ticker.registration", { name: entry.name, registered: String(entry.registered), max: String(entry.max) });
    case "winner": {
      // Mis en valeur seulement sous un vrai nom : une ligne d'équipe disparue (ou un nom
      // qui ne garde rien) s'écrit « Équipe #id » en texte simple, sans « ✓ » de champion.
      const known = entry.winner !== null;
      const fallback = entry.winnerTeamId === null ? t("ticker.unknownChampion") : team(null, entry.winnerTeamId);
      return {
        kind: "champion",
        lead: t("ticker.winnerLead", { name: entry.name }),
        name: entry.winner ?? fallback,
        known,
      };
    }
    default:
      return locale === DEFAULT_LOCALE ? t("ticker.news", { title: entry.title }) : null;
  }
}

type MatchResultRow = RowDataPacket & {
  updated_at: Date;
  tournament_name: string;
  team1_name: string | null;
  team2_name: string | null;
  team1_score: number | null;
  team2_score: number | null;
  team1_id: number | null;
  team2_id: number | null;
  winner_team_id: number | null;
  forfeit_team_id: number | null;
  double_forfeit: number | boolean | null;
  match_format_type: "BO" | "FT" | null;
  match_format_value: number | null;
  match_format_max_maps: number | null;
  match_format_draws: number | null;
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
  winner_team_id: number | null;
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
      kind: "news" as const,
      title: row.title,
      sortAt: new Date(row.created_at).getTime(),
    }));
  } catch {
    return [];
  }
}

/** Le bandeau de l'accueil, dans la langue de la page (français par défaut). */
export async function getLandingTicker(locale: Locale = DEFAULT_LOCALE): Promise<LandingTickerPayload> {
  let entries: TickerEntry[] | null;
  try {
    entries = await cachedLanding(LANDING_TICKER_KEY, LANDING_TTL_MS, loadLandingTicker);
  } catch {
    entries = null;
  }
  const items = (entries ?? [])
    .map((entry) => formatTickerEntry(entry, locale))
    .filter((item): item is TickerItem => item !== null)
    .slice(0, 10);
  return items.length === 0 ? defaultTicker(locale) : { items };
}

async function loadLandingTicker(): Promise<TickerEntry[]> {
  try {
    const db = await getDatabase();
    const entries: TickerEntry[] = [];

    // Quatre lectures indépendantes, lancées ensemble : attendues l'une après
    // l'autre, le premier rendu après une invalidation — et, par le vol unique,
    // chaque visiteur qui l'attend — payait quatre allers-retours. Une erreur
    // de l'une emporte le bandeau comme avant (repli sur les phrases d'attente) ;
    // les actualités gardent leur propre repli.
    const [[resultRows], [registrationRows], [winnerRows], newsEntries] = await Promise.all([
      db.execute<MatchResultRow[]>(
        `SELECT
          m.updated_at,
          t.name AS tournament_name,
          t1.name AS team1_name,
          t2.name AS team2_name,
          m.team1_score,
          m.team2_score,
          m.team1_id,
          m.team2_id,
          m.winner_team_id,
          m.forfeit_team_id,
          m.double_forfeit,
          t.match_format_type,
          t.match_format_value,
          t.match_format_max_maps,
          t.match_format_draws
         FROM bg_matches m
         JOIN bg_tournaments t ON t.id = m.tournament_id
         LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
         LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
         WHERE m.status = 'COMPLETED'
           AND m.is_bye = FALSE
           AND m.team1_id IS NOT NULL
           AND m.team2_id IS NOT NULL
           AND (
             m.winner_team_id IS NOT NULL
             OR m.forfeit_team_id IS NOT NULL
             OR m.double_forfeit = TRUE
             OR (
               m.team1_score IS NOT NULL
               AND m.team2_score IS NOT NULL
               AND m.team1_score = m.team2_score
             )
           )
           AND t.start_visibility_at <= NOW()
         ORDER BY m.updated_at DESC
         LIMIT 3`,
      ),
      db.execute<RegistrationRow[]>(
        `SELECT
          t.start_at,
          t.registration_open_at,
          t.name,
          COUNT(r.id) AS registered_teams,
          t.max_teams
         FROM bg_tournaments t
         LEFT JOIN bg_tournament_registrations r ON r.tournament_id = t.id
         WHERE t.state = 'REGISTRATION'
           AND t.start_visibility_at <= NOW()
         GROUP BY t.id, t.start_at, t.registration_open_at, t.name, t.max_teams
         ORDER BY t.registration_open_at DESC`,
      ),
      db.execute<WinnerRow[]>(
        `SELECT
          t.finished_at,
          t.name,
          w.name AS winner_name,
          r.team_id AS winner_team_id
         FROM bg_tournaments t
         LEFT JOIN bg_tournament_registrations r
           ON r.tournament_id = t.id
          AND r.final_rank = 1
         LEFT JOIN bg_teams w ON w.id = r.team_id
         WHERE t.state = 'FINISHED'
           AND t.start_visibility_at <= NOW()
         ORDER BY t.finished_at DESC
         LIMIT 2`,
      ),
      loadNewsEntries(db),
    ]);

    // Un résultat oppose deux engagés : une exemption (`is_bye`) ou une case
    // restée vide n'en est pas un — le bandeau affichait « Équipe #null 0 ».
    // Il porte une issue enregistrée (vainqueur, forfait, double forfait, ou
    // nul à scores égaux, comme `playedMatchSql`) : une ligne close sans rien
    // de tout cela se lirait « A 0 — B 0 (sans vainqueur) ». Un tournoi pas
    // encore publié (`start_visibility_at`) ne montre rien, ici comme ailleurs.

    entries.push(
      ...resultRows.map((row) => {
        // Identifiants en nombres : une colonne rendue en chaîne (`bigNumberStrings`)
        // rendrait chaque résultat neutre sans erreur.
        const orNull = (value: number | null) => (value === null ? null : Number(value));
        const outcome = {
          team1Id: orNull(row.team1_id),
          team2Id: orNull(row.team2_id),
          winnerTeamId: orNull(row.winner_team_id),
          forfeitTeamId: orNull(row.forfeit_team_id),
          doubleForfeit: Boolean(Number(row.double_forfeit ?? 0)),
        };
        // Forfait au score plein du format, double forfait sans score (TICKER_RESULTS.md).
        const [score1, score2] = tickerScores({
          ...outcome,
          score1: row.team1_score,
          score2: row.team2_score,
          format: parseMatchFormat(
            row.match_format_type,
            row.match_format_value,
            row.match_format_max_maps,
            row.match_format_draws,
          ),
        });
        return {
          kind: "result" as const,
          tournament: withoutInvisibles(row.tournament_name),
          team1: shownEntrantName(row.team1_name),
          team1Id: outcome.team1Id,
          team2: shownEntrantName(row.team2_name),
          team2Id: outcome.team2Id,
          score1,
          score2,
          outcomes: tickerOutcomes(outcome),
          sortAt: new Date(row.updated_at).getTime(),
        };
      }),
    );

    entries.push(
      ...registrationRows.map((row) => ({
        kind: "registration" as const,
        name: withoutInvisibles(row.name),
        registered: Number(row.registered_teams),
        max: Number(row.max_teams),
        sortAt: new Date(row.registration_open_at).getTime(),
      })),
    );

    entries.push(
      ...winnerRows.map((row) => ({
        kind: "winner" as const,
        name: withoutInvisibles(row.name),
        winner: shownEntrantName(row.winner_name),
        winnerTeamId: row.winner_team_id === null ? null : Number(row.winner_team_id),
        sortAt: new Date(row.finished_at ?? Date.now()).getTime(),
      })),
      ...newsEntries,
    );

    entries.sort((left, right) => right.sortAt - left.sortAt);
    return entries;
  } catch {
    return [];
  }
}
