import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { planningEntryKey, type AvailabilityStatus, type PlanningRole } from "@/lib/shared/planning";
import { writeAssignment } from "@/lib/server/planning/auto-assign";
import { placeOnMatch } from "@/lib/server/planning/cast-placement";
import { BOOTSTRAP_SETTING } from "@/lib/server/planning/new-entries";
import { SEED_TOURNAMENT_PREFIX } from "./cases";

/**
 * Planning des casts et arbitres (`docs/features/CAST_PLANNING.md`) : des
 * réponses de disponibilité, des préférences, un caster autonome et une
 * attribution posée à la main, sur les deux tournois « Planning » du jeu de
 * test. Le calcul n'est pas lancé : c'est le geste à exercer depuis la page.
 */
type Answer = { pseudo: string; role: PlanningRole; status: AvailabilityStatus; preferred?: boolean };

/** Réponses d'un match (selon son rang dans le plateau) : variées pour que le calcul ait des choix à faire. */
function matchAnswers(index: number): Answer[] {
  const answers: Answer[] = [
    { pseudo: "Arbitre", role: "REFEREE", status: index % 3 === 2 ? "UNAVAILABLE" : "AVAILABLE", preferred: index === 0 },
    { pseudo: "Arbitre2", role: "REFEREE", status: "AVAILABLE", preferred: index === 1 },
    { pseudo: "Caster", role: "CASTER", status: index % 2 === 0 ? "AVAILABLE" : "PENDING", preferred: index === 0 },
    { pseudo: "CasterAutonome", role: "CASTER", status: "AVAILABLE", preferred: index === 2 },
    { pseudo: "Prod", role: "PROD", status: "AVAILABLE", preferred: index === 0 },
    { pseudo: "Prod2", role: "PROD", status: index % 2 === 1 ? "AVAILABLE" : "UNAVAILABLE" },
  ];
  // Plusieurs casquettes : disponible comme caster ou comme prod, une seule tenue par créneau.
  if (index % 2 === 0) {
    answers.push(
      { pseudo: "CasterProd", role: "CASTER", status: "AVAILABLE" },
      { pseudo: "CasterProd", role: "PROD", status: "AVAILABLE", preferred: true },
    );
  }
  return answers;
}

/** Réponses de la soirée sans planification : un pool d'arbitres, un caster, un prod. */
const EVENT_ANSWERS: Answer[] = [
  { pseudo: "Arbitre", role: "REFEREE", status: "AVAILABLE", preferred: true },
  { pseudo: "Arbitre2", role: "REFEREE", status: "AVAILABLE" },
  { pseudo: "Caster", role: "CASTER", status: "AVAILABLE" },
  { pseudo: "CasterProd", role: "PROD", status: "AVAILABLE" },
  { pseudo: "Prod", role: "PROD", status: "PENDING" },
];

type Entry = { key: string; tournamentId: number; matchId: number | null };

async function tournamentId(db: Pool, name: string): Promise<number | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM bg_tournaments WHERE name = ? LIMIT 1", [name]);
  return rows.length > 0 ? Number(rows[0].id) : null;
}

