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
    await db.execute("DELETE FROM bg_matches WHERE tournament_id IN (SELECT id FROM bg_tournaments WHERE name LIKE 'Test Tournament%')");
    await db.execute("DELETE FROM bg_tournament_registrations WHERE tournament_id IN (SELECT id FROM bg_tournaments WHERE name LIKE 'Test Tournament%')");
    await db.execute("DELETE FROM bg_tournaments WHERE name LIKE 'Test Tournament%'");
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

async function createTournamentWithMatches(db: Pool, userIds: number[], teamIds: number[]): Promise<number> {
  console.log("🎮 Creating test tournament...");

  // Créer le tournoi
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const inTwoDays = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  const tournamentName = `Test Tournament ${now.getTime()}`;
  const [tournamentResult] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_tournaments
    (organizer_user_id, name, description, format, max_teams, state,
     start_visibility_at, registration_open_at, registration_close_at, start_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userIds[0],
      tournamentName,
      "A fictional tournament for testing the tournament bracket rendering",
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
  console.log(`  ✓ Created tournament: ${tournamentName} (ID: ${tournamentId})`);

  // Inscrire les équipes au tournoi
  console.log("📝 Registering teams...");
  const teamsToRegister = teamIds.slice(0, 8); // Inscrire 8 équipes

  for (let i = 0; i < teamsToRegister.length; i++) {
    try {
      await db.execute(
        `INSERT INTO bg_tournament_registrations (tournament_id, team_id, seed)
        VALUES (?, ?, ?)`,
        [tournamentId, teamsToRegister[i], i + 1]
      );
      console.log(`  ✓ Registered team ID ${teamsToRegister[i]}`);
    } catch (error) {
      console.error(`  ✗ Failed to register team:`, (error as Error).message);
    }
  }

  // Générer les matchs du tournoi double élimination
  console.log("🎯 Generating bracket matches...");
  await generateDoubleBracketMatches(db, tournamentId, teamsToRegister);

  return tournamentId;
}

async function generateDoubleBracketMatches(db: Pool, tournamentId: number, teamIds: number[]): Promise<void> {
  // Double élimination avec 8 équipes
  // Upper bracket: Round 1 (4 matches), Round 2 (2 matches), Round 3 (1 match)
  // Lower bracket: plus complexe

  const matches = generateBracketStructure(teamIds);

  for (const match of matches) {
    try {
      await db.execute<ResultSetHeader>(
        `INSERT INTO bg_matches
        (tournament_id, bracket, round_number, match_number, team1_id, team2_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [tournamentId, match.bracket, match.round, match.matchNumber, match.team1Id, match.team2Id, "PENDING"]
      );
      console.log(`  ✓ Match ${match.bracket} R${match.round}M${match.matchNumber}: Team ${match.team1Id} vs Team ${match.team2Id}`);
    } catch (error) {
      console.error(`  ✗ Failed to create match:`, (error as Error).message);
    }
  }
}

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

  // Upper bracket Round 2 - 2 matches (vainqueurs du round 1)
  matches.push(
    { bracket: "UPPER", round: 2, matchNumber: 1, team1Id: null, team2Id: null },
    { bracket: "UPPER", round: 2, matchNumber: 2, team1Id: null, team2Id: null }
  );

  // Upper bracket Round 3 - Grand final (1 match)
  matches.push(
    { bracket: "UPPER", round: 3, matchNumber: 1, team1Id: null, team2Id: null }
  );

  // Lower bracket - Simplified structure
  matches.push(
    // Lower Round 1
    { bracket: "LOWER", round: 1, matchNumber: 1, team1Id: null, team2Id: null },
    { bracket: "LOWER", round: 1, matchNumber: 2, team1Id: null, team2Id: null },
    { bracket: "LOWER", round: 1, matchNumber: 3, team1Id: null, team2Id: null },
    { bracket: "LOWER", round: 1, matchNumber: 4, team1Id: null, team2Id: null },
    // Lower Round 2
    { bracket: "LOWER", round: 2, matchNumber: 1, team1Id: null, team2Id: null },
    { bracket: "LOWER", round: 2, matchNumber: 2, team1Id: null, team2Id: null },
    // Lower Round 3
    { bracket: "LOWER", round: 3, matchNumber: 1, team1Id: null, team2Id: null }
  );

  // Grand Final
  matches.push(
    { bracket: "GRAND", round: 1, matchNumber: 1, team1Id: null, team2Id: null }
  );

  return matches;
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

    // 4. Créer le tournoi et les matchs
    const tournamentId = await createTournamentWithMatches(db, userIds, teamIds);
    console.log(`✓ Created tournament (ID: ${tournamentId})\n`);

    console.log("✅ Seed completed successfully!");
    console.log("\nTest data created:");
    console.log(`  - ${userIds.length} test users (Test_*)`);
    console.log(`  - ${teamIds.length} test teams (Test - *)`);
    console.log(`  - 1 test tournament with double elimination bracket`);
    console.log("\nYou can now test the tournament viewing functionality!");

    process.exit(0);
  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  }
}

main();
