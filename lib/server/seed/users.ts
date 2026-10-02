/**
 * Comptes du jeu de test : les joueurs fictifs qui composent les équipes, et
 * les comptes « profils » qui isolent chacun un cas d'auth, de rôle, de
 * visibilité ou d'anonymisation.
 */

import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { PLAYED_MATCH_SQL } from "@/lib/shared/ranking";
import { TERMS_VERSION } from "@/lib/shared/terms-of-use";

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
    discord: 0 | 1;
  }>;
  /** Ouvert au recrutement (défaut 0, comme la colonne) — 1 = free agent s'il est sans équipe. */
  openToRecruitment?: 0 | 1;
  withGameTags?: boolean;
  discordId?: string;
  /** Tag Discord stocké (`discord_pseudo`). Absent = aucun tag. */
  discordTag?: string;
  /**
   * Le tag est-il **certifié** ? Un tag non certifié reste invisible pour tout
   * le monde, administrateurs compris — c'est le cas qu'il faut pouvoir
   * regarder, et il n'existe qu'ici.
   */
  discordVerified?: boolean;
  /**
   * Compte Battle.net rattaché (`blizzard_sub`). Avec un tag certifié, c'est ce
   * qu'il faut pour s'inscrire comme caster d'un match (`castBlockReason`).
   */
  blizzardSub?: string;
}

const SPECIAL_USERS: SpecialUserDef[] = [
  {
    pseudo: "Admin",
    purpose: "admin global (organisateur de tous les tournois seedés)",
    isAdmin: true,
    isAdult: 1,
    discordId: "900000000000000001",
    discordTag: "test_admin",
    discordVerified: true,
  },
  {
    pseudo: "Arbitre",
    purpose: "permission tournaments seule",
    platformRoles: ["ARBITRE"],
    isAdult: 1,
    discordId: "900000000000000002",
    discordTag: "test_arbitre",
    discordVerified: true,
  },
  {
    pseudo: "Caster",
    purpose:
      "rôle CASTER : aperçu du plateau (lecture seule) + diffusion ; identité vérifiée, peut s'inscrire pour caster",
    platformRoles: ["CASTER"],
    isAdult: 1,
    discordId: "900000000000000009",
    discordTag: "test_caster",
    discordVerified: true,
    blizzardSub: "seed-blizzard-caster",
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
    visibility: { avatar: 0, overwatch: 0, marvel: 0, major: 0, discord: 0 },
  },
  {
    pseudo: "ProfilPublic",
    purpose: "toutes les visibilités actives, majorité affichée",
    isAdult: 1,
    visibility: { avatar: 1, overwatch: 1, marvel: 1, major: 1, discord: 1 },
  },
  { pseudo: "Mineur", purpose: "compte mineur (is_adult = 0)", isAdult: 0 },
  { pseudo: "AgeInconnu", purpose: "majorité non renseignée (is_adult NULL)", isAdult: null },
  {
    pseudo: "SansTags",
    purpose: "aucun battletag ni tag Marvel Rivals",
    isAdult: 1,
    withGameTags: false,
  },
  {
    pseudo: "SansEquipe",
    purpose: "sans équipe, réglage par défaut : « SANS ÉQUIPE », hors filtre free agents",
    isAdult: 1,
  },
  {
    pseudo: "FreeAgent",
    purpose: "sans équipe et ouvert au recrutement (filtre free agents)",
    isAdult: 1,
    openToRecruitment: 1,
  },
  {
    pseudo: "DiscordNonCertifie",
    purpose: "tag Discord saisi mais non certifié (invisible même aux admins)",
    isAdult: 1,
    discordTag: "tag_non_prouve",
  },
  {
    pseudo: "DiscordCertifie",
    purpose: "tag Discord certifié (visible aux admins, aux arbitres en tournoi)",
    isAdult: 1,
    discordId: "900000000000000003",
    discordTag: "tag_prouve",
    discordVerified: true,
  },
  {
    pseudo: "DiscordVisible",
    purpose: "tag Discord certifié et rendu visible (lisible de tout joueur connecté)",
    isAdult: 1,
    discordId: "900000000000000010",
    discordTag: "tag_visible",
    discordVerified: true,
    visibility: { discord: 1 },
  },
  {
    pseudo: "DiscordVisibleNonCertifie",
    purpose: "case « Tag Discord » cochée sur un tag non certifié (reste masqué de tous)",
    isAdult: 1,
    discordTag: "tag_visible_non_prouve",
    visibility: { discord: 1 },
  },
  {
    pseudo: "CompteSupprime",
    purpose: "compte anonymisé (is_deleted = 1), membre d'une équipe qui a joué",
    // Tel que l'anonymisation le laisse : ni tag, ni majorité, ni recrutement.
    isAdult: null,
    isDeleted: true,
    withGameTags: false,
    openToRecruitment: 0,
  },
];