async function writeAnswers(db: Pool, entry: Entry, answers: Answer[], ids: Map<string, number>): Promise<number> {
  let written = 0;
  for (const answer of answers) {
    const userId = ids.get(answer.pseudo);
    if (userId === undefined) continue;
    await db.execute(
      `INSERT INTO bg_planning_availability (entry_key, user_id, role, tournament_id, match_id, status, preferred)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [entry.key, userId, answer.role, entry.tournamentId, entry.matchId, answer.status, answer.preferred ? 1 : 0],
    );
    written += 1;
  }
  return written;
}

/** Un choix du staff, confirmé et verrouillé (le calcul le garde tel quel), et son évènement : l'écriture même du site. */
async function writeManual(db: Pool, entry: Entry, userId: number, role: PlanningRole, admin: number | null): Promise<void> {
  await writeAssignment(db, entry, { userId, role, source: "MANUAL", reason: "MANUAL" }, admin);
}

/**
 * Pose sur le match les casters et la prod que le planning y tient
 * (`CAST_PLANNING.md` § Placement sur le match) : la transaction même du site,
 * sans ses annonces (pas de journal Discord ni d'avis depuis le seed).
 */
async function placeSeedCast(db: Pool, entry: Entry, casterIds: number[], prodIds: number[]): Promise<boolean> {
  if (entry.matchId === null) return false;
  const matchId = entry.matchId;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const outcome = await placeOnMatch(connection, matchId, entry, casterIds, prodIds);
    await connection.commit();
    return "placement" in outcome;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Un caster inscrit de lui-même sur le match, sans ligne au planning : le cast est tenu, le planning n'y touche pas. */
async function seedSelfSignedCaster(db: Pool, matchId: number, userId: number): Promise<void> {
  const [stream] = await db.execute<ResultSetHeader>("INSERT INTO bg_match_streams (match_id, live_url) VALUES (?, NULL)", [matchId]);
  await db.execute("INSERT INTO bg_match_casters (match_id, user_id, stream_id) VALUES (?, ?, ?)", [matchId, userId, stream.insertId]);
}

export async function applyPlanningCases(db: Pool, ids: Map<string, number>): Promise<void> {
  console.log("🗓️ Planning des casts et arbitres...");
  // Le seed vient de vider le planning (cascade des tournois Test_) : sans
  // marqueur, le balayage suivant note tout le planning régénéré déjà annoncé
  // au lieu d'en écrire un récapitulatif géant (`new-entries.ts`).
  await db.execute("DELETE FROM bg_settings WHERE setting_key = ?", [BOOTSTRAP_SETTING]);
  const scheduledId = await tournamentId(db, `${SEED_TOURNAMENT_PREFIX}Planning Casts (sur deux semaines)`);
  const eventId = await tournamentId(db, `${SEED_TOURNAMENT_PREFIX}Planning Soirée (sans planification)`);
  if (scheduledId === null || eventId === null) {
    console.log("  ✗ tournois « Planning » introuvables");
    return;
  }
  const [matches] = await db.query<RowDataPacket[]>(
    `SELECT id FROM bg_matches
      WHERE tournament_id = ? AND is_bye = 0 AND start_at IS NOT NULL
      ORDER BY start_at, id`,
    [scheduledId],
  );
  let answers = 0;
  const entries: Entry[] = matches.map((row) => ({
    key: planningEntryKey("MATCH", Number(row.id)),
    tournamentId: scheduledId,
    matchId: Number(row.id),
  }));
  for (const [index, entry] of entries.entries()) answers += await writeAnswers(db, entry, matchAnswers(index), ids);
  const event: Entry = { key: planningEntryKey("TOURNAMENT", eventId), tournamentId: eventId, matchId: null };
  answers += await writeAnswers(db, event, EVENT_ANSWERS, ids);

  const solo = ids.get("CasterAutonome");
  if (solo !== undefined) {
    await db.execute("INSERT INTO bg_planning_profiles (user_id, solo_caster) VALUES (?, 1)", [solo]);
  }

  // Un choix du staff, verrouillé : le calcul le garde tel quel.
  const admin = ids.get("Admin") ?? null;
  const caster = ids.get("Caster");
  const first = entries[0];
  let manual = 0;
  let placed = false;
  if (first && caster !== undefined) {
    await writeManual(db, first, caster, "CASTER", admin);
    manual += 1;
  }
  // Deux casters et un prod (plafond `PLANNING_MAX_CASTERS`) sur le dernier match, seul à son heure : le
  // plafond se voit (plus de liste « Ajouter — Caster »), et le désistement d'un des deux garde l'autre.
  const last = entries.length > 4 ? entries.at(-1) : undefined;
  const pair = ["Caster", "CasterProd"].map((pseudo) => ids.get(pseudo));
  const prod = ids.get("Prod");
  if (last && prod !== undefined && pair.every((id) => id !== undefined)) {
    for (const id of pair as number[]) await writeManual(db, last, id, "CASTER", admin);
    await writeManual(db, last, prod, "PROD", admin);
    manual += 3;
    // Personne n'y caste : ces choix du staff y sont posés, comme sur le site.
    placed = await placeSeedCast(db, last, pair as number[], [prod]);
  }
  // Deuxième match : un caster inscrit de lui-même (invité, hors planning) — une
  // confirmation du planning ne doit rien y ajouter ni remplacer.
  const guest = ids.get("CasterInvite");
  const second = entries[1];
  if (second && second.matchId !== null && guest !== undefined) await seedSelfSignedCaster(db, second.matchId, guest);
  console.log(
    `  ✓ ${entries.length} matchs planifiés + 1 soirée · ${answers} réponses · 1 caster autonome · ${manual} attributions manuelles` +
      ` · cast du dernier match ${placed ? "posé" : "non posé"}`,
  );
}
