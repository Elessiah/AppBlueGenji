import "dotenv/config";
import type { Pool, ResultSetHeader } from "mysql2/promise";
import { getDatabase } from "./database";

// Données fictives - 32+ joueurs et 32+ équipes
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
  { pseudo: "IceBreaker", battletag: "IceBreaker#1111", marvelTag: "IceBreaker#2023" },
  { pseudo: "VortexMaster", battletag: "VortexMaster#2222", marvelTag: "VortexMaster#2023" },
  { pseudo: "BlazeFury", battletag: "BlazeFury#3333", marvelTag: "BlazeFury#2023" },
  { pseudo: "NovaStrike", battletag: "NovaStrike#4444", marvelTag: "NovaStrike#2023" },
  { pseudo: "SilentAssassin", battletag: "SilentAssassin#5555", marvelTag: "SilentAssassin#2023" },
  { pseudo: "GhostRecon", battletag: "GhostRecon#6666", marvelTag: "GhostRecon#2023" },
  { pseudo: "IcePalace", battletag: "IcePalace#7777", marvelTag: "IcePalace#2023" },
  { pseudo: "InfernoWrath", battletag: "InfernoWrath#8888", marvelTag: "InfernoWrath#2023" },
  { pseudo: "LightningBolt", battletag: "LightningBolt#9999", marvelTag: "LightningBolt#2023" },
  { pseudo: "ShadowShift", battletag: "ShadowShift#0000", marvelTag: "ShadowShift#2023" },
  { pseudo: "VenomStrike", battletag: "VenomStrike#1010", marvelTag: "VenomStrike#2023" },
  { pseudo: "CrimsonDawn", battletag: "CrimsonDawn#2020", marvelTag: "CrimsonDawn#2023" },
  { pseudo: "SilverMoon", battletag: "SilverMoon#3030", marvelTag: "SilverMoon#2023" },
  { pseudo: "DarkVortex", battletag: "DarkVortex#4040", marvelTag: "DarkVortex#2023" },
  { pseudo: "SolarEclipse", battletag: "SolarEclipse#5050", marvelTag: "SolarEclipse#2023" },
  { pseudo: "StormSeeker", battletag: "StormSeeker#6060", marvelTag: "StormSeeker#2023" },
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
  { name: "Inferno Squad", members: [16, 17, 18] },
  { name: "Vortex Crew", members: [19, 20, 21] },
  { name: "Blaze Titans", members: [22, 23, 24] },
  { name: "Nova Warriors", members: [25, 26, 27] },
  { name: "Silent Hunters", members: [28, 29, 30] },
  { name: "Ghost Division", members: [3, 16, 19] },
  { name: "Ice Dynasty", members: [9, 22, 25] },
  { name: "Fire Legends", members: [17, 23, 28] },
  { name: "Storm Riders", members: [6, 20, 29] },
  { name: "Shadow Alliance", members: [0, 12, 26] },
  { name: "Void Reapers", members: [1, 13, 30] },
  { name: "Stellar Guard", members: [2, 14, 24] },
  { name: "Cosmic Kings", members: [4, 18, 27] },
  { name: "Thunder Gods", members: [7, 11, 31] },
  { name: "Frost Wolves", members: [10, 21, 31] },
  { name: "Eclipse Sons", members: [15, 25, 31] },
  { name: "Phoenix Knights", members: [5, 8, 31] },
  { name: "Dragon Slayers", members: [11, 19, 31] },
  { name: "Titan Force", members: [20, 24, 31] },
  { name: "Void Masters", members: [3, 10, 21] },
  { name: "Star Legends", members: [4, 22, 29] },
  { name: "Dark Angels", members: [6, 16, 30] },
  { name: "Light Bringers", members: [8, 26, 27] },
  { name: "Chaos Warlords", members: [9, 17, 28] },
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
// TOURNAMENT CREATION
// ========================

