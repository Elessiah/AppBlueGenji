import "dotenv/config";
import type { Pool, ResultSetHeader } from "mysql2/promise";
import { getDatabase } from "./database";

// Données fictives
const FICTIONAL_PLAYERS = [
  { pseudo: "ShadowNinja", battletag: "ShadowNinja#1234", marvelTag: "ShadowNinja#2023" },
  { pseudo: "PhoenixRising", battletag: "PhoenixRising#5678", marvelTag: "PhoenixRising#2023" },
  { pseudo: "ThunderStrike", battletag: "ThunderStrike#9012", marvelTag: "ThunderStrike#2023" },
  { pseudo: "FrostByte", battletag: "FrostByte#3456", marvelTag: "FrostByte#2023" },
  { pseudo: "InfernoFlare", battletag: "InfernoFlare#7890", marvelTag: "InfernoFlare#2023" },
  { pseudo: "VoidWalker", battletag: "VoidWalker#2345", marvelTag: "VoidWalker#2023" },
  { pseudo: "EchoMaster", battletag: "EchoMaster#6789", marvelTag: "EchoMaster#2023" },
  { pseudo: "LunaGhost", battletag: "LunaGhost#0123", marvelTag: "LunaGhost#2023" },
  { pseudo: "SolarFlash", battletag: "SolarFlash#4567", marvelTag: "SolarFlash#2023" },
  { pseudo: "NeonViper", battletag: "NeonViper#8901", marvelTag: "NeonViper#2023" },
  { pseudo: "CrimsonBlade", battletag: "CrimsonBlade#2345", marvelTag: "CrimsonBlade#2023" },
  { pseudo: "SilverWing", battletag: "SilverWing#6789", marvelTag: "SilverWing#2023" },
  { pseudo: "IceQueen", battletag: "IceQueen#0123", marvelTag: "IceQueen#2023" },
  { pseudo: "InfernoKnight", battletag: "InfernoKnight#4567", marvelTag: "InfernoKnight#2023" },
  { pseudo: "StormChaser", battletag: "StormChaser#8901", marvelTag: "StormChaser#2023" },
  { pseudo: "ObsidianGhost", battletag: "ObsidianGhost#2345", marvelTag: "ObsidianGhost#2023" },
];

const FICTIONAL_TEAMS = [
  { name: "Dragon Squad", members: [0, 1, 2] },
  { name: "Phoenix Force", members: [3, 4, 5] },
  { name: "Thunder Legion", members: [6, 7, 8] },
  { name: "Frost Alliance", members: [9, 10, 11] },
  { name: "Eclipse Titans", members: [12, 13, 14] },
  { name: "Shadow Masters", members: [0, 5, 10] },
  { name: "Stellar Nexus", members: [2, 7, 12] },
  { name: "Cosmic Void", members: [1, 8, 15] },
];

async function clearDatabase(db: Pool): Promise<void> {
  console.log("🧹 Clearing existing test data...");
  try {
    await db.execute("SET FOREIGN_KEY_CHECKS=0");

    // Supprimer les données dans l'ordre inverse des dépendances
    await db.execute(
      "DELETE FROM bg_matches WHERE tournament_id IN (SELECT id FROM bg_tournaments WHERE name LIKE 'Test -%')"
    );
    await db.execute(
      "DELETE FROM bg_tournament_registrations WHERE tournament_id IN (SELECT id FROM bg_tournaments WHERE name LIKE 'Test -%')"
    );
    await db.execute("DELETE FROM bg_tournaments WHERE name LIKE 'Test -%'");
    await db.execute("DELETE FROM bg_team_members WHERE team_id IN (SELECT id FROM bg_teams WHERE name LIKE 'Test -%')");
    await db.execute("DELETE FROM bg_teams WHERE name LIKE 'Test -%'");
    await db.execute("DELETE FROM bg_users WHERE pseudo LIKE 'Test_%'");

    await db.execute("SET FOREIGN_KEY_CHECKS=1");
    console.log("✓ Database cleared");
  } catch (error) {
    console.error("Error clearing database:", error);
  }
}

