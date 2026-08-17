import "dotenv/config";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import { loadTournamentRow, loadRegisteredTeamIds, getMatchRows } from "./tournaments/repository";
import { createSingleEliminationBracket } from "./tournaments/bracket-single";
import { createDoubleEliminationBracket } from "./tournaments/bracket-double";
import { finalizeMatch } from "./tournaments/scoring";
import { finalizeTournamentIfDone } from "./tournaments/finalization";
import {
  initializeSwissTournament,
  generateSwissRound,
  reconcileSwiss,
} from "./tournaments/swiss";
import {
  initializeSurvivalTournament,
  generateSurvivalRound,
  reconcileSurvival,
  forfeitSurvivalTeam,
} from "./tournaments/survival";
import { SCORE_REPORT_TIMEOUT_MINUTES } from "@/lib/shared/constants";
import {
  TOURNAMENTS,
  type ReportStateCounts,
  type SeedFormat,
  type TournamentDef,
} from "./seed-cases";

// ---------------------------------------------------------------------------
// Déterminisme
// ---------------------------------------------------------------------------
// Les vainqueurs sont tirés au sort, mais le générateur est un LCG réamorcé pour
// chaque tournoi : deux exécutions du seed produisent exactement les mêmes
// résultats (captures d'écran, comparaisons de classements, tests manuels).
let rngState = 0;

function seedRng(seed: number): void {
  rngState = (seed >>> 0) || 1;
}

function rng(): number {
  rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
  return rngState / 0x100000000;
}

// Le mieux classé (team1) l'emporte 7 fois sur 10 : assez de « upsets » pour que
// les classements et le leaderboard soient variés, sans les rendre absurdes.
function playMatch(team1Id: number, team2Id: number): {
  team1Score: number;
  team2Score: number;
  winnerTeamId: number;
  loserTeamId: number;
} {
  const team1Wins = rng() < 0.7;
  const tight = rng() < 0.5;
  const winnerScore = 2;
  const loserScore = tight ? 1 : 0;
  return {
    team1Score: team1Wins ? winnerScore : loserScore,
    team2Score: team1Wins ? loserScore : winnerScore,
    winnerTeamId: team1Wins ? team1Id : team2Id,
    loserTeamId: team1Wins ? team2Id : team1Id,
  };
}

// ---------------------------------------------------------------------------
// Données fictives
// ---------------------------------------------------------------------------

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

// Comptes « profils » : chaque ligne isole un cas de figure côté auth, rôles de
// plateforme, visibilité et anonymisation. Ils servent aussi de cibles pour
// DEV_AUTH_USER_ID (cf. CLAUDE.md § Preview / dev auth bypass).
interface SpecialUserDef {
  pseudo: string;
  purpose: string;
  isAdmin?: boolean;
  platformRoles?: string[];
  isAdult?: 0 | 1 | null;
  isDeleted?: boolean;
  visibility?: Partial<{
    avatar: 0 | 1;
    pseudo: 0 | 1;
    overwatch: 0 | 1;
    marvel: 0 | 1;
    major: 0 | 1;
  }>;
  withGameTags?: boolean;
  email?: string;
  discordId?: string;
}

