/**
 * Les identités OAuth d'un compte : les rattacher, les détacher, les lister.
 *
 * **Un compte du site n'a pas de mot de passe.** Il n'est atteignable que par
 * les identités rangées dans `bg_users` — `google_sub`, `discord_id`,
 * `blizzard_sub` — et, pour Discord, par le code reçu en message privé, qui
 * passe par le *même* `discord_id`. Chaque colonne est donc une **porte
 * d'entrée**, ce qui donne à ce module ses deux règles :
 *
 * 1. **On ne déplace jamais une porte.** Un compte dont le `discord_id` est posé
 *    le garde : rattacher un autre Discord est refusé (`PROVIDER_ALREADY_LINKED`)
 *    plutôt que de faire glisser l'identité de connexion d'un compte Discord à
 *    un autre. C'est la règle que `discord-verification.ts` applique déjà sous le
 *    nom `DISCORD_ID_MISMATCH`, énoncée ici pour les trois fournisseurs.
 * 2. **On ne mure jamais la dernière.** Détacher le seul moyen de connexion ne
 *    délie pas un compte, il le ferme — définitivement, puisqu'il n'existe aucune
 *    récupération par courriel. La phrase du refus vit dans le module pur
 *    (`lib/shared/account-connections.ts`), partagée avec l'écran qui met le
 *    motif à la place du bouton ; la **borne**, elle, est portée par l'écriture
 *    (voir {@link unlinkOAuthIdentity}) — relue puis écrite, elle laissait deux
 *    retraits concurrents fermer le compte.
 *
 * **Pourquoi ce module plutôt qu'un rattachement par adresse e-mail.** La
 * question que résout « ajouter un moyen de connexion » se posait jusqu'ici à la
 * connexion Google, qui revendiquait un compte existant dès que l'adresse
 * correspondait. Une adresse n'est pas une preuve d'identité : ici le joueur est
 * **déjà connecté** quand il rattache, ce qui en est une — et le site n'a plus
 * besoin de collecter d'adresse du tout.
 *
 * Au **rattachement**, deux contrôles qui ne font pas double emploi : le
 * `SELECT` préalable donne le **refus lisible**, l'index unique de la colonne
 * tranche la **course** entre deux comptes qui rattacheraient la même identité
 * au même instant. Même paire que le sigle d'équipe et que la certification
 * Discord. Au **détachement**, l'ordre s'inverse — c'est l'écriture qui porte la
 * borne, et le `SELECT` ne vient qu'après pour nommer le refus.
 */
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isDuplicateEntryError } from "@/lib/server/mysql-errors";
import {
  adoptRemoteAvatar,
  createOrGetBlizzardUser,
  createOrGetDiscordUser,
  createOrGetGoogleUser,
  normalizeBattletag,
  normalizeDiscordHandle,
} from "@/lib/server/users-service";
import {
  buildAccountConnections,
  checkConnectionUnlink,
  type AccountConnection,
  type ConnectionMethod,
} from "@/lib/shared/account-connections";
import { OAUTH_PROVIDERS, type OAuthProvider } from "@/lib/shared/oauth-providers";

/**
 * Une identité rapportée par un aller-retour OAuth, réduite à ce que le site en
 * retient.
 *
 * Ni adresse, ni liste de serveurs, ni jeton d'accès — ce dernier n'est utile
 * qu'entre l'échange et la lecture du profil, et n'est donc jamais stocké.
 */
export type OAuthIdentity = {
  provider: OAuthProvider;
  /** Identifiant stable chez le fournisseur. C'est lui qui identifie le compte. */
  subject: string;
  /**
   * Nom lisible **et conservé** : pseudo Discord, BattleTag. `null` pour Google,
   * qui n'en donne aucun que le site ait à ranger.
   */
  handle: string | null;
  /** Photo de profil distante, à **copier** chez nous (jamais à relayer). */
  avatarUrl: string | null;
  /** Nom d'affichage, lu seulement pour proposer un pseudo à la création. */
  displayName: string | null;
};

/** La colonne qui porte l'identité de ce fournisseur. */
const SUBJECT_COLUMNS: Record<OAuthProvider, "google_sub" | "discord_id" | "blizzard_sub"> = {
  GOOGLE: "google_sub",
  DISCORD: "discord_id",
  BLIZZARD: "blizzard_sub",
};

type IdentityRow = RowDataPacket & {
  google_sub: string | null;
  discord_id: string | null;
  discord_link_method: ConnectionMethod | null;
  blizzard_sub: string | null;
  discord_pseudo: string | null;
  overwatch_battletag: string | null;
};

