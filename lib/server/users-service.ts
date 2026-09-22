import crypto from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { sendBotLog } from "@/lib/server/bot-integration";
import { getDatabase } from "@/lib/server/database";
import {
  accountDeletionPlan,
  type AccountDeletionPlan,
  type AccountTrace,
} from "@/lib/shared/account-deletion";
import { NamedLockUnavailableError, withNamedLock } from "@/lib/server/named-lock";
import { ensureUniquePseudo, resolveRoles } from "@/lib/server/auth";
import { normalizePseudo, parseRoles, toIso } from "@/lib/server/serialization";
import { deleteStoredImage } from "@/lib/server/image-upload";
import { syncSoloEntryIdentity, syncSoloEntryIdentityOn } from "@/lib/server/solo-entries-service";
import { importRemoteAvatar, shouldImportRemoteAvatar } from "@/lib/server/user-avatar-import";
import { visibleAvatarUrl } from "@/lib/shared/avatar";
import { toDiskUploadPath } from "@/lib/shared/uploads";
import { formatPlayerSignupLog, type PlayerSignupProvider } from "@/lib/shared/bot-logs";
import { isDiscordNumericId, visibleDiscordTag } from "@/lib/shared/discord-identity";
import { can, sanitizePlatformRoles, type PlatformRole } from "@/lib/shared/permissions";
import { getPlayerEntityStats, loadPlayerRecords } from "@/lib/server/stats-service";
import type {
  FullProfileResponse,
  PersonalDataExport,
  PublicUserProfile,
  TeamRole,
  UserTeamTimeline,
} from "@/lib/shared/types";

/**
 * Ce que la connexion Google rapporte, et **tout** ce qu'elle rapporte.
 *
 * **L'adresse n'y est plus, et le scope qui la demandait non plus.** Elle avait
 * un seul usage : rattacher une identité Google neuve à un compte du site sur
 * l'égalité de la chaîne. Ce rattachement a disparu — un moyen de connexion
 * s'ajoute désormais depuis `/profil`, en étant *déjà* connecté, ce qui est une
 * preuve autrement plus solide qu'une adresse dont le site n'est pas
 * l'émetteur. Privée de son unique lecteur, la colonne `bg_users.email` ne
 * pesait plus que d'un côté : une liste d'adresses est exactement ce qu'une
 * fuite fait le plus regretter, et la garder « au cas où » revient à en
 * assumer le risque pour un usage qui n'existe pas.
 *
 * C'est aussi pourquoi `emailVerified` a disparu avec elle : il ne servait qu'à
 * garder ce rattachement honnête.
 */
export type GoogleProfilePayload = {
  sub: string;
  name?: string;
  picture?: string;
};

export type DiscordChallenge = {
  challengeId: number;
  code: string;
  expiresAt: Date;
};

/**
 * Ce qu'un code juste rend, en plus du « oui ».
 *
 * Le **tag** est celui qui a servi à résoudre l'identifiant à la demande, relu
 * sur la ligne du défi. La certification l'écrit tel quel, et ne prend pas celui
 * que le client renvoie à la confirmation : entre les deux requêtes, la seconde
 * valeur n'est plus couverte par la moindre preuve. `null` quand la demande
 * portait un identifiant numérique — il n'y avait alors aucun tag à retenir.
 */
export type DiscordChallengeProof = {
  handle: string | null;
};

type UserRow = RowDataPacket & {
  id: number;
  pseudo: string;
  avatar_url: string | null;
  overwatch_battletag: string | null;
  marvel_rivals_tag: string | null;
  discord_pseudo: string | null;
  discord_verified_at?: Date | null;
  is_adult: 0 | 1 | null;
  visible_avatar: 0 | 1;
  visible_pseudo: 0 | 1;
  visible_overwatch: 0 | 1;
  visible_marvel: 0 | 1;
  visible_major: 0 | 1;
  open_to_recruitment: 0 | 1;
  is_admin?: 0 | 1;
  is_deleted?: 0 | 1;
  platform_roles_json?: string | null;
  created_at: Date;
};

type TeamTimelineRow = RowDataPacket & {
  team_id: number;
  team_name: string;
  joined_at: Date;
  left_at: Date | null;
  roles_json: string;
};

function mapPublicUser(row: UserRow): PublicUserProfile {
  return {
    id: Number(row.id),
    pseudo: row.pseudo,
    avatarUrl: row.avatar_url,
    overwatchBattletag: row.overwatch_battletag,
    marvelRivalsTag: row.marvel_rivals_tag,
    isAdult: row.is_adult === null ? null : Boolean(row.is_adult),
    visibility: {
      avatar: Boolean(row.visible_avatar),
      overwatch: Boolean(row.visible_overwatch),
      marvel: Boolean(row.visible_marvel),
      major: Boolean(row.visible_major),
    },
    openToRecruitment: Boolean(row.open_to_recruitment),
    createdAt: toIso(row.created_at)!,
  };
}

/**
 * Applique les réglages de visibilité d'un profil pour un spectateur tiers :
 * chaque champ non public est masqué (l'avatar masqué devient `null`). Aucun
 * effet lorsque le spectateur consulte son propre profil (`isSelf`). Centralise
 * la logique de masquage pour que l'annuaire `/joueurs` et la fiche profil
 * `/joueurs/[id]` restent cohérents.
 *
 * Le **pseudo n'est jamais masqué** : il identifie le joueur dans les brackets,
 * les rosters et les feuilles de match, où l'anonymat n'a pas de sens.
 */
function applyVisibility<T extends PublicUserProfile>(profile: T, isSelf: boolean): T {
  // L'avatar passe par la règle partagée (`lib/shared/avatar.ts`) : le roster
  // d'une équipe et le logo d'une entrée solo la posent aussi, et trois copies
  // divergeraient — la première l'avait déjà fait en ne la posant pas du tout.
  profile.avatarUrl = visibleAvatarUrl(profile.avatarUrl, profile.visibility.avatar, isSelf);
  if (isSelf) return profile;
  if (!profile.visibility.overwatch) profile.overwatchBattletag = null;
  if (!profile.visibility.marvel) profile.marvelRivalsTag = null;
  if (!profile.visibility.major) profile.isAdult = null;
  return profile;
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/**
 * Compare deux empreintes en temps constant.
 *
 * Les deux opérandes sont des SHA-256 en hexadécimal, donc de longueur fixe et
 * connue : la comparaison ne fuit rien de plus que « égales ou non ». On
 * n'aurait pas pu extraire le code d'une fuite de temps sur `===` en pratique,
 * mais une comparaison de secret se fait en temps constant, sans exception à
 * évaluer au cas par cas.
 */
function timingSafeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function randomCode(): string {
  const randomInt = crypto.randomInt(100000, 1000000);
  return String(randomInt);
}

/**
 * Un tag Discord tel qu'on le range en base : sans espaces autour, sans le `@`
 * que le client Discord colle devant, et **jamais un identifiant numérique**.
 *
 * Le dernier point est la seule règle qui compte ici. La résolution accepte un
 * identifiant à la place d'un tag (repli quand le bot ne partage aucun serveur
 * avec le joueur), mais un identifiant n'est pas un pseudo : l'écrire dans
 * `discord_pseudo` afficherait un nombre de dix-huit chiffres partout où
 * l'arbitrage attend un nom, et le joueur croirait avoir certifié son tag.
 *
 * Rend `null` pour tout ce qui n'est pas un tag — l'appelant n'a alors rien à
 * certifier, et le dit.
 */
export function normalizeDiscordHandle(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim().replace(/^@/, "");
  if (trimmed.length === 0) return null;
  // Prédicat partagé avec la page de connexion, qui doit annoncer l'exposition
  // exactement quand cette fonction va certifier : deux lectures du même motif
  // divergeraient en une phrase fausse.
  if (isDiscordNumericId(trimmed)) return null;
  return trimmed.slice(0, 64);
}

export async function getUserById(userId: number): Promise<PublicUserProfile | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<UserRow[]>(
    `SELECT
      id,
      pseudo,
      avatar_url,
      overwatch_battletag,
      marvel_rivals_tag,
      is_adult,
      visible_avatar,
      visible_overwatch,
      visible_marvel,
      visible_major,
      open_to_recruitment,
      created_at
     FROM bg_users
     WHERE id = ?
     LIMIT 1`,
    [userId],
  );

  if (rows.length === 0) return null;
  return mapPublicUser(rows[0]);
}

