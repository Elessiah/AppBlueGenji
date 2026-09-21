/**
 * Certification du tag Discord d'un compte.
 *
 * Le tag était une chaîne libre : n'importe qui pouvait écrire celui d'un autre,
 * et l'organisation qui s'en sert pour joindre un joueur n'avait aucun moyen de
 * savoir qu'elle écrivait à la bonne personne. La certification est la preuve
 * manquante — et, du même coup, le consentement à l'exposition que décrit
 * `lib/shared/discord-identity.ts`.
 *
 * **La preuve est celle de la connexion, ni plus ni moins** : un code à six
 * chiffres reçu en message privé sur le compte Discord revendiqué. D'où la
 * réutilisation, telle quelle, de `bg_discord_login_challenges` et de ses deux
 * bornes en base (cinq essais par code, cinq codes par quart d'heure) : le
 * secret est le même objet, il n'y a aucune raison d'en avoir un second, moins
 * éprouvé.
 *
 * **Deux chemins, une seule règle.** Un compte qui porte déjà un `discord_id` a
 * *déjà* fait cette preuve — c'est ainsi qu'il s'est connecté. Lui redemander un
 * code serait rejouer ce qu'on détient : le site vérifie alors que le tag saisi
 * **résout vers cet identifiant-là**, et certifie sur place, sans message privé.
 * Un compte Google, lui, n'a rien prouvé : il passe par le code. `startVerification`
 * dit lequel des deux vient de se produire, et c'est la seule différence entre
 * les deux parcours.
 *
 * **Ce module ne relie jamais deux comptes Discord.** Un compte du site dont le
 * `discord_id` est posé le garde : un tag qui résout ailleurs est refusé
 * (`DISCORD_ID_MISMATCH`) plutôt que de faire glisser l'identité de connexion
 * d'un compte Discord à un autre. Le `discord_id` **est** un moyen de connexion
 * (`createOrGetDiscordUser`) : le déplacer, c'est déplacer une porte d'entrée.
 */
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { resolveDiscordUser, sendDiscordLoginCode } from "@/lib/server/bot-integration";
import { isDuplicateEntryError } from "@/lib/server/mysql-errors";
import {
  consumeDiscordChallenge,
  createDiscordLoginChallenge,
  discardDiscordChallenge,
  normalizeDiscordHandle,
} from "@/lib/server/users-service";

/** État Discord d'un compte, tel que le profil le lit. */
export type DiscordAccountState = {
  /** Tag saisi, `null` s'il n'y en a pas. */
  tag: string | null;
  /** Le tag a-t-il été prouvé ? */
  verified: boolean;
  /**
   * Un identifiant Discord est-il déjà rattaché au compte ? Quand oui, la
   * certification se fait **sans code** (voir `discordVerificationNeedsCode`).
   */
  linked: boolean;
};

/** Résultat d'une demande de certification. */
export type VerificationStart =
  /** Certifié sur place : l'identifiant était déjà prouvé. */
  | { status: "VERIFIED"; tag: string }
  /** Un code part en message privé ; la confirmation suivra. */
  | { status: "CODE_SENT"; discordId: string; expiresAt: string };

type UserDiscordRow = RowDataPacket & {
  discord_id: string | null;
  discord_pseudo: string | null;
  discord_verified_at: Date | null;
};

async function loadDiscordRow(userId: number): Promise<UserDiscordRow | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<UserDiscordRow[]>(
    `SELECT discord_id, discord_pseudo, discord_verified_at
     FROM bg_users
     WHERE id = ?
     LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function getDiscordAccountState(userId: number): Promise<DiscordAccountState> {
  const row = await loadDiscordRow(userId);
  return {
    tag: row?.discord_pseudo ?? null,
    verified: row?.discord_verified_at != null,
    linked: Boolean(row?.discord_id),
  };
}

/**
 * Écrit le tag certifié.
 *
 * L'identifiant est écrit **en même temps** que le tag, et par la même
 * instruction : ce sont les deux faces d'une preuve unique, et une base où l'un
 * serait passé sans l'autre ne voudrait rien dire. `discord_id` n'est posé que
 * s'il manquait (`COALESCE`) — l'appelant a déjà refusé le cas où il diffère,
 * mais la garde vaut d'être portée par l'écriture elle-même.
 *
 * L'unicité de `discord_id` est la borne qui tranche la **course** entre deux
 * comptes du site qui certifieraient le même Discord au même instant : le
 * contrôle préalable donne le refus lisible, l'index donne la garantie. Même
 * paire que le sigle d'équipe.
 */
async function writeVerifiedTag(userId: number, discordId: string, tag: string): Promise<void> {
  const db = await getDatabase();
  try {
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE bg_users
       SET discord_id = COALESCE(discord_id, ?),
           discord_pseudo = ?,
           discord_verified_at = NOW()
       WHERE id = ?`,
      [discordId, tag, userId],
    );
    if (Number(result.affectedRows) === 0) throw new Error("PROFILE_NOT_FOUND");
  } catch (error) {
    if (isDuplicateEntryError(error)) throw new Error("DISCORD_ALREADY_LINKED");
    throw error;
  }
}