const SPECIAL_USERS: SpecialUserDef[] = [
  {
    pseudo: "Admin",
    purpose: "admin global (organisateur de tous les tournois seedés)",
    isAdmin: true,
    isAdult: 1,
    email: "admin@example.test",
    discordId: "900000000000000001",
  },
  {
    pseudo: "Arbitre",
    purpose: "permission tournaments seule",
    platformRoles: ["ARBITRE"],
    isAdult: 1,
    discordId: "900000000000000002",
  },
  {
    pseudo: "CommunityManager",
    purpose: "permission showcase seule",
    platformRoles: ["COMMUNITY_MANAGER"],
    isAdult: 1,
  },
  {
    pseudo: "Recruteur",
    purpose: "permission recruitment seule",
    platformRoles: ["RECRUTEUR"],
    isAdult: 1,
  },
  {
    pseudo: "MultiRole",
    purpose: "rôles cumulés arbitre + recruteur",
    platformRoles: ["ARBITRE", "RECRUTEUR"],
    isAdult: 1,
  },
  {
    pseudo: "ProfilPrive",
    purpose: "toutes les visibilités coupées",
    isAdult: 1,
    visibility: { avatar: 0, pseudo: 0, overwatch: 0, marvel: 0, major: 0 },
  },
  {
    pseudo: "ProfilPublic",
    purpose: "toutes les visibilités actives, majorité affichée",
    isAdult: 1,
    visibility: { avatar: 1, pseudo: 1, overwatch: 1, marvel: 1, major: 1 },
  },
  { pseudo: "Mineur", purpose: "compte mineur (is_adult = 0)", isAdult: 0 },
  { pseudo: "AgeInconnu", purpose: "majorité non renseignée (is_adult NULL)", isAdult: null },
  {
    pseudo: "SansTags",
    purpose: "aucun battletag ni tag Marvel Rivals",
    isAdult: 1,
    withGameTags: false,
  },
  { pseudo: "SansEquipe", purpose: "joueur libre, aucune équipe", isAdult: 1 },
  {
    pseudo: "CompteSupprime",
    purpose: "compte anonymisé (is_deleted = 1)",
    isAdult: 1,
    isDeleted: true,
  },
];

// Rôles d'équipe cumulables : le membre 0 est propriétaire, les suivants
// couvrent la composition type (tank / dps / heal) puis le staff.
const ROSTER_ROLES: string[][] = [
  ["OWNER", "CAPITAINE", "TANK"],
  ["DPS"],
  ["HEAL"],
  ["DPS", "CAPITAINE"],
  ["TANK"],
  ["HEAL"],
  ["COACH"],
  ["MANAGER"],
];

interface TeamDef {
  name: string;
  members: number[];
  logo?: boolean;
  roles?: string[][];
}

const FICTIONAL_TEAMS: TeamDef[] = [
  { name: "Dragon Squad", members: [0, 1, 2, 3, 4, 5, 6], logo: true },
  { name: "Phoenix Force", members: [3, 4, 5, 7, 8] },
  { name: "Thunder Legion", members: [6, 7, 8, 9], logo: true },
  { name: "Frost Alliance", members: [9, 10, 11] },
  { name: "Eclipse Titans", members: [12, 13, 14, 15] },
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
  // Cas limites de composition
  { name: "Solo Ranger", members: [31] },
  {
    name: "Staff Only",
    members: [20, 26],
    roles: [
      ["OWNER", "MANAGER"],
      ["COACH"],
    ],
  },
  {
    name: "Roster Complet",
    members: [1, 4, 11, 13, 18, 24, 29, 30],
    logo: true,
  },
];

const FICTIONAL_BUREAU = [
  { name: "Léo Perreaut", role: "Président", initials: "LP", color: "rgb(89, 212, 255)" },
  { name: "Bryan Boulleaux", role: "Trésorier", initials: "BB", color: "rgb(245, 195, 58)" },
  { name: "Sophie Martin", role: "Secrétaire", initials: "SM", color: "rgb(255, 157, 46)" },
  { name: "Jérôme Dubois", role: "Responsable arbitrage", initials: "JD", color: "rgb(167, 115, 255)" },
];

const FICTIONAL_SPONSORS = [
  { name: "Test - HyperX", slug: "test-hyperx", tier: "GOLD" as const, website_url: "https://example.com/hyperx", description: "Périphériques gaming haute performance" },
  { name: "Test - SteelSeries", slug: "test-steelseries", tier: "SILVER" as const, website_url: "https://example.com/steelseries", description: "Équipement esport de référence" },
  { name: "Test - Red Bull", slug: "test-redbull", tier: "BRONZE" as const, website_url: "https://example.com/redbull", description: "Énergie pour les champions" },
  { name: "Test - Discord", slug: "test-discord", tier: "PARTNER" as const, website_url: "https://example.com/discord", description: "La plateforme officielle de la communauté" },
];

// ---------------------------------------------------------------------------
// Nettoyage
// ---------------------------------------------------------------------------

