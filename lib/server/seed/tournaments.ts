/**
 * Création d'un tournoi du jeu de test : insertion, inscriptions, simulation
 * selon son format, puis états de match et visuel.
 */

import type { Pool, ResultSetHeader } from "mysql2/promise";
import { matchWinsRequired } from "@/lib/shared/match-format";
import { DEFAULT_REGISTRATION_FILTERS } from "@/lib/shared/registration-filters";
import type { SeedFormat, TournamentDef } from "./cases";
import { seedRng } from "./match-play";
import {
  applyLiveStreams,
  applyMatchReplays,
  applyMatchMapDetails,
  applyMatchSchedule,
  applyReportStates,
} from "./match-states";
import { generateMultiPhaseTournament, insertPreLaunchSeedPhases } from "./multi-phase";
import {
  generateEnduranceTournament,
  generateRealBracket,
  generateSurvivalTournament,
  generateSwissTournament,
} from "./simulation";
import { applyTournamentImage } from "./tournament-image";

/**
 * Fenêtre d'inscription d'un tournoi seedé.
 *
 * Les états sont dérivés des dates par computeTournamentState() : on les
 * calibre pour que l'état voulu soit stable après resynchronisation.
 */
function seedRegistrationWindow(
  def: TournamentDef,
  now: Date,
  startAt: Date
): { regOpenAt: Date; regCloseAt: Date } {
  if (def.state === "UPCOMING") {
    return {
      regOpenAt: new Date(startAt.getTime() - 7 * 86400000),
      regCloseAt: new Date(startAt.getTime() - 1 * 86400000),
    };
  }
  if (def.state === "REGISTRATION") {
    return {
      regOpenAt: new Date(now.getTime() - 3 * 86400000),
      regCloseAt: def.closesInHours
        ? new Date(now.getTime() + def.closesInHours * 3600000)
        : new Date(startAt.getTime() - 1 * 86400000),
    };
  }
  return {
    regOpenAt: new Date(startAt.getTime() - 14 * 86400000),
    regCloseAt: new Date(startAt.getTime() - 1 * 86400000),
  };
}

/** Paramètres de l'`INSERT` d'un tournoi seedé, dans l'ordre des colonnes. */
function seedTournamentInsertParams({
  organizerId,
  def,
  format,
  participantType,
  matchFormat,
  matchFormatDraws,
  insertState,
  regOpenAt,
  regCloseAt,
  startAt,
  finishedAt,
}: {
  organizerId: number;
  def: TournamentDef;
  format: SeedFormat;
  participantType: NonNullable<TournamentDef["participantType"]>;
  matchFormat: NonNullable<TournamentDef["matchFormat"]> | null;
  matchFormatDraws: boolean;
  insertState: TournamentDef["state"];
  regOpenAt: Date;
  regCloseAt: Date;
  startAt: Date;
  finishedAt: Date | null;
}): (string | number | Date | null)[] {
  const isSurvival = format === "SURVIVAL";
  const isSwiss = format === "SWISS";
  const isEndurance = format === "BG_SURVIE";
  const hasThirdPlace = format === "SINGLE" && Boolean(def.hasThirdPlaceMatch) ? 1 : 0;
  const survivalRoundsPerCut = isSurvival ? def.survivalRoundsPerCut ?? 2 : null;
  const survivalRoundsBeforeFirstCut = isSurvival
    ? def.survivalRoundsBeforeFirstCut ?? survivalRoundsPerCut
    : null;
  const swissTotalRounds = isSwiss ? def.swissTotalRounds ?? null : null;
  return [
    organizerId,
    `Test - ${def.name}`,
    def.game,
    def.description === undefined
      ? `Tournoi test ${def.game} — ${def.state} — ${format}`
      : def.description,
    format,
    participantType,
    hasThirdPlace,
    survivalRoundsBeforeFirstCut,
    survivalRoundsPerCut,
    swissTotalRounds,
    isEndurance ? def.endurancePoints ?? null : null,
    isEndurance ? def.endurancePlayoffSize ?? null : null,
    isEndurance ? def.enduranceMaxRounds ?? null : null,
    matchFormat?.type ?? null,
    matchFormat?.value ?? null,
    matchFormatDraws ? 1 : 0,
    isEndurance ? def.endurancePlayoffFormat?.type ?? null : null,
    isEndurance ? def.endurancePlayoffFormat?.value ?? null : null,
    // Absentes du cas = les défauts partagés, ceux-là mêmes que la migration a
    // posés sur les tournois d'avant : un cas qui ne dit rien couvre donc le
    // comportement courant.
    def.registrationDiscordRequirement ?? DEFAULT_REGISTRATION_FILTERS.discordRequirement,
    def.registrationBlizzardRequirement ?? DEFAULT_REGISTRATION_FILTERS.blizzardRequirement,
    def.registrationMinPlayers ?? DEFAULT_REGISTRATION_FILTERS.minPlayers,
    def.refereeScheduling === true ? 1 : 0,
    def.maxTeams,
    insertState,
    regOpenAt,
    regOpenAt,
    regCloseAt,
    startAt,
    finishedAt,
  ];
}

