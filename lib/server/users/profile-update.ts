import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { ACCOUNT_DELETED_ERROR } from "@/lib/shared/account-deletion";
import { isDuplicateEntryError } from "@/lib/server/mysql-errors";
import { BATTLETAG_LOCKED, isBattletagLocked } from "@/lib/shared/battletag-lock";
import { DISCORD_TAG_LOCKED, isDiscordTagLocked } from "@/lib/shared/discord-tag-lock";
import { normalizePseudo } from "@/lib/server/serialization";
import { syncSoloEntryIdentity } from "@/lib/server/solo-entries-service";
import { rotateHiddenAvatarFile } from "@/lib/server/avatar-rotation";
import { PSEUDO_MAX_LENGTH, pseudoLength } from "@/lib/shared/pseudo";

/*
 * Modification de son profil par le joueur : pseudo, tags de jeu et réglages
 * de visibilité, sous les verrous du tag Discord et du BattleTag.
 */

/**
 * Pseudo du patch, contrôlé avant d'être lu : `null` s'il est absent, levée
 * s'il est présent sans être un pseudo (voir `updateOwnProfile`).
 */
function readPseudoPatch(pseudo: unknown): string | null {
  if (pseudo === undefined) return null;
  if (typeof pseudo !== "string") throw new Error("INVALID_PSEUDO");
  const nextPseudo = normalizePseudo(pseudo);
  if (!nextPseudo) throw new Error("PSEUDO_EMPTY");
  if (pseudoLength(nextPseudo) > PSEUDO_MAX_LENGTH) throw new Error("PSEUDO_TOO_LONG");
  return nextPseudo;
}