// Supprime toutes les données générées par une exécution précédente du seed
// (équipes, joueurs, tournois, sponsors), identifiées par les préfixes de test
// `Test -%` / `Test_%`. Chaque suppression est indépendante : l'échec de l'une
// ne doit jamais empêcher les autres (sinon des équipes resteraient orphelines).
async function clearDatabase(db: Pool): Promise<void> {
  console.log("🧹 Nettoyage des données test existantes...");

  // Ordre important : enfants (matchs, inscriptions, membres) avant parents.
  const steps: { label: string; sql: string }[] = [
    { label: "matchs", sql: "DELETE FROM bg_matches WHERE tournament_id IN (SELECT id FROM bg_tournaments WHERE name LIKE 'Test -%')" },
    { label: "inscriptions", sql: "DELETE FROM bg_tournament_registrations WHERE tournament_id IN (SELECT id FROM bg_tournaments WHERE name LIKE 'Test -%')" },
    { label: "classements suisse", sql: "DELETE FROM bg_swiss_standings WHERE tournament_id IN (SELECT id FROM bg_tournaments WHERE name LIKE 'Test -%')" },
    { label: "classements survie", sql: "DELETE FROM bg_survival_standings WHERE tournament_id IN (SELECT id FROM bg_tournaments WHERE name LIKE 'Test -%')" },
    { label: "tournois", sql: "DELETE FROM bg_tournaments WHERE name LIKE 'Test -%'" },
    { label: "membres d'équipe", sql: "DELETE FROM bg_team_members WHERE team_id IN (SELECT id FROM bg_teams WHERE name LIKE 'Test -%')" },
    { label: "équipes", sql: "DELETE FROM bg_teams WHERE name LIKE 'Test -%'" },
    { label: "sessions", sql: "DELETE FROM bg_user_sessions WHERE user_id IN (SELECT id FROM bg_users WHERE pseudo LIKE 'Test_%')" },
    { label: "joueurs", sql: "DELETE FROM bg_users WHERE pseudo LIKE 'Test_%'" },
    { label: "sponsors", sql: "DELETE FROM bg_sponsors WHERE name LIKE 'Test -%'" },
    { label: "membres du bureau", sql: "DELETE FROM bg_bureau_members" },
    // Équipes héritées préfixées « Team_ » (underscore échappé pour LIKE).
    { label: "matchs (équipes Team_)", sql: "DELETE FROM bg_matches WHERE team1_id IN (SELECT id FROM bg_teams WHERE name LIKE 'Team\\_%') OR team2_id IN (SELECT id FROM bg_teams WHERE name LIKE 'Team\\_%')" },
    { label: "inscriptions (équipes Team_)", sql: "DELETE FROM bg_tournament_registrations WHERE team_id IN (SELECT id FROM bg_teams WHERE name LIKE 'Team\\_%')" },
    { label: "membres d'équipe (équipes Team_)", sql: "DELETE FROM bg_team_members WHERE team_id IN (SELECT id FROM bg_teams WHERE name LIKE 'Team\\_%')" },
    { label: "équipes Team_", sql: "DELETE FROM bg_teams WHERE name LIKE 'Team\\_%'" },
  ];

  try {
    await db.execute("SET FOREIGN_KEY_CHECKS=0");

    for (const step of steps) {
      try {
        const [result] = await db.execute<ResultSetHeader>(step.sql);
        if (result.affectedRows > 0) {
          console.log(`  ✓ ${result.affectedRows} ${step.label} supprimé(s)`);
        }
      } catch (error) {
        console.error(`  ✗ ${step.label}:`, (error as Error).message);
      }
    }

    console.log("  ✓ Base nettoyée");
  } finally {
    await db.execute("SET FOREIGN_KEY_CHECKS=1");
  }
}

// ---------------------------------------------------------------------------
// Joueurs, équipes, contenus éditoriaux
// ---------------------------------------------------------------------------

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