/**
 * Simule le déroulement d'un tournoi lancé par l'orchestration de son format,
 * puis date sa clôture (terminé) ou pose les états intermédiaires de report
 * (en cours).
 */
async function simulateSeedTournament(
  db: Pool,
  tournamentId: number,
  def: TournamentDef,
  {
    format,
    finish,
    winsRequired,
    matchFormatDraws,
    startAt,
  }: {
    format: SeedFormat;
    finish: boolean;
    winsRequired: number;
    matchFormatDraws: boolean;
    startAt: Date;
  }
): Promise<void> {
  if (format === "MULTI" && def.phases) {
    await generateMultiPhaseTournament(db, tournamentId, def.phases, finish, def.playWaves ?? 2, winsRequired);
  } else if (format === "BG_SURVIE") {
    await generateEnduranceTournament(db, tournamentId, finish, def.playWaves ?? 3, def.forfeits ?? 0, winsRequired, matchFormatDraws);
  } else if (format === "SURVIVAL") {
    await generateSurvivalTournament(db, tournamentId, finish, def.playWaves ?? 3, def.forfeits ?? 0, winsRequired);
  } else if (format === "SWISS") {
    await generateSwissTournament(db, tournamentId, finish, def.playWaves ?? 2, winsRequired);
  } else {
    await generateRealBracket(db, tournamentId, format as "SINGLE" | "DOUBLE", def.playWaves ?? 2, finish, winsRequired);
  }

  if (finish) {
    // Backdate la clôture (l'orchestration pose finished_at = NOW()) pour un
    // historique cohérent (leaderboard / ticker / palmarès).
    await db.execute(
      `UPDATE bg_tournaments SET state = 'FINISHED', finished_at = ? WHERE id = ?`,
      [startAt, tournamentId]
    );
  } else {
    await applyReportStates(db, tournamentId, def);
  }
}