async function createTournamentWithState(
  db: Pool,
  userIds: number[],
  teamsToRegister: number[],
  now: Date,
  state: "REGISTRATION" | "RUNNING" | "FINISHED",
  description: string
): Promise<number> {
  const teamCount = teamsToRegister.length;
  const daysAgo = state === "FINISHED" ? 7 : state === "RUNNING" ? 1 : 0;
  const pastDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  const futureDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const tournamentName = `Test - ${description} ${now.getTime()}`;
  const format = teamCount <= 8 ? "DOUBLE" : teamCount <= 16 ? "DOUBLE" : "SINGLE";
  const maxTeams = teamCount <= 4 ? 4 : teamCount <= 8 ? 8 : teamCount <= 16 ? 16 : 32;

  console.log(`  📊 Tournament: ${description} (${teamCount} teams)`);

  const finishedAt = state === "FINISHED" ? pastDate : null;
  const regCloseAt = state === "REGISTRATION" ? futureDate : pastDate;

  const [tournamentResult] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_tournaments
    (organizer_user_id, name, description, format, max_teams, state, finished_at,
     start_visibility_at, registration_open_at, registration_close_at, start_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userIds[0],
      tournamentName,
      `Tournament with ${teamCount} teams`,
      format,
      maxTeams,
      state,
      finishedAt,
      pastDate,
      pastDate,
      regCloseAt,
      pastDate,
    ]
  );

  const tournamentId = tournamentResult.insertId as number;

  // Register teams
  for (let i = 0; i < teamsToRegister.length; i++) {
    await db.execute(
      `INSERT INTO bg_tournament_registrations (tournament_id, team_id, seed, final_rank)
      VALUES (?, ?, ?, ?)`,
      [
        tournamentId,
        teamsToRegister[i],
        i + 1,
        state === "FINISHED" ? i + 1 : null,
      ]
    );
  }

  // Generate matches based on state
  if (state === "REGISTRATION") {
    // No matches for registration
    console.log(`    ✓ Created with ${teamsToRegister.length}/${maxTeams} teams registered`);
  } else if (state === "RUNNING") {
    // Generate matches - some with progress
    await generateVariableBracket(db, tournamentId, teamsToRegister, "RUNNING");
    console.log(`    ✓ Created with bracket (matches in progress)`);
  } else if (state === "FINISHED") {
    // Generate fully completed bracket
    await generateVariableBracket(db, tournamentId, teamsToRegister, "FINISHED");
    console.log(`    ✓ Created with complete bracket (all matches finished)`);
  }

  console.log(`    ID: ${tournamentId}\n`);
  return tournamentId;
}

