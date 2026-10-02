import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { sendBotLog } from "@/lib/server/bot-integration";
import { getDatabase } from "@/lib/server/database";
import type { ConnectionMethod } from "@/lib/shared/account-connections";
import { ensureUniquePseudo } from "@/lib/server/auth";
import { normalizePseudo } from "@/lib/server/serialization";
import { deleteStoredImage } from "@/lib/server/image-upload";
import { importRemoteAvatar, shouldImportRemoteAvatar } from "@/lib/server/user-avatar-import";
import { toDiskUploadPath } from "@/lib/shared/uploads";
import { formatPlayerSignupLog, type PlayerSignupProvider } from "@/lib/shared/bot-logs";
import { recordTermsAcceptance, recordTermsAcceptanceIfBehind } from "@/lib/server/terms-acceptance";
import { TERMS_REQUIRED } from "@/lib/shared/terms-of-use";
import { DISCORD_NAMED_PSEUDO_SQL } from "@/lib/server/discord-pseudo-sql";
import { normalizeBattletag, normalizeDiscordHandle } from "./tag-normalization";

/*
 * Connexion par un fournisseur (Google, Discord, Battle.net) : retrouve le
 * compte de l'identité ou le crée, avec l'acceptation des conditions.
 */

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
 * fuite fait le plus regretter, et la garder « au cas où » revient à en assumer
 * le risque pour un usage qui n'existe pas. Elle a donc été **supprimée**, ce
 * qui a effacé du même geste les adresses collectées avant la règle.
 *
 * C'est aussi pourquoi `emailVerified` a disparu avec elle : il ne servait qu'à
 * garder ce rattachement honnête.
 */
export type GoogleProfilePayload = {
  sub: string;
  picture?: string;
};

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
function announcePlayerSignup(provider: PlayerSignupProvider): void {
  // Ni pseudo ni identifiant : le canal Discord ne nomme aucun joueur
  // (`lib/shared/log-privacy.ts`).
  void sendBotLog(formatPlayerSignupLog({ provider })).catch(() => undefined);
}

/**
 * Les conditions d'utilisation, telles que la porte d'entrée les a reçues.
 *
 * Paramètre **obligatoire** des trois `createOrGet…User`, pour la même raison
 * que la porte Discord : un défaut ferait créer silencieusement des comptes
 * sans acceptation par la prochaine porte ajoutée.
 */
export type TermsConsent = { termsAccepted: boolean };

/**
 * Suite commune des trois portes, une fois le compte retrouvé ou créé.
 *
 * - compte **neuf** : l'acceptation est sa condition de naissance, vérifiée
 *   avant l'`INSERT` par {@link assertSignupConsent} ; ici elle est écrite ;
 * - compte **existant**, case cochée : l'acceptation est enregistrée si la
 *   version courante ne l'était pas encore ;
 * - compte existant, case absente : rien — on ne ferme pas la porte à un
 *   membre existant, les conditions lui seront demandées là où elles comptent.
 */
async function settleTermsAfterLogin(userId: number, created: boolean, consent: TermsConsent): Promise<void> {
  if (created) {
    await recordTermsAcceptance(userId, "SIGNUP");
    return;
  }
  if (consent.termsAccepted) await recordTermsAcceptanceIfBehind(userId, "LOGIN");
}

/** @throws TERMS_REQUIRED Création d'un compte sans les conditions acceptées. */
function assertSignupConsent(consent: TermsConsent): void {
  if (!consent.termsAccepted) throw new Error(TERMS_REQUIRED);
}

