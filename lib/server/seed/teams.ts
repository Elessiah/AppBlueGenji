/**
 * Équipes du jeu de test : équipes nommées (rosters et cas limites de
 * composition), équipes fantômes, entrées solo des tournois individuels, et
 * équipes de remplissage des gros brackets.
 */

import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { visibleAvatarUrl } from "@/lib/shared/avatar";
import { soloEntryNameCandidates } from "@/lib/shared/participants";
import { toServedUploadUrl } from "@/lib/shared/uploads";
import { bulkTeamTag } from "./cases";

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
  /**
   * Sigle de l'équipe (`lib/shared/team-tag.ts`) : 2 à 4 caractères
   * alphanumériques, **unique sur tout le site**. `null` couvre le cas des
   * équipes sans sigle, qui retombent sur les initiales de leur nom — l'état
   * de toutes les équipes créées avant la fonctionnalité.
   */
  tag: string | null;
}

const FICTIONAL_TEAMS: TeamDef[] = [
  { name: "Dragon Squad", members: [0, 1, 2, 3, 4, 5, 6], logo: true, tag: "DRGN" },
  { name: "Phoenix Force", members: [3, 4, 5, 7, 8], tag: "PHNX" },
  { name: "Thunder Legion", members: [6, 7, 8, 9], logo: true, tag: "THDR" },
  { name: "Frost Alliance", members: [9, 10, 11], tag: "FRST" },
  { name: "Eclipse Titans", members: [12, 13, 14, 15], tag: "ECL" },
  { name: "Shadow Masters", members: [0, 5, 10], tag: "SHDW" },
  { name: "Stellar Nexus", members: [2, 7, 12], tag: "STLR" },
  { name: "Cosmic Void", members: [1, 8, 15], tag: "CSMC" },
  { name: "Inferno Squad", members: [16, 17, 18], tag: "INFR" },
  { name: "Vortex Crew", members: [19, 20, 21], tag: "VRTX" },
  { name: "Blaze Titans", members: [22, 23, 24], tag: "BLZ" },
  { name: "Nova Warriors", members: [25, 26, 27], tag: "NOVA" },
  { name: "Silent Hunters", members: [28, 29, 30], tag: "SLNT" },
  { name: "Ghost Division", members: [3, 16, 19], tag: "GHST" },
  { name: "Ice Dynasty", members: [9, 22, 25], tag: "ICE" },
  { name: "Fire Legends", members: [17, 23, 28], tag: "FIRE" },
  // Cas limites de composition
  { name: "Solo Ranger", members: [31], tag: "SR" },
  {
    name: "Staff Only",
    members: [20, 26],
    roles: [
      ["OWNER", "MANAGER"],
      ["COACH"],
    ],
    // Sigle numérique : le jeu de caractères autorisé ne se limite pas aux
    // lettres.
    tag: "ST01",
  },
  {
    name: "Roster Complet",
    members: [1, 4, 11, 13, 18, 24, 29, 30],
    logo: true,
    // Sans sigle : couvre l'affichage de repli (initiales du nom) sur la carte
    // d'annuaire comme sur la fiche.
    tag: null,
  },
];

/**
 * Fabrique le logo d'équipe du jeu de test, et rend son URL servie.
 *
 * Le seed écrivait `https://placehold.co/128x128/...` dans `bg_teams.logo_url`.
 * C'était le **seul** chemin du projet qui produisait réellement un logo
 * d'origine étrangère, et il suffisait à rendre le défaut reproductible : trois
 * lignes sur une base seedée, servies à tout visiteur de l'annuaire, et
 * couvertes par le drapeau `unoptimized` qui désarmait `remotePatterns`.
 *
 * Un `NULL` aurait fermé la fuite mais fait disparaître le cas « équipe avec
 * logo » de la matrice, qui existe exprès. On écrit donc un vrai fichier, une
 * fois, dans le même dossier et au même format qu'un téléversement : le jeu de
 * test couvre alors le cas **tel qu'il se présente en production**, ce que
 * l'URL étrangère ne faisait pas.
 */