export async function listPlayers(viewerId: number): Promise<PublicUserProfile[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<UserRow[]>(
    `SELECT
      id,
      pseudo,
      avatar_url,
      overwatch_battletag,
      marvel_rivals_tag,
      is_adult,
      visible_avatar,
      visible_overwatch,
      visible_marvel,
      visible_major,
      open_to_recruitment,
      is_deleted,
      created_at
     FROM bg_users
     ORDER BY is_deleted ASC, pseudo ASC`,
  );

  // `isDeleted` voyage jusqu'à l'annuaire, qui masque ces comptes par défaut :
  // un compte anonymisé n'est plus personne, mais sa ligne reste nécessaire à
  // qui remonte un ancien match. Le filtre est côté client, comme les autres de
  // cet écran — la liste entière y est déjà, et ces lignes ne portent plus rien
  // de personnel.
  const baseUsers = rows.map((row) => ({
    ...applyVisibility(mapPublicUser(row), Number(row.id) === viewerId),
    isDeleted: Boolean(row.is_deleted),
  }));
  const userIds = baseUsers.map((u) => u.id);

  // Les badges de jeu se dérivent des tags bruts : jouer à OW/MR n'est pas
  // une donnée privée (seule la chaîne exacte du battletag l'est), donc ils
  // restent affichés même si `visible_overwatch`/`visible_marvel` masque le tag.
  const gamesByUserId = new Map<number, ("OW" | "MR")[]>(
    rows.map((row) => {
      const games: ("OW" | "MR")[] = [];
      if (row.overwatch_battletag) games.push("OW");
      if (row.marvel_rivals_tag) games.push("MR");
      return [Number(row.id), games];
    }),
  );

  if (userIds.length === 0) return baseUsers;

  // Get current team memberships and roles
  const [teamMemberships] = await db.execute<
    (RowDataPacket & {
      user_id: number;
      team_id: number;
      team_name: string;
      roles_json: string;
    })[]
  >(
    `SELECT tm.user_id, tm.team_id, t.name AS team_name, tm.roles_json
     FROM bg_team_members tm
     JOIN bg_teams t ON t.id = tm.team_id
     WHERE tm.user_id IN (${userIds.map(() => "?").join(",")})
       AND tm.left_at IS NULL`,
    userIds,
  );

  const membershipByUserId = new Map(teamMemberships.map((m) => [m.user_id, m]));

  // Tournois disputés et bilan de matchs : **le même chargeur que la fiche**
  // (`loadPlayerRecords`). Les deux requêtes d'agrégation qui vivaient ici
  // rendaient trois nombres que la fiche contredisait — byes et matchs fantômes
  // comptés, défaites lues sur `loser_team_id` (que le moteur ne renseigne pas
  // toujours), fenêtres d'appartenance ignorées. Un seul chargeur, donc un seul
  // bilan par joueur, quelle que soit la page qui l'affiche.
  const recordsByUserId = await loadPlayerRecords(userIds);

  return baseUsers.map((user) => {
    const membership = membershipByUserId.get(user.id);
    const games = gamesByUserId.get(user.id) ?? [];

    const record = recordsByUserId.get(user.id) ?? {
      wins: 0,
      losses: 0,
      tournamentsPlayed: 0,
    };

    return {
      ...user,
      team: membership
        ? {
            id: membership.team_id,
            name: membership.team_name,
            colorIndex: membership.team_id % 7,
          }
        : null,
      roles: membership ? parseRoles(membership.roles_json) : [],
      games,
      tournamentsCount: record.tournamentsPlayed,
      wins: record.wins,
      losses: record.losses,
    };
  });
}

/**
 * Annonce la naissance d'un compte au journal Discord du bot.
 *
 * **Posé sur l'insertion, pas sur la connexion.** Les deux voies d'entrée du
 * site passent par une fonction `createOrGet…` qui rend le même identifiant
 * qu'un compte soit né ou simplement retrouvé : une route qui voudrait
 * journaliser l'inscription devrait redemander à la base si ce compte existait
 * déjà — une seconde règle, qui dériverait de celle-ci au premier changement, et
 * une ligne par connexion le jour où elle se tromperait. Ici il n'y a rien à
 * décider : l'`INSERT` vient de rendre un `insertId`, donc le joueur est neuf.
 *
 * Au meilleur effort et sans être attendue, comme tout le journal : un bot
 * endormi n'allonge pas une connexion et ne la fait pas échouer. `sendBotLog`
 * avale déjà ses erreurs ; le `catch` ne couvre que le rejet qu'une version
 * future pourrait laisser passer, qui deviendrait sinon un rejet non traité.
 */
function announcePlayerSignup(
  userId: number,
  pseudo: string,
  provider: PlayerSignupProvider,
): void {
  void sendBotLog(
    formatPlayerSignupLog({ player: { id: userId, pseudo }, provider }),
  ).catch(() => undefined);
}

export async function createOrGetGoogleUser(profile: GoogleProfilePayload): Promise<number> {
  const db = await getDatabase();

  const [existing] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE google_sub = ? LIMIT 1`,
    [profile.sub],
  );

  if (existing.length > 0) {
    const userId = Number(existing[0].id);
    await adoptRemoteAvatar(userId, profile.picture);
    return userId;
  }

  // **Aucune revendication d'un compte existant.**
  //
  // Cette fonction lisait auparavant l'adresse du profil Google et, quand elle
  // correspondait à celle d'un membre, posait le `sub` sur ce compte-là — une
  // session ouverte en un clic sur la seule égalité d'une chaîne de caractères,
  // et le chemin d'entrée le plus court du site. Le contrôle de `email_verified`
  // l'avait rendu honnête ; il reste que le site n'a pas à décider qu'une
  // adresse *est* une personne.
  //
  // Le geste qu'il servait existe toujours, mais à l'endroit où il se prouve
  // tout seul : depuis `/profil`, un joueur **déjà connecté** rattache un second
  // fournisseur (`lib/server/account-identities.ts`). Une identité Google
  // inconnue, elle, ouvre un compte neuf — et rien d'autre.
  const pseudoSource = profile.name ?? `player${Date.now().toString().slice(-5)}`;
  const pseudo = await ensureUniquePseudo(pseudoSource);

  // L'avatar n'est pas posé ici : le nom du fichier porte l'identifiant du
  // compte, qui n'existe qu'une fois la ligne écrite. La photo est copiée juste
  // après, et son échec ne remet pas la création en cause.
  const [created] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_users (pseudo, avatar_url, google_sub)
     VALUES (?, NULL, ?)`,
    [pseudo, profile.sub],
  );

  const userId = Number(created.insertId);
  announcePlayerSignup(userId, pseudo, "GOOGLE");
  await adoptRemoteAvatar(userId, profile.picture);
  return userId;
}