async function loadIdentityRow(userId: number): Promise<IdentityRow | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<IdentityRow[]>(
    `SELECT google_sub, discord_id, discord_link_method, blizzard_sub,
            discord_pseudo, overwatch_battletag
     FROM bg_users
     WHERE id = ? AND is_deleted = 0
     LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

function connectionsFromRow(row: IdentityRow): AccountConnection[] {
  return buildAccountConnections({
    GOOGLE: { subject: row.google_sub },
    DISCORD: {
      subject: row.discord_id,
      handle: row.discord_pseudo,
      method: row.discord_link_method,
    },
    BLIZZARD: { subject: row.blizzard_sub, handle: row.overwatch_battletag },
  });
}

/**
 * Les moyens de connexion du compte, **tous** — rattachés ou non.
 *
 * L'écran doit pouvoir proposer ce qui manque autant qu'afficher ce qui est
 * là ; c'est le module pur qui garantit que la liste est complète.
 */
export async function listAccountConnections(userId: number): Promise<AccountConnection[]> {
  const row = await loadIdentityRow(userId);
  if (!row) throw new Error("PROFILE_NOT_FOUND");
  return connectionsFromRow(row);
}

/**
 * Ouvre (ou retrouve) le compte que désigne cette identité.
 *
 * Simple aiguillage : chaque fournisseur a déjà sa fonction dans
 * `users-service`, avec ses effets propres — la certification du tag pour
 * Discord, le BattleTag pour Blizzard, la photo pour Google. Les regrouper ici
 * évite qu'une route ait à savoir lequel appeler, ce qui est exactement le genre
 * d'aiguillage qu'on oublie de compléter en ajoutant un fournisseur.
 */
export async function createOrGetOAuthUser(identity: OAuthIdentity): Promise<number> {
  switch (identity.provider) {
    case "GOOGLE":
      return createOrGetGoogleUser({
        sub: identity.subject,
        name: identity.displayName ?? undefined,
        picture: identity.avatarUrl ?? undefined,
      });
    case "DISCORD":
      // La porte est nommée, jamais devinée : c'est un aller-retour OAuth, donc
      // une autorisation d'application posée chez Discord.
      return createOrGetDiscordUser(identity.subject, undefined, identity.handle, {
        avatarUrl: identity.avatarUrl,
        method: "OAUTH",
      });
    case "BLIZZARD":
      return createOrGetBlizzardUser(identity.subject, identity.handle);
  }
}

/**
 * Un autre compte du site détient-il déjà cette identité ?
 *
 * Le contrôle porte sur l'**identifiant** du fournisseur, jamais sur le tag :
 * deux comptes peuvent écrire le même pseudo Discord, un seul peut prouver
 * l'identifiant qui va avec.
 */
async function subjectTakenByAnother(
  provider: OAuthProvider,
  subject: string,
  userId: number,
): Promise<boolean> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE ${SUBJECT_COLUMNS[provider]} = ? AND id <> ? LIMIT 1`,
    [subject, userId],
  );
  return rows.length > 0;
}

/**
 * Ce qu'un rattachement vient de faire.
 *
 * `REFRESHED` n'est pas un cas limite mais un geste à part entière : c'est
 * **la même** identité, rapportée une seconde fois par le fournisseur. Rien ne
 * change de porte ; seul ce que le fournisseur atteste est réécrit — pour
 * Discord, le pseudo, certifié. C'est ainsi qu'un compte déjà relié certifie son
 * tag sans passer par le bot : la résolution d'un tag par le bot balaie les
 * serveurs qu'il partage avec le joueur, et un compte venu par OAuth n'en
 * partage souvent aucun.
 */
export type OAuthLinkOutcome = "LINKED" | "REFRESHED";

/**
 * Rattache cette identité au compte connecté.
 *
 * @returns `REFRESHED` si le compte portait déjà cette identité-là.
 *
 * @throws PROFILE_NOT_FOUND Le compte n'existe plus (ou vient d'être anonymisé).
 * @throws PROVIDER_ALREADY_LINKED Le compte porte **déjà** une autre identité de
 *   ce fournisseur. On ne déplace pas une porte d'entrée : au joueur de détacher
 *   d'abord, en connaissance de cause.
 * @throws IDENTITY_ALREADY_LINKED Cette identité appartient à un autre compte du
 *   site. Le `SELECT` le dit lisiblement, l'index unique le tranche sous course.
 */
