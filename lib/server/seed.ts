import "dotenv/config";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "./database";
import { loadTournamentRow, loadRegisteredTeamIds, getMatchRows } from "./tournaments/repository";
import { createSingleEliminationBracket } from "./tournaments/bracket-single";
import { createDoubleEliminationBracket } from "./tournaments/bracket-double";
import { finalizeMatch } from "./tournaments/scoring";
import { finalizeTournamentIfDone } from "./tournaments/finalization";
import {
  initializeEnduranceTournament,
  generateEnduranceRound,
  reconcileEndurance,
  forfeitEnduranceTeam,
} from "./tournaments/bg-survie";
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
import { insertPhases, setCurrentPhase, loadPhases } from "./tournaments/phases-repository";
import { initializeMultiTournament, startPhase, reconcilePhases } from "./tournaments/phases";
import { SCORE_REPORT_TIMEOUT_MINUTES } from "@/lib/shared/constants";
import { matchWinsRequired } from "@/lib/shared/match-format";
import { soloEntryNameCandidates } from "@/lib/shared/participants";
import {
  TOURNAMENTS,
  type ReportStateCounts,
  type SeedFormat,
  type TournamentDef,
  type SeedPhase,
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
// `winsRequired` = nombre de manches à gagner, dicté par le format de match du
// tournoi (3 en BO5/FT3, 2 par défaut). Sans ça, un tournoi seedé en BO5
// afficherait des scores impossibles à saisir dans l'interface.
function playMatch(team1Id: number, team2Id: number, winsRequired = 2): {
  team1Score: number;
  team2Score: number;
  winnerTeamId: number;
  loserTeamId: number;
} {
  const team1Wins = rng() < 0.7;
  const tight = rng() < 0.5;
  const winnerScore = winsRequired;
  const loserScore = tight ? winsRequired - 1 : 0;
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
    overwatch: 0 | 1;
    marvel: 0 | 1;
    major: 0 | 1;
  }>;
  /** Ouvert au recrutement (défaut 1) — 0 = ne veut pas être démarché. */
  openToRecruitment?: 0 | 1;
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
    visibility: { avatar: 0, overwatch: 0, marvel: 0, major: 0 },
  },
  {
    pseudo: "ProfilPublic",
    purpose: "toutes les visibilités actives, majorité affichée",
    isAdult: 1,
    visibility: { avatar: 1, overwatch: 1, marvel: 1, major: 1 },
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
    pseudo: "PasDeRecrutement",
    purpose: "sans équipe mais fermé au recrutement (hors filtre free agents)",
    isAdult: 1,
    openToRecruitment: 0,
  },
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