async function createUsers(db: Pool): Promise<number[]> {
  console.log("👥 Creating test users...");
  const userIds: number[] = [];

  for (const player of FICTIONAL_PLAYERS) {
    const pseudo = `Test_${player.pseudo}`;
    try {
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO bg_users
        (pseudo, overwatch_battletag, marvel_rivals_tag, visible_avatar, visible_pseudo, visible_overwatch, visible_marvel, is_adult)
        VALUES (?, ?, ?, 1, 1, 1, 1, 1)`,
        [pseudo, player.battletag, player.marvelTag]
      );
      userIds.push(result.insertId as number);
      console.log(`  ✓ Created user: ${pseudo}`);
    } catch (error) {
      console.error(`  ✗ Failed to create user ${pseudo}:`, (error as Error).message);
    }
  }

  return userIds;
}

async function createTeams(db: Pool, userIds: number[]): Promise<number[]> {
  console.log("🏆 Creating test teams...");
  const teamIds: number[] = [];

  for (const team of FICTIONAL_TEAMS) {
    const teamName = `Test - ${team.name}`;
    try {
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO bg_teams (name, logo_url) VALUES (?, NULL)`,
        [teamName]
      );
      const teamId = result.insertId as number;
      teamIds.push(teamId);

      // Ajouter les membres à l'équipe
      for (const memberIndex of team.members) {
        if (memberIndex < userIds.length) {
          const userId = userIds[memberIndex];
          const isOwner = team.members[0] === memberIndex;
          const roles = isOwner ? '["OWNER"]' : '["MEMBER"]';

          await db.execute(
            `INSERT INTO bg_team_members (team_id, user_id, roles_json, joined_at)
            VALUES (?, ?, ?, NOW())`,
            [teamId, userId, roles]
          );
        }
      }

      console.log(`  ✓ Created team: ${teamName} with ${team.members.length} members`);
    } catch (error) {
      console.error(`  ✗ Failed to create team ${teamName}:`, (error as Error).message);
    }
  }

  return teamIds;
}

// ========================
// TOURNAMENT CREATION FUNCTIONS
// ========================

async function createRegistrationTournament(
  db: Pool,
  userIds: number[],
  teamIds: number[],
  now: Date
): Promise<number> {
  console.log("  📋 Tournament 1: REGISTRATION (Open for signup)");

  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const inTwoDays = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  const tournamentName = `Test - Registration Phase ${now.getTime()}`;
  const [tournamentResult] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_tournaments
    (organizer_user_id, name, description, format, max_teams, state,
     start_visibility_at, registration_open_at, registration_close_at, start_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userIds[0],
      tournamentName,
      "Tournament in registration phase - teams can sign up now",
      "DOUBLE",
      8,
      "REGISTRATION",
      now,
      now,
      inTwoDays,
      nextWeek,
    ]
  );

  const tournamentId = tournamentResult.insertId as number;

  // Register only 5 teams to show both registered and available spots
  const teamsToRegister = teamIds.slice(0, 5);
  for (let i = 0; i < teamsToRegister.length; i++) {
    await db.execute(
      `INSERT INTO bg_tournament_registrations (tournament_id, team_id, seed)
      VALUES (?, ?, ?)`,
      [tournamentId, teamsToRegister[i], i + 1]
    );
  }

  console.log(`    ✓ Created: ${tournamentName}`);
  console.log(`      Status: REGISTRATION | Teams: 5/8 registered\n`);

  return tournamentId;
}

async function createRunningTournament(
  db: Pool,
  userIds: number[],
  teamIds: number[],
  now: Date
): Promise<number> {
  console.log("  🎮 Tournament 2: RUNNING (Active with completed matches)");

  const pastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const tournamentName = `Test - Active Tournament ${now.getTime()}`;
  const [tournamentResult] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_tournaments
    (organizer_user_id, name, description, format, max_teams, state,
     start_visibility_at, registration_open_at, registration_close_at, start_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userIds[0],
      tournamentName,
      "Tournament currently running with matches in progress",
      "DOUBLE",
      8,
      "RUNNING",
      pastWeek,
      pastWeek,
      yesterday,
      yesterday,
    ]
  );

  const tournamentId = tournamentResult.insertId as number;

  // Register all 8 teams
  const teamsToRegister = teamIds.slice(0, 8);
  for (let i = 0; i < teamsToRegister.length; i++) {
    await db.execute(
      `INSERT INTO bg_tournament_registrations (tournament_id, team_id, seed)
      VALUES (?, ?, ?)`,
      [tournamentId, teamsToRegister[i], i + 1]
    );
  }

  // Generate bracket with some completed matches
  await generateRunningBracketMatches(db, tournamentId, teamsToRegister);

  console.log(`    ✓ Created: ${tournamentName}`);
  console.log(`      Status: RUNNING | Teams: 8/8 | Some matches completed\n`);

  return tournamentId;
}

