/**
 * Le tag Discord d'un compte **rattaché** ne se saisit plus : il se lit.
 *
 * Deux façons d'écrire `bg_users.discord_pseudo` coexistaient sans se connaître.
 * La première est une **saisie libre** sur `/profil`, que la certification vient
 * ensuite prouver (code reçu en message privé, ou simple bouton quand le compte
 * porte déjà un `discord_id`). La seconde est le **rattachement OAuth** : la
 * connexion par Discord, comme l'ajout de Discord dans « Applications
 * connectées », écrit le pseudo que Discord nomme lui-même et le pose certifié
 * (`lib/server/account-identities.ts`).
 *
 * Laisser la première ouverte une fois la seconde faite ne pouvait produire que
 * du faux : le champ invitait à réécrire à la main une donnée que le
 * fournisseur venait d'attester, et **toute modification défait la
 * certification** (`updateOwnProfile`). Le joueur perdait donc, d'une faute de
 * frappe, la seule chose qui rendait son tag visible de l'arbitrage — pour
 * ensuite se voir proposer un bouton « Recertifier » qui ne fait que replacer ce
 * que Discord disait déjà. Un aller-retour entier pour revenir au point de
 * départ, avec une fenêtre où le site exposait un tag inventé.
 *
 * La règle est donc : **un compte Discord rattaché possède son tag.** Le champ
 * passe en lecture seule, le bouton de certification disparaît, et la route
 * refuse la réécriture — écrit ici une fois pour que l'écran et le serveur
 * disent la même chose.
 *
 * Module **pur** : l'état du rattachement est un fait que l'appelant a déjà
 * établi (le serveur en base, le client depuis `GET /api/profile/discord`).
 */

/**
 * Refus de l'écriture manuelle du tag.
 *
 * Deux motifs, et le second n'est pas un doublon du premier : `LINKED_ACCOUNT`
 * est un **fait établi**, `UNKNOWN_LINK` est l'absence de fait. Le serveur ne
 * rencontre jamais le second — il lit la colonne —, l'écran si : il reçoit
 * l'état par un appel à part (`GET /api/profile/discord`), donc il ne le connaît
 * pas au premier rendu, et pas du tout si l'appel échoue.
 */
export type DiscordTagEditRefusal = "LINKED_ACCOUNT" | "UNKNOWN_LINK";

/** Code d'erreur rendu par la route quand elle refuse la réécriture. */
export const DISCORD_TAG_LOCKED = "DISCORD_TAG_LOCKED";

/**
 * Le tag est-il encore saisissable ? `null` = oui.
 *
 * Le rattachement seul décide — ni le tag stocké, ni la certification. Un compte
 * rattaché dont Discord n'a donné **aucun** pseudo affichable (un `username`
 * entièrement numérique, que `normalizeDiscordHandle` écarte) reste verrouillé :
 * ce qu'il pourrait saisir ne serait de toute façon pas certifiable — la
 * certification vérifie que le tag résout vers *son* identifiant Discord, et
 * elle rejette le même numérique — donc invisible de tous, y compris de
 * l'arbitrage. Un champ ouvert sur rien est un piège, pas une liberté.
 *
 * **Un rattachement inconnu verrouille aussi**, et ce défaut-là est le seul
 * tenable. Les deux erreurs ne se valent pas : verrouiller à tort fait attendre
 * un rechargement, ouvrir à tort laisse saisir un tag que la route refusera en
 * 409 — et ce refus emporte **toute** la sauvegarde (pseudo, visibilités,
 * BattleTag), le `PATCH` étant indivisible. Un champ ouvert sur un enregistrement
 * voué à échouer est pire qu'un champ fermé.
 */
export function checkDiscordTagEdit(state: {
  linked: boolean | null;
}): DiscordTagEditRefusal | null {
  if (state.linked === null) return "UNKNOWN_LINK";
  return state.linked ? "LINKED_ACCOUNT" : null;
}

/** Raccourci de lecture, pour les écrans qui n'ont qu'un booléen à poser. */
export function isDiscordTagLocked(state: { linked: boolean | null }): boolean {
  return checkDiscordTagEdit(state) !== null;
}

/**
 * La phrase qui remplace l'aide du champ quand il est verrouillé.
 *
 * Elle vit ici, avec la règle : une copie dans l'écran aurait cessé de la
 * décrire au premier ajustement. Deux cas, parce que le joueur qui ne voit
 * aucun tag doit comprendre que ce n'est pas un chargement raté.
 *
 * Elle **nomme les deux gestes** qui rouvrent la donnée — renommer sur Discord
 * puis se reconnecter, ou détacher Discord — parce qu'un refus qui ne dit pas
 * comment il se lève se lit comme une panne.
 */
export function discordTagLockNotice(state: {
  tag: string | null;
  verified: boolean;
  linked: boolean | null;
}): string {
  // L'état n'est pas encore connu — ou ne l'a jamais été, l'appel ayant échoué.
  // On ne décrit alors **ni** un rattachement ni son absence : on nomme le
  // verrou, sa raison et sa sortie. Prétendre ici que le compte est rattaché
  // serait une affirmation que rien ne soutient.
  if (state.linked === null) {
    return "Impossible de lire l'état de ton compte Discord pour l'instant : le champ reste en lecture seule, pour ne pas écraser un pseudo que Discord aurait nommé. Recharge la page pour le rouvrir.";
  }
  // Le geste nommé doit **exister à l'écran**. « Détache Discord » n'en est pas
  // un pour un compte né par Discord : le bouton y est remplacé par le refus
  // `LAST_CONNECTION`, faute d'une autre porte. Restent les deux qui valent
  // toujours — se renommer chez Discord puis se reconnecter, et retirer son tag.
  const reopen =
    "Pour en changer, renomme-toi sur Discord puis reconnecte-toi. Pour cesser d'être joignable, retire-le.";
  if (!state.tag) {
    // Deux causes mènent ici — un tag retiré, ou un pseudo Discord entièrement
    // numérique que `normalizeDiscordHandle` écarte — et l'écran ne peut pas les
    // distinguer. Il dit donc l'état et le geste, sans inventer la cause : le
    // joueur qui vient de retirer son tag n'a pas à lire une explication fausse.
    return `Ton compte Discord est rattaché, mais aucun pseudo n'est enregistré : l'organisation ne peut pas te joindre pendant un tournoi. Enregistre-le ci-dessous, ou reconnecte-toi par Discord.`;
  }
  // On n'affirme pas l'**origine** du tag : `linkOAuthIdentity` n'écrit
  // `discord_pseudo` que si Discord a donné un pseudo affichable, si bien qu'un
  // compte rattaché peut porter un tag saisi à la main. Ce qui est sûr, et seul
  // utile au joueur, c'est qui le lit.
  if (!state.verified) {
    return `Ton compte Discord est rattaché, mais ce pseudo n'est pas certifié — personne ne le voit. ${reopen}`;
  }
  return `Ton compte Discord est rattaché et ce pseudo est certifié : les administrateurs le voient, et les arbitres pendant tes tournois. ${reopen}`;
}