export async function createOrGetGoogleUser(
  profile: GoogleProfilePayload,
  consent: TermsConsent,
): Promise<number> {
  const db = await getDatabase();

  const [existing] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE google_sub = ? LIMIT 1`,
    [profile.sub],
  );

  if (existing.length > 0) {
    const userId = Number(existing[0].id);
    await adoptRemoteAvatar(userId, profile.picture);
    await settleTermsAfterLogin(userId, false, consent);
    return userId;
  }

  assertSignupConsent(consent);

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
  //
  // **Le pseudo n'est jamais tiré du nom Google.** Le `name` d'un profil Google
  // est le plus souvent un prénom et un nom réels, et un pseudo est public et
  // ne se masque pas : le reprendre démentait la promesse « aucun nom réel »
  // (`/rgpd`, modale de consentement, registre T01). Le compte naît donc sous
  // un pseudo neutre, que le joueur remplace depuis « Mon profil » — et le nom
  // ne traverse même plus la frontière du fournisseur (`GoogleProfilePayload`).
  const pseudo = await ensureUniquePseudo(`player${Date.now().toString().slice(-5)}`);

  // L'avatar n'est pas posé ici : le nom du fichier porte l'identifiant du
  // compte, qui n'existe qu'une fois la ligne écrite. La photo est copiée juste
  // après, et son échec ne remet pas la création en cause.
  const [created] = await db.execute<ResultSetHeader>(
    `INSERT INTO bg_users (pseudo, avatar_url, google_sub)
     VALUES (?, NULL, ?)`,
    [pseudo, profile.sub],
  );

  const userId = Number(created.insertId);
  announcePlayerSignup("GOOGLE");
  await settleTermsAfterLogin(userId, true, consent);
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
 * **La photo importée naît masquée** (`visible_avatar = 0`). Le joueur ne l'a
 * pas choisie : elle vient du fournisseur par lequel il s'est connecté, et la
 * publier d'office à tout membre connecté — et, par l'entrée solo, jusqu'à la
 * vitrine publique — serait une mise à disposition sans intervention de
 * l'intéressé (RGPD art. 25.2). Il la rend visible d'une case sur « Mon
 * profil ». Le réglage n'est posé qu'ici, à l'import : un avatar téléversé à la
 * main n'est jamais concerné, et l'entrée solo n'a rien à resynchroniser — il
 * n'y avait aucun avatar local avant l'import (`shouldImportRemoteAvatar`).
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
    `SELECT avatar_url FROM bg_users WHERE id = ? AND is_deleted = 0 LIMIT 1`,
    [userId],
  );
  if (rows.length === 0) return;
  if (!shouldImportRemoteAvatar(rows[0].avatar_url)) return;

  const stored = await importRemoteAvatar(picture, userId);
  if (!stored) return;

  // Même condition, même raison que le téléversement ordinaire — avec un délai
  // plus long encore : entre la lecture ci-dessus et cette écriture, il y a un
  // téléchargement sortant et un traitement d'image, soit des secondes pendant
  // lesquelles le joueur peut supprimer son compte depuis un autre onglet. La
  // photo repartait alors sur la ligne anonymisée, publiquement servie par
  // `/api/uploads/avatars/…` et republiée sur l'entrée solo à la prochaine
  // resynchronisation. Le fichier est déjà sur le disque dans les deux modes —
  // sur un compte **effacé** la ligne n'existe même plus —, d'où le ménage :
  // sans lui, une photo personnelle orpheline survivait à un compte dont on
  // venait de promettre qu'il ne resterait rien.
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE bg_users SET avatar_url = ?, visible_avatar = 0 WHERE id = ? AND is_deleted = 0`,
    [stored, userId],
  );
  if (Number(result.affectedRows) === 0) {
    await deleteStoredImage(toDiskUploadPath(stored)).catch(() => {
      // Disque récalcitrant : un résidu, et rien à annoncer — l'appelant a déjà
      // avalé les refus de cette fonction par construction.
    });
  }
}

/**
 * Retrouve (ou crée) le compte rattaché à cet identifiant Discord.
 *
 * `verifiedHandle` est le **tag prouvé** par le code qui vient d'être consommé,
 * ou nommé par Discord au retour de l'OAuth (`null` quand la demande portait un
 * identifiant numérique). Il est **enregistré, jamais certifié** : voir
 * {@link DISCORD_NAMED_PSEUDO_SQL}. La certification reste un geste distinct,
 * fait depuis le profil.
 *
 * Il **écrase** le tag stocké, et ce n'est pas une négligence : on n'arrive ici
 * que par un identifiant qui a résolu ce handle-là. Les deux valeurs désignent
 * donc le même compte Discord, et la plus récente est la bonne — un pseudo
 * Discord se change, et c'est précisément le cas où le tag stocké est périmé.
 *
 * `door.method` dit **par quelle des deux portes Discord** on arrive : les deux
 * chemins — l'aller-retour OAuth et le code reçu en message privé — passent par
 * cette même fonction et y arrivent avec les mêmes arguments. Seul l'appelant
 * sait lequel il est, d'où un paramètre obligatoire plutôt qu'un défaut
 * (`lib/shared/account-connections.ts`).
 */