async function createJustStartedTournament(
  db: Pool,
  userIds: number[],
  teamIds: number[],
  now: Date
): Promise<number> {
  console.log("  🚀 Tournament 3: RUNNING (Just started, no matches yet)");

  const pastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const tournamentName = `Test - Just Started ${now.getTime()}`;
  const [tournamentResult] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_tournaments
    (organizer_user_id, name, description, format, max_teams, state,
     start_visibility_at, registration_open_at, registration_close_at, start_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userIds[0],
      tournamentName,
      "Tournament just started - matches haven't begun yet",
      "SINGLE",
      8,
      "RUNNING",
      pastWeek,
      pastWeek,
      yesterday,
      now, // Started just now
    ]
  );

  const tournamentId = tournamentResult.insertId as number;

  // Register all 8 teams
  const teamsToRegister = teamIds.slice(0, 8);
  for (let i = 0; i < teamsToRegister.length; i++) {
    await db.execute(
      `INSERT INTO bg_tournament_registrations (tournament_id, team_id, seed)
      VALUES (?, ?, ?)`,
      [tournamentId, teamsToRegister[i], i + 1]
    );
  }

  // Generate bracket structure but all PENDING
  await generatePendingBracketMatches(db, tournamentId, teamsToRegister);

  console.log(`    ✓ Created: ${tournamentName}`);
  console.log(`      Status: RUNNING | Teams: 8/8 | All matches pending\n`);

  return tournamentId;
}

async function createFinishedTournament(
  db: Pool,
  userIds: number[],
  teamIds: number[],
  now: Date
): Promise<number> {
  console.log("  ✅ Tournament 4: FINISHED (Completed tournament)");

  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

  const tournamentName = `Test - Finished Tournament ${now.getTime()}`;
  const [tournamentResult] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_tournaments
    (organizer_user_id, name, description, format, max_teams, state, finished_at,
     start_visibility_at, registration_open_at, registration_close_at, start_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userIds[0],
      tournamentName,
      "Tournament has finished - final results available",
      "DOUBLE",
      8,
      "FINISHED",
      threeDaysAgo,
      twoWeeksAgo,
      twoWeeksAgo,
      oneWeekAgo,
      oneWeekAgo,
    ]
  );

  const tournamentId = tournamentResult.insertId as number;

  // Register all 8 teams with final rankings
  const teamsToRegister = teamIds.slice(0, 8);
  for (let i = 0; i < teamsToRegister.length; i++) {
    await db.execute(
      `INSERT INTO bg_tournament_registrations (tournament_id, team_id, seed, final_rank)
      VALUES (?, ?, ?, ?)`,
      [tournamentId, teamsToRegister[i], i + 1, i + 1] // Simple ranking by seed
    );
  }

  // Generate fully completed bracket
  await generateFinishedBracketMatches(db, tournamentId, teamsToRegister);

  console.log(`    ✓ Created: ${tournamentName}`);
  console.log(`      Status: FINISHED | Teams: 8/8 | All matches completed\n`);

  return tournamentId;
}

// ========================
// BRACKET GENERATION FUNCTIONS
// ========================

interface BracketMatch {
  bracket: "UPPER" | "LOWER" | "GRAND";
  round: number;
  matchNumber: number;
  team1Id: number | null;
  team2Id: number | null;
}

function generateBracketStructure(teamIds: number[]): BracketMatch[] {
  const matches: BracketMatch[] = [];

  // Upper bracket Round 1 - 4 matches
  matches.push(
    { bracket: "UPPER", round: 1, matchNumber: 1, team1Id: teamIds[0], team2Id: teamIds[1] },
    { bracket: "UPPER", round: 1, matchNumber: 2, team1Id: teamIds[2], team2Id: teamIds[3] },
    { bracket: "UPPER", round: 1, matchNumber: 3, team1Id: teamIds[4], team2Id: teamIds[5] },
    { bracket: "UPPER", round: 1, matchNumber: 4, team1Id: teamIds[6], team2Id: teamIds[7] }
  );

  // Upper bracket Round 2 - 2 matches
  matches.push(
    { bracket: "UPPER", round: 2, matchNumber: 1, team1Id: null, team2Id: null },
    { bracket: "UPPER", round: 2, matchNumber: 2, team1Id: null, team2Id: null }
  );

  // Upper bracket Round 3 - Final
  matches.push({ bracket: "UPPER", round: 3, matchNumber: 1, team1Id: null, team2Id: null });

  // Lower bracket - 7 matches
  matches.push(
    { bracket: "LOWER", round: 1, matchNumber: 1, team1Id: null, team2Id: null },
    { bracket: "LOWER", round: 1, matchNumber: 2, team1Id: null, team2Id: null },
    { bracket: "LOWER", round: 1, matchNumber: 3, team1Id: null, team2Id: null },
    { bracket: "LOWER", round: 1, matchNumber: 4, team1Id: null, team2Id: null },
    { bracket: "LOWER", round: 2, matchNumber: 1, team1Id: null, team2Id: null },
    { bracket: "LOWER", round: 2, matchNumber: 2, team1Id: null, team2Id: null },
    { bracket: "LOWER", round: 3, matchNumber: 1, team1Id: null, team2Id: null }
  );

  // Grand Final
  matches.push({ bracket: "GRAND", round: 1, matchNumber: 1, team1Id: null, team2Id: null });

  return matches;
}