async function ensureSeedTeamLogo(): Promise<string> {
  const dir = path.join(process.cwd(), "public", "uploads", "teams");
  const filename = "seed-team-logo.webp";
  await mkdir(dir, { recursive: true });
  const logo = await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 11, g: 18, b: 32, alpha: 1 } },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">` +
            `<text x="64" y="80" font-family="sans-serif" font-size="46" font-weight="700"` +
            ` fill="#5ac8ff" text-anchor="middle">BG</text></svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .webp({ quality: 82 })
    .toBuffer();
  await writeFile(path.join(dir, filename), logo);
  return toServedUploadUrl(`/uploads/teams/${filename}`);
}

export async function createTeams(db: Pool, userIds: number[]): Promise<number[]> {
  console.log("🏆 Création des équipes...");
  const teamIds: number[] = [];
  const seedLogoUrl = await ensureSeedTeamLogo();
  for (const team of FICTIONAL_TEAMS) {
    const teamName = `Test - ${team.name}`;
    try {
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO bg_teams (name, tag, logo_url) VALUES (?, ?, ?)`,
        [teamName, team.tag, team.logo ? seedLogoUrl : null]
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
// Une équipe fantôme entre dans le même espace de noms de sigles qu'une équipe
// réelle : elle court les mêmes tournois et s'affiche dans les mêmes plateaux.
const GHOST_TEAMS = [
  { name: "Test - Fantôme Invitée", description: "Équipe invitée, inscrite hors plateforme.", tag: "GH01" },
  { name: "Test - Fantôme Remplissage", description: null, tag: "GH02" },
] as const;

export async function createGhostTeams(db: Pool): Promise<number[]> {
  console.log("👻 Création des équipes fantômes...");
  const teamIds: number[] = [];
  for (const team of GHOST_TEAMS) {
    try {
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO bg_teams (name, tag, logo_url, description, is_ghost) VALUES (?, ?, NULL, ?, 1)`,
        [team.name, team.tag, team.description],
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
export async function createSoloEntries(db: Pool, userIds: number[]): Promise<number[]> {
  console.log("🙋 Création des entrées solo (tournois individuels)...");
  const entryIds: number[] = [];

  for (const userId of userIds) {
    const [users] = await db.execute<
      (RowDataPacket & { pseudo: string; avatar_url: string | null; visible_avatar: 0 | 1 })[]
    >(
      `SELECT pseudo, avatar_url, visible_avatar FROM bg_users WHERE id = ? LIMIT 1`,
      [userId],
    );
    if (users.length === 0) continue;

    // Le logo d'une entrée solo est servi à tout le monde, jusque sur la carte
    // du match en direct de l'accueil : il obéit donc au réglage d'avatar comme
    // partout ailleurs (`lib/shared/avatar.ts`). Cette boucle recopiait
    // `avatar_url` brut, si bien que chaque exécution du jeu de test
    // republiait l'avatar des comptes « profil privé » — et que le contrôle en
    // conditions réelles montrait la fuite qu'on venait de fermer.
    const logoUrl = visibleAvatarUrl(users[0].avatar_url, users[0].visible_avatar === 1);

    for (const name of soloEntryNameCandidates(users[0].pseudo, userId)) {
      try {
        const [result] = await db.execute<ResultSetHeader>(
          `INSERT INTO bg_teams (name, logo_url, description, is_ghost, solo_user_id)
           VALUES (?, ?, NULL, 0, ?)`,
          [name, logoUrl, userId],
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
export async function createBulkTeams(db: Pool, count: number): Promise<number[]> {
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
        `INSERT INTO bg_teams (name, tag, logo_url) VALUES (?, ?, NULL)`,
        [`Test - Bracket Team ${i}`, bulkTeamTag(i)]
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
