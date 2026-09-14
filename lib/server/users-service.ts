import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { NamedLockUnavailableError, withNamedLock } from "@/lib/server/named-lock";
import { ensureUniquePseudo, resolveRoles } from "@/lib/server/auth";
import { normalizePseudo, parseRoles, toIso } from "@/lib/server/serialization";
import { syncSoloEntryIdentity } from "@/lib/server/solo-entries-service";
import { visibleAvatarUrl } from "@/lib/shared/avatar";
import { sanitizePlatformRoles, type PlatformRole } from "@/lib/shared/permissions";
import { getPlayerEntityStats, loadPlayerRecords } from "@/lib/server/stats-service";
import type {
  FullProfileResponse,
  PersonalDataExport,
  PublicUserProfile,
  TeamRole,
  UserTeamTimeline,
} from "@/lib/shared/types";

export type GoogleProfilePayload = {
  sub: string;
  email?: string;
  /**
   * `email_verified` de l'`userinfo` Google. Voir `createOrGetGoogleUser`.
   *
   * **Obligatoire, et c'est le compilateur qui tient la règle.** Facultatif, il
   * valait `undefined` dès qu'un appelant l'oubliait — donc « non vérifiée »,
   * donc plus aucun rattachement : chaque connexion Google d'un compte dont le
   * `sub` n'est pas encore enregistré aurait créé un **doublon**, équipe,
   * historique et rôles laissés derrière. Une panne sans message, qu'un
   * `profile` passé tel quel au refactor suivant suffisait à provoquer, et
   * qu'aucun test ne peut voir puisque la valeur manquante est un cas légitime.
   */
  emailVerified: boolean;
  name?: string;
  picture?: string;
};

export type DiscordChallenge = {
  challengeId: number;
  code: string;
  expiresAt: Date;
};

type UserRow = RowDataPacket & {
  id: number;
  pseudo: string;
  avatar_url: string | null;
  overwatch_battletag: string | null;
  marvel_rivals_tag: string | null;
  discord_pseudo: string | null;
  is_adult: 0 | 1 | null;
  visible_avatar: 0 | 1;
  visible_pseudo: 0 | 1;
  visible_overwatch: 0 | 1;
  visible_marvel: 0 | 1;
  visible_major: 0 | 1;
  open_to_recruitment: 0 | 1;
  is_admin?: 0 | 1;
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

export async function getUserById(userId: number): Promise<PublicUserProfile | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<UserRow[]>(
    `SELECT
      id,
      pseudo,
      avatar_url,
      overwatch_battletag,
      marvel_rivals_tag,
      discord_pseudo,
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
      discord_pseudo,
      is_adult,
      visible_avatar,
      visible_overwatch,
      visible_marvel,
      visible_major,
      open_to_recruitment,
      created_at
     FROM bg_users
     ORDER BY is_deleted ASC, pseudo ASC`,
  );

  const baseUsers = rows.map((row) =>
    applyVisibility(mapPublicUser(row), Number(row.id) === viewerId),
  );
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

export async function createOrGetGoogleUser(profile: GoogleProfilePayload): Promise<number> {
  const db = await getDatabase();

  // **`bg_users.email` ne contient qu'une adresse vérifiée**, et cette ligne est
  // le seul endroit qui en décide — les trois écritures en dessous n'en voient
  // pas d'autre.
  //
  // Deux raisons, de deux ordres. La colonne est une **preuve d'identité** : la
  // branche de rattachement ci-dessous lie un `sub` Google neuf à un compte du
  // site sur la seule égalité de chaîne, donc ce qui s'y écrit doit valoir ce
  // qu'elle y lit. Et la colonne est **unique** (`database.ts`) : écrire une
  // adresse non vérifiée que quelqu'un d'autre détient déjà ne la volait pas,
  // elle faisait échouer l'écriture — `ER_DUP_ENTRY` avalé en
  // `/connexion?error=oauth` par la route de rappel, à chaque essai,
  // indéfiniment. Une identité Google non vérifiée ne pouvait donc ni
  // revendiquer un compte (ce qui est voulu) ni s'en créer un (ce qui ne l'est
  // pas). Elle en crée un désormais, simplement sans adresse.
  const verifiedEmail = profile.emailVerified === true ? (profile.email ?? null) : null;

  const [existing] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE google_sub = ? LIMIT 1`,
    [profile.sub],
  );

  if (existing.length > 0) {
    await db.execute(
      `UPDATE bg_users
       SET email = COALESCE(?, email),
           avatar_url = COALESCE(?, avatar_url)
       WHERE id = ?`,
      [verifiedEmail, profile.picture ?? null, existing[0].id],
    );
    return Number(existing[0].id);
  }

  // **Rattachement à un compte existant : uniquement sur une adresse vérifiée.**
  //
  // Cette branche lie un `sub` Google neuf à un compte du site sur la seule
  // égalité de chaîne de l'adresse. Sans consulter `email_verified` — que
  // `userinfo` renvoie et qu'on jetait —, il suffisait d'obtenir une identité
  // Google affirmant l'adresse d'un membre pour ouvrir sa session en un clic :
  // ni code, ni plafond, ni courriel de confirmation. Plus court que la force
  // brute sur le code Discord, et le seul chemin d'entrée qui n'en demande
  // aucun.
  //
  // Une adresse non vérifiée n'interdit pas de **créer** un compte plus bas :
  // elle interdit d'en revendiquer un — et elle ne s'y écrit pas (voir
  // `verifiedEmail`).
  if (verifiedEmail) {
    const [emailMatch] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM bg_users WHERE email = ? LIMIT 1`,
      [verifiedEmail],
    );

    if (emailMatch.length > 0) {
      await db.execute(`UPDATE bg_users SET google_sub = ? WHERE id = ?`, [profile.sub, emailMatch[0].id]);
      return Number(emailMatch[0].id);
    }
  }

  const pseudoSource = profile.name ?? profile.email?.split("@")[0] ?? `player${Date.now().toString().slice(-5)}`;
  const pseudo = await ensureUniquePseudo(pseudoSource);

  const [created] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_users (pseudo, avatar_url, google_sub, email)
     VALUES (?, ?, ?, ?)`,
    [pseudo, profile.picture ?? null, profile.sub, verifiedEmail],
  );

  return Number(created.insertId);
}

export async function createOrGetDiscordUser(discordId: string, pseudoInput?: string): Promise<number> {
  const db = await getDatabase();

  const [existing] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE discord_id = ? LIMIT 1`,
    [discordId],
  );

  if (existing.length > 0) {
    return Number(existing[0].id);
  }

  const rawPseudo = normalizePseudo(pseudoInput || `discord_${discordId.slice(-6)}`);
  const pseudo = await ensureUniquePseudo(rawPseudo);

  const [created] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_users (pseudo, discord_id)
     VALUES (?, ?)`,
    [pseudo, discordId],
  );

  return Number(created.insertId);
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
 * Court : sous le verrou il n'y a que deux instructions, un compte et une
 * insertion. Passé ce délai, ce n'est plus une file d'attente, c'est une
 * avalanche — et c'est exactement ce que le plafond refuse.
 */
const DISCORD_CODE_LOCK_TIMEOUT_SECONDS = 5;

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
export async function createDiscordLoginChallenge(discordId: string): Promise<DiscordChallenge> {
  const db = await getDatabase();
  const code = randomCode();

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
          `INSERT INTO bg_discord_login_challenges (discord_id, code_hash, expires_at)
           VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
          [discordId, hashCode(code)],
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