async function generateVariableBracket(
  db: Pool,
  tournamentId: number,
  teamIds: number[],
  state: "RUNNING" | "FINISHED"
): Promise<void> {
  const teamCount = teamIds.length;

  // Calculate next power of 2 for bracket size
  let bracketSize = 1;
  while (bracketSize < teamCount) {
    bracketSize *= 2;
  }

  // Calculate BYEs (teams that skip first round)
  const byeCount = bracketSize - teamCount;
  const playingInRound1 = teamCount - byeCount;
  const firstRoundMatches = playingInRound1 / 2;

  console.log(`    Bracket Size: ${bracketSize} | Teams: ${teamCount} | BYEs: ${byeCount} | R1 Matches: ${firstRoundMatches}`);

  // Calculate total rounds needed
  const rounds = Math.ceil(Math.log2(bracketSize));

  // First round - only teams without BYE play
  for (let i = 0; i < firstRoundMatches; i++) {
    const team1Id = teamIds[i * 2];
    const team2Id = teamIds[i * 2 + 1];

    const status = state === "FINISHED" ? "COMPLETED" : "PENDING";
    const score1 = status === "COMPLETED" ? 2 : null;
    const score2 = status === "COMPLETED" ? 1 : null;
    const winner = status === "COMPLETED" ? team1Id : null;

    await db.execute<ResultSetHeader>(
      `INSERT INTO bg_matches
      (tournament_id, bracket, round_number, match_number, team1_id, team2_id, status, team1_score, team2_score, winner_team_id, loser_team_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tournamentId,
        "UPPER",
        1,
        i + 1,
        team1Id,
        team2Id,
        status,
        score1,
        score2,
        winner,
        status === "COMPLETED" ? team2Id : null,
      ]
    );
  }

  // Rounds 2+ with BYEs resolved
  // Round 2 will have: winners from R1 matches + teams with BYE
  const teamsInRound2 = firstRoundMatches + byeCount; // Winners + BYE teams
  let currentRoundTeams = teamsInRound2;

  for (let round = 2; round <= rounds; round++) {
    const matchesInRound = Math.ceil(currentRoundTeams / 2);

    for (let i = 0; i < matchesInRound; i++) {
      const status = state === "FINISHED" ? "COMPLETED" : "PENDING";
      const score1 = status === "COMPLETED" ? 2 : null;
      const score2 = status === "COMPLETED" ? 1 : null;

      await db.execute<ResultSetHeader>(
        `INSERT INTO bg_matches
        (tournament_id, bracket, round_number, match_number, team1_id, team2_id, status, team1_score, team2_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tournamentId, "UPPER", round, i + 1, null, null, status, score1, score2]
      );
    }
    currentRoundTeams = matchesInRound;
  }

  // Lower bracket matches (simplified - just empty structure)
  currentRoundTeams = firstRoundMatches;
  for (let round = 1; round <= rounds; round++) {
    const matchesInRound = Math.ceil(currentRoundTeams / 2);

    for (let i = 0; i < matchesInRound; i++) {
      const status = state === "FINISHED" ? "COMPLETED" : "PENDING";
      const score1 = status === "COMPLETED" ? 2 : null;
      const score2 = status === "COMPLETED" ? 1 : null;

      await db.execute<ResultSetHeader>(
        `INSERT INTO bg_matches
        (tournament_id, bracket, round_number, match_number, team1_id, team2_id, status, team1_score, team2_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tournamentId, "LOWER", round, i + 1, null, null, status, score1, score2]
      );
    }
    currentRoundTeams = matchesInRound;
  }

  // Grand final
  const status = state === "FINISHED" ? "COMPLETED" : "PENDING";
  const score1 = state === "FINISHED" ? 2 : null;
  const score2 = state === "FINISHED" ? 1 : null;

  await db.execute<ResultSetHeader>(
    `INSERT INTO bg_matches
    (tournament_id, bracket, round_number, match_number, team1_id, team2_id, status, team1_score, team2_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tournamentId, "GRAND", 1, 1, null, null, status, score1, score2]
  );
}

async function main(): Promise<void> {
  console.log("🚀 Starting database seed with variable tournament sizes...\n");

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

    // 4. Créer des tournois avec BYEs (nombres non-puissance-de-2)
    console.log("🎮 Creating tournaments with BYE demonstrations...\n");
    const now = new Date();

    // Tailles de tournois avec BYEs (nombres impairs uniquement pour les BYEs)
    const tournamentSizes = [
      { size: 3, name: "Tiny (3)", description: "Small Registration", state: "REGISTRATION" as const },
      { size: 5, name: "Small (5)", description: "Small Registration", state: "REGISTRATION" as const },
      { size: 7, name: "Seven (7)", description: "Medium Registration", state: "REGISTRATION" as const },
      { size: 9, name: "Nine (9)", description: "Large Registration", state: "REGISTRATION" as const },
      { size: 11, name: "Medium+ (11)", description: "Running - No Matches", state: "RUNNING" as const },
      { size: 13, name: "Medium+ (13)", description: "Running - No Matches", state: "RUNNING" as const },
      { size: 27, name: "Large (27)", description: "Running - No Matches", state: "RUNNING" as const },
      { size: 29, name: "Large (29)", description: "Running - No Matches", state: "RUNNING" as const },
    ];

    for (const tournament of tournamentSizes) {
      const { size, name, description, state } = tournament;
      const teamsToUse = teamIds.slice(0, Math.min(size, teamIds.length));

      await createTournamentWithState(
        db,
        userIds,
        teamsToUse,
        now,
        state,
        `${name} ${description}`
      );
    }

    console.log("✅ Seed completed successfully!");
    console.log("\nTest data created:");
    console.log(`  - ${userIds.length} test users (Test_*)`);
    console.log(`  - ${teamIds.length} test teams (Test - *)`);
    console.log(`  - 8 test tournaments with BYE demonstrations (all odd team counts):`);
    console.log(`    1. 3 teams  - REGISTRATION (open for signup)`);
    console.log(`    2. 5 teams  - REGISTRATION (open for signup)`);
    console.log(`    3. 7 teams  - REGISTRATION (open for signup)`);
    console.log(`    4. 9 teams  - REGISTRATION (open for signup)`);
    console.log(`    5. 11 teams - RUNNING (no matches completed)`);
    console.log(`    6. 13 teams - RUNNING (no matches completed)`);
    console.log(`    7. 27 teams - RUNNING (no matches completed)`);
    console.log(`    8. 29 teams - RUNNING (no matches completed)`);
    console.log("\nAll tournaments use odd team counts to demonstrate BYEs!");

    process.exit(0);
  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  }
}

main();