// Crée les comptes « profils » (admin, rôles de plateforme, visibilités, âge,
// anonymisation) et retourne leurs ids indexés par pseudo court.
async function createSpecialUsers(db: Pool): Promise<Map<string, number>> {
  console.log("🪪 Création des comptes de test (rôles / visibilité / âge)...");
  const ids = new Map<string, number>();

  for (const def of SPECIAL_USERS) {
    const pseudo = `Test_${def.pseudo}`;
    const visibility = {
      avatar: def.visibility?.avatar ?? 1,
      pseudo: def.visibility?.pseudo ?? 1,
      overwatch: def.visibility?.overwatch ?? 1,
      marvel: def.visibility?.marvel ?? 1,
      major: def.visibility?.major ?? 0,
    };
    const withTags = def.withGameTags !== false;

    try {
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO bg_users
         (pseudo, email, discord_id, overwatch_battletag, marvel_rivals_tag,
          visible_avatar, visible_pseudo, visible_overwatch, visible_marvel, visible_major,
          is_adult, is_admin, is_deleted, platform_roles_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pseudo,
          def.email ?? null,
          def.discordId ?? null,
          withTags ? `${def.pseudo}#1000` : null,
          withTags ? `${def.pseudo}#2023` : null,
          visibility.avatar,
          visibility.pseudo,
          visibility.overwatch,
          visibility.marvel,
          visibility.major,
          def.isAdult === undefined ? 1 : def.isAdult,
          def.isAdmin ? 1 : 0,
          def.isDeleted ? 1 : 0,
          def.platformRoles ? JSON.stringify(def.platformRoles) : null,
        ]
      );
      const id = result.insertId as number;
      ids.set(def.pseudo, id);
      console.log(`  ✓ #${id} ${pseudo} — ${def.purpose}`);
    } catch (error) {
      console.error(`  ✗ ${pseudo}:`, (error as Error).message);
    }
  }

  return ids;
}

async function createTeams(db: Pool, userIds: number[]): Promise<number[]> {
  console.log("🏆 Création des équipes...");
  const teamIds: number[] = [];
  for (const team of FICTIONAL_TEAMS) {
    const teamName = `Test - ${team.name}`;
    try {
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO bg_teams (name, logo_url) VALUES (?, ?)`,
        [teamName, team.logo ? "https://placehold.co/128x128/0b1220/5ac8ff?text=BG" : null]
      );
      const teamId = result.insertId as number;
      teamIds.push(teamId);
      for (let i = 0; i < team.members.length; i++) {
        const memberIndex = team.members[i];
        if (memberIndex >= userIds.length) continue;
        const roles = team.roles?.[i] ?? ROSTER_ROLES[i % ROSTER_ROLES.length];
        await db.execute(
          `INSERT INTO bg_team_members (team_id, user_id, roles_json, joined_at) VALUES (?, ?, ?, NOW())`,
          [teamId, userIds[memberIndex], JSON.stringify(i === 0 && !team.roles ? ROSTER_ROLES[0] : roles)]
        );
      }
    } catch (error) {
      console.error(`  ✗ ${teamName}:`, (error as Error).message);
    }
  }
  console.log(`  ✓ ${teamIds.length} équipes créées`);
  return teamIds;
}

// Génère en masse des équipes « remplissage » (chacune avec un seul owner) pour
// alimenter les gros brackets (64 / 128 équipes). Retourne les nouveaux team ids.
async function createBulkTeams(db: Pool, count: number): Promise<number[]> {
  console.log(`🤖 Génération de ${count} équipes de remplissage...`);
  const teamIds: number[] = [];
  for (let i = 1; i <= count; i++) {
    try {
      const pseudo = `Test_BulkUser_${i}`;
      const [userResult] = await db.execute<ResultSetHeader>(
        `INSERT INTO bg_users
         (pseudo, overwatch_battletag, marvel_rivals_tag, visible_avatar, visible_pseudo, visible_overwatch, visible_marvel, is_adult)
         VALUES (?, ?, ?, 1, 1, 1, 1, 1)`,
        [pseudo, `BulkUser${i}#${1000 + i}`, `BulkUser${i}#2023`]
      );
      const userId = userResult.insertId as number;

      const [teamResult] = await db.execute<ResultSetHeader>(
        `INSERT INTO bg_teams (name, logo_url) VALUES (?, NULL)`,
        [`Test - Bracket Team ${i}`]
      );
      const teamId = teamResult.insertId as number;
      teamIds.push(teamId);

      await db.execute(
        `INSERT INTO bg_team_members (team_id, user_id, roles_json, joined_at) VALUES (?, ?, ?, NOW())`,
        [teamId, userId, '["OWNER"]']
      );
    } catch (error) {
      console.error(`  ✗ Bracket Team ${i}:`, (error as Error).message);
    }
  }
  console.log(`  ✓ ${teamIds.length} équipes de remplissage créées`);
  return teamIds;
}

