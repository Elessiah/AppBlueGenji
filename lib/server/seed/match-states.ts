/**
 * États de match posés après la simulation d'un tournoi : reports de score en
 * cours, horaires des manches, diffusion en direct, lancement et rediffusions.
 */

import type { Pool, RowDataPacket } from "mysql2/promise";
import { SCORE_REPORT_TIMEOUT_MINUTES } from "@/lib/shared/constants";
import { normalizeStreamUrl } from "@/lib/shared/live-streams";
import { normalizeReplayUrl } from "@/lib/shared/match-replay";
import type { ReportStateCounts, TournamentDef } from "./cases";

// Transforme des matchs READY en états intermédiaires du cycle de report :
//  · pendingReports  → une seule équipe a reporté, délai en cours
//  · conflicts       → les deux équipes ont reporté des scores contradictoires
//  · expiredReports  → un report unique dont le délai est dépassé (la prochaine
//                      lecture de l'API doit le résoudre automatiquement)
export async function applyReportStates(
  db: Pool,
  tournamentId: number,
  counts: ReportStateCounts
): Promise<void> {
  const wanted =
    (counts.pendingReports ?? 0) + (counts.conflicts ?? 0) + (counts.expiredReports ?? 0);
  if (wanted === 0) return;

  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_matches
     WHERE tournament_id = ? AND status = 'READY'
       AND team1_id IS NOT NULL AND team2_id IS NOT NULL AND winner_team_id IS NULL
     ORDER BY round_number, match_number
     LIMIT 50`,
    [tournamentId]
  );

  let cursor = 0;
  const next = (): number | null => (cursor < rows.length ? Number(rows[cursor++].id) : null);

  for (let i = 0; i < (counts.conflicts ?? 0); i++) {
    const id = next();
    if (id === null) break;
    // Les deux équipes se déclarent vainqueures : conflit à arbitrer.
    await db.execute(
      `UPDATE bg_matches SET
         team1_report_score = 2, team1_report_opponent_score = 0, team1_reported_at = NOW(),
         team2_report_score = 2, team2_report_opponent_score = 1, team2_reported_at = NOW(),
         score_deadline_at = DATE_ADD(NOW(), INTERVAL ${SCORE_REPORT_TIMEOUT_MINUTES} MINUTE),
         status = 'AWAITING_CONFIRMATION'
       WHERE id = ?`,
      [id]
    );
  }

  for (let i = 0; i < (counts.expiredReports ?? 0); i++) {
    const id = next();
    if (id === null) break;
    await db.execute(
      `UPDATE bg_matches SET
         team1_report_score = 2, team1_report_opponent_score = 1, team1_reported_at = DATE_SUB(NOW(), INTERVAL 30 MINUTE),
         score_deadline_at = DATE_SUB(NOW(), INTERVAL 20 MINUTE),
         status = 'AWAITING_CONFIRMATION'
       WHERE id = ?`,
      [id]
    );
  }

  for (let i = 0; i < (counts.pendingReports ?? 0); i++) {
    const id = next();
    if (id === null) break;
    await db.execute(
      `UPDATE bg_matches SET
         team1_report_score = 2, team1_report_opponent_score = 1, team1_reported_at = NOW(),
         score_deadline_at = DATE_ADD(NOW(), INTERVAL ${SCORE_REPORT_TIMEOUT_MINUTES} MINUTE),
         status = 'AWAITING_CONFIRMATION'
       WHERE id = ?`,
      [id]
    );
  }
}

/**
 * Dates de début des manches d'un tournoi seedé
 * (`lib/shared/match-schedule.ts`).
 *
 * Un horaire par numéro de manche, décalé de `hoursPerRound` : c'est ainsi que
 * le staff programme un plateau étalé sur la journée, et cela suffit à couvrir
 * les deux côtés de la frontière (manches passées, manches à venir) dans un
 * même tournoi.
 *
 * Posé **avant** la diffusion, parce que le mode `START_TIME` en dépend.
 */
export async function applyMatchSchedule(
  db: Pool,
  tournamentId: number,
  def: TournamentDef
): Promise<void> {
  if (!def.matchSchedule) return;

  const { firstRoundHours, hoursPerRound } = def.matchSchedule;
  const base = Date.now() + firstRoundHours * 3600000;

  await db.execute(
    `UPDATE bg_matches
     SET start_at = DATE_ADD(?, INTERVAL (round_number - 1) * ? HOUR)
     WHERE tournament_id = ?`,
    [new Date(base), hoursPerRound, tournamentId]
  );
}

/**
 * Diffusion en direct d'un tournoi seedé.
 *
 * La chaîne officielle est posée sur le tournoi ; le mode de diffusion est
 * appliqué aux seules manches encore jouables (`READY`), c'est-à-dire celles
 * que la simulation n'a pas résolues. Poser un mode sur une manche déjà notée
 * ne produirait rien de visible : l'état est dérivé, et un score saisi éteint
 * le direct (`lib/shared/live-streams.ts`).
 */
export async function applyLiveStreams(
  db: Pool,
  tournamentId: number,
  def: TournamentDef
): Promise<void> {
  if (!def.live) return;

  // Normalisé comme le ferait la route de production : le jeu de test doit
  // contenir exactement ce qu'un enregistrement réel produit.
  await db.execute(`UPDATE bg_tournaments SET live_url = ? WHERE id = ?`, [
    normalizeStreamUrl(def.live.url),
    tournamentId,
  ]);

  const startedAt = def.live.trigger === "MANUAL" && def.live.onAir ? new Date() : null;
  await db.execute(
    `UPDATE bg_matches
     SET live_trigger = ?, live_url = ?, live_started_at = ?
     WHERE tournament_id = ?
       AND status = 'READY'
       AND team1_id IS NOT NULL
       AND team2_id IS NOT NULL`,
    [def.live.trigger, normalizeStreamUrl(def.live.matchUrl), startedAt, tournamentId]
  );
}

/**
 * Lancement des matchs (`lib/shared/match-launch.ts`) : sur chaque tournoi
 * casté du jeu de test, la première manche jouable reçoit le caster de test,
 * l'équipe 2 comme hôte (le cas où l'arbitrage a changé le défaut) et un
 * « Prêt » de l'équipe 1 — de quoi voir la modale avec ses trois parties, dont
 * une prête et deux attendues. Les autres manches jouables restent en
 * lancement, sans caster : le cas « deux équipes seules ». L'empreinte de
 * l'appariement est posée avec le « Prêt », sans quoi il serait lu comme celui
 * d'un autre appariement (`currentLaunchState`).
 */
export async function applyMatchLaunchCases(db: Pool, casterId: number | null): Promise<void> {
  if (casterId === null) return;
  await db.execute(
    `UPDATE bg_matches m
     JOIN (
       SELECT MIN(m2.id) AS id
       FROM bg_matches m2
       JOIN bg_tournaments t ON t.id = m2.tournament_id
       WHERE t.name LIKE 'Test - %'
         AND t.state = 'RUNNING'
         AND m2.status = 'READY'
         AND m2.team1_id IS NOT NULL AND m2.team2_id IS NOT NULL
         AND m2.live_trigger IS NOT NULL
       GROUP BY m2.tournament_id
     ) first_casted ON first_casted.id = m.id
     SET m.caster_user_id = ?, m.host_team_id = m.team2_id, m.team1_ready_at = NOW(),
         m.launch_pairing = CONCAT(m.team1_id, ':', m.team2_id)`,
    [casterId]
  );
}

/**
 * Rediffs d'un tournoi seedé (`lib/shared/match-replay.ts`).
 *
 * Une rencontre jouée sur deux (par identifiant) reçoit un lien : le même
 * plateau montre ainsi, côte à côte, des matchs terminés avec et sans bandeau
 * « Rediff disponible ». Seules les rencontres réellement disputées sont
 * visées — la même condition que la route, écrite en SQL.
 */
export async function applyMatchReplays(
  db: Pool,
  tournamentId: number,
  def: TournamentDef
): Promise<void> {
  if (!def.replays) return;
  await db.execute(
    `UPDATE bg_matches
     SET replay_url = ?
     WHERE tournament_id = ?
       AND status = 'COMPLETED'
       AND team1_id IS NOT NULL
       AND team2_id IS NOT NULL
       AND forfeit_team_id IS NULL
       AND double_forfeit = 0
       AND MOD(id, 2) = 0`,
    [normalizeReplayUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), tournamentId]
  );
}