/**
 * Copie la photo de profil rapportée par un fournisseur OAuth, si elle a lieu
 * d'être.
 *
 * L'ancienne écriture rangeait l'URL de Google telle quelle, si bien que chaque
 * page portant cet avatar annonçait l'IP du **visiteur** à Google. La photo est
 * désormais copiée chez nous, et `avatar_url` ne porte plus que des fichiers du
 * site — c'est ce que `visibleAvatarUrl` exige à la sortie. Discord sert ses
 * avatars depuis son propre CDN : même geste, même raison, donc la même
 * fonction.
 *
 * Silencieux par construction : un CDN indisponible ne doit pas faire échouer
 * une connexion. Le compte reste alors sans avatar — pastille à initiale — et
 * la tentative sera refaite au prochain passage, `shouldImportRemoteAvatar`
 * n'ayant toujours rien de local à constater.
 */
export async function adoptRemoteAvatar(userId: number, picture: string | undefined): Promise<void> {
  if (!picture) return;

  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { avatar_url: string | null })[]>(
    `SELECT avatar_url FROM bg_users WHERE id = ? LIMIT 1`,
    [userId],
  );
  if (rows.length === 0) return;
  if (!shouldImportRemoteAvatar(rows[0].avatar_url)) return;

  const stored = await importRemoteAvatar(picture, userId);
  if (!stored) return;

  await db.execute(`UPDATE bg_users SET avatar_url = ? WHERE id = ?`, [stored, userId]);
}

/**
 * Retrouve (ou crée) le compte rattaché à cet identifiant Discord.
 *
 * `verifiedHandle` est le **tag prouvé** par le code qui vient d'être consommé
 * (`null` quand la demande portait un identifiant numérique). Il est écrit tel
 * quel, et **certifié** : se connecter par Discord *est* la preuve que la
 * certification demande, si bien qu'un joueur qui entre par cette porte n'a
 * jamais à la refaire depuis son profil.
 *
 * Il **écrase** le tag stocké, y compris un tag déjà certifié, et ce n'est pas
 * une négligence : on n'arrive ici que par un identifiant qui a résolu ce
 * handle-là. Les deux valeurs désignent donc le même compte Discord, et la plus
 * récente est la bonne — un pseudo Discord se change, et c'est précisément le cas
 * où le tag stocké est périmé.
 */
export async function createOrGetDiscordUser(
  discordId: string,
  pseudoInput?: string,
  verifiedHandle?: string | null,
  /**
   * Photo de profil Discord, à **copier** chez nous comme celle de Google.
   *
   * Le code par message privé n'en rapporte aucune — le bot ne résout qu'un
   * identifiant —, l'aller-retour OAuth si. Elle ne remplace jamais un avatar
   * déjà téléversé (`shouldImportRemoteAvatar`).
   */
  avatarUrl?: string | null,
): Promise<number> {
  const db = await getDatabase();
  const handle = normalizeDiscordHandle(verifiedHandle);

  const [existing] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE discord_id = ? LIMIT 1`,
    [discordId],
  );

  if (existing.length > 0) {
    const userId = Number(existing[0].id);
    if (handle) {
      await db.execute(
        `UPDATE bg_users
         SET discord_pseudo = ?,
             discord_verified_at = NOW()
         WHERE id = ?`,
        [handle, userId],
      );
    }
    await adoptRemoteAvatar(userId, avatarUrl ?? undefined);
    return userId;
  }

  const rawPseudo = normalizePseudo(pseudoInput || handle || `discord_${discordId.slice(-6)}`);
  const pseudo = await ensureUniquePseudo(rawPseudo);

  const [created] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_users (pseudo, discord_id, discord_pseudo, discord_verified_at)
     VALUES (?, ?, ?, ${handle ? "NOW()" : "NULL"})`,
    [pseudo, discordId, handle],
  );

  const userId = Number(created.insertId);
  announcePlayerSignup(userId, pseudo, "DISCORD");
  await adoptRemoteAvatar(userId, avatarUrl ?? undefined);
  return userId;
}

/**
 * Retrouve (ou crée) le compte rattaché à ce Battle.net.
 *
 * **Le BattleTag n'a pas de colonne à lui** : il *est*
 * `bg_users.overwatch_battletag`, le champ que le profil propose déjà de saisir
 * à la main pour que les autres joueurs puissent s'ajouter en jeu. En avoir une
 * seconde ferait deux BattleTags pour un joueur, dont un faux, et l'écran
 * devrait choisir.
 *
 * **Et Blizzard l'écrase à chaque connexion**, y compris sur une valeur saisie à
 * la main. C'est le sens de ce rattachement : entre ce que Blizzard affirme et
 * ce qu'un joueur a tapé, la source fait foi — un BattleTag mal recopié ne se
 * voit pas, il se constate quand l'ajout en jeu échoue. Le réglage de visibilité
 * (`visible_overwatch`), lui, n'est pas touché : la connexion corrige une
 * donnée, elle ne publie rien.
 *
 * `null` quand le compte Battle.net n'a pas de BattleTag — le champ reste alors
 * ce qu'il était, on n'efface pas une saisie avec du vide.
 */
export async function createOrGetBlizzardUser(sub: string, battletag: string | null): Promise<number> {
  const db = await getDatabase();
  const tag = normalizeBattletag(battletag);

  const [existing] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE blizzard_sub = ? LIMIT 1`,
    [sub],
  );

  if (existing.length > 0) {
    const userId = Number(existing[0].id);
    if (tag) {
      await db.execute(`UPDATE bg_users SET overwatch_battletag = ? WHERE id = ?`, [tag, userId]);
    }
    return userId;
  }

  // Le pseudo du site se déduit du BattleTag amputé de son discriminant :
  // « Nova#2143 » donne « nova ». Le discriminant est un détail de Blizzard, il
  // n'a rien à faire dans une URL de profil.
  const pseudoSource = tag ? tag.split("#")[0] : `player${Date.now().toString().slice(-5)}`;
  const pseudo = await ensureUniquePseudo(pseudoSource);

  const [created] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_users (pseudo, blizzard_sub, overwatch_battletag)
     VALUES (?, ?, ?)`,
    [pseudo, sub, tag],
  );

  const userId = Number(created.insertId);
  announcePlayerSignup(userId, pseudo, "BLIZZARD");
  return userId;
}

/**
 * Le BattleTag tel qu'il s'écrit en base, ou `null`.
 *
 * Borné à la largeur de la colonne (64), et vidé s'il est vide : un compte
 * Battle.net sans BattleTag existe, et écrire une chaîne vide par-dessus une
 * saisie du joueur serait la détruire pour rien.
 */
export function normalizeBattletag(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 64);
}

/**
 * Indique si un compte du site est déjà rattaché à cet identifiant Discord.
 *
 * Sert au formulaire de connexion : le champ « pseudo site » n'a de sens qu'à
 * la création du compte, il est donc masqué lors des connexions suivantes.
 */
