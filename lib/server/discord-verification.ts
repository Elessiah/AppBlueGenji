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
 * **La connexion prouve, elle ne certifie pas.** Se connecter par Discord (bouton
 * ou code) enregistre le pseudo que Discord a donné, **non certifié** : c'est un
 * acte d'authentification, pas le consentement à l'exposition que la
 * certification ouvre. Celle-ci reste un geste distinct, fait sur `/profil`.
 *
 * **Deux chemins, selon ce que le compte a déjà prouvé.** Un compte qui porte un
 * `discord_id` a *déjà* fait la preuve — c'est ainsi qu'il s'est connecté, et
 * c'est Discord qui a nommé son pseudo (`discord_pseudo_from_discord`). Il
 * certifie donc **d'un clic** (`certifyLinkedDiscordTag`) : ni aller-retour
 * OAuth, ni code, ni bot — et jamais une valeur envoyée par le client, qui ne
 * sert qu'à vérifier que le tag montré est bien celui qu'on certifie. Un compte
 * Google, lui, n'a rien prouvé : il passe par le code en message privé.
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
import type { ConnectionMethod } from "@/lib/shared/account-connections";
import {
  consumeDiscordLoginChallenge,
  createDiscordLoginChallenge,
  discardDiscordChallenge,
} from "@/lib/server/users/discord-challenges";
import { normalizeDiscordHandle } from "@/lib/server/users/tag-normalization";

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
  /**
   * Le tag enregistré a-t-il été **nommé par Discord** ? C'est la condition de
   * la certification en un clic d'un compte rattaché : sans elle (tag tapé à la
   * main avant le rattachement, ou aucun tag), le joueur repasse par Discord
   * pour qu'il nomme son pseudo.
   */
  attested: boolean;
};

/** Résultat d'une demande de certification. */
export type VerificationStart =
  /** Certifié sur place : l'identifiant était déjà prouvé. */
  | { status: "VERIFIED"; tag: string }
  /** Un code part en message privé ; la confirmation suivra. */
  | CodeSent;

/**
 * Un code est parti en message privé. La confirmation désigne le défi par
 * `challenge`, un jeton imprévisible qui **ne désigne personne** — jamais par
 * l'identifiant Discord résolu, que le site traite partout comme une
 * coordonnée : le rendre ici faisait de la demande un oracle (« ce pseudo est
 * ce compte Discord »), celui que la connexion par code a cessé d'être.
 */
export type CodeSent = { status: "CODE_SENT"; challenge: string; expiresAt: string };

type UserDiscordRow = RowDataPacket & {
  discord_id: string | null;
  discord_pseudo: string | null;
  discord_verified_at: Date | null;
  discord_pseudo_from_discord: number | boolean | null;
};

/**
 * La ligne du compte, **si elle est encore vivante**.
 *
 * Un compte anonymisé garde sa ligne, mais plus aucune de ses identités : lui
 * rendre son état Discord n'aurait rien à dire, et le laisser entrer dans une
 * certification rouvrirait la porte que la suppression vient de fermer. Le
 * `PROFILE_NOT_FOUND` de ses appelants est la bonne réponse — pour eux, ce
 * compte n'existe plus.
 */