async function createSponsors(db: Pool): Promise<void> {
  console.log("🤝 Création des sponsors...");
  for (let i = 0; i < FICTIONAL_SPONSORS.length; i++) {
    const s = FICTIONAL_SPONSORS[i];
    try {
      await db.execute(
        `INSERT INTO bg_sponsors (name, slug, tier, website_url, description, display_order, active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        // Le dernier sponsor est inactif : couvre le filtrage de la page partenaires.
        [s.name, s.slug, s.tier, s.website_url, s.description, (i + 1) * 10, i === FICTIONAL_SPONSORS.length - 1 ? 0 : 1]
      );
    } catch (error) {
      console.error(`  ✗ ${s.name}:`, (error as Error).message);
    }
  }
  console.log(`  ✓ ${FICTIONAL_SPONSORS.length} sponsors créés (dont 1 inactif)`);
}

async function createBureau(db: Pool): Promise<void> {
  console.log("🏛️  Création des membres du bureau...");
  for (let i = 0; i < FICTIONAL_BUREAU.length; i++) {
    const m = FICTIONAL_BUREAU[i];
    try {
      await db.execute(
        `INSERT INTO bg_bureau_members (name, role, initials, color, display_order)
         VALUES (?, ?, ?, ?, ?)`,
        [m.name, m.role, m.initials, m.color, (i + 1) * 10]
      );
    } catch (error) {
      console.error(`  ✗ ${m.name}:`, (error as Error).message);
    }
  }
  console.log(`  ✓ ${FICTIONAL_BUREAU.length} membres du bureau créés`);
}

// ---------------------------------------------------------------------------
// Simulation de matchs
// ---------------------------------------------------------------------------

type MatchRowLike = Awaited<ReturnType<typeof getMatchRows>>[number];

function readyMatches(matches: MatchRowLike[]): MatchRowLike[] {
  return matches.filter(
    (m) =>
      m.status === "READY" &&
      m.team1_id !== null &&
      m.team2_id !== null &&
      m.winner_team_id === null
  );
}

// Joue `waves` vagues de matchs prêts sur un bracket à élimination. `waves` à
// Infinity = jusqu'à épuisement (tournoi terminé).
async function playBracket(
  connection: PoolConnection,
  tournamentId: number,
  waves: number
): Promise<number> {
  let played = 0;
  for (let wave = 0; wave < waves; wave++) {
    const ready = readyMatches(await getMatchRows(connection, tournamentId));
    if (ready.length === 0) break;
    for (const m of ready) {
      await finalizeMatch(
        connection,
        tournamentId,
        m,
        playMatch(Number(m.team1_id), Number(m.team2_id))
      );
      played++;
    }
  }
  return played;
}

// Génère un vrai bracket (single ou double élimination) via les générateurs de
// production, puis simule `playWaves` vagues de matchs joués.
async function generateRealBracket(
  db: Pool,
  tournamentId: number,
  format: "SINGLE" | "DOUBLE",
  playWaves: number,
  finish: boolean
): Promise<void> {
  const connection = await db.getConnection();
  try {
    const tournament = await loadTournamentRow(connection, tournamentId);
    if (!tournament) throw new Error(`Tournoi ${tournamentId} introuvable`);
    const teamIds = await loadRegisteredTeamIds(connection, tournamentId);

    if (format === "DOUBLE") {
      await createDoubleEliminationBracket(connection, tournament, teamIds);
    } else {
      await createSingleEliminationBracket(connection, tournament, teamIds);
    }

    const played = await playBracket(connection, tournamentId, finish ? Infinity : playWaves);
    if (finish) {
      await finalizeTournamentIfDone(connection, tournamentId);
    }
    console.log(`    ↳ bracket ${format} : ${played} matchs simulés`);
  } finally {
    connection.release();
  }
}

// Génère un tournoi « Ronde suisse » via l'orchestration de production
// (initialize + generate + reconcile), sur le même schéma que la Survie.
// `reconcileSwiss` enchaîne lui-même la ronde suivante quand la ronde courante
// est complète, et clôt le tournoi (avec classement final) à la dernière.
async function generateSwissTournament(
  db: Pool,
  tournamentId: number,
  finish: boolean,
  playWaves: number
): Promise<void> {
  const connection = await db.getConnection();
  try {
    await initializeSwissTournament(tournamentId, connection);
    await generateSwissRound(tournamentId, connection);
    await reconcileSwiss(tournamentId, connection);

    let waves = 0;
    let played = 0;
    while (true) {
      const ready = readyMatches(await getMatchRows(connection, tournamentId));
      if (ready.length === 0) break; // plus rien à jouer (souvent : terminé)
      if (!finish && waves >= playWaves) break; // laisse le tournoi en cours

      for (const m of ready) {
        await finalizeMatch(
          connection,
          tournamentId,
          m,
          playMatch(Number(m.team1_id), Number(m.team2_id))
        );
        played++;
      }
      await reconcileSwiss(tournamentId, connection);
      waves++;
    }
    console.log(`    ↳ suisse : ${played} matchs simulés sur ${waves} ronde(s)`);
  } finally {
    connection.release();
  }
}

// Génère un tournoi « Survie » réaliste via l'orchestration de production
// (initialize + generate + reconcile). Pour un tournoi RUNNING, on s'arrête
// après `playWaves` vagues (des matchs restent READY) ; pour un FINISHED, on
// joue jusqu'au sacre de la championne. `forfeits` équipes encore en lice
// déclarent forfait à la fin de la simulation (couvre le rééquilibrage).
async function generateSurvivalTournament(
  db: Pool,
  tournamentId: number,
  finish: boolean,
  playWaves: number,
  forfeits: number
): Promise<void> {
  const connection = await db.getConnection();
  try {
    await initializeSurvivalTournament(tournamentId, connection);
    await generateSurvivalRound(tournamentId, connection);
    await reconcileSurvival(tournamentId, connection);

    let waves = 0;
    let played = 0;
    while (true) {
      const ready = readyMatches(await getMatchRows(connection, tournamentId));
      if (ready.length === 0) break; // plus rien à jouer (souvent : terminé)
      if (!finish && waves >= playWaves) break; // laisse le tournoi en cours

      for (const m of ready) {
        await finalizeMatch(
          connection,
          tournamentId,
          m,
          playMatch(Number(m.team1_id), Number(m.team2_id))
        );
        played++;
      }
      await reconcileSurvival(tournamentId, connection);
      waves++;
    }

    let forfeited = 0;
    for (let i = 0; i < forfeits; i++) {
      const [rows] = await connection.execute<(RowDataPacket & { team_id: number })[]>(
        `SELECT team_id FROM bg_survival_standings
         WHERE tournament_id = ? AND status = 'ACTIVE'
         ORDER BY \`rank\` DESC, seed DESC
         LIMIT 1`,
        [tournamentId]
      );
      if (rows.length === 0) break;
      try {
        await forfeitSurvivalTeam(tournamentId, Number(rows[0].team_id), connection);
        forfeited++;
      } catch (error) {
        console.error(`    ✗ forfait:`, (error as Error).message);
        break;
      }
    }

    console.log(
      `    ↳ survie : ${played} matchs simulés sur ${waves} round(s)` +
        (forfeited ? `, ${forfeited} forfait(s)` : "")
    );
  } finally {
    connection.release();
  }
}