export async function discordAccountExists(discordId: string): Promise<boolean> {
  const db = await getDatabase();

  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE discord_id = ? LIMIT 1`,
    [discordId],
  );

  return rows.length > 0;
}

/**
 * Nombre d'essais accordés à un code de connexion Discord avant qu'il ne soit
 * brûlé.
 *
 * Le code fait six chiffres : un million de combinaisons, ce qui n'est un
 * secret que si l'on **compte les essais**. La colonne `attempts` existait
 * depuis toujours et n'était lue nulle part — elle s'incrémentait sans jamais
 * rien refuser —, si bien qu'un tiers connaissant le pseudo Discord d'un joueur
 * (une information publique sur n'importe quel serveur) pouvait demander un
 * code puis énumérer les six chiffres jusqu'à ouvrir sa session. Cinq essais
 * suffisent à qui a lu son message privé, et ramènent l'attaque à une chance
 * sur deux cent mille par code.
 */
export const MAX_DISCORD_CODE_ATTEMPTS = 5;

/**
 * Codes délivrables à un même compte Discord sur {@link DISCORD_CODE_WINDOW_MINUTES}.
 *
 * C'est **cette** borne, et non le plafond de débit en mémoire, qui tient la
 * force brute : `lib/server/rate-limit.ts` compte dans une `Map` d'un seul
 * processus, dont le seau se vide entièrement (`bucket.clear()`) dès qu'on lui
 * fabrique dix mille clés — et la clé est ici un identifiant Discord que
 * l'appelant choisit. Le plafond en mémoire reste utile comme première ligne,
 * gratuite ; la garantie, elle, est en base.
 *
 * Cinq codes par quart d'heure : cinq essais chacun, soit vingt-cinq
 * combinaisons sur un million, et cinq messages privés que la victime voit
 * arriver.
 */
export const MAX_DISCORD_CODES_PER_WINDOW = 5;

/** Fenêtre de {@link MAX_DISCORD_CODES_PER_WINDOW}, en minutes. */
export const DISCORD_CODE_WINDOW_MINUTES = 15;

/**
 * Durée de rétention d'un code déjà expiré.
 *
 * Rien n'effaçait jamais une ligne de `bg_discord_login_challenges` : la table
 * grossissait d'une ligne par demande, définitivement. Le ménage se fait à la
 * création, comme celui des sessions dans `auth.ts`, et laisse largement de
 * quoi compter la fenêtre ci-dessus.
 */
const DISCORD_CHALLENGE_RETENTION_HOURS = 24;

/**
 * Préfixe du verrou nommé qui sérialise l'émission de codes d'un compte.
 *
 * Le verrou porte sur **un compte Discord**, pas sur la table : deux joueurs qui
 * demandent un code au même instant ne s'attendent pas. `discord_id` tient en 40
 * caractères, le nom reste donc loin des 64 que MySQL accorde.
 */
const DISCORD_CODE_LOCK_PREFIX = "bg_discord_code:";

/**
 * Attente maximale du verrou, en secondes.
 *
 * **Très court, et le chiffre compte.** `GET_LOCK` attend sur une connexion du
 * pool, qui n'en a que 25 : chaque demande en attente en immobilise une, et
 * elles manquent alors à *tout le site*, pas seulement à la connexion Discord.
 * Une attente de cinq secondes suffisait à ce que vingt-cinq demandes visant le
 * même compte fassent patienter l'accueil, les tournois et toute écriture
 * derrière elles — le verrou qui protège le plafond aurait fabriqué une panne
 * plus large que celle qu'il évite.
 *
 * Une seconde est déjà mille fois la durée de la section protégée (un comptage
 * et une insertion). Ce qui attend plus longtemps que cela n'est plus une file,
 * c'est une avalanche sur un seul compte — et une avalanche sur un seul compte
 * est exactement ce que le plafond refuse.
 */
const DISCORD_CODE_LOCK_TIMEOUT_SECONDS = 1;

/**
 * Émet un code de connexion.
 *
 * **Ne périme pas les codes précédents**, et n'a pas à le faire :
 * {@link verifyDiscordChallenge} ne lit que le **dernier émis**, si bien qu'un
 * code neuf rend le précédent inatteignable par sa seule existence. Rien à
 * écrire, donc rien qui puisse échouer à mi-chemin. Le corollaire est tenu à
 * l'autre bout : un envoi raté **supprime** sa ligne
 * ({@link discardDiscordChallenge}), faute de quoi la mort-née resterait la
 * dernière et masquerait le code que le joueur tient réellement.
 *
 * **Comptage et insertion se font sous un verrou nommé.** Le plafond était un
 * `SELECT COUNT(*)` puis, un `await` plus loin, un `INSERT` : la forme exacte
 * que le quota d'essais vient d'abandonner un cran plus bas, et pour la même
 * raison. Des demandes lancées de front lisaient toutes le même compte et
 * inséraient chacune leur ligne — autant de codes en jeu, chacun rouvrant cinq
 * essais, sur la borne que ce module présente comme *celle qui tient réellement
 * la force brute*.
 *
 * Le remède évident — `SELECT … FOR UPDATE` dans une transaction — **ne marche
 * pas ici**, et il a fallu une vraie base pour le voir : sur la plage vide d'un
 * compte sans ligne, chaque transaction pose un verrou d'intervalle sur la même
 * plage puis demande, pour insérer, une intention qui entre en conflit avec
 * celui des autres. Douze demandes de front rendaient onze `ER_LOCK_DEADLOCK`
 * et **un** code, là où cinq étaient attendus. Le verrou nommé
 * (`lib/server/named-lock.ts`) n'a ni intervalle ni ordre de prise : il
 * sérialise les demandes d'un même compte, et ne gêne aucun autre.
 *
 * @throws TOO_MANY_CODE_REQUESTS quand le compte a déjà reçu
 *   {@link MAX_DISCORD_CODES_PER_WINDOW} codes dans la fenêtre — ou quand la
 *   file d'attente sur son verrou ne se vide pas dans le délai, ce qui est le
 *   même fait vu d'un peu plus loin.
 */
export async function createDiscordLoginChallenge(
  discordId: string,
  handle?: string | null,
): Promise<DiscordChallenge> {
  const db = await getDatabase();
  const code = randomCode();
  // Le tag n'est retenu que s'il en est un : une demande faite par identifiant
  // numérique n'a pas de tag à certifier, et écrire l'identifiant dans cette
  // colonne ferait passer un nombre pour un pseudo.
  const storedHandle = normalizeDiscordHandle(handle);

  // Ménage d'abord, et **hors verrou** : il ne regarde aucun compte en
  // particulier, et il ne pèse pas sur le comptage — une ligne expirée depuis un
  // jour est née bien avant la fenêtre de quinze minutes. Il borne la croissance
  // de la table, qui n'effaçait rien, jamais.
  await db.execute(
    `DELETE FROM bg_discord_login_challenges
     WHERE expires_at < DATE_SUB(NOW(), INTERVAL ? HOUR)`,
    [DISCORD_CHALLENGE_RETENTION_HOURS],
  );

  try {
    return await withNamedLock(
      db,
      `${DISCORD_CODE_LOCK_PREFIX}${discordId}`,
      DISCORD_CODE_LOCK_TIMEOUT_SECONDS,
      async (connection) => {
        // La borne qui tient réellement la force brute (voir
        // `MAX_DISCORD_CODES_PER_WINDOW`) : en base, donc commune à tous les
        // processus et insensible à la fabrication de clés.
        const [recent] = await connection.execute<(RowDataPacket & { c: number })[]>(
          `SELECT COUNT(*) AS c
           FROM bg_discord_login_challenges
           WHERE discord_id = ?
             AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
          [discordId, DISCORD_CODE_WINDOW_MINUTES],
        );
        if (Number(recent[0]?.c ?? 0) >= MAX_DISCORD_CODES_PER_WINDOW) {
          throw new Error("TOO_MANY_CODE_REQUESTS");
        }

        const [insert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO bg_discord_login_challenges (discord_id, code_hash, handle, expires_at)
           VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
          [discordId, hashCode(code), storedHandle],
        );

        const [rows] = await connection.execute<(RowDataPacket & { expires_at: Date | string })[]>(
          `SELECT expires_at FROM bg_discord_login_challenges WHERE id = ? LIMIT 1`,
          [insert.insertId],
        );

        const rawExpiresAt = rows[0]?.expires_at;
        return {
          challengeId: Number(insert.insertId),
          code,
          // mysql2 peut renvoyer expires_at en string selon la config du pool : on normalise en Date.
          expiresAt: rawExpiresAt ? new Date(rawExpiresAt) : new Date(Date.now() + 10 * 60 * 1000),
        };
      },
    );
  } catch (error) {
    // Le verrou qui ne se libère pas en cinq secondes, sur un compte dont deux
    // instructions font tout le travail, **est** une avalanche de demandes pour
    // ce compte : on la refuse comme telle, plutôt que de rendre une panne
    // interne à un joueur qui n'y peut rien. Refuser est aussi le sens sûr — le
    // contraire délivrerait un code de plus sans l'avoir compté.
    if (error instanceof NamedLockUnavailableError) {
      throw new Error("TOO_MANY_CODE_REQUESTS");
    }
    throw error;
  }
}