export async function verifyDiscordChallenge(discordId: string, code: string): Promise<boolean> {
  const db = await getDatabase();

  const [rows] = await db.execute<
    (RowDataPacket & {
      id: number;
      code_hash: string;
      expires_at: Date;
      consumed_at: Date | null;
      attempts: number;
    })[]
  >(
    `SELECT id, code_hash, expires_at, consumed_at, attempts
     FROM bg_discord_login_challenges
     WHERE discord_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [discordId],
  );

  if (rows.length === 0) return false;

  const challenge = rows[0];
  if (challenge.consumed_at !== null) return false;
  if (new Date(challenge.expires_at).getTime() < Date.now()) return false;

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
  if (Number(reserved.affectedRows) === 0) return false;

  if (!timingSafeEquals(challenge.code_hash, hashCode(code))) return false;

  await db.execute(
    `UPDATE bg_discord_login_challenges
     SET consumed_at = NOW()
     WHERE id = ?`,
    [challenge.id],
  );

  return true;
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

  await db.execute(
    `UPDATE bg_users
     SET pseudo = COALESCE(?, pseudo),
         overwatch_battletag = ?,
         marvel_rivals_tag = ?,
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
      patch.discordPseudo === undefined ? null : patch.discordPseudo,
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
 * Anonymise (« supprime ») le compte de l'utilisateur : toutes les données
 * personnelles sont effacées et les moyens de connexion révoqués, mais les
 * statistiques et l'historique générés par la plateforme sont conservés
 * (les adhésions d'équipe restent rattachées à un profil anonyme).
 */
export async function anonymizeOwnAccount(userId: number): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `UPDATE bg_users
     SET pseudo = CONCAT('compte_supprime_', id),
         avatar_url = NULL,
         overwatch_battletag = NULL,
         marvel_rivals_tag = NULL,
         discord_pseudo = NULL,
         is_adult = NULL,
         discord_id = NULL,
         google_sub = NULL,
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
  await db.execute(`DELETE FROM bg_user_sessions WHERE user_id = ?`, [userId]);
  // Le pseudo anonymisé doit aussi remplacer le nom affiché en tournoi.
  await syncSoloEntryIdentity(userId);
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

export async function getFullProfile(
  viewerId: number,
  targetUserId: number,
  viewerIsAdmin = false,
): Promise<FullProfileResponse | null> {
  const db = await getDatabase();

  const [userRows] = await db.execute<UserRow[]>(
    `SELECT
      id,
      pseudo,
      avatar_url,
      overwatch_battletag,
      marvel_rivals_tag,
      discord_pseudo,
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

  if (isSelf) {
    profile.discordPseudo = userRows[0].discord_pseudo;
  } else {
    applyVisibility(profile, false);
  }

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
      discord_id: string | null;
      google_sub: string | null;
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
            discord_pseudo, discord_id, google_sub, email, is_adult, is_admin,
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
  const full = await getFullProfile(userId, userId);
  if (!full) throw new Error("PROFILE_NOT_FOUND");

  return {
    exportedAt: new Date().toISOString(),
    account: {
      id: Number(row.id),
      pseudo: row.pseudo,
      email: row.email,
      discordId: row.discord_id,
      discordPseudo: row.discord_pseudo,
      googleSub: row.google_sub,
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

