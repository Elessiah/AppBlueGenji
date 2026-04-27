import "dotenv/config";
import type { Pool, ResultSetHeader } from "mysql2/promise";
import { getDatabase } from "./database";

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
];

const FICTIONAL_SPONSORS = [
  { name: "Test - HyperX", slug: "test-hyperx", tier: "GOLD" as const, website_url: "https://example.com/hyperx", description: "Périphériques gaming haute performance" },
  { name: "Test - SteelSeries", slug: "test-steelseries", tier: "SILVER" as const, website_url: "https://example.com/steelseries", description: "Équipement esport de référence" },
  { name: "Test - Red Bull", slug: "test-redbull", tier: "BRONZE" as const, website_url: "https://example.com/redbull", description: "Énergie pour les champions" },
  { name: "Test - Discord", slug: "test-discord", tier: "PARTNER" as const, website_url: "https://example.com/discord", description: "La plateforme officielle de la communauté" },
];

async function clearDatabase(db: Pool): Promise<void> {
  console.log("🧹 Nettoyage des données test existantes...");
  try {
    await db.execute("SET FOREIGN_KEY_CHECKS=0");
    await db.execute("DELETE FROM bg_matches WHERE tournament_id IN (SELECT id FROM bg_tournaments WHERE name LIKE 'Test -%')");
    await db.execute("DELETE FROM bg_tournament_registrations WHERE tournament_id IN (SELECT id FROM bg_tournaments WHERE name LIKE 'Test -%')");
    await db.execute("DELETE FROM bg_tournaments WHERE name LIKE 'Test -%'");
    await db.execute("DELETE FROM bg_team_members WHERE team_id IN (SELECT id FROM bg_teams WHERE name LIKE 'Test -%')");
    await db.execute("DELETE FROM bg_teams WHERE name LIKE 'Test -%'");
    await db.execute("DELETE FROM bg_users WHERE pseudo LIKE 'Test_%'");
    await db.execute("DELETE FROM bg_sponsors WHERE name LIKE 'Test -%'");
    await db.execute("SET FOREIGN_KEY_CHECKS=1");
    console.log("  ✓ Base nettoyée");
  } catch (error) {
    console.error("  ✗ Erreur nettoyage:", error);
    await db.execute("SET FOREIGN_KEY_CHECKS=1");
  }
}

async function createUsers(db: Pool): Promise<number[]> {
  console.log("👥 Création des joueurs...");
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
    } catch (error) {
      console.error(`  ✗ ${pseudo}:`, (error as Error).message);
    }
  }
  console.log(`  ✓ ${userIds.length} joueurs créés`);
  return userIds;
}

async function createTeams(db: Pool, userIds: number[]): Promise<number[]> {
  console.log("🏆 Création des équipes...");
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
      for (const memberIndex of team.members) {
        if (memberIndex < userIds.length) {
          const isOwner = team.members[0] === memberIndex;
          await db.execute(
            `INSERT INTO bg_team_members (team_id, user_id, roles_json, joined_at) VALUES (?, ?, ?, NOW())`,
            [teamId, userIds[memberIndex], isOwner ? '["OWNER"]' : '["MEMBER"]']
          );
        }
      }
    } catch (error) {
      console.error(`  ✗ ${teamName}:`, (error as Error).message);
    }
  }
  console.log(`  ✓ ${teamIds.length} équipes créées`);
  return teamIds;
}

async function createSponsors(db: Pool): Promise<void> {
  console.log("🤝 Création des sponsors...");
  for (let i = 0; i < FICTIONAL_SPONSORS.length; i++) {
    const s = FICTIONAL_SPONSORS[i];
    try {
      await db.execute(
        `INSERT INTO bg_sponsors (name, slug, tier, website_url, description, display_order, active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [s.name, s.slug, s.tier, s.website_url, s.description, (i + 1) * 10]
      );
    } catch (error) {
      console.error(`  ✗ ${s.name}:`, (error as Error).message);
    }
  }
  console.log(`  ✓ ${FICTIONAL_SPONSORS.length} sponsors créés`);
}

// Génère un bracket terminé avec winner/loser correctement propagés sur tous les rounds
async function generateFinishedBracket(
  db: Pool,
  tournamentId: number,
  teamIds: number[]
): Promise<void> {
  let currentRoundTeams = [...teamIds];
  let round = 1;

  while (currentRoundTeams.length > 1) {
    const matchCount = Math.floor(currentRoundTeams.length / 2);
    const nextRoundTeams: number[] = [];
    const isLastRound = matchCount === 1 && currentRoundTeams.length === 2;

    for (let i = 0; i < matchCount; i++) {
      const team1Id = currentRoundTeams[i * 2];
      const team2Id = currentRoundTeams[i * 2 + 1];
      const winnerId = team1Id;
      const loserId = team2Id;

      await db.execute<ResultSetHeader>(
        `INSERT INTO bg_matches
         (tournament_id, bracket, round_number, match_number,
          team1_id, team2_id, status, team1_score, team2_score, winner_team_id, loser_team_id)
         VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', 2, 1, ?, ?)`,
        [tournamentId, isLastRound ? "GRAND" : "UPPER", round, i + 1, team1Id, team2Id, winnerId, loserId]
      );
      nextRoundTeams.push(winnerId);
    }

    currentRoundTeams = nextRoundTeams;
    round++;
  }
}

