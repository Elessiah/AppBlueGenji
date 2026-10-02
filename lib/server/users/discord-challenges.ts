import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { NamedLockUnavailableError, withNamedLock } from "@/lib/server/named-lock";
import { DISCORD_CODE_VALIDITY_MINUTES } from "@/lib/shared/processing-register";
import { normalizeDiscordHandle } from "./tag-normalization";

/*
 * Codes de connexion Discord envoyés en message privé : création sous quotas,
 * consommation avec compte des essais, et leur jeton opaque.
 */

export type DiscordChallenge = {
  challengeId: number;
  /**
   * Jeton **imprévisible** qui désigne le défi auprès de la connexion
   * (`consumeDiscordLoginChallenge`). Seule son empreinte est rangée en base.
   * Le numéro de ligne, séquentiel, ne peut pas jouer ce rôle : qui le devine
   * brûle les codes d'autrui.
   */
  challengeToken: string;
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

/**
 * Ce que rend un code de **connexion** juste : la preuve, plus l'identifiant
 * Discord du défi — que la demande de code ne publie plus.
 */
export type DiscordLoginProof = DiscordChallengeProof & {
  discordId: string;
};

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

/**
 * Jeton d'un défi : 24 octets aléatoires, soit 32 caractères base64url. Forme
 * vérifiée par {@link isDiscordChallengeToken} avant toute lecture en base.
 */
function randomChallengeToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** `true` si `value` a la forme d'un jeton de défi. */
export function isDiscordChallengeToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32}$/.test(value);
}

function randomCode(): string {
  const randomInt = crypto.randomInt(100000, 1000000);
  return String(randomInt);
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
 * Codes délivrables à un même compte Discord sur {@link DISCORD_CODE_DAY_HOURS}.
 *
 * Les deux bornes précédentes ne raisonnaient qu'à l'échelle du quart d'heure :
 * vingt-cinq essais toutes les quinze minutes, soit 2 400 par jour sur 900 000
 * valeurs — environ 0,27 % par jour, **60 % par an**, de prendre la session
 * d'un joueur nommé en rejouant patiemment la même attaque. Dix codes par jour
 * (cinquante essais) ramènent ce risque à environ 2 % par an, au prix de dix
 * messages privés quotidiens chez la victime, qui ne passent pas inaperçus.
 *
 * Dix suffisent largement à l'usage réel — un joueur ne se connecte pas dix
 * fois par jour par code, et le bouton Discord (OAuth) ne passe pas par ici.
 */
export const MAX_DISCORD_CODES_PER_DAY = 10;

/** Fenêtre de {@link MAX_DISCORD_CODES_PER_DAY}, en heures. */
export const DISCORD_CODE_DAY_HOURS = 24;

/**
 * Durée de rétention d'un code déjà expiré.
 *
 * Rien n'effaçait jamais une ligne de `bg_discord_login_challenges` : la table
 * grossissait d'une ligne par demande, définitivement. Le ménage se fait à la
 * création, comme celui des sessions dans `auth.ts`.
 *
 * **Au moins la journée de {@link MAX_DISCORD_CODES_PER_DAY}**, et c'est une
 * contrainte, pas un réglage : la purge vise `expires_at`, postérieur de dix
 * minutes à `created_at`, si bien qu'une ligne née dans les dernières
 * {@link DISCORD_CODE_DAY_HOURS} heures est toujours là pour être comptée.
 * Une rétention plus courte effacerait des codes avant la fin de leur journée
 * — et avec eux le plafond.
 */
const DISCORD_CHALLENGE_RETENTION_HOURS = DISCORD_CODE_DAY_HOURS;

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
 * @throws TOO_MANY_CODE_REQUESTS_TODAY quand le compte a déjà reçu
 *   {@link MAX_DISCORD_CODES_PER_DAY} codes dans la journée.
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
  const challengeToken = randomChallengeToken();
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
        //
        // Deux horizons dans la même lecture : le quart d'heure (la rafale) et
        // la journée (la force brute lente, voir `MAX_DISCORD_CODES_PER_DAY`).
        // La journée d'abord — c'est le refus qui dit d'attendre le plus.
        const [recent] = await connection.execute<
          (RowDataPacket & { windowCount: number | string | null; dayCount: number | string | null })[]
        >(
          `SELECT
             SUM(created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)) AS windowCount,
             COUNT(*) AS dayCount
           FROM bg_discord_login_challenges
           WHERE discord_id = ?
             AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)`,
          [DISCORD_CODE_WINDOW_MINUTES, discordId, DISCORD_CODE_DAY_HOURS],
        );
        if (Number(recent[0]?.dayCount ?? 0) >= MAX_DISCORD_CODES_PER_DAY) {
          throw new Error("TOO_MANY_CODE_REQUESTS_TODAY");
        }
        if (Number(recent[0]?.windowCount ?? 0) >= MAX_DISCORD_CODES_PER_WINDOW) {
          throw new Error("TOO_MANY_CODE_REQUESTS");
        }

        const [insert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO bg_discord_login_challenges (discord_id, lookup_hash, code_hash, handle, expires_at)
           VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ${DISCORD_CODE_VALIDITY_MINUTES} MINUTE))`,
          [discordId, hashCode(challengeToken), hashCode(code), storedHandle],
        );

        const [rows] = await connection.execute<(RowDataPacket & { expires_at: Date | string })[]>(
          `SELECT expires_at FROM bg_discord_login_challenges WHERE id = ? LIMIT 1`,
          [insert.insertId],
        );

        const rawExpiresAt = rows[0]?.expires_at;
        return {
          challengeId: Number(insert.insertId),
          challengeToken,
          code,
          // mysql2 peut renvoyer expires_at en string selon la config du pool : on normalise en Date.
          expiresAt: rawExpiresAt ? new Date(rawExpiresAt) : new Date(Date.now() + DISCORD_CODE_VALIDITY_MINUTES * 60 * 1000),
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

  const [rows] = await db.execute<ChallengeRow[]>(
    `SELECT id, discord_id, code_hash, handle, expires_at, consumed_at, attempts
     FROM bg_discord_login_challenges
     WHERE discord_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [discordId],
  );

  if (rows.length === 0) return null;
  return settleChallengeAttempt(db, rows[0], code);
}

