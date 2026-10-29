/**
 * Le BattleTag d'un compte **rattaché** ne se saisit plus : il se lit.
 *
 * `bg_users.overwatch_battletag` a deux écrivains qui ne se connaissaient pas.
 * Le premier est une **saisie libre** sur `/profil` — le joueur recopie son tag
 * à la main pour qu'on puisse l'ajouter en jeu. Le second est **Blizzard**, qui
 * le renseigne au rattachement et le **réécrit à chaque connexion**
 * (`createOrGetBlizzardUser`) : entre ce que la source affirme et ce qu'un
 * joueur a tapé, c'est la source qui fait foi, et c'est tout le sens de cette
 * porte.
 *
 * Laisser le champ ouvert une fois Blizzard rattaché ne pouvait donc produire
 * qu'une promesse intenable : le formulaire acceptait une correction, l'écrivait,
 * l'affichait — et la connexion suivante l'effaçait sans rien dire. Un tag mal
 * recopié ne se voit pas ; il se constate le jour où l'ajout en jeu échoue,
 * c'est-à-dire trop tard, et le joueur cherche alors une faute dans un champ
 * qu'il a pourtant corrigé.
 *
 * La règle est donc : **un compte Blizzard rattaché possède son BattleTag.**
 *
 * **Le retrait n'y fait pas exception, et c'est là que la règle s'écarte de
 * celle du tag Discord** (`lib/shared/discord-tag-lock.ts`), qui l'autorise.
 * Les deux champs ne portent pas la même chose. Effacer son tag Discord *est*
 * l'annulation d'une exposition — la certification le rend lisible de
 * l'arbitrage, et il n'existe aucune route de décertification, donc le refuser
 * enfermerait un compte né par Discord. Le BattleTag n'atteste rien : ce qui le
 * publie est un réglage à part, `visible_overwatch`, que le joueur garde
 * entièrement en main. L'annulation existe donc déjà, ailleurs et sans effet de
 * bord — pendant qu'un effacement du champ, lui, serait défait à la prochaine
 * connexion Battle.net. Autoriser un geste que la source annule, c'est
 * exactement le défaut que ce verrou ferme.
 *
 * Module **pur** : l'état du rattachement est un fait que l'appelant a déjà
 * établi (le serveur sur la ligne du compte, l'écran depuis
 * `GET /api/profile/connections`).
 */

/**
 * Refus de l'écriture manuelle du BattleTag.
 *
 * Deux motifs, et le second n'est pas un doublon du premier : `LINKED_ACCOUNT`
 * est un **fait établi**, `UNKNOWN_LINK` est l'absence de fait. Le serveur ne
 * rencontre jamais le second — il lit la colonne —, l'écran si : il reçoit la
 * liste des rattachements par un appel à part, donc il ne la connaît pas au
 * premier rendu, et pas du tout si l'appel échoue.
 */
export type BattletagEditRefusal = "LINKED_ACCOUNT" | "UNKNOWN_LINK";

/** Code d'erreur rendu par la route quand elle refuse la réécriture. */
export const BATTLETAG_LOCKED = "BATTLETAG_LOCKED";

/**
 * Le BattleTag est-il encore saisissable ? `null` = oui.
 *
 * Le rattachement seul décide — jamais le tag stocké. Un compte Battle.net qui
 * n'a donné **aucun** BattleTag reste verrouillé : ce que le joueur saisirait
 * là serait réécrit à sa prochaine connexion Battle.net (par le BattleTag de
 * Blizzard, ou effacé s'il n'en donne toujours aucun), et un champ ouvert sur
 * une valeur vouée à disparaître est un piège, pas une liberté.
 *
 * **Un rattachement inconnu verrouille aussi**, et ce défaut-là est le seul
 * tenable — même arbitrage que pour le tag Discord. Les deux erreurs ne se
 * valent pas : verrouiller à tort fait attendre un rechargement, ouvrir à tort
 * laisse saisir une valeur que la route refusera en 409, et ce refus emporte
 * **toute** la sauvegarde (pseudo, visibilités, tag Marvel), le `PATCH` étant
 * indivisible.
 */
export function checkBattletagEdit(state: {
  linked: boolean | null;
}): BattletagEditRefusal | null {
  // Le test porte sur les deux valeurs **connues**, et tout le reste retombe
  // sur l'inconnu. Écrit dans l'autre sens (`linked === null` d'abord), un
  // `undefined` glisserait entre les branches et **ouvrirait** le champ —
  // l'exact inverse du défaut annoncé comme seul tenable.
  if (state.linked === true) return "LINKED_ACCOUNT";
  if (state.linked === false) return null;
  return "UNKNOWN_LINK";
}

/** Raccourci de lecture, pour les écrans qui n'ont qu'un booléen à poser. */
export function isBattletagLocked(state: { linked: boolean | null }): boolean {
  return checkBattletagEdit(state) !== null;
}

/**
 * Ce que dit le champ verrouillé : une **ligne d'état** visible, et le détail
 * derrière le bouton « i » (`docs/features/INFO_HINTS.md`).
 */
export type BattletagLockNotice = { status: string; details: readonly string[] };

/**
 * Ce qui remplace l'aide du champ quand il est verrouillé.
 *
 * Elle vit ici, avec la règle : une copie dans l'écran aurait cessé de la
 * décrire au premier ajustement.
 *
 * Elle **nomme les deux gestes** qui restent, et ils ne font pas la même chose
 * — en changer (retirer Blizzard, puis rattacher le bon compte) et cesser de le
 * publier (décocher sa visibilité). Un refus qui ne dit pas comment il se lève
 * se lit comme une panne.
 */
export function battletagLockNotice(state: {
  tag: string | null;
  linked: boolean | null;
  /**
   * La lecture de l'état est **en cours**.
   *
   * Sans ce drapeau, « pas encore lu » et « lecture échouée » se confondent en
   * un seul `linked: null`, et la phrase annonce une panne pendant le temps
   * normal d'un aller-retour — le profil se rendant dès que `GET /api/profile`
   * répond, ce qui arrive régulièrement avant la liste des rattachements.
   */
  pending?: boolean;
}): BattletagLockNotice {
  // L'attente se dit comme une attente, sans cause ni geste.
  if (state.pending && state.linked !== true) {
    return { status: "Lecture de tes applications connectées… Champ en lecture seule en attendant.", details: [] };
  }
  // L'état n'est pas connu — ou ne l'a jamais été, l'appel ayant échoué : ni
  // rattachement ni absence, seulement le verrou et sa sortie.
  if (state.linked !== true) {
    return {
      status: "Applications connectées illisibles pour l'instant : champ en lecture seule. Recharge la page pour réessayer.",
      details: [],
    };
  }
  const change =
    "Pour en changer, retire Blizzard des « Applications connectées » (après avoir ajouté un autre moyen de connexion si c'est le seul), puis rattache le bon compte.";
  if (!state.tag) {
    // Rattaché sans BattleTag : le cas existe (un compte Battle.net peut n'en
    // porter aucun), et le champ reste fermé parce que la prochaine connexion
    // écrira celui de la source par-dessus.
    return { status: "Compte Blizzard rattaché, sans BattleTag : Blizzard le remplira à ta prochaine connexion.", details: [change] };
  }
  return {
    status: "Fourni par ton compte Blizzard, et mis à jour à chaque connexion.",
    details: [change, "Pour le retirer de ta fiche, de l'annuaire et des rosters, décoche « BattleTag OW » plus bas."],
  };
}