// Génère un bracket en cours avec le premier match en READY (équipes assignées)
async function generateRunningBracket(
  db: Pool,
  tournamentId: number,
  teamIds: number[]
): Promise<void> {
  const matchCount = Math.floor(teamIds.length / 2);

  for (let i = 0; i < matchCount; i++) {
    const isFirst = i === 0;
    await db.execute<ResultSetHeader>(
      `INSERT INTO bg_matches
       (tournament_id, bracket, round_number, match_number,
        team1_id, team2_id, status, team1_score, team2_score)
       VALUES (?, 'UPPER', 1, ?, ?, ?, ?, NULL, NULL)`,
      [
        tournamentId,
        i + 1,
        isFirst ? teamIds[0] : null,
        isFirst ? teamIds[1] : null,
        isFirst ? "READY" : "PENDING",
      ]
    );
  }

  // Round 2 : matches PENDING
  const round2Count = Math.ceil(matchCount / 2);
  for (let i = 0; i < round2Count; i++) {
    await db.execute<ResultSetHeader>(
      `INSERT INTO bg_matches
       (tournament_id, bracket, round_number, match_number, status)
       VALUES (?, 'UPPER', 2, ?, 'PENDING')`,
      [tournamentId, i + 1]
    );
  }

  // Grand final PENDING
  await db.execute<ResultSetHeader>(
    `INSERT INTO bg_matches (tournament_id, bracket, round_number, match_number, status) VALUES (?, 'GRAND', 1, 1, 'PENDING')`,
    [tournamentId]
  );
}

interface TournamentDef {
  name: string;
  game: "OW2" | "MR";
  state: "REGISTRATION" | "RUNNING" | "FINISHED";
  teamCount: number;
  maxTeams: number;
  daysOffset: number; // négatif = dans le passé
  format?: "SINGLE" | "DOUBLE";
  hasThirdPlaceMatch?: boolean;
}

async function createTournament(
  db: Pool,
  userIds: number[],
  teamIds: number[],
  def: TournamentDef
): Promise<number> {
  const now = new Date();
  const startAt = new Date(now.getTime() + def.daysOffset * 86400000);
  const regOpenAt = new Date(startAt.getTime() - 14 * 86400000);
  const regCloseAt = def.state === "REGISTRATION"
    ? new Date(now.getTime() + 7 * 86400000)
    : new Date(startAt.getTime() - 1 * 86400000);
  const finishedAt = def.state === "FINISHED" ? startAt : null;
  const format = def.format ?? "DOUBLE";
  const hasThirdPlace = format === "SINGLE" && Boolean(def.hasThirdPlaceMatch) ? 1 : 0;

  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_tournaments
     (organizer_user_id, name, game, description, format, has_third_place_match, max_teams, state,
      start_visibility_at, registration_open_at, registration_close_at, start_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userIds[0],
      `Test - ${def.name}`,
      def.game,
      `Tournoi test ${def.game} — ${def.state}`,
      format,
      hasThirdPlace,
      def.maxTeams,
      def.state,
      regOpenAt,
      regOpenAt,
      regCloseAt,
      startAt,
      finishedAt,
    ]
  );
  const tournamentId = result.insertId as number;

  // Inscriptions
  const teamsToUse = teamIds.slice(0, Math.min(def.teamCount, teamIds.length));
  for (let i = 0; i < teamsToUse.length; i++) {
    await db.execute(
      `INSERT INTO bg_tournament_registrations (tournament_id, team_id, seed, final_rank) VALUES (?, ?, ?, ?)`,
      [tournamentId, teamsToUse[i], i + 1, def.state === "FINISHED" ? i + 1 : null]
    );
  }

  // Matches selon l'état
  if (def.state === "RUNNING") {
    await generateRunningBracket(db, tournamentId, teamsToUse);
  } else if (def.state === "FINISHED") {
    await generateFinishedBracket(db, tournamentId, teamsToUse);
  }

  const gameLabel = def.game === "OW2" ? "Overwatch 2" : "Marvel Rivals";
  console.log(`  ✓ [${def.state}] ${gameLabel} · ${def.name} (${teamsToUse.length}/${def.maxTeams} équipes)`);
  return tournamentId;
}