/**
 * Efface un code dont l'envoi a échoué.
 *
 * **Un code qui n'est pas parti ne doit pas survivre à son échec.**
 * `verifyDiscordChallenge` ne lit que le plus récent : la ligne mort-née
 * masquerait celui que le joueur a réellement reçu, qui serait alors refusé
 * comme invalide — et chaque essai brûlerait le quota de la mauvaise ligne
 * jusqu'à ce qu'elle se consume.
 *
 * **Supprimée et non consommée** : le comptage de
 * {@link MAX_DISCORD_CODES_PER_WINDOW} porte sur `created_at`, sans regarder
 * `consumed_at`. Un message privé jamais parti n'a spammé personne, il ne doit
 * pas dépenser le budget de codes de la victime.
 */
export async function discardDiscordChallenge(challengeId: number): Promise<void> {
  const db = await getDatabase();
  await db.execute(`DELETE FROM bg_discord_login_challenges WHERE id = ?`, [challengeId]);
}

/**
 * Consomme un code juste et rend ce que la ligne du défi prouve
 * ({@link DiscordChallengeProof}), ou `null` pour tout refus.
 *
 * Séparé de {@link verifyDiscordChallenge}, qui n'en garde que le « oui » : la
 * connexion n'a besoin de rien d'autre, la **certification** du tag a besoin du
 * tag résolu. Une seule consommation, donc un seul décompte d'essai — deux
 * fonctions qui liraient la même ligne à la suite en brûleraient deux.
 */
export async function consumeDiscordChallenge(
  discordId: string,
  code: string,
): Promise<DiscordChallengeProof | null> {
  const db = await getDatabase();

  const [rows] = await db.execute<
    (RowDataPacket & {
      id: number;
      code_hash: string;
      handle: string | null;
      expires_at: Date;
      consumed_at: Date | null;
      attempts: number;
    })[]
  >(
    `SELECT id, code_hash, handle, expires_at, consumed_at, attempts
     FROM bg_discord_login_challenges
     WHERE discord_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [discordId],
  );

  if (rows.length === 0) return null;

  const challenge = rows[0];
  if (challenge.consumed_at !== null) return null;
  if (new Date(challenge.expires_at).getTime() < Date.now()) return null;

  // **L'essai se réserve avant d'être joué**, en une seule instruction.
  //
  // Le quota était relu sur la ligne déjà chargée, puis décompté par une
  // écriture séparée : entre les deux, un `await`. Dix vérifications lancées de
  // front lisaient donc toutes `attempts = 0`, passaient toutes le contrôle et
  // comparaient toutes une combinaison — cinq essais annoncés, dix accordés, et
  // jusqu'à la taille du pool. La course était sur la **lecture**, que le `CASE`
  // de l'écriture ne pouvait pas fermer.
  //
  // Ici c'est le `WHERE attempts < ?` qui tranche, sous le verrou de ligne de
  // l'`UPDATE` : chaque réservation voit le compte des précédentes, et
  // `affectedRows` dit si celle-ci a eu lieu. Un essai est donc décompté même
  // quand le code est bon — sans conséquence, la réussite consommant la ligne.
  //
  // `consumed_at` **avant** `attempts` : MySQL évalue les affectations de
  // gauche à droite et les suivantes lisent déjà la nouvelle valeur. Dans
  // l'autre ordre, le `CASE` compterait un essai de trop et brûlerait le code
  // une tentative trop tôt.
  const [reserved] = await db.execute<ResultSetHeader>(
    `UPDATE bg_discord_login_challenges
     SET consumed_at = CASE WHEN attempts + 1 >= ? THEN NOW() ELSE consumed_at END,
         attempts = attempts + 1
     WHERE id = ?
       AND consumed_at IS NULL
       AND attempts < ?`,
    [MAX_DISCORD_CODE_ATTEMPTS, challenge.id, MAX_DISCORD_CODE_ATTEMPTS],
  );
  if (Number(reserved.affectedRows) === 0) return null;

  if (!timingSafeEquals(challenge.code_hash, hashCode(code))) return null;

  await db.execute(
    `UPDATE bg_discord_login_challenges
     SET consumed_at = NOW()
     WHERE id = ?`,
    [challenge.id],
  );

  return { handle: normalizeDiscordHandle(challenge.handle) };
}

/**
 * Le code est-il juste ? Chemin de la **connexion**, qui n'a que faire du tag.
 *
 * Un mince habillage de {@link consumeDiscordChallenge} : deux implémentations
 * de la réservation d'essai divergeraient, et c'est elle qui tient le secret.
 */
export async function verifyDiscordChallenge(discordId: string, code: string): Promise<boolean> {
  return (await consumeDiscordChallenge(discordId, code)) !== null;
}

export async function updateOwnProfile(
  userId: number,
  patch: {
    pseudo?: string;
    overwatchBattletag?: string | null;
    marvelRivalsTag?: string | null;
    discordPseudo?: string | null;
    isAdult?: boolean | null;
    visibility?: {
      avatar?: boolean;
      overwatch?: boolean;
      marvel?: boolean;
      major?: boolean;
    };
    openToRecruitment?: boolean;
  },
): Promise<void> {
  const db = await getDatabase();

  if (patch.pseudo) {
    const normalized = normalizePseudo(patch.pseudo);
    const [conflicts] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM bg_users WHERE pseudo = ? AND id <> ? LIMIT 1`,
      [normalized, userId],
    );
    if (conflicts.length > 0) {
      throw new Error("PSEUDO_ALREADY_USED");
    }
  }

  const nextDiscordPseudo = patch.discordPseudo === undefined ? null : patch.discordPseudo;

  // **La certification se perd à chaque changement de tag.** Elle ne dit pas
  // « ce compte a un Discord » (c'est `discord_id`) mais « le tag stocké a été
  // prouvé » : un tag réécrit n'a rien prouvé, et le laisser certifié exposerait
  // à l'arbitrage un pseudo que personne n'a vérifié — exactement ce que la
  // certification est censée empêcher.
  //
  // Le `CASE` est posé **avant** l'affectation de `discord_pseudo`, et l'ordre
  // n'est pas décoratif : MySQL évalue les affectations de gauche à droite, si
  // bien qu'une comparaison placée après lirait déjà la valeur neuve et ne
  // verrait jamais de changement (même piège que la réservation d'essai d'un
  // code, plus haut). `<=>` parce que le tag peut être `NULL` des deux côtés —
  // un `=` rendrait alors `NULL`, donc faux, donc une certification perdue à
  // chaque sauvegarde d'un profil sans tag.
  //
  // La comparaison hérite de la **collation de la colonne**
  // (`utf8mb4_0900_ai_ci`, insensible à la casse et aux accents) : « keryan » et
  // « Keryan » sont donc le même tag, et une correction de casse ne défait pas la
  // certification. C'est le bon comportement — les pseudos Discord sont eux-mêmes
  // insensibles à la casse, la preuve continue de désigner le même compte —, et
  // c'est la raison de ne **pas** durcir ceci en comparaison binaire : on
  // recertifierait pour une majuscule.
  await db.execute(
    `UPDATE bg_users
     SET pseudo = COALESCE(?, pseudo),
         overwatch_battletag = ?,
         marvel_rivals_tag = ?,
         discord_verified_at = CASE WHEN discord_pseudo <=> ? THEN discord_verified_at ELSE NULL END,
         discord_pseudo = ?,
         is_adult = ?,
         visible_avatar = COALESCE(?, visible_avatar),
         visible_overwatch = COALESCE(?, visible_overwatch),
         visible_marvel = COALESCE(?, visible_marvel),
         visible_major = COALESCE(?, visible_major),
         open_to_recruitment = COALESCE(?, open_to_recruitment)
     WHERE id = ?`,
    [
      patch.pseudo ? normalizePseudo(patch.pseudo) : null,
      patch.overwatchBattletag === undefined ? null : patch.overwatchBattletag,
      patch.marvelRivalsTag === undefined ? null : patch.marvelRivalsTag,
      nextDiscordPseudo,
      nextDiscordPseudo,
      patch.isAdult === undefined ? null : patch.isAdult,
      patch.visibility?.avatar ?? null,
      patch.visibility?.overwatch ?? null,
      patch.visibility?.marvel ?? null,
      patch.visibility?.major ?? null,
      patch.openToRecruitment ?? null,
      userId,
    ],
  );

  // L'entrée solo (tournois individuels) affiche le pseudo **et l'avatar** du
  // joueur dans les brackets : elle suit le renommage, et aussi la bascule de
  // visibilité de l'avatar — sans quoi masquer son image n'aurait effacé que la
  // fiche de profil, l'entrée solo continuant de la servir à tout le site.
  if (patch.pseudo || patch.visibility?.avatar !== undefined) {
    await syncSoloEntryIdentity(userId);
  }
}