export async function linkOAuthIdentity(
  userId: number,
  identity: OAuthIdentity,
): Promise<OAuthLinkOutcome> {
  const row = await loadIdentityRow(userId);
  if (!row) throw new Error("PROFILE_NOT_FOUND");

  const current = row[SUBJECT_COLUMNS[identity.provider]];
  if (current && current !== identity.subject) throw new Error("PROVIDER_ALREADY_LINKED");
  if (await subjectTakenByAnother(identity.provider, identity.subject, userId)) {
    throw new Error("IDENTITY_ALREADY_LINKED");
  }

  // Les trois écritures portent `is_deleted = 0`, exactement comme le
  // détachement plus bas. `loadIdentityRow` filtre déjà les lignes mortes, mais
  // il le fait **deux `await` plus tôt** : un aller-retour OAuth dure plusieurs
  // secondes, le joueur peut supprimer son compte depuis un autre onglet
  // pendant ce temps, et l'écriture reprise après le commit de la suppression
  // reposerait `discord_id`, `google_sub` ou `blizzard_sub` sur la ligne
  // anonymisée — c'est-à-dire une **porte d'entrée** vers un compte dont on
  // vient de promettre qu'il n'en avait plus. `affectedRows = 0` retombe sur le
  // `PROFILE_NOT_FOUND` déjà rendu par la lecture : c'est la même réponse pour
  // le même fait.
  const db = await getDatabase();
  try {
    let result: ResultSetHeader;
    if (identity.provider === "DISCORD") {
      // Le rattachement **certifie** le tag, exactement comme la connexion par
      // Discord : l'aller-retour OAuth est la preuve que demande
      // `lib/shared/discord-identity.ts`, et c'est Discord lui-même qui nomme le
      // pseudo. Un pseudo entièrement numérique est écarté par
      // `normalizeDiscordHandle` — on ne publie pas une suite de chiffres là où
      // un arbitre attend un nom — et le compte se rattache alors sans que son
      // tag soit certifié.
      //
      // `discord_link_method` est posé dans la **même** instruction, et à
      // `OAUTH` sans condition : c'est ce que ce rattachement-ci est, et il
      // l'emporte sur une valeur plus ancienne — une autorisation donnée existe
      // chez Discord jusqu'à ce que le joueur la retire, qu'il se connecte
      // ensuite par code ou non (`lib/shared/account-connections.ts`).
      const handle = normalizeDiscordHandle(identity.handle);
      [result] = await db.execute<ResultSetHeader>(
        handle
          ? `UPDATE bg_users
             SET discord_id = ?, discord_pseudo = ?, discord_verified_at = NOW(),
                 discord_link_method = 'OAUTH'
             WHERE id = ? AND is_deleted = 0`
          : `UPDATE bg_users
             SET discord_id = ?, discord_link_method = 'OAUTH'
             WHERE id = ? AND is_deleted = 0`,
        handle ? [identity.subject, handle, userId] : [identity.subject, userId],
      );
    } else if (identity.provider === "BLIZZARD") {
      // Même règle qu'à la connexion : Blizzard fait foi sur le BattleTag, et
      // n'efface rien quand il n'en a pas à donner.
      const tag = normalizeBattletag(identity.handle);
      [result] = await db.execute<ResultSetHeader>(
        tag
          ? `UPDATE bg_users SET blizzard_sub = ?, overwatch_battletag = ? WHERE id = ? AND is_deleted = 0`
          : `UPDATE bg_users SET blizzard_sub = ? WHERE id = ? AND is_deleted = 0`,
        tag ? [identity.subject, tag, userId] : [identity.subject, userId],
      );
    } else {
      [result] = await db.execute<ResultSetHeader>(
        `UPDATE bg_users SET google_sub = ? WHERE id = ? AND is_deleted = 0`,
        [identity.subject, userId],
      );
    }
    if (Number(result.affectedRows) === 0) throw new Error("PROFILE_NOT_FOUND");
  } catch (error) {
    if (isDuplicateEntryError(error)) throw new Error("IDENTITY_ALREADY_LINKED");
    throw error;
  }

  // La photo ne remplace jamais un avatar téléversé, et son échec ne remet pas
  // le rattachement en cause : elle est copiée après l'écriture qui compte, et
  // son rejet est **avalé ici**. `importRemoteAvatar` ne lève jamais, par
  // construction ; les deux `db.execute` qui l'encadrent, si — et le rejet
  // remontait jusqu'à faire annoncer « le rattachement a échoué » sur une
  // identité déjà écrite, que la liste d'à côté montrait rattachée dans le même
  // écran.
  await adoptRemoteAvatar(userId, identity.avatarUrl ?? undefined).catch(() => {
    // Le compte garde sa pastille à initiale. La copie sera retentée à la
    // prochaine connexion, `shouldImportRemoteAvatar` n'ayant toujours rien de
    // local à constater.
  });
  return current === identity.subject ? "REFRESHED" : "LINKED";
}