async function main(): Promise<void> {
  console.log("🚀 Seed BlueGenji Arena\n");

  try {
    const db = await getDatabase();

    await clearDatabase(db);
    console.log();

    const userIds = await createUsers(db);
    console.log();

    const teamIds = await createTeams(db, userIds);
    console.log();

    await createSponsors(db);
    console.log();

    console.log("🎮 Création des tournois...");

    const tournaments: TournamentDef[] = [
      // REGISTRATION — inscrits ouverts, données pour la landing
      { name: "OW2 Open Cup S1", game: "OW2", state: "REGISTRATION", teamCount: 5, maxTeams: 8, daysOffset: 10 },
      { name: "Marvel Rivals Cup S1", game: "MR", state: "REGISTRATION", teamCount: 3, maxTeams: 8, daysOffset: 14 },
      { name: "OW2 Grand Prix", game: "OW2", state: "REGISTRATION", teamCount: 2, maxTeams: 16, daysOffset: 21 },

      // RUNNING — avec un match READY (affiché dans le live de la landing)
      { name: "OW2 Champions League", game: "OW2", state: "RUNNING", teamCount: 8, maxTeams: 8, daysOffset: -1 },

      // FINISHED — brackets complets avec winner/loser (données leaderboard + ticker)
      { name: "OW2 Spring Clash", game: "OW2", state: "FINISHED", teamCount: 8, maxTeams: 8, daysOffset: -30 },
      { name: "Marvel Rivals Open", game: "MR", state: "FINISHED", teamCount: 4, maxTeams: 4, daysOffset: -20 },
      { name: "OW2 Winter Cup", game: "OW2", state: "FINISHED", teamCount: 8, maxTeams: 8, daysOffset: -60 },
      { name: "Marvel Rivals Pro Series", game: "MR", state: "FINISHED", teamCount: 8, maxTeams: 8, daysOffset: -45 },

      // 11 équipes — simple sans petite finale
      { name: "OW2 11-Team Single", game: "OW2", state: "REGISTRATION", teamCount: 11, maxTeams: 16, daysOffset: 18, format: "SINGLE", hasThirdPlaceMatch: false },
      // 11 équipes — simple avec petite finale
      { name: "MR 11-Team Single + 3rd", game: "MR", state: "REGISTRATION", teamCount: 11, maxTeams: 16, daysOffset: 22, format: "SINGLE", hasThirdPlaceMatch: true },
      // 11 équipes — double élimination
      { name: "OW2 11-Team Double", game: "OW2", state: "REGISTRATION", teamCount: 11, maxTeams: 16, daysOffset: 25, format: "DOUBLE" },
    ];

    for (const def of tournaments) {
      await createTournament(db, userIds, teamIds, def);
    }

    console.log("\n✅ Seed terminé avec succès !");
    console.log(`\n  Récap :`);
    console.log(`  · ${userIds.length} joueurs (Test_*)`);
    console.log(`  · ${teamIds.length} équipes (Test - *)`);
    console.log(`  · ${FICTIONAL_SPONSORS.length} sponsors (Test - *)`);
    console.log(`  · ${tournaments.length} tournois dont :`);
    console.log(`    - 6 REGISTRATION (inscrits ouverts, dont 3 × 11 équipes)`);
    console.log(`    - 1 RUNNING avec match READY (live landing)`);
    console.log(`    - 4 FINISHED avec brackets complets (leaderboard + ticker)`);
    console.log(`    - SINGLE sans petite finale (11 équipes)`);
    console.log(`    - SINGLE avec petite finale (11 équipes)`);
    console.log(`    - DOUBLE élimination (11 équipes)`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Seed échoué:", error);
    process.exit(1);
  }
}

main();
