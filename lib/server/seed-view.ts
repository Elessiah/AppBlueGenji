import "dotenv/config";
import { getDatabase } from "./database";
import type { RowDataPacket } from "mysql2/promise";

async function viewTestData(): Promise<void> {
  console.log("📊 Test Data Overview\n");
  console.log("=".repeat(80));

  try {
    const db = await getDatabase();

    // 1. View test users
    console.log("\n👥 TEST USERS:");
    const [users] = await db.execute<(RowDataPacket & { id: number; pseudo: string })[]>(
      "SELECT id, pseudo FROM bg_users WHERE pseudo LIKE 'Test_%' ORDER BY id"
    );
    users.forEach((u) => console.log(`   ${u.id}: ${u.pseudo}`));
    console.log(`\n   Total: ${users.length} test users`);

    // 2. View test teams
    console.log("\n\n🏆 TEST TEAMS:");
    const [teams] = await db.execute<
      (RowDataPacket & {
        id: number;
        name: string;
        members_count: number;
      })[]
    >(
      `SELECT t.id, t.name, COUNT(tm.id) as members_count
       FROM bg_teams t
       LEFT JOIN bg_team_members tm ON tm.team_id = t.id AND tm.left_at IS NULL
       WHERE t.name LIKE 'Test -%'
       GROUP BY t.id, t.name
       ORDER BY t.id`
    );

    teams.forEach((t) => console.log(`   ${t.id}: ${t.name} (${t.members_count} members)`));
    console.log(`\n   Total: ${teams.length} test teams`);

    // 3. View test tournaments
    console.log("\n\n🎮 TEST TOURNAMENTS:");
    const [tournaments] = await db.execute<
      (RowDataPacket & {
        id: number;
        name: string;
        format: string;
        state: string;
        registered_count: number;
        max_teams: number;
        match_count: number;
      })[]
    >(
      `SELECT
         t.id,
         t.name,
         t.format,
         t.state,
         COUNT(DISTINCT tr.team_id) as registered_count,
         t.max_teams,
         (SELECT COUNT(*) FROM bg_matches WHERE tournament_id = t.id) as match_count
       FROM bg_tournaments t
       LEFT JOIN bg_tournament_registrations tr ON tr.tournament_id = t.id
       WHERE t.name LIKE 'Test -%'
       GROUP BY t.id, t.name, t.format, t.state, t.max_teams
       ORDER BY t.id`
    );

    if (tournaments.length === 0) {
      console.log("   No test tournaments found. Run 'npm run seed' first.");
    } else {
      tournaments.forEach((t) => {
        console.log(`   ${t.id}: ${t.name}`);
        console.log(`      Format: ${t.format} | State: ${t.state}`);
        console.log(`      Teams: ${t.registered_count}/${t.max_teams} | Matches: ${t.match_count}`);
      });
      console.log(`\n   Total: ${tournaments.length} test tournament(s)`);

      // 4. Show bracket for each tournament
      for (const tournament of tournaments) {
        console.log("\n\n📋 TOURNAMENT BRACKET STRUCTURE:");
        console.log(`   Tournament ID: ${tournament.id} - ${tournament.name}`);
        console.log(`   State: ${tournament.state} | Format: ${tournament.format} | Teams: ${tournament.registered_count}/${tournament.max_teams}`);

        // Group matches by bracket and round
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
          })[]
        >(
          `SELECT
             m.bracket,
             m.round_number,
             m.match_number,
             t1.name as team1_name,
             t2.name as team2_name,
             m.status,
             m.team1_score,
             m.team2_score
           FROM bg_matches m
           LEFT JOIN bg_teams t1 ON m.team1_id = t1.id
           LEFT JOIN bg_teams t2 ON m.team2_id = t2.id
           WHERE m.tournament_id = ?
           ORDER BY m.bracket DESC, m.round_number, m.match_number`,
          [tournament.id]
        );

        if (matches.length === 0) {
          console.log("   No matches yet");
        } else {
          let currentBracket = "";
          let currentRound = 0;

          matches.forEach((m) => {
            if (m.bracket !== currentBracket) {
              currentBracket = m.bracket;
              currentRound = 0;
              console.log(`\n   ${currentBracket} BRACKET:`);
            }
            if (m.round_number !== currentRound) {
              currentRound = m.round_number;
              console.log(`     Round ${currentRound}:`);
            }

            const team1 = m.team1_name ? m.team1_name.replace("Test - ", "") : "TBD";
            const team2 = m.team2_name ? m.team2_name.replace("Test - ", "") : "TBD";
            const score = m.team1_score !== null ? ` (${m.team1_score}-${m.team2_score})` : "";
            console.log(`       Match ${m.match_number}: ${team1} vs ${team2} [${m.status}]${score}`);
          });
        }
      }
    }

    console.log("\n" + "=".repeat(80));
    console.log("\n✅ View complete!\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

viewTestData();