async function loadDiscordRow(userId: number): Promise<UserDiscordRow | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<UserDiscordRow[]>(
    `SELECT discord_id, discord_pseudo, discord_verified_at, discord_pseudo_from_discord
     FROM bg_users
     WHERE id = ? AND is_deleted = 0
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
    attested: isAttestedTag(row),
  };
}

/** Le tag stocké a-t-il été nommé par Discord (et existe-t-il) ? */
function isAttestedTag(row: UserDiscordRow | null): boolean {
  return Boolean(row?.discord_pseudo) && Number(row?.discord_pseudo_from_discord ?? 0) === 1;
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
 *
 * `is_deleted = 0` en tranche une autre, et c'est celle qui coûte le plus cher :
 * une certification lancée avant une suppression de compte attend le verrou de
 * `deleteOwnAccount` et reprend **après** son commit. Elle reposait alors
 * `discord_id` sur la ligne fraîchement anonymisée — donc une **porte d'entrée**
 * neuve, `createOrGetDiscordUser` retrouvant le compte par cet identifiant — et
 * un tag personnel certifié, que `canViewDiscordTag` ouvre à l'arbitrage. La
 * lecture préalable ne suffit pas : c'est l'écriture qui doit porter la
 * condition, un `await` la sépare de son contrôle.
 *
 * La méthode suit `discord_id` par le même `COALESCE` : le code reçu en message
 * privé est la porte qu'un compte sans Discord vient de franchir, mais il ne
 * réécrit pas celle d'un rattachement déjà noué.
 */
async function writeVerifiedTag(userId: number, discordId: string, tag: string): Promise<void> {
  const method: ConnectionMethod = "DM_CODE";
  const db = await getDatabase();
  try {
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE bg_users
       SET discord_id = COALESCE(discord_id, ?),
           discord_pseudo = ?,
           discord_verified_at = NOW(),
           discord_pseudo_from_discord = 1,
           discord_link_method = COALESCE(discord_link_method, ?)
       WHERE id = ? AND is_deleted = 0`,
      [discordId, tag, method, userId],
    );
    if (Number(result.affectedRows) === 0) throw new Error("PROFILE_NOT_FOUND");
  } catch (error) {
    if (isDuplicateEntryError(error)) throw new Error("DISCORD_ALREADY_LINKED");
    throw error;
  }
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
 * Il n'est **pas** appelé sur le chemin sans code : une certification en un clic
 * ne fait sonner aucun téléphone, il n'y a rien à protéger.
 */
export type ResolvedDiscordIdGuard = (discordId: string) => void;

/**
 * Certifie **d'un clic** le tag d'un compte Discord rattaché.
 *
 * La preuve est faite — le compte s'est connecté par ce Discord, qui a nommé le
 * pseudo — et ce clic n'apporte que ce qui manquait : le **consentement** à
 * l'exposition. Rien n'est donc demandé au bot ni à Discord, et rien de ce que
 * le client envoie n'est écrit : `expectedTag` (le tag que l'écran montrait)
 * sert seulement de garde, pour ne pas certifier un pseudo que la connexion d'un
 * autre appareil viendrait de remplacer sous les yeux du joueur.
 *
 * Une seule instruction, conditions comprises : un `await` entre la lecture et
 * l'écriture laisserait un détachement ou une suppression de compte s'y glisser.
 * Déjà certifié, le geste réussit sans rien changer (`COALESCE`).
 *
 * @throws DISCORD_NOT_LINKED Le compte n'a plus de Discord rattaché.
 * @throws DISCORD_TAG_MISSING Aucun tag enregistré.
 * @throws DISCORD_TAG_NOT_ATTESTED Le tag n'a pas été nommé par Discord (saisi
 *   avant le rattachement) : le joueur repasse par Discord pour qu'il le nomme.
 * @throws DISCORD_TAG_CHANGED Le tag enregistré n'est plus celui montré.
 * @throws PROFILE_NOT_FOUND Compte supprimé.
 */