/**
 * Consomme un code **désigné par le jeton de son défi** — chemin de la
 * connexion.
 *
 * La demande de code rendait l'identifiant Discord résolu (et si un compte du
 * site y était rattaché) à qui envoyait n'importe quel pseudo : un oracle
 * anonyme, alors que l'annuaire est derrière une connexion et que le flux
 * public du bot masque ces identifiants comme des coordonnées. Elle ne rend
 * plus que le jeton du défi, qui ne désigne personne ; l'identifiant n'est
 * relu qu'**ici**, une fois le code juste.
 *
 * **Un jeton imprévisible, pas le numéro de ligne.** Séquentiel, le numéro se
 * devine — et la demande en rend un récent à chaque appel : cinq codes faux
 * sur chacun des derniers numéros brûlaient tous les codes en vol du site,
 * connexions et certifications de tag confondues, sans connaître personne.
 * Seule l'empreinte du jeton est en base.
 *
 * La règle « seul le dernier code émis vaut » est gardée : un défi que suit un
 * défi plus récent pour le même compte est refusé, exactement comme
 * {@link consumeDiscordChallenge} ne le lirait jamais.
 */
export async function consumeDiscordLoginChallenge(
  challengeToken: string,
  code: string,
): Promise<DiscordLoginProof | null> {
  if (!isDiscordChallengeToken(challengeToken)) return null;
  const db = await getDatabase();

  const [rows] = await db.execute<ChallengeRow[]>(
    `SELECT c.id, c.discord_id, c.code_hash, c.handle, c.expires_at, c.consumed_at, c.attempts
     FROM bg_discord_login_challenges c
     WHERE c.lookup_hash = ?
       AND NOT EXISTS (
         SELECT 1 FROM bg_discord_login_challenges newer
         WHERE newer.discord_id = c.discord_id AND newer.id > c.id
       )
     LIMIT 1`,
    [hashCode(challengeToken)],
  );

  if (rows.length === 0) return null;
  const proof = await settleChallengeAttempt(db, rows[0], code);
  return proof ? { ...proof, discordId: String(rows[0].discord_id) } : null;
}

type ChallengeRow = RowDataPacket & {
  id: number;
  discord_id: string;
  code_hash: string;
  handle: string | null;
  expires_at: Date;
  consumed_at: Date | null;
  attempts: number;
};

/**
 * Réserve un essai sur la ligne d'un défi puis compare le code : l'unique
 * implémentation, partagée par les deux façons de désigner le défi.
 */
async function settleChallengeAttempt(
  db: Awaited<ReturnType<typeof getDatabase>>,
  challenge: ChallengeRow,
  code: string,
): Promise<DiscordChallengeProof | null> {
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