/**
 * Pool ou connexion de transaction : la lecture des traces se fait sur l'une ou
 * sur l'autre selon qu'on **informe** (route de prévisualisation, hors
 * transaction) ou qu'on **écrit** (suppression, sous verrou).
 */
type SqlRunner = Pick<PoolConnection, "execute">;

/**
 * Ce que ce compte laisse derrière lui, en **une** requête.
 *
 * Trois `EXISTS` indexés plutôt que trois allers-retours : la suppression est
 * un geste unique, ses trois questions se posent au même instant et sur le même
 * instantané. Les poser séparément laisserait un `await` entre elles — un
 * tournoi créé entre la deuxième et la troisième et la ligne partirait quand
 * même, sur une base qui la refuse.
 *
 * L'engagement se lit sur **toute** appartenance, close comprise : un joueur
 * parti d'une équipe a tout de même joué ses matchs sous ses couleurs.
 */
async function loadAccountTrace(
  runner: SqlRunner,
  userId: number,
): Promise<AccountTrace> {
  const [rows] = await runner.execute<(RowDataPacket & {
    tournaments: number;
    organized: number;
    owned: number;
  })[]>(
    `SELECT
       (
         EXISTS (
           SELECT 1
           FROM bg_tournament_registrations r
           JOIN bg_team_members tm ON tm.team_id = r.team_id AND tm.user_id = ?
         )
         -- L'entrée solo compte **par elle-même** : elle n'a pas de clé
         -- étrangère (une cascade effacerait l'engagé, et avec lui l'historique
         -- des matchs), donc l'effacement du compte la laisserait pendre sur un
         -- identifiant disparu.
         OR EXISTS (SELECT 1 FROM bg_teams WHERE solo_user_id = ?)
       ) AS tournaments,
       EXISTS (
         SELECT 1 FROM bg_tournaments WHERE organizer_user_id = ?
       ) AS organized,
       EXISTS (
         SELECT 1
         FROM bg_team_members m
         JOIN bg_teams t ON t.id = m.team_id AND t.deleted_at IS NULL
         WHERE m.user_id = ? AND m.left_at IS NULL
           AND JSON_CONTAINS(m.roles_json, '"OWNER"')
       ) AS owned`,
    [userId, userId, userId, userId],
  );
  const row = rows[0];
  return {
    tournaments: Boolean(row?.tournaments),
    organizedTournaments: Boolean(row?.organized),
    ownedTeams: Boolean(row?.owned),
  };
}

/**
 * Ce que la suppression **ferait** à ce compte, sans rien écrire.
 *
 * L'écran doit annoncer le geste avant le clic : une confirmation qui promet la
 * conservation des statistiques à un compte qui n'en a aucune est un mensonge
 * poli, et l'inverse serait pire. La question n'est posée qu'au moment où elle
 * peut changer la réponse — sur le chemin de la suppression, jamais à chaque
 * chargement du profil.
 *
 * Ce n'est **pas** une promesse : l'écriture repose la question sur son propre
 * instantané. Rien n'interdit qu'un tournoi soit créé entre les deux, et c'est
 * l'écriture qui fait foi.
 */
export async function getAccountDeletionPlan(userId: number): Promise<AccountDeletionPlan> {
  const db = await getDatabase();
  return accountDeletionPlan(await loadAccountTrace(db, userId));
}

/**
 * Supprimer son compte — **effacé** s'il ne laisse rien, anonymisé sinon.
 *
 * Le mode est décidé par `accountDeletionMode` (`lib/shared/account-deletion.ts`),
 * partagé avec l'écran qui annonce le geste avant le clic : une confirmation
 * qui promet la conservation des statistiques à un compte qui n'en a aucune est
 * un mensonge poli, et l'inverse serait pire.
 *
 * Lecture des traces et écriture vivent dans **une seule transaction**, sous un
 * verrou pris sur la ligne du compte : une trace relue hors transaction laisse
 * un `await` entre la question et la réponse, et l'effacement d'un compte ne se
 * défait pas. La transaction ferme au passage l'état intermédiaire des deux
 * écritures de l'effacement — un `DELETE` refusé après le détachement des
 * visites laissait un compte vivant dont la fréquentation était anonymisée pour
 * toujours.
 *
 * Deux choses échappent à la transaction, chacune pour sa raison : le **fichier
 * de l'avatar**, qu'un `unlink` ne rendrait pas (il part après le commit), et
 * les tables sans clé étrangère, dont seul le verrou du compte protège
 * — `bg_teams.solo_user_id` en particulier, que `ensureSoloEntry` verrouille de
 * son côté.
 *
 * Rend le plan appliqué — le mode **et** le motif —, pour que la route puisse
 * le dire au joueur : « tes statistiques restent » ne veut rien dire à qui n'en
 * a aucune et dont la ligne n'est retenue que par une équipe à transférer.
 */