async function generatePendingBracketMatches(db: Pool, tournamentId: number, teamIds: number[]): Promise<void> {
  const matches = generateBracketStructure(teamIds);

  for (const match of matches) {
    await db.execute<ResultSetHeader>(
      `INSERT INTO bg_matches
      (tournament_id, bracket, round_number, match_number, team1_id, team2_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tournamentId, match.bracket, match.round, match.matchNumber, match.team1Id, match.team2Id, "PENDING"]
    );
  }
}

async function generateRunningBracketMatches(db: Pool, tournamentId: number, teamIds: number[]): Promise<void> {
  // Upper bracket round 1 with completed matches
  const upperRound1Matches = [
    { bracket: "UPPER", round: 1, matchNumber: 1, team1Id: teamIds[0], team2Id: teamIds[1], status: "COMPLETED" },
    { bracket: "UPPER", round: 1, matchNumber: 2, team1Id: teamIds[2], team2Id: teamIds[3], status: "COMPLETED" },
    { bracket: "UPPER", round: 1, matchNumber: 3, team1Id: teamIds[4], team2Id: teamIds[5], status: "READY" },
    { bracket: "UPPER", round: 1, matchNumber: 4, team1Id: teamIds[6], team2Id: teamIds[7], status: "PENDING" },
  ];

  for (const match of upperRound1Matches) {
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO bg_matches
      (tournament_id, bracket, round_number, match_number, team1_id, team2_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tournamentId, match.bracket, match.round, match.matchNumber, match.team1Id, match.team2Id, match.status]
    );
    const matchId = result.insertId as number;

    // Add scores for completed matches
    if (match.status === "COMPLETED") {
      const winner = match.matchNumber === 1 ? match.team1Id : match.team2Id;
      const loser = match.matchNumber === 1 ? match.team2Id : match.team1Id;
      await db.execute(
        `UPDATE bg_matches SET
        team1_score = ?, team2_score = ?, winner_team_id = ?, loser_team_id = ?
        WHERE id = ?`,
        [2, 1, winner, loser, matchId]
      );
    }
  }

  // Upper bracket round 2 - one match with teams from round 1
  await db.execute<ResultSetHeader>(
    `INSERT INTO bg_matches
    (tournament_id, bracket, round_number, match_number, team1_id, team2_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tournamentId, "UPPER", 2, 1, teamIds[0], teamIds[2], "READY"]
  );

  // Upper bracket round 2 match 2
  await db.execute<ResultSetHeader>(
    `INSERT INTO bg_matches
    (tournament_id, bracket, round_number, match_number, team1_id, team2_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tournamentId, "UPPER", 2, 2, null, null, "PENDING"]
  );

  // Upper bracket round 3
  await db.execute<ResultSetHeader>(
    `INSERT INTO bg_matches
    (tournament_id, bracket, round_number, match_number, team1_id, team2_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tournamentId, "UPPER", 3, 1, null, null, "PENDING"]
  );

  // Lower bracket matches
  for (let i = 1; i <= 4; i++) {
    await db.execute<ResultSetHeader>(
      `INSERT INTO bg_matches
      (tournament_id, bracket, round_number, match_number, team1_id, team2_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tournamentId, "LOWER", 1, i, null, null, "PENDING"]
    );
  }

  for (let i = 1; i <= 2; i++) {
    await db.execute<ResultSetHeader>(
      `INSERT INTO bg_matches
      (tournament_id, bracket, round_number, match_number, team1_id, team2_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tournamentId, "LOWER", 2, i, null, null, "PENDING"]
    );
  }

  await db.execute<ResultSetHeader>(
    `INSERT INTO bg_matches
    (tournament_id, bracket, round_number, match_number, team1_id, team2_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tournamentId, "LOWER", 3, 1, null, null, "PENDING"]
  );

  // Grand final
  await db.execute<ResultSetHeader>(
    `INSERT INTO bg_matches
    (tournament_id, bracket, round_number, match_number, team1_id, team2_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tournamentId, "GRAND", 1, 1, null, null, "PENDING"]
  );
}

async function generateFinishedBracketMatches(db: Pool, tournamentId: number, teamIds: number[]): Promise<void> {
  // All matches completed with results
  const finishedMatches = [
    // Upper round 1
    { bracket: "UPPER", round: 1, m: 1, t1: teamIds[0], t2: teamIds[1], w: teamIds[0] },
    { bracket: "UPPER", round: 1, m: 2, t1: teamIds[2], t2: teamIds[3], w: teamIds[2] },
    { bracket: "UPPER", round: 1, m: 3, t1: teamIds[4], t2: teamIds[5], w: teamIds[4] },
    { bracket: "UPPER", round: 1, m: 4, t1: teamIds[6], t2: teamIds[7], w: teamIds[6] },
    // Upper round 2
    { bracket: "UPPER", round: 2, m: 1, t1: teamIds[0], t2: teamIds[2], w: teamIds[0] },
    { bracket: "UPPER", round: 2, m: 2, t1: teamIds[4], t2: teamIds[6], w: teamIds[4] },
    // Upper round 3
    { bracket: "UPPER", round: 3, m: 1, t1: teamIds[0], t2: teamIds[4], w: teamIds[0] },
    // Lower bracket (simplified - just TBD for losers)
    { bracket: "LOWER", round: 1, m: 1, t1: teamIds[1], t2: teamIds[3], w: teamIds[1] },
    { bracket: "LOWER", round: 1, m: 2, t1: teamIds[5], t2: teamIds[7], w: teamIds[5] },
    { bracket: "LOWER", round: 1, m: 3, t1: null, t2: null, w: null },
    { bracket: "LOWER", round: 1, m: 4, t1: null, t2: null, w: null },
    { bracket: "LOWER", round: 2, m: 1, t1: teamIds[1], t2: teamIds[5], w: teamIds[1] },
    { bracket: "LOWER", round: 2, m: 2, t1: null, t2: null, w: null },
    { bracket: "LOWER", round: 3, m: 1, t1: null, t2: null, w: null },
    // Grand final
    { bracket: "GRAND", round: 1, m: 1, t1: teamIds[0], t2: teamIds[1], w: teamIds[0] },
  ];

  for (const match of finishedMatches) {
    const status = match.w ? "COMPLETED" : "PENDING";
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO bg_matches
      (tournament_id, bracket, round_number, match_number, team1_id, team2_id, status, team1_score, team2_score, winner_team_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tournamentId,
        match.bracket,
        match.round,
        match.m,
        match.t1,
        match.t2,
        status,
        match.w ? 2 : null,
        match.w ? 1 : null,
        match.w,
      ]
    );

    if (match.w) {
      const loser = match.t1 === match.w ? match.t2 : match.t1;
      await db.execute(`UPDATE bg_matches SET loser_team_id = ? WHERE id = ?`, [loser, result.insertId]);
    }
  }
}

