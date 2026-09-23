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

import {
  DISCORD_TAG_AUDIENCE,
  DISCORD_TAG_UNVERIFIED_AUDIENCE,
} from "@/lib/shared/identity-sharing";

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
  // Le test porte sur les deux valeurs **connues**, et tout le reste retombe sur
  // l'inconnu. Écrit dans l'autre sens (`linked === null` d'abord), un
  // `undefined` glissait entre les branches et **ouvrait** le champ — l'exact
  // inverse du défaut que le bloc ci-dessus annonce comme seul tenable. Ce n'est
  // pas théorique : l'écran alimente cet état par un `as` sur une réponse JSON
  // que rien ne valide, si bien qu'un corps sans `linked` le produit.
  if (state.linked === true) return "LINKED_ACCOUNT";
  if (state.linked === false) return null;
  return "UNKNOWN_LINK";
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
  /**
   * La lecture de l'état est **en cours**.
   *
   * Sans ce drapeau, « pas encore lu » et « lecture échouée » se confondaient
   * en un seul `linked: null`, et la phrase annonçait une panne pendant le
   * temps normal d'un aller-retour — le profil se rendant dès que
   * `GET /api/profile` répond, ce qui arrive régulièrement avant
   * `GET /api/profile/discord`. C'est exactement ce que `profile-errors.ts`
   * s'interdit : affirmer une cause qu'on ne connaît pas.
   *
   * L'appelant est le seul à savoir laquelle des deux : le module reste pur, il
   * se contente de ne plus supposer.
   */
  pending?: boolean;
}): string {
  // L'attente se dit comme une attente, sans cause ni geste : il n'y a rien à
  // réessayer tant que le premier essai n'a pas répondu.
  if (state.pending && state.linked !== true) {
    return "Lecture de l'état de ton compte Discord… Le champ reste en lecture seule le temps de savoir si Discord a nommé ce pseudo.";
  }
  // L'état n'est pas encore connu — ou ne l'a jamais été, l'appel ayant échoué.
  // On ne décrit alors **ni** un rattachement ni son absence : on nomme le
  // verrou, sa raison et sa sortie. Prétendre ici que le compte est rattaché
  // serait une affirmation que rien ne soutient.
  if (state.linked !== true) {
    return "Impossible de lire l'état de ton compte Discord pour l'instant : le champ reste en lecture seule, pour ne pas écraser un pseudo que Discord aurait nommé. Réessaie, ou recharge la page.";
  }
  // Le geste nommé doit **exister à l'écran**. « Détache Discord » n'en est pas
  // un pour un compte né par Discord : le bouton y est remplacé par le refus
  // `LAST_CONNECTION`, faute d'une autre porte. Reste celui qui vaut toujours :
  // se renommer chez Discord, puis se reconnecter.
  const rename = "Pour en changer, renomme-toi sur Discord puis reconnecte-toi.";
  if (!state.tag) {
    // Deux causes mènent ici — un tag retiré, ou un pseudo Discord entièrement
    // numérique que `normalizeDiscordHandle` écarte — et l'écran ne peut pas les
    // distinguer. Il dit donc l'état et le geste, sans inventer la cause : le
    // joueur qui vient de retirer son tag n'a pas à lire une explication fausse.
    //
    // Le bouton est **nommé**, jamais situé : « ci-dessous » était faux (il est
    // rendu au-dessus du paragraphe) et n'aurait de toute façon rien à faire
    // dans un module pur, qui ne connaît pas la mise en page de ses lecteurs.
    return `Ton compte Discord est rattaché, mais aucun pseudo n'est enregistré : l'organisation ne peut pas te joindre pendant un tournoi. Utilise « Enregistrer mon tag », ou reconnecte-toi par Discord.`;
  }
  // On n'affirme pas l'**origine** du tag : `linkOAuthIdentity` n'écrit
  // `discord_pseudo` que si Discord a donné un pseudo affichable, si bien qu'un
  // compte rattaché peut porter un tag saisi à la main. Ce qui est sûr, et seul
  // utile au joueur, c'est qui le lit.
  if (!state.verified) {
    // **Pas de « pour cesser d'être joignable »** ici : la phrase vient de dire
    // que personne ne voit ce tag. Proposer d'arrêter une exposition qui
    // n'existe pas pousserait à effacer une donnée sans raison. Le retrait reste
    // offert par le bouton d'à côté, il n'a simplement rien à promettre.
    return `Ton compte Discord est rattaché, mais ce pseudo n'est pas certifié : ${DISCORD_TAG_UNVERIFIED_AUDIENCE} ${rename} Tu peux aussi le retirer.`;
  }
  // Qui lit le tag est une **promesse** du site, rédigée une seule fois dans
  // `identity-sharing.ts` et partagée avec `/connexion` : la recopier ici
  // laisserait les deux écrans promettre deux publics différents au premier
  // ajustement de l'un.
  return `Ton compte Discord est rattaché et ce pseudo est certifié : ${DISCORD_TAG_AUDIENCE} ${rename} Pour cesser d'être joignable, retire-le.`;
}