/**
 * Détache ce fournisseur du compte connecté.
 *
 * @throws NOT_LINKED Rien à détacher.
 * @throws LAST_CONNECTION C'est le dernier moyen d'entrer : le retirer fermerait
 *   le compte sans recours.
 *
 * **Discord perd sa certification en même temps que son identifiant**, et le
 * tag reste. Ce n'est pas un demi-geste : la certification atteste que le compte
 * Discord appartient au joueur, or la preuve vient de se détacher — la laisser
 * exposerait à l'organisation un tag que plus rien ne couvre. Le tag, lui,
 * redevient une saisie comme une autre une fois décertifiée : invisible de tous,
 * administrateurs compris. C'est très exactement ce que fait déjà
 * `updateOwnProfile` quand le joueur modifie son tag.
 *
 * Le **BattleTag survit au détachement de Blizzard** — et c'est cohérent, pas
 * contradictoire : il n'est ni une porte d'entrée ni une attestation, seulement
 * un pseudo de jeu que le joueur peut aussi taper à la main.
 */
export async function unlinkOAuthIdentity(userId: number, provider: OAuthProvider): Promise<void> {
  const column = SUBJECT_COLUMNS[provider];
  // « Il reste une autre porte » est une **condition de l'écriture**, pas une
  // lecture préalable.
  //
  // Lue d'abord puis écrite après un `await`, elle laissait exactement la course
  // que `CLAUDE.md` décrit pour le code Discord : deux onglets ouverts sur
  // `/profil` (le `busy` de l'écran n'en couvre qu'un), un `DELETE` sur Google et
  // un sur Discord lancés de front, les deux lectures voyant **deux** connexions
  // et les deux écritures passant. Le compte se retrouvait à zéro moyen
  // d'entrée — et comme il n'y a ni mot de passe ni récupération par courriel,
  // la perte était définitive. C'est précisément ce que cette règle existe pour
  // empêcher.
  //
  // Le `SELECT` n'a pas disparu, il a changé de rôle : il ne décide plus, il
  // **nomme le refus** quand l'écriture n'a rien apparié. Le cas nominal ne
  // coûte donc plus qu'une seule instruction.
  const otherDoors = OAUTH_PROVIDERS.filter((other) => other !== provider)
    .map((other) => `${SUBJECT_COLUMNS[other]} IS NOT NULL`)
    .join(" OR ");
  // Discord perd sa certification dans la même instruction : ce sont les deux
  // faces d'une preuve unique, et une base où l'une serait passée sans l'autre
  // exposerait à l'organisation un tag que plus rien ne couvre.
  //
  // La **méthode** part avec : elle ne décrit pas le compte mais le
  // rattachement, et un compte détaché n'en a plus. La laisser ferait annoncer
  // « rattaché par le bouton Discord » au prochain rattachement par code, tant
  // que celui-ci n'aurait pas réécrit la colonne.
  const clearedColumns =
    provider === "DISCORD"
      ? "discord_id = NULL, discord_verified_at = NULL, discord_link_method = NULL"
      : `${column} = NULL`;

  const db = await getDatabase();
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE bg_users
        SET ${clearedColumns}
      WHERE id = ?
        AND is_deleted = 0
        AND ${column} IS NOT NULL
        AND (${otherDoors})`,
    [userId],
  );
  if (Number(result.affectedRows) > 0) return;

  const row = await loadIdentityRow(userId);
  if (!row) throw new Error("PROFILE_NOT_FOUND");
  // Les deux refus du module pur sont **exactement** le complément de la
  // condition ci-dessus, donc l'un des deux s'applique forcément. Le repli ne
  // couvre que l'état qui aurait encore bougé entre l'écriture et cette
  // relecture, et il refuse plutôt que de laisser croire que rien n'était
  // rattaché.
  throw new Error(checkConnectionUnlink(connectionsFromRow(row), provider) ?? "LAST_CONNECTION");
}