// Annonces de recrutement : couvre l'aperçu tronqué des longues descriptions
// (le cas qui a motivé la modale de lecture), les deux modes de mise en avant,
// le cas « plusieurs annonces urgentes » — une seule est servie, les autres
// attendent leur tour — et le brouillon inactif.
const FICTIONAL_RECRUITMENT_ADS = [
  {
    title: "Test - BlueGenji recrute des Admins",
    team_name: "Pôle administration",
    domain: "ADMIN" as const,
    roles: "Modération, tickets, check-ins de tournoi",
    body: "Suite à une pause dans nos activités, nous recherchons de nouvelles têtes pour le poste d'Admin.\n\nCe que nous offrons:\nUne structure claire et un encadrement professionnel. L'association existe depuis 2020 et est sous loi 1901, ce qui nous donne l'expérience nécessaire pour connaître les besoins de ce rôle.\n\nEn quoi consiste le rôle:\n\n- Surveiller les salons textuels pour repérer comportements toxiques, conflits ou spam.\n\n- Intervenir immédiatement en cas de problème (rappel des règles, mute, kick si nécessaire).\n\n- Répondre rapidement aux signalements des membres.\n\n- Ouvrir, trier et gérer les tickets selon leur catégorie.\n\n- Effectuer les check-ins en tournoi et gérer les problèmes pendant les matchs.\n\n- Aider au brainstorm et à la conception des évènements ainsi que leur mise en place.\n\n- Relayer ou faire appliquer les décisions urgentes des directeurs de pôles.\n\nLes outils à disposition:\nTrois serveurs Discord (principal, Marvel Rivals, équipes), ainsi qu'un outil de ticketing externe permettant le suivi de vos tâches et la collaboration avec le reste du staff.\n\nSi le rôle t'intéresse:\nPostule directement via le bouton ci-dessous, ou contacte-nous sur Discord en message privé pour qu'on puisse discuter, échanger, et pourquoi pas planifier un entretien vocal.",
    contact_url: "https://example.com/ticket/admin",
    contact_discord: "recrutement_bg",
    contact_discord_id: "123456789012345678",
    contact_preferred: "DISCORD" as const,
    highlight: "MODAL" as const,
    active: 1,
  },
  {
    title: "Test - BlueGenji recrute un Graphiste",
    team_name: "Pôle communication",
    domain: "DESIGN" as const,
    roles: "Identité visuelle, affiches, overlays",
    body: "Suite à une reprise de nos événements, nous recherchons un graphiste pour assurer nos besoins visuels.\n\nCe que nous offrons:\nUn cadre bienveillant, des projets variés et une vraie liberté créative sur la direction artistique de la saison.\n\nEn quoi consiste le rôle:\n\n- Collaborer avec le pôle communication pour définir les besoins visuels.\n\n- Élaborer un cahier des normes graphiques pour l'association.\n\n- Créer les éléments de communication visuelle : logos, affiches, brochures.\n\n- Pouvoir effectuer des modifications de dernière minute sur un visuel.\n\n- Mettre en place et tenir un espace de travail partagé bien organisé.\n\nLes outils à disposition:\nUn outil de ticketing externe pour le suivi des tâches, et des points réguliers avec le pôle communication.\n\nSi le rôle t'intéresse:\nPostule via le lien, ou viens en parler sur Discord.",
    contact_url: "https://example.com/ticket/design",
    contact_discord: "https://discord.gg/bluegenji",
    contact_discord_id: null,
    contact_preferred: "LINK" as const,
    // Deuxième « modale à l'arrivée » : masquée par celle du dessus.
    highlight: "MODAL" as const,
    active: 1,
  },
  {
    title: "Test - Arbitres pour les tournois du dimanche",
    team_name: "Pôle arbitrage",
    domain: "ARBITRAGE" as const,
    roles: "Arbitrer les matchs, gérer les litiges",
    body: "Deux tournois par mois, le dimanche après-midi. Formation assurée par le pôle : aucune expérience préalable n'est demandée, seulement de la rigueur et de la disponibilité.",
    contact_url: null,
    contact_discord: "arbitrage_bg",
    contact_discord_id: null,
    contact_preferred: "AUTO" as const,
    // Troisième mise en avant, en banderole : masquée elle aussi.
    highlight: "BANNER" as const,
    active: 1,
  },
  {
    title: "Test - Caster pour les finales",
    team_name: null,
    domain: "CASTING" as const,
    roles: null,
    // Description courte : la carte l'affiche en entier, sans « lire la suite ».
    body: "Commenter les finales en direct, une soirée par mois.",
    contact_url: "https://example.com/ticket/casting",
    contact_discord: null,
    contact_discord_id: null,
    contact_preferred: "AUTO" as const,
    highlight: "NONE" as const,
    active: 1,
  },
  {
    title: "Test - Développeur (brouillon)",
    team_name: "Pôle dev",
    domain: "DEV" as const,
    roles: null,
    body: null,
    contact_url: null,
    contact_discord: null,
    contact_discord_id: null,
    contact_preferred: "AUTO" as const,
    // Brouillon urgent : inactif, donc jamais mis en avant.
    highlight: "MODAL" as const,
    active: 0,
  },
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
    // Entrées solo (tournois individuels) : nommées d'après le pseudo du joueur,
    // elles ne portent pas le préfixe « Test - » des équipes. On vise aussi
    // celles dont le compte a déjà disparu (exécution précédente interrompue) :
    // sans ça elles resteraient à jamais, en réservant leur pseudo dans l'espace
    // de noms unique des équipes.
    { label: "entrées solo", sql: "DELETE t FROM bg_teams t LEFT JOIN bg_users u ON u.id = t.solo_user_id WHERE t.solo_user_id IS NOT NULL AND (u.id IS NULL OR u.pseudo LIKE 'Test%')" },
    { label: "sessions", sql: "DELETE FROM bg_user_sessions WHERE user_id IN (SELECT id FROM bg_users WHERE pseudo LIKE 'Test_%')" },
    { label: "joueurs", sql: "DELETE FROM bg_users WHERE pseudo LIKE 'Test_%'" },
    { label: "sponsors", sql: "DELETE FROM bg_sponsors WHERE name LIKE 'Test -%'" },
    { label: "annonces de recrutement", sql: "DELETE FROM bg_recruitment_ads WHERE title LIKE 'Test -%'" },
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
      overwatch: def.visibility?.overwatch ?? 1,
      marvel: def.visibility?.marvel ?? 1,
      major: def.visibility?.major ?? 0,
    };
    const withTags = def.withGameTags !== false;

    try {
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO bg_users
         (pseudo, email, discord_id, overwatch_battletag, marvel_rivals_tag,
          visible_avatar, visible_overwatch, visible_marvel, visible_major,
          open_to_recruitment, is_adult, is_admin, is_deleted, platform_roles_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pseudo,
          def.email ?? null,
          def.discordId ?? null,
          withTags ? `${def.pseudo}#1000` : null,
          withTags ? `${def.pseudo}#2023` : null,
          visibility.avatar,
          visibility.overwatch,
          visibility.marvel,
          visibility.major,
          def.openToRecruitment ?? 1,
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

// Équipes fantômes : créées par le staff, sans aucun membre (voir
// `docs/features/GHOST_TEAMS.md`). Présentes dans le jeu de test pour couvrir
// l'affichage du badge, l'attribution à un joueur et l'inscription en tournoi.
const GHOST_TEAMS = [
  { name: "Test - Fantôme Invitée", description: "Équipe invitée, inscrite hors plateforme." },
  { name: "Test - Fantôme Remplissage", description: null },
] as const;

async function createGhostTeams(db: Pool): Promise<number[]> {
  console.log("👻 Création des équipes fantômes...");
  const teamIds: number[] = [];
  for (const team of GHOST_TEAMS) {
    try {
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO bg_teams (name, logo_url, description, is_ghost) VALUES (?, NULL, ?, 1)`,
        [team.name, team.description],
      );
      teamIds.push(result.insertId as number);
    } catch (error) {
      console.error(`  ✗ ${team.name}:`, (error as Error).message);
    }
  }
  console.log(`  ✓ ${teamIds.length} équipes fantômes créées`);
  return teamIds;
}

// Entrées solo : la ligne `bg_teams` qui représente un joueur en tournoi
// individuel (voir `docs/features/SOLO_TOURNAMENTS.md`). Sans membre, nommée
// d'après le pseudo, elle sert d'engagé aux tournois `participantType: "SOLO"`.
async function createSoloEntries(db: Pool, userIds: number[]): Promise<number[]> {
  console.log("🙋 Création des entrées solo (tournois individuels)...");
  const entryIds: number[] = [];

  for (const userId of userIds) {
    const [users] = await db.execute<(RowDataPacket & { pseudo: string; avatar_url: string | null })[]>(
      `SELECT pseudo, avatar_url FROM bg_users WHERE id = ? LIMIT 1`,
      [userId],
    );
    if (users.length === 0) continue;

    for (const name of soloEntryNameCandidates(users[0].pseudo, userId)) {
      try {
        const [result] = await db.execute<ResultSetHeader>(
          `INSERT INTO bg_teams (name, logo_url, description, is_ghost, solo_user_id)
           VALUES (?, ?, NULL, 0, ?)`,
          [name, users[0].avatar_url, userId],
        );
        entryIds.push(result.insertId as number);
        break;
      } catch {
        // Nom déjà pris par une équipe : on essaie le candidat suivant.
      }
    }
  }

  console.log(`  ✓ ${entryIds.length} entrées solo créées`);
  return entryIds;
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

async function createRecruitmentAds(db: Pool): Promise<void> {
  console.log("📣 Création des annonces de recrutement...");
  for (let i = 0; i < FICTIONAL_RECRUITMENT_ADS.length; i++) {
    const ad = FICTIONAL_RECRUITMENT_ADS[i];
    try {
      await db.execute(
        `INSERT INTO bg_recruitment_ads
           (title, team_name, domain, roles, body, contact_url, contact_discord,
            contact_discord_id, contact_preferred, highlight, active, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ad.title,
          ad.team_name,
          ad.domain,
          ad.roles,
          ad.body,
          ad.contact_url,
          ad.contact_discord,
          ad.contact_discord_id,
          ad.contact_preferred,
          ad.highlight,
          ad.active,
          (i + 1) * 10,
        ]
      );
    } catch (error) {
      console.error(`  \u2717 ${ad.title}:`, (error as Error).message);
    }
  }
  const urgent = FICTIONAL_RECRUITMENT_ADS.filter((a) => a.active === 1 && a.highlight !== "NONE");
  console.log(
    `  \u2713 ${FICTIONAL_RECRUITMENT_ADS.length} annonces créées (dont 1 brouillon · ${urgent.length} urgentes, 1 seule réellement mise en avant)`
  );
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
  waves: number,
  winsRequired: number
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
        playMatch(Number(m.team1_id), Number(m.team2_id), winsRequired)
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
  finish: boolean,
  winsRequired: number
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

    const played = await playBracket(connection, tournamentId, finish ? Infinity : playWaves, winsRequired);
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
  playWaves: number,
  winsRequired: number
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
          playMatch(Number(m.team1_id), Number(m.team2_id), winsRequired)
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
/**
 * Simule un tournoi « BlueGenji Survie » : manches d'endurance jusqu'à la
 * bascule en play-offs, puis l'arbre final. Même schéma que la Survie —
 * initialize → generate → reconcile, puis vagues de matchs joués.
 */
async function generateEnduranceTournament(
  db: Pool,
  tournamentId: number,
  finish: boolean,
  playWaves: number,
  forfeits: number,
  winsRequired: number
): Promise<void> {
  const connection = await db.getConnection();
  try {
    await initializeEnduranceTournament(tournamentId, connection);
    await generateEnduranceRound(tournamentId, connection);
    await reconcileEndurance(tournamentId, connection);

    let waves = 0;
    let played = 0;
    while (true) {
      const ready = readyMatches(await getMatchRows(connection, tournamentId));
      if (ready.length === 0) break;
      if (!finish && waves >= playWaves) break;

      for (const m of ready) {
        await finalizeMatch(
          connection,
          tournamentId,
          m,
          playMatch(Number(m.team1_id), Number(m.team2_id), winsRequired)
        );
        played++;
      }
      await reconcileEndurance(tournamentId, connection);
      waves++;
    }

    let forfeited = 0;
    for (let i = 0; i < forfeits; i++) {
      const [rows] = await connection.execute<(RowDataPacket & { team_id: number })[]>(
        `SELECT team_id FROM bg_endurance_standings
         WHERE tournament_id = ? AND status = 'ACTIVE'
         ORDER BY \`rank\` DESC, seed DESC
         LIMIT 1`,
        [tournamentId]
      );
      if (rows.length === 0) break;
      try {
        await forfeitEnduranceTeam(tournamentId, Number(rows[0].team_id), connection);
        forfeited++;
      } catch {
        break;
      }
    }

    console.log(
      `    ↳ endurance : ${played} matchs simulés sur ${waves} manche(s)` +
        (forfeited > 0 ? ` · ${forfeited} forfait(s)` : "")
    );
  } finally {
    connection.release();
  }
}

async function generateSurvivalTournament(
  db: Pool,
  tournamentId: number,
  finish: boolean,
  playWaves: number,
  forfeits: number,
  winsRequired: number
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
          playMatch(Number(m.team1_id), Number(m.team2_id), winsRequired)
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

// Génère un tournoi multi-phase. Persiste les phases dans la base, initialise
// le tournoi, puis joue les matchs à travers les phases en utilisant
// l'orchestration réelle (reconcilePhases pour l'avancement).
async function generateMultiPhaseTournament(
  db: Pool,
  tournamentId: number,
  phases: SeedPhase[],
  finish: boolean,
  playWaves: number,
  winsRequired: number
): Promise<void> {
  const connection = await db.getConnection();
  try {
    const phaseConfigs = phases.map((p, idx) => ({
      position: idx + 1,
      format: p.format,
      name: null,
      qualifierMode: p.qualifierMode,
      qualifierValue: p.qualifierValue,
      swissTotalRounds: p.swissTotalRounds ?? null,
      survivalRoundsBeforeFirstCut: p.survivalRoundsBeforeFirstCut ?? null,
      survivalRoundsPerCut: p.survivalRoundsPerCut ?? null,
      hasThirdPlaceMatch: p.hasThirdPlaceMatch ?? false,
    }));

    await insertPhases(connection, tournamentId, phaseConfigs);
    await initializeMultiTournament(tournamentId, connection);

    let totalPlayed = 0;
    let currentWaves = 0;
    // Garde-fou anti-blocage : une phase qui n'avance plus (aucun match joué et
    // aucun changement d'état) ferait tourner cette boucle à l'infini quand
    // `finish` est vrai, puisque plus rien ne la fait sortir. On préfère un
    // avertissement visible et un tournoi laissé en l'état à un seed suspendu.
    let lastSignature = "";

    while (true) {
      const loadedPhases = await loadPhases(connection, tournamentId);
      const currentPhase = loadedPhases.find((p) => p.state === "PENDING" || p.state === "RUNNING");

      if (!currentPhase) break;

      const signature = `${totalPlayed}|${loadedPhases.map((p) => `${p.id}:${p.state}`).join(",")}`;
      if (signature === lastSignature) {
        console.warn(
          `    ⚠ multi-phase : phase ${currentPhase.position} (${currentPhase.format}) bloquée, ` +
            `tournoi #${tournamentId} laissé en l'état`
        );
        break;
      }
      lastSignature = signature;

      if (currentPhase.state === "PENDING") {
        await setCurrentPhase(connection, tournamentId, currentPhase.id);

        // On passe par l'orchestrateur reel plutot que de reimplementer le
        // demarrage d'une phase : le seed teste ainsi le meme chemin que la prod.
        if (currentPhase.format === "SWISS" || currentPhase.format === "SURVIVAL") {
          await startPhase(tournamentId, currentPhase.id, connection);
          await reconcilePhases(tournamentId, connection);
        } else {
          const bracket = currentPhase.format as "SINGLE" | "DOUBLE";
          const tournament = await loadTournamentRow(connection, tournamentId);
          if (!tournament) break;
          const teamIds = await loadPhaseTeamIds(connection, currentPhase.id);

          if (bracket === "DOUBLE") {
            await createDoubleEliminationBracket(connection, tournament, teamIds, { phaseId: currentPhase.id });
          } else {
            await createSingleEliminationBracket(connection, tournament, teamIds, { phaseId: currentPhase.id });
          }
        }
      }

      let phaseWaves = 0;

      while (true) {
        const allMatches = await getMatchRows(connection, tournamentId);
        const phaseMatches = allMatches.filter((m) => Number(m.phase_id) === currentPhase.id);
        const phaseReady = readyMatches(phaseMatches);
        if (phaseReady.length === 0) break;
        if (!finish && phaseWaves >= playWaves) break;

        for (const m of phaseReady) {
          await finalizeMatch(
            connection,
            tournamentId,
            m,
            playMatch(Number(m.team1_id), Number(m.team2_id), winsRequired)
          );
          await reconcilePhases(tournamentId, connection);
          totalPlayed++;
        }
        phaseWaves++;
        currentWaves++;
      }

      await reconcilePhases(tournamentId, connection);

      if (!finish && currentWaves >= playWaves) break;

      const [rows] = await connection.execute<(RowDataPacket & { state: string })[]>(
        `SELECT state FROM bg_tournaments WHERE id = ? LIMIT 1`,
        [tournamentId]
      );
      if (rows[0]?.state === "FINISHED") break;
    }

    console.log(`    ↳ multi-phase : ${totalPlayed} matchs simulés`);
  } finally {
    connection.release();
  }
}

// Helper pour récupérer les team IDs d'une phase
async function loadPhaseTeamIds(
  connection: PoolConnection,
  phaseId: number
): Promise<number[]> {
  const [rows] = await connection.execute<(RowDataPacket & { team_id: number })[]>(
    `SELECT team_id FROM bg_tournament_phase_teams WHERE phase_id = ? ORDER BY seed ASC`,
    [phaseId]
  );
  return rows.map((r) => Number(r.team_id));
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
  // Survie, suisse et multi sont pilotés par leur orchestration (initialize → reconcile)
  // : on insère en RUNNING, puis l'orchestration bascule vers FINISHED.
  const orchestrated = isSurvival || isSwiss || isMulti || isEndurance;
  const insertState = orchestrated && def.state === "FINISHED" ? "RUNNING" : def.state;
  const finishedAt = !orchestrated && def.state === "FINISHED" ? startAt : null;

  // Format de match du tournoi (BO5, FT3…) : il pilote aussi les scores simulés,
  // pour que le jeu de test reste cohérent avec ce que l'interface autorise.
  const matchFormat = def.matchFormat ?? null;
  const winsRequired = matchFormat ? matchWinsRequired(matchFormat) : 2;

  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_tournaments
     (organizer_user_id, name, game, description, format, participant_type, has_third_place_match,
      survival_rounds_before_first_cut, survival_rounds_per_cut, swiss_total_rounds,
      endurance_start_points, endurance_playoff_size, match_format_type, match_format_value,
      max_teams, state, start_visibility_at, registration_open_at, registration_close_at, start_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
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
      matchFormat?.type ?? null,
      matchFormat?.value ?? null,
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

  if (def.state !== "UPCOMING" && def.state !== "REGISTRATION" && teamsToUse.length >= 2) {
    if (isMulti && def.phases) {
      await generateMultiPhaseTournament(db, tournamentId, def.phases, finish, def.playWaves ?? 2, winsRequired);
    } else if (isEndurance) {
      await generateEnduranceTournament(db, tournamentId, finish, def.playWaves ?? 3, def.forfeits ?? 0, winsRequired);
    } else if (isSurvival) {
      await generateSurvivalTournament(db, tournamentId, finish, def.playWaves ?? 3, def.forfeits ?? 0, winsRequired);
    } else if (isSwiss) {
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

  const gameLabel = def.game === "OW2" ? "Overwatch" : "Marvel Rivals";
  console.log(
    `  ✓ #${tournamentId} [${def.state}/${format}] ${gameLabel} · ${def.name} (${teamsToUse.length}/${def.maxTeams})`
  );
  return tournamentId;
}


// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("🚀 Seed BlueGenji Esport\n");

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

    // Hors du pool de tournois : elles servent à exercer l'administration des
    // équipes fantômes (badge, attribution, inscription manuelle par le staff).
    await createGhostTeams(db);
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

    // Engagés des tournois individuels : une entrée solo par joueur nommé.
    const soloEntryIds = await createSoloEntries(db, userIds);
    console.log();

    await createSponsors(db);
    console.log();

    await createBureau(db);
    console.log();

    await createRecruitmentAds(db);
    console.log();

    const organizerId = specialUserIds.get("Admin") ?? userIds[0];

    console.log("🎮 Création des tournois...");
    for (let i = 0; i < TOURNAMENTS.length; i++) {
      await createTournament(db, organizerId, teamIds, soloEntryIds, TOURNAMENTS[i], i);
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
    console.log(`  · ${FICTIONAL_RECRUITMENT_ADS.length} annonces de recrutement (longues descriptions, mises en avant concurrentes, brouillon)`);
    console.log(`  · ${TOURNAMENTS.length} tournois :`);
    console.log(`    - états : ${byState("UPCOMING")} à venir · ${byState("REGISTRATION")} inscriptions · ${byState("RUNNING")} en cours · ${byState("FINISHED")} terminés`);
    console.log(`    - formats : ${byFormat("SINGLE")} simple · ${byFormat("DOUBLE")} double · ${byFormat("SWISS")} suisse · ${byFormat("SURVIVAL")} survie · ${byFormat("MULTI")} multi-phase · ${byFormat("BG_SURVIE")} BG Survie`);
    console.log(`    - effectifs : 0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 21, 64, 128`);
    console.log(`    - individuel : ${TOURNAMENTS.filter((t) => t.participantType === "SOLO").length} tournois solo (${soloEntryIds.length} entrées disponibles)`);
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