/** Refus lisible d'un pseudo déjà pris ; l'index unique tranche la course. */
async function assertPseudoAvailable(db: Pool, nextPseudo: string, userId: number): Promise<void> {
  const [conflicts] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_users WHERE pseudo = ? AND id <> ? LIMIT 1`,
    [nextPseudo, userId],
  );
  if (conflicts.length > 0) {
    throw new Error("PSEUDO_ALREADY_USED");
  }
}

/**
 * Champ texte nullable du patch : chaîne vide et `null` valent un effacement,
 * tout autre type que chaîne est refusé par `invalidCode`.
 */
function readNullableTextPatch(value: unknown, invalidCode: string): string | null {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new Error(invalidCode);
  }
  return ((value as string | null | undefined) ?? "").trim() || null;
}

/** Refuse de réécrire le tag d'un compte Discord rattaché (voir `updateOwnProfile`). */
async function assertDiscordTagWritable(
  db: Pool,
  userId: number,
  nextDiscordPseudo: string,
): Promise<void> {
  const [lockRows] = await db.execute<(RowDataPacket & {
    discord_id: string | null;
    discord_pseudo: string | null;
  })[]>(`SELECT discord_id, discord_pseudo FROM bg_users WHERE id = ? LIMIT 1`, [userId]);
  const lockRow = lockRows[0];
  if (lockRow && isDiscordTagLocked({ linked: Boolean(lockRow.discord_id) })) {
    // Comparaison **exacte**, casse comprise, et c'est un durcissement
    // délibéré. Elle était insensible à la casse pour une raison qui a
    // disparu : le formulaire renvoyait le tag à chaque sauvegarde, et
    // refuser sur sa seule présence rendait tout le profil inenregistrable.
    // Le client ne soumet plus ce champ que s'il a **changé**, si bien qu'une
    // différence de casse ne peut plus venir que d'un appel direct.
    //
    // Or laisser passer une telle différence rendait un **200 qui n'écrivait
    // rien** : le `CASE` de l'`UPDATE` garde la valeur stockée dès qu'un
    // `discord_id` est posé, quoi qu'ait décidé ce contrôle. Le refus lisible
    // annonce désormais ce que l'écriture fait vraiment — c'est Discord qui
    // nomme ce tag, sa casse comprise.
    if (lockRow.discord_pseudo !== nextDiscordPseudo) throw new Error(DISCORD_TAG_LOCKED);
  }
}

/** Refuse de toucher au BattleTag d'un compte Blizzard rattaché (voir `updateOwnProfile`). */
async function assertBattletagWritable(
  db: Pool,
  userId: number,
  nextBattletag: string | null,
): Promise<void> {
  const [lockRows] = await db.execute<(RowDataPacket & {
    blizzard_sub: string | null;
    overwatch_battletag: string | null;
  })[]>(`SELECT blizzard_sub, overwatch_battletag FROM bg_users WHERE id = ? LIMIT 1`, [userId]);
  const lockRow = lockRows[0];
  if (lockRow && isBattletagLocked({ linked: Boolean(lockRow.blizzard_sub) })) {
    // Comparaison **exacte**, casse comprise : un BattleTag la conserve, et
    // c'est Blizzard qui la fixe. Le client ne soumet ce champ que s'il a
    // changé, si bien qu'une différence de casse ne peut plus venir que d'un
    // appel direct — qui recevrait sinon un **200 n'écrivant rien**, le
    // `CASE` de l'`UPDATE` gardant la valeur stockée dès qu'un `blizzard_sub`
    // est posé.
    if (lockRow.overwatch_battletag !== nextBattletag) throw new Error(BATTLETAG_LOCKED);
  }
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
      discord?: boolean;
    };
    openToRecruitment?: boolean;
  },
): Promise<void> {
  const db = await getDatabase();

  // **Le pseudo est contrôlé avant d'être lu.** Le corps du `PATCH` n'est
  // qu'*annoté*, jamais validé : `{"pseudo": 123}` partait dans
  // `normalizePseudo`, dont le `.replace` levait un `TypeError` — et son message
  // interne (`raw.replace is not a function`) ressortait tel quel dans le corps
  // du 400. Même trou, même parade que pour `discordPseudo` plus bas.
  //
  // Deux saisies passaient aussi sans être des pseudos : une chaîne faite
  // d'espaces, que la normalisation réduisait à `""` et que `COALESCE` écrivait
  // (un compte sans nom dans les brackets), et un pseudo plus long que la
  // colonne, refusé par MySQL avec un message qui nomme la colonne. Un pseudo
  // **absent** reste un pseudo inchangé ; un pseudo **présent** doit en être un.
  const nextPseudo = readPseudoPatch(patch.pseudo);
  if (nextPseudo) await assertPseudoAvailable(db, nextPseudo, userId);

  // **Un champ absent du patch n'est pas un champ vidé.** Quatre colonnes
  // nullables — le tag Discord, les deux identifiants de jeu et la majorité —
  // recevaient `null` dès que le patch ne les mentionnait pas : une requête
  // partielle les effaçait toutes, et la certification avec. Longtemps sans
  // conséquence, le formulaire renvoyant la fiche entière ; le premier appel
  // partiel (le bouton « Retirer mon tag ») a vidé les trois voisines du champ
  // qu'il visait, sans rien afficher avant un rechargement.
  //
  // Les quatre passent donc par le même `CASE WHEN ? THEN ? ELSE col END`, piloté
  // par « le patch parle-t-il de ce champ ? ». `visible_*` et
  // `open_to_recruitment` n'en ont pas besoin : `COALESCE` suffit à des colonnes
  // `NOT NULL`.
  const touchesDiscordTag = patch.discordPseudo !== undefined;
  // Un champ **vidé** arrive en chaîne vide depuis un formulaire et en `null`
  // depuis un appel direct : c'est le même geste, et les distinguer laissait
  // l'un passer pour un effacement et l'autre pour une réécriture — donc un 409
  // sur un compte rattaché, et une chaîne vide écrite dans la colonne sur les
  // autres.
  //
  // Le type est contrôlé ici et non à la route : le corps du `PATCH` n'est
  // qu'*annoté*, jamais validé, si bien qu'un `{"discordPseudo": 123}` faisait
  // lever `.trim()` — un `TypeError` dont le message interne ressortait tel quel
  // dans le corps du 400. Les voisines n'ont pas ce besoin : elles passent à
  // mysql2 sans être lues.
  const nextDiscordPseudo = readNullableTextPatch(patch.discordPseudo, "INVALID_DISCORD_PSEUDO");

  // **Un compte Discord rattaché possède son tag** (`lib/shared/discord-tag-lock.ts`) :
  // il ne peut pas en **inventer** un autre, Discord ayant nommé celui-là.
  //
  // Il peut en revanche le **retirer**, et ce n'est pas une exception : effacer
  // son tag *est* le geste d'annulation de l'exposition, le seul que le site
  // offre — il n'existe aucune route de décertification. Le lui refuser
  // enfermerait le cas le plus courant, un compte né par Discord : son tag est
  // certifié donc lisible de l'arbitrage, et détacher Discord lui serait refusé
  // en `LAST_CONNECTION` faute d'une autre porte. Il ne lui resterait que la
  // suppression du compte.
  //
  // Le refus est lisible — l'écran verrouille déjà le champ, mais la route est
  // atteignable sans lui —, et il ne tombe que sur une **réécriture** : le
  // formulaire renvoie le tag à chaque sauvegarde, refuser sur sa seule présence
  // rendrait tout le profil inenregistrable. La comparaison est celle de la
  // colonne (insensible à la casse et aux accents, `utf8mb4_0900_ai_ci`), sans
  // quoi une correction de casse serait refusée là où la certification, elle, y
  // survit.
  if (touchesDiscordTag && nextDiscordPseudo !== null) {
    await assertDiscordTagWritable(db, userId, nextDiscordPseudo);
  }

  // **Un compte Blizzard rattaché possède son BattleTag**
  // (`lib/shared/battletag-lock.ts`), et contrairement au tag Discord il ne
  // peut pas non plus l'**effacer** : ce qui publie ce champ est un réglage à
  // part (`visible_overwatch`), que le joueur garde en main, et un effacement
  // serait de toute façon défait à la prochaine connexion Battle.net.
  //
  // Le type est contrôlé ici, comme pour le tag Discord et pour la même raison :
  // le corps du `PATCH` n'est qu'*annoté*, jamais validé, et il faut lire la
  // valeur pour la comparer.
  const touchesBattletag = patch.overwatchBattletag !== undefined;
  const nextBattletag = readNullableTextPatch(patch.overwatchBattletag, "INVALID_OVERWATCH_BATTLETAG");

  if (touchesBattletag) await assertBattletagWritable(db, userId, nextBattletag);

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
  //
  // `discord_pseudo` est en outre **gardé tel quel** quand un `discord_id` est
  // posé : le refus lisible ci-dessus nomme la règle, cette branche la tient —
  // une lecture puis une écriture laissent un `await` entre les deux, et le
  // rattachement peut tomber dans cet intervalle. La garde couvre du même geste
  // `discord_verified_at`, qui n'a alors aucune raison de tomber puisque rien ne
  // change.
  //
  // `overwatch_battletag` est **gardé tel quel** dès qu'un `blizzard_sub` est
  // posé, pour la même raison que `discord_pseudo` l'est sous un `discord_id` :
  // le refus lisible ci-dessus nomme la règle, cette branche la tient — une
  // lecture puis une écriture laissent un `await` entre elles, et le
  // rattachement Battle.net peut tomber dans cet intervalle. Sans la clause
  // `? IS NOT NULL` que porte la branche Discord, et c'est la règle et non un
  // oubli : effacer le BattleTag n'est pas ici un geste d'annulation — il en
  // existe un, la case « BattleTag OW » — et la prochaine connexion Blizzard le
  // réécrirait.
  //
  // `is_deleted = 0` ferme une **troisième** course, du même genre : une
  // sauvegarde de profil déjà partie se bloque sur le verrou de
  // `deleteOwnAccount` et reprend **après** son commit. Sans la condition, elle
  // reposait le pseudo réel, le BattleTag, le tag Marvel et le tag Discord sur
  // une ligne fraîchement anonymisée — puis `syncSoloEntryIdentity` republiait
  // ce pseudo dans les brackets et jusqu'à la carte de match en direct de la
  // vitrine. La suppression est irréversible : c'est elle qui doit gagner.
  //
  // Masquer un avatar **visible** en change aussi le fichier d'adresse (plus
  // bas) : on relit donc l'état d'avant, seule la bascule doit renommer — le
  // formulaire renvoie le réglage à chaque sauvegarde.
  let hidesVisibleAvatar = false;
  if (patch.visibility?.avatar === false) {
    const [before] = await db.execute<(RowDataPacket & { visible_avatar: 0 | 1 })[]>(
      `SELECT visible_avatar FROM bg_users WHERE id = ? LIMIT 1`,
      [userId],
    );
    hidesVisibleAvatar = before[0]?.visible_avatar === 1;
  }
  let result: ResultSetHeader;
  try {
    [result] = await db.execute<ResultSetHeader>(
      `UPDATE bg_users
       SET pseudo = COALESCE(?, pseudo),
           overwatch_battletag = CASE
             WHEN NOT ? THEN overwatch_battletag
             WHEN blizzard_sub IS NOT NULL THEN overwatch_battletag
             ELSE ?
           END,
           marvel_rivals_tag = CASE WHEN ? THEN ? ELSE marvel_rivals_tag END,
           discord_pseudo_from_discord = CASE
             WHEN NOT ? THEN discord_pseudo_from_discord
             WHEN discord_id IS NOT NULL AND ? IS NOT NULL THEN discord_pseudo_from_discord
             WHEN discord_pseudo <=> ? THEN discord_pseudo_from_discord
             ELSE 0
           END,
           discord_verified_at = CASE
             WHEN NOT ? THEN discord_verified_at
             WHEN discord_id IS NOT NULL AND ? IS NOT NULL THEN discord_verified_at
             WHEN discord_pseudo <=> ? THEN discord_verified_at
             ELSE NULL
           END,
           discord_pseudo = CASE
             WHEN NOT ? THEN discord_pseudo
             WHEN discord_id IS NOT NULL AND ? IS NOT NULL THEN discord_pseudo
             ELSE ?
           END,
           is_adult = CASE WHEN ? THEN ? ELSE is_adult END,
           visible_avatar = COALESCE(?, visible_avatar),
           visible_overwatch = COALESCE(?, visible_overwatch),
           visible_marvel = COALESCE(?, visible_marvel),
           visible_major = COALESCE(?, visible_major),
           visible_discord = COALESCE(?, visible_discord),
           open_to_recruitment = COALESCE(?, open_to_recruitment)
       WHERE id = ? AND is_deleted = 0`,
      [
        nextPseudo,
        touchesBattletag,
        nextBattletag,
        patch.marvelRivalsTag !== undefined,
        patch.marvelRivalsTag ?? null,
        // Origine du tag : une saisie qui le change le fait passer pour tapé.
        touchesDiscordTag,
        nextDiscordPseudo,
        nextDiscordPseudo,
        touchesDiscordTag,
        nextDiscordPseudo,
        nextDiscordPseudo,
        touchesDiscordTag,
        nextDiscordPseudo,
        nextDiscordPseudo,
        patch.isAdult !== undefined,
        patch.isAdult ?? null,
        patch.visibility?.avatar ?? null,
        patch.visibility?.overwatch ?? null,
        patch.visibility?.marvel ?? null,
        patch.visibility?.major ?? null,
        patch.visibility?.discord ?? null,
        patch.openToRecruitment ?? null,
        userId,
      ],
    );
  } catch (error) {
    // Le `SELECT` d'unicité plus haut donne le refus lisible ; l'index unique
    // tranche la **course** — deux joueurs qui prennent le même pseudo à la
    // même seconde passent tous deux le `SELECT`. Seul `pseudo` est unique
    // parmi les colonnes que cette écriture touche : un doublon ne peut venir
    // que de lui, et le second joueur doit lire « pseudo déjà pris », pas un
    // échec générique.
    if (isDuplicateEntryError(error)) throw new Error("PSEUDO_ALREADY_USED");
    throw error;
  }
  // `affectedRows` compte les lignes **appariées** (mysql2 pose `FOUND_ROWS`),
  // pas celles qui ont changé : zéro ne dit donc pas « rien à modifier » mais
  // bien « la ligne vivante n'existe plus ». On sort avant la synchronisation
  // de l'entrée solo, qui republierait l'identité qu'on vient de refuser.
  if (result.affectedRows === 0) throw new Error(ACCOUNT_DELETED_ERROR);

  // L'entrée solo (tournois individuels) affiche le pseudo **et l'avatar** du
  // joueur dans les brackets : elle suit le renommage, et aussi la bascule de
  // visibilité de l'avatar — sans quoi masquer son image n'aurait effacé que la
  // fiche de profil, l'entrée solo continuant de la servir à tout le site.
  if (patch.pseudo || patch.visibility?.avatar !== undefined) {
    await syncSoloEntryIdentity(userId);
  }

  // Masqué, l'avatar disparaît des réponses mais son fichier restait servi sans
  // session à la même adresse : on le renomme, l'ancienne adresse meurt. Un
  // échec n'annule pas le réglage, déjà écrit — il se journalise. Après la
  // resynchronisation : l'entrée solo, vidée, ne compte plus pour un partage.
  if (hidesVisibleAvatar) {
    try {
      await rotateHiddenAvatarFile(userId);
    } catch (error) {
      console.error("[avatar-rotation] renommage impossible", error);
    }
  }
}