// ---------------------------------------------------------------------------
// États intermédiaires de report de score
// ---------------------------------------------------------------------------

// Transforme des matchs READY en états intermédiaires du cycle de report :
//  · pendingReports  → une seule équipe a reporté, délai en cours
//  · conflicts       → les deux équipes ont reporté des scores contradictoires
//  · expiredReports  → un report unique dont le délai est dépassé (la prochaine
//                      lecture de l'API doit le résoudre automatiquement)
async function applyReportStates(
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

// ---------------------------------------------------------------------------
// Tournois
// ---------------------------------------------------------------------------

async function createTournament(
  db: Pool,
  organizerId: number,
  teamIds: number[],
  def: TournamentDef,
  index: number
): Promise<number> {
  seedRng(0x5eed0000 + index * 7919);

  const now = new Date();
  const startAt = new Date(now.getTime() + def.daysOffset * 86400000);
  const format = def.format ?? "DOUBLE";
  const isSurvival = format === "SURVIVAL";
  const isSwiss = format === "SWISS";

  // Les états sont dérivés des dates par computeTournamentState() : on les
  // calibre pour que l'état voulu soit stable après resynchronisation.
  let regOpenAt: Date;
  let regCloseAt: Date;
  if (def.state === "UPCOMING") {
    regOpenAt = new Date(startAt.getTime() - 7 * 86400000);
    regCloseAt = new Date(startAt.getTime() - 1 * 86400000);
  } else if (def.state === "REGISTRATION") {
    regOpenAt = new Date(now.getTime() - 3 * 86400000);
    regCloseAt = def.closesInHours
      ? new Date(now.getTime() + def.closesInHours * 3600000)
      : new Date(startAt.getTime() - 1 * 86400000);
  } else {
    regOpenAt = new Date(startAt.getTime() - 14 * 86400000);
    regCloseAt = new Date(startAt.getTime() - 1 * 86400000);
  }

  const hasThirdPlace = format === "SINGLE" && Boolean(def.hasThirdPlaceMatch) ? 1 : 0;
  const survivalRoundsPerCut = isSurvival ? def.survivalRoundsPerCut ?? 2 : null;
  const survivalRoundsBeforeFirstCut = isSurvival
    ? def.survivalRoundsBeforeFirstCut ?? survivalRoundsPerCut
    : null;
  const swissTotalRounds = isSwiss ? def.swissTotalRounds ?? null : null;
  // Survie et suisse sont pilotés par leur orchestration (initialize → reconcile)
  // : on insère en RUNNING, puis l'orchestration bascule vers FINISHED.
  const orchestrated = isSurvival || isSwiss;
  const insertState = orchestrated && def.state === "FINISHED" ? "RUNNING" : def.state;
  const finishedAt = !orchestrated && def.state === "FINISHED" ? startAt : null;

  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_tournaments
     (organizer_user_id, name, game, description, format, has_third_place_match,
      survival_rounds_before_first_cut, survival_rounds_per_cut, swiss_total_rounds,
      max_teams, state, start_visibility_at, registration_open_at, registration_close_at, start_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      organizerId,
      `Test - ${def.name}`,
      def.game,
      def.description === undefined
        ? `Tournoi test ${def.game} — ${def.state} — ${format}`
        : def.description,
      format,
      hasThirdPlace,
      survivalRoundsBeforeFirstCut,
      survivalRoundsPerCut,
      swissTotalRounds,
      def.maxTeams,
      insertState,
      regOpenAt,
      regOpenAt,
      regCloseAt,
      startAt,
      finishedAt,
    ]
  );
  const tournamentId = result.insertId as number;

  // Inscriptions — la tranche d'équipes varie d'un tournoi à l'autre pour que
  // les mêmes équipes ne finissent pas systématiquement au même rang.
  const offset = (def.teamOffset ?? 0) % Math.max(teamIds.length, 1);
  const pool = [...teamIds.slice(offset), ...teamIds.slice(0, offset)];
  const teamsToUse = pool.slice(0, Math.min(def.teamCount, pool.length));
  for (let i = 0; i < teamsToUse.length; i++) {
    await db.execute(
      `INSERT INTO bg_tournament_registrations (tournament_id, team_id, seed, final_rank) VALUES (?, ?, ?, NULL)`,
      [tournamentId, teamsToUse[i], i + 1]
    );
  }

  const finish = def.state === "FINISHED";

  if (def.state !== "UPCOMING" && def.state !== "REGISTRATION" && teamsToUse.length >= 2) {
    if (isSurvival) {
      await generateSurvivalTournament(db, tournamentId, finish, def.playWaves ?? 3, def.forfeits ?? 0);
    } else if (isSwiss) {
      await generateSwissTournament(db, tournamentId, finish, def.playWaves ?? 2);
    } else {
      await generateRealBracket(db, tournamentId, format as "SINGLE" | "DOUBLE", def.playWaves ?? 2, finish);
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

  const gameLabel = def.game === "OW2" ? "Overwatch 2" : "Marvel Rivals";
  console.log(
    `  ✓ #${tournamentId} [${def.state}/${format}] ${gameLabel} · ${def.name} (${teamsToUse.length}/${def.maxTeams})`
  );
  return tournamentId;
}


// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("🚀 Seed BlueGenji Arena\n");

  try {
    const db = await getDatabase();

    await clearDatabase(db);
    console.log();

    const userIds = await createUsers(db);
    console.log();

    const specialUserIds = await createSpecialUsers(db);
    console.log();

    const namedTeamIds = await createTeams(db, userIds);
    console.log();

    // Pool d'équipes étendu pour alimenter les gros brackets (jusqu'à 128) avec
    // de la marge, afin que teamOffset puisse décaler les tranches.
    const TEAM_POOL_TARGET = 160;
    const bulkTeamIds = await createBulkTeams(
      db,
      Math.max(0, TEAM_POOL_TARGET - namedTeamIds.length)
    );
    const teamIds = [...namedTeamIds, ...bulkTeamIds];
    console.log();

    await createSponsors(db);
    console.log();

    await createBureau(db);
    console.log();

    const organizerId = specialUserIds.get("Admin") ?? userIds[0];

    console.log("🎮 Création des tournois...");
    for (let i = 0; i < TOURNAMENTS.length; i++) {
      await createTournament(db, organizerId, teamIds, TOURNAMENTS[i], i);
    }

    const byState = (state: TournamentDef["state"]) =>
      TOURNAMENTS.filter((t) => t.state === state).length;
    const byFormat = (format: SeedFormat) =>
      TOURNAMENTS.filter((t) => (t.format ?? "DOUBLE") === format).length;

    console.log("\n✅ Seed terminé avec succès !");
    console.log(`\n  Récap :`);
    console.log(`  · ${userIds.length} joueurs + ${specialUserIds.size} comptes de test (Test_*)`);
    console.log(`  · ${teamIds.length} équipes (Test - *), dont solo / staff / roster complet`);
    console.log(`  · ${FICTIONAL_SPONSORS.length} sponsors (dont 1 inactif) · ${FICTIONAL_BUREAU.length} membres du bureau`);
    console.log(`  · ${TOURNAMENTS.length} tournois :`);
    console.log(`    - états : ${byState("UPCOMING")} à venir · ${byState("REGISTRATION")} inscriptions · ${byState("RUNNING")} en cours · ${byState("FINISHED")} terminés`);
    console.log(`    - formats : ${byFormat("SINGLE")} simple · ${byFormat("DOUBLE")} double · ${byFormat("SWISS")} suisse · ${byFormat("SURVIVAL")} survie`);
    console.log(`    - effectifs : 0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 21, 64, 128`);
    console.log(`    - survie : barrage impair (3/5/7/9/11/15/21), cadences 1/2/3, forfaits`);
    console.log(`    - matchs : reports en attente, conflits de score, délais expirés`);
    console.log(`\n  Admin de test : DEV_AUTH_USER_ID=${organizerId}\n`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Seed échoué:", error);
    process.exit(1);
  }
}

main();
