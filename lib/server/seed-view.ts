import "dotenv/config";
import { getDatabase } from "./database";
import type { RowDataPacket } from "mysql2/promise";

/**
 * Inspection des données de test.
 *
 *   npm run seed:view            → vue d'ensemble (comptes, équipes, tournois)
 *   npm run seed:view -- 1937    → détail d'un tournoi (bracket round par round)
 *
 * Le seed génère une cinquantaine de tournois : dumper tous les brackets à
 * chaque exécution noierait l'information utile, d'où la vue d'ensemble par
 * défaut et le détail à la demande.
 */

const short = (name: string | null): string =>
  (name ?? "TBD").replace("Test - ", "").replace("Test_", "");

async function overview(db: Awaited<ReturnType<typeof getDatabase>>): Promise<void> {
  const [users] = await db.execute<(RowDataPacket & { pseudo: string; id: number; roles: string | null; is_admin: number })[]>(
    `SELECT id, pseudo, platform_roles_json AS roles, is_admin
     FROM bg_users
     WHERE pseudo LIKE 'Test\\_%' AND pseudo NOT LIKE 'Test\\_BulkUser\\_%'
     ORDER BY is_admin DESC, id`
  );

  console.log("\n👥 COMPTES DE TEST");
  for (const u of users) {
    const badges = [
      u.is_admin ? "ADMIN" : null,
      u.roles ? (Array.isArray(u.roles) ? u.roles.join("+") : String(u.roles)) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    console.log(`   #${u.id} ${short(u.pseudo)}${badges ? `  [${badges}]` : ""}`);
  }

  const [teams] = await db.execute<(RowDataPacket & { total: number; bulk: number })[]>(
    `SELECT COUNT(*) total, SUM(name LIKE 'Test - Bracket Team %') bulk
     FROM bg_teams WHERE name LIKE 'Test -%'`
  );
  console.log(
    `\n🏆 ÉQUIPES : ${teams[0].total} dont ${Number(teams[0].bulk)} de remplissage`
  );

  const [matrix] = await db.execute<(RowDataPacket & { state: string; format: string; c: number })[]>(
    `SELECT state, format, COUNT(*) c FROM bg_tournaments
     WHERE name LIKE 'Test -%' GROUP BY state, format
     ORDER BY FIELD(state,'UPCOMING','REGISTRATION','RUNNING','FINISHED'), format`
  );
  console.log("\n🎮 TOURNOIS PAR ÉTAT × FORMAT");
  for (const row of matrix) {
    console.log(`   ${row.state.padEnd(13)} ${row.format.padEnd(9)} ${row.c}`);
  }

  const [tournaments] = await db.execute<
    (RowDataPacket & {
      id: number;
      name: string;
      format: string;
      state: string;
      registered: number;
      max_teams: number;
      matches: number;
      awaiting: number;
    })[]
  >(
    `SELECT t.id, t.name, t.format, t.state, t.max_teams,
       (SELECT COUNT(*) FROM bg_tournament_registrations r WHERE r.tournament_id = t.id) registered,
       (SELECT COUNT(*) FROM bg_matches m WHERE m.tournament_id = t.id) matches,
       (SELECT COUNT(*) FROM bg_matches m WHERE m.tournament_id = t.id AND m.status = 'AWAITING_CONFIRMATION') awaiting
     FROM bg_tournaments t
     WHERE t.name LIKE 'Test -%'
     ORDER BY FIELD(t.state,'RUNNING','REGISTRATION','UPCOMING','FINISHED'), t.id`
  );

  console.log("\n📋 DÉTAIL DES TOURNOIS");
  for (const t of tournaments) {
    const flags = Number(t.awaiting) > 0 ? `  ⏳ ${t.awaiting} en attente` : "";
    console.log(
      `   #${t.id} [${t.state}/${t.format}] ${short(t.name)}` +
        ` — ${t.registered}/${t.max_teams} équipes · ${t.matches} matchs${flags}`
    );
  }

  console.log("\n💡 Détail d'un bracket : npm run seed:view -- <id>\n");
}

async function detail(
  db: Awaited<ReturnType<typeof getDatabase>>,
  tournamentId: number
): Promise<void> {
  const [rows] = await db.execute<
    (RowDataPacket & { id: number; name: string; format: string; state: string; max_teams: number })[]
  >(`SELECT id, name, format, state, max_teams FROM bg_tournaments WHERE id = ? LIMIT 1`, [
    tournamentId,
  ]);

  if (rows.length === 0) {
    console.log(`\n❌ Tournoi #${tournamentId} introuvable.\n`);
    return;
  }

  const t = rows[0];
  console.log(`\n📋 #${t.id} ${short(t.name)}`);
  console.log(`   ${t.state} · ${t.format} · max ${t.max_teams} équipes`);

  const [matches] = await db.execute<
    (RowDataPacket & {
      bracket: string;
      round_number: number;
      match_number: number;
      team1_name: string | null;
      team2_name: string | null;
      status: string;
      team1_score: number | null;
      team2_score: number | null;
      winner_name: string | null;
    })[]
  >(
    `SELECT m.bracket, m.round_number, m.match_number,
       t1.name team1_name, t2.name team2_name, w.name winner_name,
       m.status, m.team1_score, m.team2_score
     FROM bg_matches m
     LEFT JOIN bg_teams t1 ON m.team1_id = t1.id
     LEFT JOIN bg_teams t2 ON m.team2_id = t2.id
     LEFT JOIN bg_teams w ON m.winner_team_id = w.id
     WHERE m.tournament_id = ?
     ORDER BY m.bracket DESC, m.round_number, m.match_number`,
    [tournamentId]
  );

  let currentBracket = "";
  let currentRound = 0;
  for (const m of matches) {
    if (m.bracket !== currentBracket) {
      currentBracket = m.bracket;
      currentRound = 0;
      console.log(`\n   ${currentBracket}`);
    }
    if (m.round_number !== currentRound) {
      currentRound = m.round_number;
      console.log(`     Round ${currentRound}`);
    }
    const score = m.team1_score !== null ? ` (${m.team1_score}-${m.team2_score})` : "";
    const winner = m.winner_name ? ` → ${short(m.winner_name)}` : "";
    console.log(
      `       ${m.match_number}. ${short(m.team1_name)} vs ${short(m.team2_name)}` +
        ` [${m.status}]${score}${winner}`
    );
  }

  if (t.format === "SURVIVAL") {
    const [standings] = await db.execute<
      (RowDataPacket & { name: string; seed: number; wins: number; losses: number; status: string; rank: number })[]
    >(
      `SELECT tm.name, s.seed, s.wins, s.losses, s.status, s.\`rank\`
       FROM bg_survival_standings s JOIN bg_teams tm ON tm.id = s.team_id
       WHERE s.tournament_id = ? ORDER BY s.\`rank\`, s.seed`,
      [tournamentId]
    );
    console.log("\n   CLASSEMENT SURVIE");
    for (const s of standings) {
      console.log(
        `     ${String(s.rank).padStart(2)}. ${short(s.name).padEnd(24)} ` +
          `seed ${String(s.seed).padStart(2)} · ${s.wins}V-${s.losses}D · ${s.status}`
      );
    }
  }

  console.log();
}

async function main(): Promise<void> {
  console.log("📊 Données de test BlueGenji");
  console.log("=".repeat(72));

  try {
    const db = await getDatabase();
    const arg = process.argv[2];
    const tournamentId = arg ? Number(arg) : NaN;

    if (Number.isInteger(tournamentId) && tournamentId > 0) {
      await detail(db, tournamentId);
    } else {
      await overview(db);
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