export async function createUsers(db: Pool): Promise<number[]> {
  console.log("👥 Création des joueurs...");
  const userIds: number[] = [];
  for (const [index, player] of FICTIONAL_PLAYERS.entries()) {
    const pseudo = `Test_${player.pseudo}`;
    // **Deux joueurs sur trois ont un tag certifié**, le troisième en a un qui
    // ne l'est pas. Ce n'est pas de la décoration : les conditions d'inscription
    // (`lib/shared/registration-filters.ts`) se jugent sur cette colonne, et un
    // jeu de test où personne n'est certifié rendrait l'inscription impossible
    // à essayer — tandis qu'un jeu où tout le monde l'est ne montrerait jamais
    // le refus. Le motif est déterministe, donc le seed reste reproductible.
    const discordVerified = index % 3 !== 2;
    // **Un tag certifié implique un identifiant prouvé** : `writeVerifiedTag`
    // écrit toujours les deux ensemble, et un compte certifié sans `discord_id`
    // est un état que la production ne sait pas produire — le jeu de test
    // donnerait à relire un cas qui n'existe nulle part. L'identifiant est
    // synthétique mais unique (la colonne l'exige) et hors des plages utilisées
    // par les comptes spéciaux.
    const discordId = discordVerified ? `9010000000000${String(index).padStart(5, "0")}` : null;
    // **Un joueur sur deux a rattaché son compte Blizzard**, pour la même raison
    // que la certification Discord juste au-dessus : la condition « compte
    // Blizzard » d'un tournoi (`lib/shared/registration-filters.ts`) se juge sur
    // `blizzard_sub`, et un jeu de test où la colonne est partout `NULL` ne
    // montrerait jamais qu'un refus. Le motif est **décalé** de celui du tag
    // (un sur deux contre deux sur trois) pour que les deux conditions ne
    // retombent pas sur les mêmes joueurs : une équipe peut ainsi buter sur
    // l'une sans buter sur l'autre, ce qui est exactement le cas à relire.
    const blizzardSub = index % 2 === 0 ? `seed-blizzard-${String(index).padStart(5, "0")}` : null;
    try {
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO bg_users
         (pseudo, overwatch_battletag, marvel_rivals_tag, discord_id, discord_pseudo, discord_verified_at,
          blizzard_sub, visible_avatar, visible_pseudo, visible_overwatch, visible_marvel, is_adult)
         VALUES (?, ?, ?, ?, ?, ${discordVerified ? "NOW()" : "NULL"}, ?, 1, 1, 1, 1, 1)`,
        [
          pseudo,
          player.battletag,
          player.marvelTag,
          discordId,
          player.pseudo.toLowerCase(),
          blizzardSub,
        ]
      );
      userIds.push(result.insertId as number);
    } catch (error) {
      console.error(`  ✗ ${pseudo}:`, (error as Error).message);
    }
  }
  console.log(`  ✓ ${userIds.length} joueurs créés`);
  return userIds;
}

/** Paramètres de l'`INSERT` d'un compte « profil », dans l'ordre des colonnes. */
function specialUserInsertParams(def: SpecialUserDef, pseudo: string): (string | number | null)[] {
  const visibility = {
    avatar: def.visibility?.avatar ?? 1,
    overwatch: def.visibility?.overwatch ?? 1,
    marvel: def.visibility?.marvel ?? 1,
    major: def.visibility?.major ?? 0,
    // Défaut de la colonne : l'exposition du tag est un choix.
    discord: def.visibility?.discord ?? 0,
  };
  const withTags = def.withGameTags !== false;
  return [
    pseudo,
    def.discordId ?? null,
    def.discordTag ?? null,
    def.blizzardSub ?? null,
    withTags ? `${def.pseudo}#1000` : null,
    withTags ? `${def.pseudo}#2023` : null,
    visibility.avatar,
    visibility.overwatch,
    visibility.marvel,
    visibility.major,
    visibility.discord,
    def.openToRecruitment ?? 0,
    def.isAdult === undefined ? 1 : def.isAdult,
    def.isAdmin ? 1 : 0,
    def.isDeleted ? 1 : 0,
    def.platformRoles ? JSON.stringify(def.platformRoles) : null,
  ];
}

// Crée les comptes « profils » (admin, rôles de plateforme, visibilités, âge,
// anonymisation) et retourne leurs ids indexés par pseudo court.
export async function createSpecialUsers(db: Pool): Promise<Map<string, number>> {
  console.log("🪪 Création des comptes de test (rôles / visibilité / âge)...");
  const ids = new Map<string, number>();

  for (const def of SPECIAL_USERS) {
    const pseudo = `Test_${def.pseudo}`;

    try {
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO bg_users
         (pseudo, discord_id, discord_pseudo, discord_verified_at,
          blizzard_sub, overwatch_battletag, marvel_rivals_tag,
          visible_avatar, visible_overwatch, visible_marvel, visible_major, visible_discord,
          open_to_recruitment, is_adult, is_admin, is_deleted, platform_roles_json)
         VALUES (?, ?, ?, ${def.discordVerified ? "NOW()" : "NULL"}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        specialUserInsertParams(def, pseudo),
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

/**
 * Place le compte supprimé du jeu de test dans une équipe qui a **joué**.
 *
 * Un compte supprimé n'est conservé que s'il a disputé un match
 * (`lib/shared/account-deletion.ts`) : sans match, le rattrapage des comptes
 * supprimés (`reconcileDeletedAccounts`, lancé au démarrage du site)
 * l'effacerait, et le cas « fiche d'un compte supprimé » disparaîtrait de la
 * matrice. Il est membre depuis 2020 — la fenêtre d'appartenance couvre donc
 * tous les tournois seedés — et reste au roster, comme l'anonymisation le
 * laisse.
 */
export async function attachDeletedAccountToPlayedTeam(db: Pool, userId: number | null): Promise<void> {
  if (userId === null) return;
  const [rows] = await db.execute<(RowDataPacket & { team_id: number })[]>(
    `SELECT m.team1_id AS team_id
       FROM bg_matches m
       JOIN bg_teams t ON t.id = m.team1_id
      WHERE ${PLAYED_MATCH_SQL}
        AND t.solo_user_id IS NULL
        AND t.is_ghost = 0
        AND t.name LIKE 'Test - %'
      ORDER BY m.id
      LIMIT 1`,
  );
  if (rows.length === 0) return;
  await db.execute(
    `INSERT INTO bg_team_members (team_id, user_id, roles_json, joined_at)
     VALUES (?, ?, ?, '2020-01-01 00:00:00')`,
    [rows[0].team_id, userId, '["DPS"]'],
  );
}

/**
 * Les comptes du jeu de test ont accepté les conditions d'utilisation en
 * vigueur, comme tout compte né par la page de connexion : sans cela, chaque
 * gérant de la matrice verrait la modale d'acceptation au premier chargement,
 * et chaque geste de gestion d'équipe serait refusé en 409. Pour éprouver la
 * modale, remettre `terms_version` à `NULL` sur un propriétaire d'équipe.
 * Le compte supprimé n'accepte rien.
 */
export async function acceptTermsForSeededAccounts(db: Pool): Promise<void> {
  await db.execute(
    `UPDATE bg_users
     SET terms_version = ?, terms_accepted_at = NOW()
     WHERE pseudo LIKE 'Test_%' AND is_deleted = 0`,
    [TERMS_VERSION],
  );
}