export async function deleteOwnAccount(userId: number): Promise<AccountDeletionPlan> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  let plan: AccountDeletionPlan;
  // Le fichier de l'avatar, relevé **avant** l'effacement : la ligne partie, son
  // chemin ne se retrouve plus. Il ne part qu'après le commit — un `unlink` ne
  // se défait pas, et une transaction annulée rendrait un compte vivant sans sa
  // photo.
  let orphanedAvatar: string | null = null;

  try {
    await connection.beginTransaction();

    // Verrou en **toute première instruction**, et lecture des traces juste
    // après : sous `REPEATABLE READ`, c'est la première lecture *ordinaire* qui
    // fige l'instantané, si bien qu'une trace lue avant le verrou daterait
    // d'avant l'attente. Le compte est ici la ressource disputée — une
    // inscription en tournoi individuel pose le même verrou (`ensureSoloEntry`),
    // seul moyen de couvrir une entrée solo qui n'a volontairement aucune clé
    // étrangère.
    const [locked] = await connection.execute<(RowDataPacket & {
      avatar_url: string | null;
    })[]>(
      `SELECT avatar_url FROM bg_users WHERE id = ? FOR UPDATE`,
      [userId],
    );
    if (locked.length === 0) throw new Error("USER_NOT_FOUND");
    orphanedAvatar = toDiskUploadPath(locked[0].avatar_url);

    plan = accountDeletionPlan(await loadAccountTrace(connection, userId));

    if (plan.mode === "ERASE") {
      await eraseAccount(connection, userId);
    } else {
      await anonymizeAccount(connection, userId);
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  // Les deux modes effacent la photo : l'un fait disparaître la ligne, l'autre
  // met `avatar_url` à `NULL` — dans les deux cas le fichier resterait servi
  // par `/api/uploads/avatars/...`, donc une donnée personnelle publique que
  // plus aucune ligne ne désigne. L'échec est **avalé** : la suppression est
  // commitée, annoncer un refus au joueur serait faux.
  try {
    await deleteStoredImage(orphanedAvatar);
  } catch {
    // Fichier verrouillé ou disque en lecture seule : un résidu, pas un échec.
  }

  return plan;
}

/**
 * L'effacement pur et simple, sous le verrou de `deleteOwnAccount`.
 *
 * Les cascades déjà déclarées font l'essentiel (sessions, appartenances,
 * invitations) ; `bg_endurance_penalties.created_by` passe à `NULL`, la
 * sanction restant due. Seules les visites demandent un geste : elles n'ont
 * **aucune** clé étrangère (une cascade y effacerait l'historique de
 * fréquentation), et c'est le lien vers une personne qu'il faut retirer, pas le
 * fait qu'une page ait été vue — d'où un détachement, et **avant** l'effacement
 * qui rendrait la ligne introuvable.
 */
async function eraseAccount(connection: PoolConnection, userId: number): Promise<void> {
  await connection.execute(`UPDATE bg_site_visits SET user_id = NULL WHERE user_id = ?`, [userId]);
  await connection.execute(`DELETE FROM bg_users WHERE id = ?`, [userId]);
}

/** L'anonymisation : la ligne reste, tout ce qui désigne une personne part. */
async function anonymizeAccount(connection: PoolConnection, userId: number): Promise<void> {
  await connection.execute(
    `UPDATE bg_users
     SET pseudo = CONCAT('compte_supprime_', id),
         avatar_url = NULL,
         overwatch_battletag = NULL,
         marvel_rivals_tag = NULL,
         discord_pseudo = NULL,
         -- Le tag part, sa certification avec : elle ne certifie rien d'autre
         -- que lui, et une date restée seule ferait d'un compte anonymisé un
         -- compte « vérifié » sans tag.
         discord_verified_at = NULL,
         is_adult = NULL,
         discord_id = NULL,
         google_sub = NULL,
         blizzard_sub = NULL,
         email = NULL,
         visible_avatar = 0,
         visible_overwatch = 0,
         visible_marvel = 0,
         visible_major = 0,
         open_to_recruitment = 0,
         is_deleted = 1
     WHERE id = ?`,
    [userId],
  );
  await connection.execute(`DELETE FROM bg_user_sessions WHERE user_id = ?`, [userId]);
  // Le pseudo anonymisé doit aussi remplacer le nom affiché en tournoi — sur la
  // connexion de la transaction, sans quoi le renommage survivrait à un
  // rollback de l'anonymisation qui l'a motivé.
  await syncSoloEntryIdentityOn(connection, userId);
}

export async function updateUserAvatar(userId: number, avatarPath: string | null): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `UPDATE bg_users SET avatar_url = ? WHERE id = ?`,
    [avatarPath, userId],
  );
  // Le logo de l'entrée solo est l'avatar du joueur.
  await syncSoloEntryIdentity(userId);
}

/**
 * Un joueur est-il engagé dans un tournoi **encore vivant** ?
 *
 * C'est la condition qui ouvre son tag Discord à l'arbitrage
 * (`lib/shared/discord-identity.ts`) : le besoin de le joindre naît du tournoi
 * et s'éteint avec lui. La borne est celle de `tournamentGrantsContactAccess` —
 * tout état sauf `FINISHED` —, rejouée ici en SQL faute de pouvoir appeler du
 * TypeScript depuis une requête : les deux doivent bouger ensemble.
 *
 * Les deux formes d'engagement sont couvertes par la même requête — appartenance
 * à une équipe inscrite (fenêtre d'appartenance **ouverte** : un joueur parti ne
 * représente plus l'équipe) et entrée solo, qui porte l'identifiant du joueur.
 */
async function isInActiveTournament(userId: number): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { c: number })[]>(
    `SELECT 1 AS c
     FROM bg_tournament_registrations r
     JOIN bg_tournaments t ON t.id = r.tournament_id
     LEFT JOIN bg_team_members tm
       ON tm.team_id = r.team_id
      AND tm.user_id = ?
      AND tm.left_at IS NULL
     LEFT JOIN bg_teams te ON te.id = r.team_id
     WHERE t.state <> 'FINISHED'
       AND (tm.id IS NOT NULL OR te.solo_user_id = ?)
     LIMIT 1`,
    [userId, userId],
  );
  return rows.length > 0;
}

/** Le lecteur d'une fiche, tel que les règles de visibilité le demandent. */
export type ProfileViewer = {
  id: number;
  isAdmin?: boolean;
  roles?: readonly PlatformRole[];
};