/**
 * Le tag est-il libre, ou déjà certifié par un autre compte du site ?
 *
 * Le refus porte sur l'**identifiant** et non sur la chaîne du tag : deux
 * comptes peuvent écrire le même pseudo (rien ne l'empêche, et l'un des deux se
 * trompe), mais un seul peut prouver l'identifiant qui va avec. C'est le même
 * espace de noms que la connexion Discord, dont `bg_users.discord_id` est
 * unique.
 */
async function discordIdTakenByAnother(discordId: string, userId: number): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE discord_id = ? AND id <> ? LIMIT 1`,
    [discordId, userId],
  );
  return rows.length > 0;
}

/**
 * Contrôle posé sur l'identifiant **une fois résolu**, avant qu'un message privé
 * ne parte.
 *
 * C'est le seul moyen de plafonner sur le compte Discord *visé* : il n'est connu
 * qu'après la résolution du tag, qui vit dans ce module. La route y met son
 * plafond de débit ; qu'il lève est ce qui le rend effectif — appelé après
 * l'envoi, il n'aurait plus rien à empêcher.
 *
 * Il n'est **pas** appelé sur le chemin sans code : une certification immédiate
 * ne fait sonner aucun téléphone, il n'y a rien à protéger.
 */
export type ResolvedDiscordIdGuard = (discordId: string) => void;

/**
 * Ouvre une certification pour `handle`.
 *
 * @throws INVALID_DISCORD_HANDLE Un identifiant numérique, une chaîne vide : il
 *   n'y a pas de **tag** à certifier. La connexion accepte un identifiant en
 *   repli, la certification non — c'est un pseudo qu'elle publie à l'arbitrage.
 * @throws DISCORD_ID_MISMATCH Le tag désigne un autre compte Discord que celui
 *   déjà rattaché.
 * @throws DISCORD_ALREADY_LINKED Un autre compte du site a déjà prouvé ce
 *   Discord.
 * @throws DISCORD_USER_NOT_FOUND / BOT_INTERNAL_UNREACHABLE / DISCORD_DM_FAILED
 *   Remontées telles quelles de la résolution et de l'envoi.
 */
export async function startDiscordVerification(
  userId: number,
  handle: string,
  guardBeforeSend?: ResolvedDiscordIdGuard,
): Promise<VerificationStart> {
  const tag = normalizeDiscordHandle(handle);
  if (!tag) throw new Error("INVALID_DISCORD_HANDLE");

  const row = await loadDiscordRow(userId);
  if (!row) throw new Error("PROFILE_NOT_FOUND");

  const discordId = await resolveDiscordUser(tag);

  if (row.discord_id && row.discord_id !== discordId) {
    throw new Error("DISCORD_ID_MISMATCH");
  }
  if (await discordIdTakenByAnother(discordId, userId)) {
    throw new Error("DISCORD_ALREADY_LINKED");
  }

  // **La preuve existe déjà** : ce compte s'est connecté par ce Discord. Le tag
  // vient d'être résolu vers ce même identifiant, il n'y a plus rien à prouver.
  if (row.discord_id === discordId) {
    await writeVerifiedTag(userId, discordId, tag);
    return { status: "VERIFIED", tag };
  }

  // **Avant le défi et avant l'envoi** : ce qui suit fait vibrer le téléphone de
  // quelqu'un, et un plafond posé après n'aurait plus rien à refuser.
  guardBeforeSend?.(discordId);

  const challenge = await createDiscordLoginChallenge(discordId, tag);
  try {
    await sendDiscordLoginCode(discordId, challenge.code);
  } catch (error) {
    // Même geste symétrique qu'à la connexion : un code qui n'est pas parti ne
    // doit pas survivre à son échec, sinon il masque comme « dernier émis »
    // celui que le joueur détient vraiment.
    await discardDiscordChallenge(challenge.challengeId).catch(() => {});
    throw error;
  }

  return {
    status: "CODE_SENT",
    discordId,
    expiresAt: challenge.expiresAt.toISOString(),
  };
}

/**
 * Confirme une certification avec le code reçu.
 *
 * Le tag écrit est celui **retenu sur la ligne du défi**, jamais celui que le
 * client renvoie : c'est la ligne qui porte la preuve. Un défi né d'un
 * identifiant numérique n'a aucun tag à certifier — il vient de la page de
 * connexion, pas d'ici — et le refus le dit (`INVALID_DISCORD_HANDLE`).
 *
 * @throws CODE_INVALID_OR_EXPIRED Code faux, périmé, déjà consommé, ou quota
 *   d'essais épuisé : un seul message pour tous ces cas, qui ne se distinguent
 *   pas du point de vue de qui essaie.
 */
export async function confirmDiscordVerification(
  userId: number,
  discordId: string,
  code: string,
): Promise<{ tag: string }> {
  const row = await loadDiscordRow(userId);
  if (!row) throw new Error("PROFILE_NOT_FOUND");
  // Relu après l'aller-retour du joueur : son compte a pu se rattacher entre la
  // demande et la confirmation, et on ne déplace jamais une porte d'entrée.
  if (row.discord_id && row.discord_id !== discordId) throw new Error("DISCORD_ID_MISMATCH");

  const proof = await consumeDiscordChallenge(discordId, code);
  if (!proof) throw new Error("CODE_INVALID_OR_EXPIRED");
  if (!proof.handle) throw new Error("INVALID_DISCORD_HANDLE");

  await writeVerifiedTag(userId, discordId, proof.handle);
  return { tag: proof.handle };
}