async function main(): Promise<void> {
  console.log("🚀 Starting database seed...\n");

  try {
    const db = await getDatabase();

    // 1. Nettoyer les données existantes
    await clearDatabase(db);

    // 2. Créer les utilisateurs
    const userIds = await createUsers(db);
    console.log(`✓ Created ${userIds.length} users\n`);

    // 3. Créer les équipes
    const teamIds = await createTeams(db, userIds);
    console.log(`✓ Created ${teamIds.length} teams\n`);

    // 4. Créer les 4 tournois à différents stades
    console.log("🎮 Creating multiple tournaments...\n");
    const now = new Date();

    const tournamentIds = [];
    tournamentIds.push(await createRegistrationTournament(db, userIds, teamIds, now));
    tournamentIds.push(await createRunningTournament(db, userIds, teamIds, now));
    tournamentIds.push(await createJustStartedTournament(db, userIds, teamIds, now));
    tournamentIds.push(await createFinishedTournament(db, userIds, teamIds, now));

    console.log("✅ Seed completed successfully!");
    console.log("\nTest data created:");
    console.log(`  - ${userIds.length} test users (Test_*)`);
    console.log(`  - ${teamIds.length} test teams (Test - *)`);
    console.log(`  - 4 test tournaments with different states:`);
    console.log(`    1. REGISTRATION - Open for team signup (5/8 teams)`);
    console.log(`    2. RUNNING - Active tournament with matches in progress`);
    console.log(`    3. RUNNING - Tournament just started (no matches yet)`);
    console.log(`    4. FINISHED - Completed tournament with final results`);
    console.log("\nYou can now test all tournament states and bracket rendering!");

    process.exit(0);
  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  }
}

main();