export async function createOrGetDiscordUser(
  discordId: string,
  pseudoInput: string | undefined,
  verifiedHandle: string | null | undefined,
  door: {
    /**
     * Photo de profil Discord, à **copier** chez nous comme celle de Google.
     *
     * Le code par message privé n'en rapporte aucune — le bot ne résout qu'un
     * identifiant —, l'aller-retour OAuth si. Elle ne remplace jamais un avatar
     * déjà téléversé (`shouldImportRemoteAvatar`).
     */
    avatarUrl?: string | null;
    /**
     * **Par quelle porte** on arrive, et c'est l'appelant qui le sait.
     *
     * Le paramètre est obligatoire, et c'est délibéré : un défaut ferait
     * silencieusement classer la porte ajoutée demain, et la valeur ne se
     * devine pas d'ici — les deux chemins arrivent avec exactement les mêmes
     * arguments, à l'avatar près, qu'un compte Discord peut aussi ne pas
     * avoir.
     */
    method: ConnectionMethod;
    /** Conditions d'utilisation cochées à l'entrée (voir {@link TermsConsent}). */
    termsAccepted: boolean;
  },
): Promise<number> {
  const db = await getDatabase();
  const handle = normalizeDiscordHandle(verifiedHandle);
  const avatarUrl = door.avatarUrl;
  // `OAUTH` s'impose, `DM_CODE` ne se pose que faute de mieux : une autorisation
  // d'application donnée à Discord existe chez lui tant que le joueur ne la
  // retire pas, et une connexion par code, plus tard, ne la défait pas
  // (`lib/shared/account-connections.ts`). Un rattachement antérieur à la
  // colonne (`NULL`) se laisse donc nommer par la première porte qui repasse.
  const methodSql =
    door.method === "OAUTH" ? `'OAUTH'` : `COALESCE(discord_link_method, 'DM_CODE')`;

  const [existing] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE discord_id = ? LIMIT 1`,
    [discordId],
  );

  if (existing.length > 0) {
    const userId = Number(existing[0].id);
    // `is_deleted = 0` ferme ici la course que ferment déjà `writeVerifiedTag`,
    // `updateOwnProfile` et les trois écritures de `linkOAuthIdentity` — et
    // c'est celle qui coûte le plus cher des quatre. Une connexion Discord
    // partie avant la suppression a résolu son compte sur le `discord_id`
    // d'alors ; elle reprend **après** le commit de `deleteOwnAccount`, qui
    // vient de vider tag et certification. Sans la condition, elle réécrivait
    // le vrai pseudo Discord sur la ligne anonymisée — une donnée personnelle
    // que l'anonymisation venait d'effacer.
    //
    // La session, elle, n'est pas le sujet : `getCurrentUser` et la lecture
    // par jeton portent déjà `is_deleted = 0`, donc celle que la connexion
    // s'apprête à ouvrir ne résoudra personne.
    //
    // Le tag reste **conditionnel** — un identifiant numérique n'est pas un
    // pseudo —, la méthode non : elle décrit la porte qu'on vient de franchir,
    // que Discord ait nommé un pseudo affichable ou pas. Les deux dans la même
    // instruction, plutôt qu'une seconde écriture qui laisserait un `await`
    // entre elles.
    await db.execute(
      handle
        ? `UPDATE bg_users
           SET ${DISCORD_NAMED_PSEUDO_SQL},
               discord_link_method = ${methodSql}
           WHERE id = ? AND is_deleted = 0`
        : `UPDATE bg_users
           SET discord_link_method = ${methodSql}
           WHERE id = ? AND is_deleted = 0`,
      handle ? [handle, handle, userId] : [userId],
    );
    await adoptRemoteAvatar(userId, avatarUrl ?? undefined);
    await settleTermsAfterLogin(userId, false, door);
    return userId;
  }

  assertSignupConsent(door);

  const rawPseudo = normalizePseudo(pseudoInput || handle || `discord_${discordId.slice(-6)}`);
  const pseudo = await ensureUniquePseudo(rawPseudo);

  const [created] = await db.execute<ResultSetHeader>(
    // Tag enregistré, **jamais certifié** : un compte neuf n'a rien consenti
    // d'autre que de se connecter.
    `INSERT INTO bg_users (pseudo, discord_id, discord_pseudo, discord_pseudo_from_discord,
                           discord_link_method)
     VALUES (?, ?, ?, ?, ?)`,
    [pseudo, discordId, handle, handle ? 1 : 0, door.method],
  );

  const userId = Number(created.insertId);
  announcePlayerSignup("DISCORD");
  await settleTermsAfterLogin(userId, true, door);
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
export async function createOrGetBlizzardUser(
  sub: string,
  battletag: string | null,
  consent: TermsConsent,
): Promise<number> {
  const db = await getDatabase();
  const tag = normalizeBattletag(battletag);

  const [existing] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE blizzard_sub = ? LIMIT 1`,
    [sub],
  );

  if (existing.length > 0) {
    const userId = Number(existing[0].id);
    if (tag) {
      // Même course, même remède qu'au-dessus : une connexion Battle.net partie
      // avant la suppression réécrivait le BattleTag sur la ligne que
      // `anonymizeAccount` venait de mettre à `NULL`. La donnée est moins
      // exposée que le tag Discord (aucune certification, et l'anonymisation
      // force `visible_overwatch` à 0), mais c'est la même chose : une
      // coordonnée personnelle qui repousse sur un compte vidé.
      await db.execute(
        `UPDATE bg_users SET overwatch_battletag = ? WHERE id = ? AND is_deleted = 0`,
        [tag, userId],
      );
    }
    await settleTermsAfterLogin(userId, false, consent);
    return userId;
  }

  assertSignupConsent(consent);

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
  announcePlayerSignup("BLIZZARD");
  await settleTermsAfterLogin(userId, true, consent);
  return userId;
}