export async function createTournament(
  db: Pool,
  organizerId: number,
  teamIds: number[],
  soloEntryIds: number[],
  def: TournamentDef,
  index: number
): Promise<number> {
  seedRng(0x5eed0000 + index * 7919);

  const now = new Date();
  const startAt = new Date(now.getTime() + def.daysOffset * 86400000);
  const format = def.format ?? "DOUBLE";
  const isSurvival = format === "SURVIVAL";
  const isSwiss = format === "SWISS";
  const isMulti = format === "MULTI";
  const isEndurance = format === "BG_SURVIE";
  // Tournoi individuel : les engagés sont les entrées solo des joueurs, pas
  // les équipes.
  const participantType = def.participantType ?? "TEAM";
  const entrantPool = participantType === "SOLO" ? soloEntryIds : teamIds;

  const { regOpenAt, regCloseAt } = seedRegistrationWindow(def, now, startAt);

  // Survie, suisse et multi sont pilotés par leur orchestration (initialize → reconcile)
  // : on insère en RUNNING, puis l'orchestration bascule vers FINISHED.
  const orchestrated = isSurvival || isSwiss || isMulti || isEndurance;
  const insertState = orchestrated && def.state === "FINISHED" ? "RUNNING" : def.state;
  const finishedAt = !orchestrated && def.state === "FINISHED" ? startAt : null;

  // Format de match du tournoi (BO5, FT3…) : il pilote aussi les scores simulés,
  // pour que le jeu de test reste cohérent avec ce que l'interface autorise.
  const matchFormat = def.matchFormat ?? null;
  const winsRequired = matchFormat ? matchWinsRequired(matchFormat) : 2;
  // Les égalités n'ont de sens qu'en BG Survie, et pas sans format de match :
  // c'est lui qui borne la rencontre. Même règle que `validateTournamentInput`.
  const matchFormatDraws = isEndurance && matchFormat !== null && def.matchFormatDraws === true;

  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_tournaments
     (organizer_user_id, name, game, description, format, participant_type, has_third_place_match,
      survival_rounds_before_first_cut, survival_rounds_per_cut, swiss_total_rounds,
      endurance_start_points, endurance_playoff_size, endurance_max_rounds,
      match_format_type, match_format_value, match_format_draws,
      endurance_playoff_format_type, endurance_playoff_format_value,
      registration_discord_requirement, registration_blizzard_requirement, registration_min_players,
      referee_scheduling,
      max_teams, state, start_visibility_at, registration_open_at, registration_close_at, start_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    seedTournamentInsertParams({
      organizerId,
      def,
      format,
      participantType,
      matchFormat,
      matchFormatDraws,
      insertState,
      regOpenAt,
      regCloseAt,
      startAt,
      finishedAt,
    })
  );
  const tournamentId = result.insertId as number;

  // Inscriptions — la tranche d'équipes varie d'un tournoi à l'autre pour que
  // les mêmes équipes ne finissent pas systématiquement au même rang.
  const offset = (def.teamOffset ?? 0) % Math.max(entrantPool.length, 1);
  const pool = [...entrantPool.slice(offset), ...entrantPool.slice(0, offset)];
  const teamsToUse = pool.slice(0, Math.min(def.teamCount, pool.length));
  for (let i = 0; i < teamsToUse.length; i++) {
    await db.execute(
      `INSERT INTO bg_tournament_registrations (tournament_id, team_id, seed, final_rank) VALUES (?, ?, ?, NULL)`,
      [tournamentId, teamsToUse[i], i + 1]
    );
  }

  const finish = def.state === "FINISHED";

  // Les phases d'un tournoi multi-mode sont écrites dès sa création par
  // `createTournament` : un tournoi encore en inscriptions en a donc déjà.
  // Sans cela, le cas seedé serait le seul de la base à ne pas en avoir, et
  // l'aperçu du plateau n'aurait rien à prévisualiser.
  if (isMulti && def.phases && (def.state === "UPCOMING" || def.state === "REGISTRATION")) {
    await insertPreLaunchSeedPhases(db, tournamentId, def.phases);
  }

  if (def.state !== "UPCOMING" && def.state !== "REGISTRATION" && teamsToUse.length >= 2) {
    await simulateSeedTournament(db, tournamentId, def, {
      format,
      finish,
      winsRequired,
      matchFormatDraws,
      startAt,
    });
  }

  await applyMatchSchedule(db, tournamentId, def);
  await applyLiveStreams(db, tournamentId, def);
  await applyMatchReplays(db, tournamentId, def);
  await applyMatchMapDetails(db, tournamentId, def);
  await applyTournamentImage(db, tournamentId, def);

  const gameLabel = def.game === "OW" ? "Overwatch" : "Marvel Rivals";
  console.log(
    `  ✓ #${tournamentId} [${def.state}/${format}] ${gameLabel} · ${def.name} (${teamsToUse.length}/${def.maxTeams})`
  );
  return tournamentId;
}