export async function certifyLinkedDiscordTag(
  userId: number,
  expectedTag: string,
): Promise<{ status: "VERIFIED"; tag: string }> {
  const expected = normalizeDiscordHandle(expectedTag);
  if (expected) {
    const db = await getDatabase();
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE bg_users
       SET discord_verified_at = COALESCE(discord_verified_at, NOW())
       WHERE id = ? AND is_deleted = 0
         AND discord_id IS NOT NULL
         AND discord_pseudo_from_discord = 1
         AND discord_pseudo = ?`,
      [userId, expected],
    );
    if (Number(result.affectedRows) > 0) return { status: "VERIFIED", tag: expected };
  }

  // Rien n'a été apparié : la relecture ne décide plus, elle **nomme** le refus.
  const row = await loadDiscordRow(userId);
  if (!row) throw new Error("PROFILE_NOT_FOUND");
  if (!row.discord_id) throw new Error("DISCORD_NOT_LINKED");
  if (!row.discord_pseudo) throw new Error("DISCORD_TAG_MISSING");
  if (!isAttestedTag(row)) throw new Error("DISCORD_TAG_NOT_ATTESTED");
  throw new Error("DISCORD_TAG_CHANGED");
}

/**
 * Ouvre une certification pour `handle`.
 *
 * Un compte **rattaché** certifie d'un clic ({@link certifyLinkedDiscordTag}) :
 * `handle` n'y est que le tag montré à l'écran. Un compte sans Discord reçoit un
 * code en message privé.
 *
 * @throws INVALID_DISCORD_HANDLE Un identifiant numérique, une chaîne vide : il
 *   n'y a pas de **tag** à certifier. La connexion accepte un identifiant en
 *   repli, la certification non — c'est un pseudo qu'elle publie à l'arbitrage.
 *
 * **Aucun refus ne dit si ce Discord est déjà rattaché ailleurs.** Ce refus
 * partait ici, avant tout message privé : n'importe quel membre connecté
 * apprenait, pour n'importe quel pseudo et sans laisser de trace chez
 * l'intéressé, si la personne avait un compte BlueGenji — l'oracle que la
 * demande de code de connexion a cessé d'être (`docs/AUTHORIZATION_RULES.md`
 * §1.1). Le code part donc de la même façon dans les deux cas, et le refus
 * (`DISCORD_ALREADY_LINKED`) n'est rendu qu'à la **confirmation**, par l'index
 * unique de `bg_users.discord_id` — à qui détient le code, donc le Discord.
 *
 * @throws DISCORD_USER_NOT_FOUND / BOT_INTERNAL_UNREACHABLE / DISCORD_DM_FAILED
 *   Remontées telles quelles de la résolution et de l'envoi.
 */
export async function startDiscordVerification(
  userId: number,
  handle: string,
  guardBeforeSend?: ResolvedDiscordIdGuard,
): Promise<VerificationStart> {
  const row = await loadDiscordRow(userId);
  if (!row) throw new Error("PROFILE_NOT_FOUND");

  // **La preuve existe déjà** : ce compte s'est connecté par son Discord. Il ne
  // manque que le consentement, que ce clic donne.
  if (row.discord_id) return certifyLinkedDiscordTag(userId, handle);

  const tag = normalizeDiscordHandle(handle);
  if (!tag) throw new Error("INVALID_DISCORD_HANDLE");

  const discordId = await resolveDiscordUser(tag);

  // **Avant le défi et avant l'envoi** : ce qui suit fait vibrer le téléphone de
  // quelqu'un, et un plafond posé après n'aurait plus rien à refuser.
  guardBeforeSend?.(discordId);

  return sendHandleChallenge(discordId, tag);
}

/**
 * Confirme une certification avec le code reçu.
 *
 * Le tag écrit est celui **retenu sur la ligne du défi**, jamais celui que le
 * client renvoie : c'est la ligne qui porte la preuve. Un défi né d'un
 * identifiant numérique n'a aucun tag à certifier — il vient de la page de
 * connexion, pas d'ici — et le refus le dit (`INVALID_DISCORD_HANDLE`).
 *
 * Le défi est désigné par son jeton (`challenge`) : l'identifiant Discord n'est
 * relu que **sur la ligne**, une fois le code juste.
 *
 * @throws CODE_INVALID_OR_EXPIRED Code faux, périmé, déjà consommé, quota
 *   d'essais épuisé ou jeton inconnu : un seul message pour tous ces cas, qui
 *   ne se distinguent pas du point de vue de qui essaie.
 * @throws DISCORD_ALREADY_LINKED Un autre compte du site détient ce Discord.
 */
export async function confirmDiscordVerification(
  userId: number,
  challenge: string,
  code: string,
): Promise<{ tag: string }> {
  const row = await loadDiscordRow(userId);
  if (!row) throw new Error("PROFILE_NOT_FOUND");

  const proof = await consumeDiscordLoginChallenge(challenge, code);
  if (!proof) throw new Error("CODE_INVALID_OR_EXPIRED");
  const { discordId } = proof;
  // Relu après l'aller-retour du joueur : son compte a pu se rattacher entre la
  // demande et la confirmation, et on ne déplace jamais une porte d'entrée.
  if (row.discord_id && row.discord_id !== discordId) throw new Error("DISCORD_ID_MISMATCH");
  if (!proof.handle) throw new Error("INVALID_DISCORD_HANDLE");

  // Le code reçu en message privé **est** la porte, ici : sur un compte qui ne
  // portait pas encore de `discord_id`, cette écriture le pose, et c'est donc
  // ce geste-là qui a noué le rattachement.
  await writeVerifiedTag(userId, discordId, proof.handle);
  return { tag: proof.handle };
}

/**
 * Émet un défi pour `tag` et l'envoie en message privé.
 *
 * La mécanique est celle de la connexion par code, sans rien de plus : même
 * table, mêmes deux bornes en base (`createDiscordLoginChallenge`), et un envoi
 * raté **supprime** sa ligne — un code qui n'est pas parti ne doit pas survivre
 * à son échec, sinon il masque comme « dernier émis » celui que le joueur
 * détient vraiment.
 */
async function sendHandleChallenge(discordId: string, tag: string): Promise<CodeSent> {
  const challenge = await createDiscordLoginChallenge(discordId, tag);
  try {
    await sendDiscordLoginCode(discordId, challenge.code);
  } catch (error) {
    await discardDiscordChallenge(challenge.challengeId).catch(() => {});
    throw error;
  }

  return {
    status: "CODE_SENT",
    challenge: challenge.challengeToken,
    expiresAt: challenge.expiresAt.toISOString(),
  };
}

/**
 * « Mettre à jour mon pseudo » — la ligne « Bot Discord » d'« Applications
 * connectées ».
 *
 * Le bot ne **renvoie** jamais le tag d'un compte : il ne sait que résoudre un
 * pseudo qu'on lui donne. Le joueur saisit donc son pseudo, le bot le retrouve et
 * lui envoie un code à six chiffres en message privé, et c'est le code qui
 * prouve que le pseudo est le sien. Le pseudo enregistré est alors « donné par
 * Discord » au même titre que celui d'une connexion
 * (`discord_pseudo_from_discord`), donc certifiable d'un clic ensuite.
 *
 * **On ne déplace jamais une porte** : un compte qui porte un `discord_id` ne
 * peut mettre à jour que le pseudo de *ce* compte Discord — un pseudo qui résout
 * ailleurs est refusé (`DISCORD_ID_MISMATCH`). Un compte sans Discord rattache
 * par le même geste (`discord_link_method = 'DM_CODE'`), sauf si un autre compte
 * du site détient déjà ce Discord — refus rendu à la **confirmation** seulement,
 * pour la raison dite sur {@link startDiscordVerification} : le rendre ici
 * ferait de la demande un oracle.
 *
 * @throws INVALID_DISCORD_HANDLE Chaîne vide ou identifiant numérique.
 * @throws DISCORD_ID_MISMATCH Le pseudo désigne un autre compte Discord que
 *   celui déjà rattaché **à ce compte** : rien n'y est dit d'un tiers.
 */
export async function startDiscordHandleUpdate(
  userId: number,
  handle: string,
  guardBeforeSend?: ResolvedDiscordIdGuard,
): Promise<CodeSent> {
  const row = await loadDiscordRow(userId);
  if (!row) throw new Error("PROFILE_NOT_FOUND");

  const tag = normalizeDiscordHandle(handle);
  if (!tag) throw new Error("INVALID_DISCORD_HANDLE");

  const discordId = await resolveDiscordUser(tag);
  if (row.discord_id && row.discord_id !== discordId) throw new Error("DISCORD_ID_MISMATCH");

  // Avant le défi et avant l'envoi, comme pour la certification.
  guardBeforeSend?.(discordId);
  return sendHandleChallenge(discordId, tag);
}

/**
 * Confirme « Mettre à jour mon pseudo » avec le code reçu.
 *
 * Le pseudo écrit est celui **retenu sur la ligne du défi** — celui que le bot a
 * résolu vers ce compte Discord —, jamais une valeur renvoyée par le client.
 *
 * Une seule instruction, dont l'ordre des affectations compte (MySQL les évalue
 * de gauche à droite) :
 *
 * - la **certification** tombe si le pseudo change (`<=>`, le tag pouvant être
 *   `NULL`) : elle portait sur l'ancien, et certifier reste un geste distinct ;
 *   un pseudo inchangé la garde ;
 * - la **méthode** n'est posée que sur un rattachement neuf, lue **avant**
 *   l'affectation de `discord_id` : réauthentifier un rattachement existant
 *   n'est pas franchir une porte, et `OAUTH` ne redescend jamais ;
 * - `discord_id IS NULL OR discord_id = ?` porte dans l'écriture la règle que le
 *   `SELECT` n'a fait que nommer — un rattachement a pu changer pendant
 *   l'`await` —, et `is_deleted = 0` ferme la course avec une suppression.
 *
 * @throws CODE_INVALID_OR_EXPIRED Code faux, périmé, consommé ou brûlé.
 * @throws DISCORD_ID_MISMATCH Le compte a un autre Discord rattaché.
 * @throws DISCORD_ALREADY_LINKED Un autre compte du site détient ce Discord.
 */
export async function confirmDiscordHandleUpdate(
  userId: number,
  challenge: string,
  code: string,
): Promise<{ tag: string }> {
  const row = await loadDiscordRow(userId);
  if (!row) throw new Error("PROFILE_NOT_FOUND");

  const proof = await consumeDiscordLoginChallenge(challenge, code);
  if (!proof) throw new Error("CODE_INVALID_OR_EXPIRED");
  const { discordId } = proof;
  if (row.discord_id && row.discord_id !== discordId) throw new Error("DISCORD_ID_MISMATCH");

  // Un défi né d'un identifiant numérique (connexion en repli) n'a aucun pseudo.
  const tag = normalizeDiscordHandle(proof.handle ?? "");
  if (!tag) throw new Error("INVALID_DISCORD_HANDLE");

  const method: ConnectionMethod = "DM_CODE";
  const db = await getDatabase();
  let affected: number;
  try {
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE bg_users
       SET discord_verified_at = CASE WHEN discord_pseudo <=> ? THEN discord_verified_at ELSE NULL END,
           discord_link_method = CASE WHEN discord_id IS NULL THEN ? ELSE discord_link_method END,
           discord_id = COALESCE(discord_id, ?),
           discord_pseudo = ?,
           discord_pseudo_from_discord = 1
       WHERE id = ? AND is_deleted = 0 AND (discord_id IS NULL OR discord_id = ?)`,
      [tag, method, discordId, tag, userId, discordId],
    );
    affected = Number(result.affectedRows);
  } catch (error) {
    if (isDuplicateEntryError(error)) throw new Error("DISCORD_ALREADY_LINKED");
    throw error;
  }

  if (affected === 0) {
    const current = await loadDiscordRow(userId);
    if (!current) throw new Error("PROFILE_NOT_FOUND");
    throw new Error("DISCORD_ID_MISMATCH");
  }
  return { tag };
}