export async function getFullProfile(
  viewer: ProfileViewer,
  targetUserId: number,
): Promise<FullProfileResponse | null> {
  const viewerId = viewer.id;
  const viewerIsAdmin = Boolean(viewer.isAdmin);
  const db = await getDatabase();

  const [userRows] = await db.execute<UserRow[]>(
    `SELECT
      id,
      pseudo,
      avatar_url,
      overwatch_battletag,
      marvel_rivals_tag,
      discord_pseudo,
      discord_verified_at,
      is_adult,
      visible_avatar,
      visible_overwatch,
      visible_marvel,
      visible_major,
      open_to_recruitment,
      is_admin,
      platform_roles_json,
      created_at
    FROM bg_users
    WHERE id = ?
    LIMIT 1`,
    [targetUserId],
  );

  if (userRows.length === 0) return null;

  const isSelf = viewerId === targetUserId;
  const targetIsAdmin = Boolean(userRows[0].is_admin);
  const targetRoles = resolveRoles(targetIsAdmin, userRows[0].platform_roles_json);
  const profile = mapPublicUser(userRows[0]);
  const discordVerified = userRows[0].discord_verified_at != null;

  if (!isSelf) applyVisibility(profile, false);

  // **Le tag Discord passe par sa propre règle**, et pas par `applyVisibility` :
  // il n'a pas de réglage de visibilité, il a un public (voir
  // `lib/shared/discord-identity.ts`). La question du tournoi n'est posée que
  // lorsqu'elle peut changer la réponse — un administrateur voit de toute façon,
  // le lecteur ordinaire ne voit de toute façon pas, et une requête de plus sur
  // chaque fiche consultée n'aurait servi à personne.
  const needsTournamentCheck =
    !isSelf && !viewerIsAdmin && can(viewer, "tournaments") && discordVerified;
  profile.discordPseudo = visibleDiscordTag(userRows[0].discord_pseudo, viewer, {
    userId: targetUserId,
    verified: discordVerified,
    inActiveTournament: needsTournamentCheck ? await isInActiveTournament(targetUserId) : false,
  });
  // **La pastille ne suit pas le tag** (`canSeeDiscordVerification`) : le tag dit
  // *comment* joindre le joueur, la certification dit seulement *qu'il est
  // joignable*. Le second fait ne nomme personne — et il manque à quelqu'un de
  // précis, le capitaine dont le tournoi exige « tous les Discord vérifiés », qui
  // lisait jusqu'ici un refus sans savoir qui de son roster devait certifier.
  profile.discordVerified = discordVerified;

  const [timelineRows] = await db.execute<TeamTimelineRow[]>(
    `SELECT
      tm.team_id,
      t.name AS team_name,
      tm.joined_at,
      tm.left_at,
      tm.roles_json
     FROM bg_team_members tm
     JOIN bg_teams t ON t.id = tm.team_id
     WHERE tm.user_id = ?
     ORDER BY tm.joined_at DESC`,
    [targetUserId],
  );

  const timeline: UserTeamTimeline[] = timelineRows.map((row) => ({
    teamId: Number(row.team_id),
    teamName: row.team_name,
    joinedAt: toIso(row.joined_at) ?? new Date().toISOString(),
    leftAt: toIso(row.left_at),
    roles: parseRoles(row.roles_json),
  }));

  // Statistiques et palmarès viennent de la même collecte (`stats-service`) :
  // mêmes définitions que côté équipe, et surtout mêmes bornes d'appartenance.
  // L'ancienne requête, jointe sans condition de date, listait aussi le même
  // tournoi une fois par équipe du joueur.
  const { stats, tournaments } = await getPlayerEntityStats(targetUserId);

  return {
    profile,
    stats,
    teamsTimeline: timeline,
    tournaments,
    // Ne pas divulguer qui est admin / quels rôles aux non-admins : réservé au viewer admin.
    isAdmin: viewerIsAdmin ? targetIsAdmin : false,
    roles: viewerIsAdmin ? targetRoles : [],
    // Les rôles staff sont des titres publics affichés à tous les visiteurs.
    displayRoles: targetRoles,
    isSelf,
    viewerIsAdmin,
  };
}

/**
 * Rassemble l'intégralité des données personnelles du propriétaire du compte
 * pour l'export RGPD (droit à la portabilité, art. 20). Retourne les données
 * brutes non masquées — l'appelant DOIT s'assurer que `userId` est bien celui
 * de l'utilisateur authentifié (jamais un tiers).
 */
export async function exportOwnData(userId: number): Promise<PersonalDataExport> {
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & {
      id: number;
      pseudo: string;
      avatar_url: string | null;
      overwatch_battletag: string | null;
      marvel_rivals_tag: string | null;
      discord_pseudo: string | null;
      discord_verified_at: Date | null;
      discord_id: string | null;
      google_sub: string | null;
      blizzard_sub: string | null;
      email: string | null;
      is_adult: 0 | 1 | null;
      is_admin: 0 | 1;
      visible_avatar: 0 | 1;
      visible_overwatch: 0 | 1;
      visible_marvel: 0 | 1;
      visible_major: 0 | 1;
      open_to_recruitment: 0 | 1;
      created_at: Date;
    })[]
  >(
    `SELECT id, pseudo, avatar_url, overwatch_battletag, marvel_rivals_tag,
            discord_pseudo, discord_verified_at, discord_id, google_sub, blizzard_sub, email, is_adult, is_admin,
            visible_avatar, visible_overwatch, visible_marvel, visible_major,
            open_to_recruitment, created_at
     FROM bg_users
     WHERE id = ? AND is_deleted = 0
     LIMIT 1`,
    [userId],
  );

  if (rows.length === 0) throw new Error("PROFILE_NOT_FOUND");
  const row = rows[0];

  // Réutilise l'agrégation existante pour les stats, l'historique d'équipes et
  // le palmarès de tournois (vue « self » = données complètes non masquées).
  const full = await getFullProfile({ id: userId }, userId);
  if (!full) throw new Error("PROFILE_NOT_FOUND");

  return {
    exportedAt: new Date().toISOString(),
    account: {
      id: Number(row.id),
      pseudo: row.pseudo,
      email: row.email,
      discordId: row.discord_id,
      discordPseudo: row.discord_pseudo,
      // L'export RGPD dit **tout** ce que le site détient : la date de
      // certification en fait partie, c'est elle qui justifie l'exposition du
      // tag à l'organisation.
      discordVerifiedAt: toIso(row.discord_verified_at),
      googleSub: row.google_sub,
      blizzardSub: row.blizzard_sub,
      isAdult: row.is_adult === null ? null : Boolean(row.is_adult),
      isAdmin: Boolean(row.is_admin),
      createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    },
    profile: {
      avatarUrl: row.avatar_url,
      overwatchBattletag: row.overwatch_battletag,
      marvelRivalsTag: row.marvel_rivals_tag,
      visibility: {
        avatar: Boolean(row.visible_avatar),
        overwatch: Boolean(row.visible_overwatch),
        marvel: Boolean(row.visible_marvel),
        major: Boolean(row.visible_major),
      },
      openToRecruitment: Boolean(row.open_to_recruitment),
    },
    stats: full.stats,
    teamsTimeline: full.teamsTimeline,
    tournaments: full.tournaments,
  };
}

/**
 * Remplace l'intégralité des rôles de permission d'un utilisateur.
 * Le rôle `ADMIN` est persisté via la colonne `is_admin` ; les autres rôles
 * cumulables (ARBITRE, COMMUNITY_MANAGER, RECRUTEUR) dans `platform_roles_json`.
 * Réservé aux administrateurs (contrôle d'accès effectué côté route API).
 *
 * @returns la liste normalisée des rôles effectivement enregistrés.
 */
export async function setUserRoles(
  targetUserId: number,
  roles: PlatformRole[],
): Promise<PlatformRole[]> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE id = ? AND is_deleted = 0 LIMIT 1`,
    [targetUserId],
  );
  if (rows.length === 0) {
    throw new Error("USER_NOT_FOUND");
  }

  const sanitized = sanitizePlatformRoles(roles);
  const isAdmin = sanitized.includes("ADMIN");
  // Ne persister en JSON que les rôles cumulables non-ADMIN (ADMIN ⇔ is_admin).
  const nonAdminRoles = sanitized.filter((role) => role !== "ADMIN");

  await db.execute(
    `UPDATE bg_users SET is_admin = ?, platform_roles_json = ? WHERE id = ?`,
    [isAdmin ? 1 : 0, JSON.stringify(nonAdminRoles), targetUserId],
  );

  return sanitized;
}

export async function getUserIdByPseudo(pseudo: string): Promise<number | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE pseudo = ? LIMIT 1`,
    [normalizePseudo(pseudo)],
  );

  return rows.length === 0 ? null : Number(rows[0].id);
}

/**
 * Ne garde d'une liste de rôles d'équipe que les valeurs connues, dédupliquées.
 *
 * **Aucun repli** : une entrée vide ou entièrement invalide rend une liste
 * vide, et c'est à l'appelant de dire ce qu'il en fait — `MISSING_ROLE` quand
 * on modifie un membre existant, `DPS` quand on en accueille un nouveau. La
 * fonction repliait jusqu'ici sur `["OWNER"]`, ce que ses appelants
 * annulaient aussitôt en filtrant ce rôle : le repli n'a donc jamais rien
 * accordé, mais il attendait le premier appelant qui oublierait le filtre pour
 * faire d'un corps de requête vide une prise de propriété.
 */
export function sanitizeRoles(roles: TeamRole[]): TeamRole[] {
  return Array.from(new Set(parseRoles(roles)));
}

