import { BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import { CONNECTION_LOG_RETENTION_DAYS } from "@/lib/shared/connection-logs";

/**
 * Les annonces d'horaire et rappels de match remis en message privé Discord
 * reposent sur l'intérêt légitime (registre T04), pas sur le contrat qui fonde
 * l'enregistrement de l'identifiant et du pseudo Discord.
 */
export const MATCH_TIME_DM_SCOPE = "annonces d'horaire, rappels, avis de retrait de match, check-in du match et avis du retrait d'un cast en message privé";

/** Avis de suspension ou de modération en message privé : intérêt légitime à faire respecter les conditions (registre T11). */
export const MODERATION_DM_SCOPE = "avis de suspension ou de modération en message privé";

/** Information sur les données en message privé : obligation légale d'information (registre T10). */
export const DATA_NOTICE_DM_SCOPE = "information sur tes données en message privé";

/**
 * Le pseudo public d'un joueur inscrit en tournoi individuel part dans
 * l'annonce #live (registre T16) et y survit au compte. Base : l'exécution du
 * service auquel il s'inscrit (décision du 2026-10-14), pas l'intérêt légitime
 * — d'où aucune opposition autre que ne pas s'inscrire.
 */
export const LIVE_PSEUDO_SCOPE = "annonce #live d'un tournoi individuel, gardée dans le salon Discord jusqu'à sa suppression sur demande";

/**
 * Copie du même pseudo dans l'alerte AutoMod d'une annonce #live bloquée ou
 * signalée (registre T16) : intérêt légitime de l'association à modérer son
 * serveur, opposition = suppression sur demande — pas l'exécution du service.
 */
export const AUTOMOD_ALERT_SCOPE = "alerte AutoMod d'une telle annonce bloquée ou signalée, gardée dans le salon d'alertes des modérateurs jusqu'à sa suppression par eux ou sur demande";

/**
 * Contacts d'un match (registre T04) : exécution du service, que les
 * conditions d'utilisation prévoient (section « Contacts de match », version 6).
 * Les équipes et les arbitres les ont dès que les deux adversaires sont connus,
 * chaque caster le temps du match seulement ; ceux de chaque caster, les
 * équipes et les autres casters du match le temps du match et les arbitres dès
 * que les adversaires sont connus
 * (`lib/shared/match-launch.ts`, `exposesCasterContacts`).
 */
export const MATCH_CONTACTS_SCOPE =
  "présentation (le BattleTag, des contacts d'équipe comme des casters, dans les seuls tournois Overwatch), dans la fenêtre « Contacts » du match et dans sa fenêtre de lancement, aux membres de ses deux équipes et aux arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin, et à ses casters le temps du match (la fenêtre de lancement, au départ du match, ne s'ouvre qu'aux deux équipes, aux casters et à l'arbitre désigné) ; les contacts de chaque caster aux deux équipes et aux autres casters du match le temps du match, et aux arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin — contacts que la page du match reprend aussi, aux mêmes lecteurs et aux mêmes moments que la fenêtre « Contacts », comme ceux des deux équipes, aux seules parties du match (jamais aux arbitres sans rôle sur ce match) — (conditions d'utilisation, « Contacts de match »)";

/**
 * BattleTag masqué : le masquer ne le retire pas des parties de tes matchs
 * (`battletag-visibility.ts`). Cette lecture-là n'est pas un consentement —
 * le réglage n'y peut rien — mais l'exécution du service (décision du
 * 2026-10-19), prévue par les conditions d'utilisation.
 */
export const BATTLETAG_MATCH_SCOPE =
  "lecture, même masqué, dans un tournoi Overwatch seulement (jamais en Marvel Rivals) : présenté comme contact d'un match, dans sa fenêtre « Contacts », dans sa fenêtre de lancement et, pour les seules parties du match, sur sa page seulement, par ses deux équipes et les arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin, par ses casters le temps du match ; celui d'un caster, dans ces fenêtres et aussi sur la page du match, par les deux équipes et les autres casters du match le temps du match et par les arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin (la fenêtre de lancement, au départ du match, ne s'ouvre qu'aux deux équipes, aux casters et à l'arbitre désigné) — arbitres et administrateurs n'y ont pas d'autre accès (conditions d'utilisation, « Contacts de match »)";

/**
 * BattleTag de l'arbitre désigné d'un match, même masqué, présenté aux parties
 * du match — dans les seuls tournois Overwatch (décision de l'utilisateur 35,
 * 2026-10-28 ; comme celui des casters) : exécution du contrat une fois la version 7 des conditions
 * d'utilisation acceptée par cet arbitre, sa section « Contacts de match » le
 * prévoyant (décision de l'utilisateur du 2026-10-27) ; tant qu'il ne l'a pas
 * acceptée, l'intérêt légitime, avec un droit d'opposition
 * (`REFEREE_BATTLETAG_BEFORE_V7_SCOPE` — revue juridique de #487). Se retirer
 * d'un match l'en retire, sans empêcher le staff de lui confier de nouveau ce
 * match.
 */
export const REFEREE_BATTLETAG_SCOPE =
  "BattleTag de l'arbitre désigné d'un match d'un tournoi Overwatch (jamais en Marvel Rivals), même masqué, dans ses fenêtres « Contacts » et de lancement et sur la page du match : lu par ses deux équipes et les arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin, par ses casters le temps du match — par ses deux équipes le temps du match seulement s'il caste aussi le match — (la fenêtre de lancement, au départ du match, ne s'ouvre qu'aux deux équipes, aux casters et à l'arbitre désigné) ; retrait d'un match à tout moment, le staff pouvant lui confier de nouveau ce match, sans avis (conditions d'utilisation, « Contacts de match », une fois leur version 7 ou une suivante acceptée par l'arbitre)";

/**
 * Même présentation, pour un arbitre qui n'a pas encore accepté la version 7
 * des conditions : intérêt légitime, avec un droit d'opposition (décision de
 * l'utilisateur du 2026-10-27 — aucun interrupteur dans le code).
 */
export const REFEREE_BATTLETAG_BEFORE_V7_SCOPE =
  "la même présentation du BattleTag de l'arbitre désigné, tant que cet arbitre n'a pas accepté la version 7 des conditions d'utilisation ou une version suivante — opposition par le formulaire de signalement, catégorie RGPD (retenue, il est retiré de tous ses matchs non terminés et ne peut plus en prendre un ni s'en voir confier un tant qu'elle n'est pas levée — à sa seule demande —, même une fois la version 7 ou une suivante acceptée)";

/**
 * Pseudo de l'arbitre désigné présenté aux parties de ses matchs, sur la même
 * base que son BattleTag (`REFEREE_BATTLETAG_SCOPE`, `_BEFORE_V7_SCOPE`) —
 * revue juridique de #491 : la ligne « Pseudo site » le déclare aussi.
 */
export const REFEREE_USERNAME_SCOPE =
  "pseudo de l'arbitre désigné d'un match, dans ses fenêtres « Contacts » et de lancement et sur la page du match, quel que soit le jeu : à ses deux équipes et aux arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin, et à ses casters le temps du match (dans un tournoi Overwatch, à côté de son BattleTag — voir « Pseudo Overwatch »), et seul dès que la fenêtre de lancement montre le match (conditions d'utilisation, « Contacts de match », une fois leur version 7 ou une suivante acceptée par l'arbitre)";

export const REFEREE_USERNAME_BEFORE_V7_SCOPE =
  "la même présentation du pseudo de l'arbitre désigné, tant que cet arbitre n'a pas accepté la version 7 des conditions d'utilisation ou une version suivante — opposition par le formulaire de signalement, catégorie RGPD (retenue, il est retiré de tous ses matchs non terminés et ne peut plus en prendre un ni s'en voir confier un tant qu'elle n'est pas levée — à sa seule demande —, même une fois la version 7 ou une suivante acceptée)";

/**
 * Pseudo seul de l'arbitre désigné lu par tout membre connecté (lot
 * MATCH-UI-NAMES, décision 52) : intérêt légitime, même opposition.
 */
export const REFEREE_USERNAME_MEMBERS_SCOPE =
  "pseudo seul de l'arbitre désigné d'un match, sur la carte et la page du match jusqu'à la déclaration de son score ou la fin du tournoi, lu par tout membre connecté (jamais par un visiteur sans compte, qui lit « Arbitre désigné ») — opposition par le formulaire de signalement, catégorie RGPD, avec le même effet qu'une opposition à sa présentation aux parties (retrait de ses matchs non terminés)";

/**
 * Tag Discord certifié de l'arbitre désigné, présenté aux seules parties du
 * match — membres de ses deux équipes, ses casters — dans la fenêtre
 * « Contacts » et sur la page du match (lot MATCH-PAGE-CONNECT,
 * `MATCH_PAGE_CONNECT.md`) : depuis le 6 novembre 2026, l'exécution du service,
 * strictement nécessaire à son fonctionnement minimum (décision de
 * l'utilisateur du 2026-11-03, auparavant l'intérêt légitime), une fois la
 * version 9 acceptée par l'arbitre — avant, `REFEREE_DISCORD_BEFORE_V7_SCOPE` (nom hérité : il vaut avant la version 9) ; son opposition à
 * l'arbitrage, retenue, l'en retire toujours avec ses matchs non terminés.
 */
export const REFEREE_DISCORD_SCOPE =
  "si tu es l'arbitre désigné d'un match, ton tag Discord certifié, dans sa fenêtre « Contacts » et sur sa page, lu par ses deux équipes dès que ses deux adversaires sont connus et jusqu'à sa fin et par ses casters le temps du match (jamais par les arbitres sans rôle sur ce match ni dans la fenêtre de lancement ; si tu le castes aussi, la règle des casters : le temps du match pour ses parties, fenêtre de lancement comprise, et dès que ses deux adversaires sont connus pour les autres arbitres), pour qu'ils puissent te joindre, depuis le 6 novembre 2026 (auparavant, intérêt légitime) et une fois la version 9 des conditions d'utilisation ou une suivante acceptée par toi — strictement nécessaire au fonctionnement minimum du service, sans opposition propre : la présentation cesse avec ton arbitrage du match — retrait par toi ou par le staff, autre arbitre ou autogestion, joueur du match avant son lancement, ton opposition d'arbitre (formulaire de signalement, catégorie RGPD) retenue, qui te retire de tes matchs non terminés, ou la suppression de ton compte —, dès que tu ne remplis plus les conditions de l'arbitrage (tag retiré compris : avant le lancement, tu es aussi retiré du match), et à la fin du match ; si tu le castes aussi, ton tag suit en plus la règle des casters";

/**
 * Même présentation du tag Discord, pour un arbitre qui n'a pas encore accepté
 * la version 9 des conditions (nom hérité de la version 7) : intérêt légitime, avec un droit d'opposition,
 * comme son pseudo et son BattleTag (`REFEREE_BATTLETAG_BEFORE_V7_SCOPE`).
 */
export const REFEREE_DISCORD_BEFORE_V7_SCOPE =
  "la même présentation de ton tag Discord certifié d'arbitre désigné, tant que tu n'as pas accepté la version 9 des conditions d'utilisation ou une version suivante — opposition par le formulaire de signalement, catégorie RGPD (retenue, tu es retiré de tous tes matchs non terminés et ne peux plus en prendre un ni t'en voir confier un tant qu'elle n'est pas levée — à ta seule demande —, même une fois la version 9 ou une suivante acceptée)";

/**
 * Pastilles de certification de la fiche (tag Discord certifié, BattleTag tiré
 * d'un compte Battle.net rattaché) : lues par tout joueur connecté, tag masqué
 * compris (`canSeeDiscordVerification`, `canSeeBattletagVerification`). Pas un
 * consentement — masquer le tag n'y change rien — mais l'intérêt légitime
 * (savoir qui a prouvé son identité de jeu, notamment pour les conditions
 * d'inscription d'un tournoi), avec un droit d'opposition (décision de
 * l'utilisateur du 2026-10-21).
 */
export const VERIFIED_BADGE_SCOPE =
  "pastille de certification de ta fiche, lue par tout joueur connecté même tag masqué (sans le tag) — opposition par le formulaire de signalement, catégorie RGPD";

/**
 * Bases légales citées par la politique — les mêmes que le registre
 * (`processing-register.ts`). Une donnée a une base principale ; quand une
 * partie de sa finalité repose sur une autre (le tag certifié et le BattleTag,
 * exposés sur consentement mais présentés aux parties d'un match en exécution
 * des conditions d'utilisation), `extraBases` la nomme avec sa portée.
 *
 * **Le compte et l'authentification reposent sur le contrat** (art. 6.1.b) : un
 * consentement demandé pour des données sans lesquelles le compte n'existe pas
 * ne serait pas libre (art. 7.4). Le **consentement** est réservé à ce que le
 * joueur choisit en plus — une certification qui l'expose, une donnée
 * facultative qu'il renseigne et publie.
 */
export type LegalBase = "Exécution du contrat" | "Consentement" | "Intérêt légitime" | "Obligation légale";

// Les bases et la durée les plus citées, nommées une fois : une ligne du
// tableau les désigne par leur nom, ce qui la distingue de sa voisine pour la
// détection de duplication de SonarCloud (`docs/features/LEGAL_DATA_FILES.md`).
const CONTRAT = "Exécution du contrat" satisfies LegalBase;
const CONSENTEMENT = "Consentement" satisfies LegalBase;
const INTERET_LEGITIME = "Intérêt légitime" satisfies LegalBase;
const OBLIGATION_LEGALE = "Obligation légale" satisfies LegalBase;
const DUREE_DU_COMPTE = "Durée du compte";

export interface DonneEntry {
  donnee: string;
  finalite: string;
  base: LegalBase;
  /**
   * Autres bases, chacune bornée à une partie de la finalité : une même donnée
   * peut être exposée sur consentement et présentée, ailleurs, en exécution
   * des conditions d'utilisation. Affichées à côté de la base principale,
   * jamais contredites par la finalité.
   */
  extraBases?: readonly { base: LegalBase; scope: string }[];
  duree: string;
}

/** Une base d'appoint et les portées qui la suivent sans interruption. */
export interface ExtraBaseGroup {
  base: LegalBase;
  scopes: string[];
}

/**
 * Les bases d'appoint d'une ligne, regroupées quand des portées qui se suivent
 * ont la même base : une seule pastille pour elles (revue de #491 — deux
 * pastilles identiques côte à côte se lisaient comme deux bases). L'ordre des
 * portées est gardé ; deux portées de même base séparées par une autre restent
 * deux groupes.
 */
export function groupedExtraBases(extraBases: DonneEntry["extraBases"]): ExtraBaseGroup[] {
  const groups: ExtraBaseGroup[] = [];
  for (const extra of extraBases ?? []) {
    const last = groups.at(-1);
    if (last?.base === extra.base) last.scopes.push(extra.scope);
    else groups.push({ base: extra.base, scopes: [extra.scope] });
  }
  return groups;
}

export interface DroitEntry {
  title: string;
  text: string;
}

export const DONNEES_PROFIL: DonneEntry[] = [
  {
    donnee: "Pseudo site",
    // **Jamais un nom réel.** Un compte créé par Google recevait le `name` de
    // son profil Google — un prénom et un nom, le plus souvent — pour pseudo
    // public et non masquable. Il naît désormais sous un pseudo neutre ; Discord
    // et Blizzard donnent un pseudonyme de jeu (tag, BattleTag sans son numéro).
    finalite:
      "Identification sur la plateforme, URLs de profil. Jamais tiré de ton nom : un compte créé par Discord ou Blizzard reprend ton pseudo Discord ou ton BattleTag (sans son numéro), un compte créé par Google reçoit un pseudo neutre — tu le changes dans Mon profil. Un compte créé par Google avant le 30 septembre 2026 a pu recevoir le nom de ton compte Google : si c'est le cas, remplace-le dans Mon profil",
    base: CONTRAT,
    extraBases: [
      { base: CONTRAT, scope: LIVE_PSEUDO_SCOPE },
      { base: INTERET_LEGITIME, scope: AUTOMOD_ALERT_SCOPE },
      { base: CONTRAT, scope: REFEREE_USERNAME_SCOPE },
      { base: INTERET_LEGITIME, scope: REFEREE_USERNAME_BEFORE_V7_SCOPE },
      { base: INTERET_LEGITIME, scope: REFEREE_USERNAME_MEMBERS_SCOPE },
    ],
    duree: DUREE_DU_COMPTE,
  },
  {
    donnee: "Pseudo Overwatch",
    // Depuis la connexion Blizzard, ce champ a deux origines possibles, et la
    // seconde écrase la première à chaque connexion : le dire est la condition
    // pour que le joueur comprenne pourquoi sa saisie a changé.
    finalite:
      "Mise en relation entre joueurs (s'ajouter en jeu) — aucune statistique. Saisi par toi, ou renseigné par Blizzard à chaque connexion si tu as rattaché ton compte Battle.net. Masqué, il n'est lisible de personne — arbitres et administrateurs compris — sauf dans un tournoi Overwatch (jamais en Marvel Rivals, où aucun des cas qui suivent ne s'applique) : dans la fenêtre « Contacts » d'un match où tu fais partie des contacts présentés et dans sa fenêtre de lancement : des membres de ses deux équipes et des arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin, de ses casters le temps du match seulement (de son départ à sa fin) (la fenêtre de lancement, au départ du match, ne s'ouvre qu'aux deux équipes, aux casters et à l'arbitre désigné) ; si tu castes un match, de ses deux équipes et de ses autres casters le temps du match et des arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin ; si tu es l'arbitre désigné d'un match, de ses deux équipes et des arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin et de ses casters le temps du match — de ses deux équipes le temps du match seulement si tu le castes aussi — (voir « Arbitre désigné d'un match ») ; la page du match le montre aussi, aux mêmes lecteurs et aux mêmes moments que la fenêtre « Contacts », hors arbitres sans rôle sur ce match quand tu y es contact d'équipe ; présenté comme contact d'un match, il est montré avec ton rôle d'équipe et l'indication qu'il vient ou non d'un compte Battle.net rattaché. Visible ou masqué, ta fiche montre à tout joueur connecté qui la consulte une pastille « BattleTag vérifié » s'il vient d'un compte Battle.net rattaché — sans jamais dire un BattleTag masqué ; tu peux t'y opposer par le formulaire de signalement (catégorie RGPD)",
    // Masqué, le BattleTag reste lu par les parties de tes matchs : ce n'est
    // pas un consentement (le masquer n'y change rien), mais l'exécution du
    // service — les conditions d'utilisation le prévoient (« Contacts de
    // match », version 6 ; celui de l'arbitre désigné depuis la version 7).
    // Le consentement ne vaut que pour le renseigner et
    // l'afficher au public.
    base: CONSENTEMENT,
    extraBases: [
      { base: CONTRAT, scope: BATTLETAG_MATCH_SCOPE },
      { base: CONTRAT, scope: REFEREE_BATTLETAG_SCOPE },
      { base: INTERET_LEGITIME, scope: REFEREE_BATTLETAG_BEFORE_V7_SCOPE },
      { base: INTERET_LEGITIME, scope: VERIFIED_BADGE_SCOPE },
    ],
    duree: DUREE_DU_COMPTE,
  },
  {
    donnee: "Pseudo Discord",
    // La finalité a changé avec la certification (`lib/shared/discord-identity.ts`),
    // et une déclaration RGPD qui resterait sur l'ancienne serait fausse : le tag
    // n'est plus seulement un moyen technique, il devient une **coordonnée de
    // contact** exposée à l'organisation — mais uniquement une fois certifié, et
    // uniquement à deux publics. La phrase dit les deux régimes, parce que les
    // deux existent en base au même instant — et le troisième public, les autres
    // joueurs, qui n'existe que si le titulaire coche « Tag Discord ».
    //
    // Deux bases, donc deux lignes : l'enregistrement du pseudo sert la
    // connexion (contrat), son **exposition** repose sur la certification
    // (consentement, ligne suivante).
    finalite:
      "Authentification Discord, codes du bot en message privé (connexion, rattachement, certification), notifications bot (tag certifié seulement). Enregistré à ta connexion par Discord, ou saisi par toi (compte sans Discord rattaché) ; sans certification, invisible de tous, administrateurs compris",
    base: CONTRAT,
    extraBases: [{ base: INTERET_LEGITIME, scope: MATCH_TIME_DM_SCOPE }],
    duree: DUREE_DU_COMPTE,
  },
  {
    donnee: "Certification du pseudo Discord",
    // **Un geste distinct, et le seul.** Se connecter par Discord ne la donne
    // plus : s'authentifier n'est pas consentir à une exposition, et le refuser
    // ne doit pas coûter la porte Discord. D'où une base « Consentement » qui
    // tient — le geste est libre, spécifique, et se retire.
    finalite:
      "Ouvre ton tag Discord à l'organisation pour te joindre : administrateurs à tout moment, arbitres tant que tu es inscrit à un tournoi qui n'est pas terminé (dès l'ouverture des inscriptions), membres des deux équipes de ton match dès que ses deux adversaires sont connus et jusqu'à sa fin, ses casters le temps du match seulement (et, si tu castes un match, ses deux équipes, ses autres casters et son arbitre désigné le temps du match, dans ses fenêtres « Contacts » et de lancement et sur sa page, et les autres arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin, dans sa fenêtre « Contacts » et sur sa page ; et, si tu es l'arbitre désigné d'un match, ses deux équipes dès que ses deux adversaires sont connus et jusqu'à sa fin et ses casters le temps du match, dans sa fenêtre « Contacts » et sur sa page — le temps du match seulement pour ses parties si tu le castes aussi) ; les autres joueurs connectés seulement si tu coches « Tag Discord ». Que ton tag soit certifié (pastille ✅, sans le tag) se lit sur ta fiche par tout joueur connecté. Sans la certification, le bot ne t'envoie aucun message privé de match. Donnée seulement par toi, depuis Mon profil (un clic si ton Discord est rattaché, un code en message privé sinon) ou, d'un clic, depuis la fenêtre qui te la propose après une connexion par Discord ou Blizzard (sinon, elle te mène à Mon profil) — se connecter par Discord ne la donne pas. Les conditions d'inscription d'un tournoi peuvent l'exiger, et caster ou arbitrer un match l'exige. Retirée en retirant ton tag ; perdue si ton pseudo change",
    base: CONSENTEMENT,
    // La certification décide aussi qui reçoit les messages privés de match,
    // qui reposent sur l'intérêt légitime (opposition par la case du profil).
    extraBases: [
      { base: CONTRAT, scope: MATCH_CONTACTS_SCOPE },
      { base: INTERET_LEGITIME, scope: MATCH_TIME_DM_SCOPE },
      { base: INTERET_LEGITIME, scope: VERIFIED_BADGE_SCOPE },
      { base: CONTRAT, scope: REFEREE_DISCORD_SCOPE },
      { base: INTERET_LEGITIME, scope: REFEREE_DISCORD_BEFORE_V7_SCOPE },
    ],
    duree: "Jusqu'au retrait ou au changement du tag, ou durée du compte",
  },
  {
    donnee: "ID Discord",
    // Le compte n'a pas de mot de passe : cet identifiant **est** un moyen de
    // connexion, au même titre que les deux suivants. La finalité le dit, parce
    // que c'est ce qui explique qu'on ne puisse pas retirer le dernier.
    finalite:
      "Moyen de connexion (bouton Discord, ou code reçu en message privé) — stocké uniquement si tu rattaches Discord. Sert aussi au bot pour t'écrire en message privé (horaires, rappels, retrait de match, check-in d'un match que tu joues, et retrait de ton cast — seulement si ton tag est certifié —, demande d'adhésion à une équipe que tu gères, invitation d'une équipe, reprise d'équipe proposée ou propriété de ton équipe reçue, avis de suspension ou de modération, information sur tes données). Retirable depuis Mon profil tant qu'il t'en reste un autre",
    base: CONTRAT,
    extraBases: [
      { base: INTERET_LEGITIME, scope: MATCH_TIME_DM_SCOPE },
      { base: INTERET_LEGITIME, scope: MODERATION_DM_SCOPE },
      { base: OBLIGATION_LEGALE, scope: DATA_NOTICE_DM_SCOPE },
    ],
    duree: DUREE_DU_COMPTE,
  },
  {
    donnee: "Identifiant Google",
    // L'**adresse** n'y figure pas, et ce n'est pas un oubli : plus rien ne
    // rattache un compte par son e-mail, le scope `email` n'est plus demandé, et
    // la colonne a été **supprimée** — avec les adresses collectées avant la
    // règle. Ce qui reste est un identifiant opaque, qui ne s'affiche à
    // personne.
    finalite:
      "Moyen de connexion (bouton Google) — identifiant technique opaque. Aucune adresse e-mail n'est demandée ni conservée, et le nom de ton compte Google n'est pas repris. Retirable depuis Mon profil tant qu'il t'en reste un autre",
    base: CONTRAT,
    duree: DUREE_DU_COMPTE,
  },
  {
    donnee: "Identifiant Blizzard",
    finalite:
      "Moyen de connexion (bouton Blizzard) — identifiant technique opaque. Renseigne et tient à jour ton BattleTag. Retirable depuis Mon profil tant qu'il t'en reste un autre",
    base: CONTRAT,
    duree: DUREE_DU_COMPTE,
  },
  {
    donnee: "Pseudo Marvel Rivals",
    finalite: "Mise en relation entre joueurs (s'ajouter en jeu) — aucune statistique",
    base: CONSENTEMENT,
    duree: DUREE_DU_COMPTE,
  },
  {
    donnee: "Majorité déclarée",
    finalite:
      "Oui, non ou non renseignée, à ton choix. Affichée sur ta fiche seulement si tu coches « Majorité » dans Mon profil",
    base: CONSENTEMENT,
    duree: DUREE_DU_COMPTE,
  },
  {
    donnee: "Avatar",
    // La photo copiée depuis Google ou Discord n'est pas un choix du joueur :
    // elle naît masquée (`adoptRemoteAvatar`), et seul le joueur la publie.
    finalite:
      "Affichage sur le profil et les brackets. Téléversé par toi, ou copié sur nos serveurs depuis Google ou Discord à la connexion — depuis le 30 septembre 2026, la photo copiée reste masquée tant que tu ne coches pas « Avatar » dans Mon profil (une photo copiée avant cette date reste affichée : décoche « Avatar » pour la masquer)",
    base: CONSENTEMENT,
    duree: DUREE_DU_COMPTE,
  },
  {
    donnee: "Langue du compte",
    // Lot i18n 9-3 (`bg_users.locale`) : base T01, décision de l'utilisateur
    // (2026-10-13) — sert à rédiger les notifications push, pas un choix
    // facultatif de visibilité.
    finalite:
      "Français ou anglais : la langue des notifications push et des messages privés Discord du site (transmise au bot avec le seul code envoyé en message privé). Celle de la page du site d'où part ta dernière connexion (sauf les exceptions détaillées à la section Notifications push), ou celle que tu choisis dans Mon profil ; français par défaut, remis au français si le compte est anonymisé",
    base: CONTRAT,
    duree: DUREE_DU_COMPTE,
  },
  {
    donnee: "Choix des messages privés de match",
    // `bg_users.match_dm_enabled` : l'opposition aux messages privés de match
    // (registre T04), exportée et remise au défaut à l'anonymisation. Le garder
    // relève d'une obligation légale (art. 6.1.c : honorer l'opposition, art. 21).
    finalite:
      "Coché par défaut : le bot t'écrit en privé pour l'horaire, les rappels et le retrait de tes matchs, si ton tag Discord est certifié ; décoché dans Mon profil (ton opposition), il ne le fait plus. Gardé au titre d'une obligation légale : c'est ce qui permet de continuer d'honorer ton opposition. Figure dans l'export de tes données, remis au défaut si le compte est anonymisé",
    base: OBLIGATION_LEGALE,
    duree: DUREE_DU_COMPTE,
  },
  {
    donnee: "Choix « Ne plus afficher » du recrutement",
    // `bg_users.recruitment_modal_off` (registre T01) : préférence d'affichage,
    // exportée et remise au défaut à l'anonymisation. Le cookie du navigateur
    // (`bg_recr_off`) est décrit à la section des cookies.
    finalite:
      "Non par défaut : la fenêtre des annonces de recrutement urgentes s'ouvre d'elle-même. « Ne plus afficher » dans cette fenêtre : elle ne s'ouvre plus d'elle-même sur tes autres appareils (un choix fait sur ce navigateur avant la connexion, ou pas enregistré sur-le-champ, y est reporté à la connexion ou à ta prochaine visite connectée). Réversible dans Mon profil : le compte note alors que la fenêtre a été réaffichée et le cookie bg_recr_off de ce navigateur est effacé ; dès lors, plus aucun cookie n'est reporté sur le compte (un nouveau « Ne plus afficher » fait connecté, ou la case de Mon profil, l'y remet). Figure dans l'export de tes données, remis au défaut si le compte est anonymisé",
    base: CONTRAT,
    duree: DUREE_DU_COMPTE,
  },
  {
    donnee: "Choix « Ne plus voir » de la certification Discord",
    // `bg_users.discord_certify_prompt_dismissed_at` (registre T01) :
    // préférence d'affichage, exportée et effacée à l'anonymisation. La marque
    // de session (`bg_user_sessions.certify_prompt_due`) part avec la session.
    finalite:
      "Non par défaut : après une connexion par Discord ou Blizzard, tant que ton tag Discord n'est pas certifié, une fenêtre te propose de le certifier (ou, si tu n'en as pas, de l'ajouter puis de le certifier), une fois par connexion : « Plus tard » la ferme pour cette connexion-là ; elle revient à ta prochaine connexion par Discord ou Blizzard. La session de connexion note seulement qu'elle reste à proposer : marque levée à ta première réponse (« Ne plus voir » la lève sur toutes tes sessions) ou dès qu'il n'y a plus rien à proposer, effacée avec la session, hors de l'export de tes données. Une réponse qui ne parvient pas au site, ou qu'il refuse (autre compte connecté depuis dans ce navigateur, compte introuvable), ne lève pas la marque : la fenêtre peut revenir au chargement suivant. « Ne plus voir » : elle ne s'ouvre plus, sur aucun appareil (date du choix gardée) — et, sur la fiche d'un tournoi, l'invitation à certifier faite à qui mène une équipe ne s'ouvre plus quand seul son tag Discord manque (jamais quand ton équipe n'a aucun contact) ; la certification reste possible dans Mon profil. Ce choix figure dans l'export de tes données, effacé si le compte est anonymisé",
    base: CONTRAT,
    duree: DUREE_DU_COMPTE,
  },
];

export const DONNEE_TOURNOIS: DonneEntry = {
  donnee: "Résultats de tournois",
  finalite: "Historique compétitif, classements, palmarès",
  base: INTERET_LEGITIME,
  // Décision de l'association : aucune durée de conservation n'est définie.
  // Les résultats restent tant que le site existe ; à la suppression d'un
  // compte, ils sont anonymisés (pseudo d'emprunt, `anonymizeAccount`).
  duree: "Aucune durée définie : tant que le site existe ; anonymisés à la suppression du compte (voir §03)",
};

/**
 * Les copies de sauvegarde — la seule donnée du tableau qui ne se lit pas sur le
 * site, et la seule qui survive un temps à une suppression.
 *
 * La page disait qu'elles « peuvent subsister quelques jours » ; elles étaient
 * gardées six mois. La durée vient désormais de la constante que le script de
 * sauvegarde doit respecter (`BACKUP_RETENTION_DAYS`), et la phrase nomme les
 * deux choses qui rendent cette survie acceptable : le chiffrement (Hetzner
 * héberge, en Allemagne, sans pouvoir lire) et le rejeu des suppressions de compte à la
 * restauration — les seules qui soient rejouées.
 */
export const DONNEE_SAUVEGARDES: DonneEntry = {
  donnee: "Copies de sauvegarde",
  finalite:
    "Reprise après incident (panne, corruption). Chiffrées avant envoi, avec des clés que détient le seul responsable technique de l'association (qui est aussi l'hébergeur du site), puis hébergées chez Hetzner, en Allemagne",
  base: INTERET_LEGITIME,
  duree: `${BACKUP_RETENTION_DAYS} jours au plus`,
};

/**
 * Journal des données de connexion (`lib/shared/connection-logs.ts`) : la
 * seule donnée que le site garde **au-delà** de la suppression du compte, au
 * titre d'une obligation légale — d'où sa ligne à part.
 */
export const DONNEE_CONNEXIONS: DonneEntry = {
  donnee: "Données de connexion (adresse IP, date et heure, moyen de connexion)",
  finalite:
    "Obligation de l'hébergeur des contenus publiés par les membres (LCEN, art. 6 ; décret n° 2021-1362) : permettre d'identifier l'auteur d'un contenu, sur réquisition d'une autorité judiciaire. Aucune autre utilisation",
  base: OBLIGATION_LEGALE,
  duree: `${CONNECTION_LOG_RETENTION_DAYS} jours (un an) après chaque connexion, y compris après la suppression du compte`,
};

export const DROITS: DroitEntry[] = [
  {
    title: "Droit d'accès",
    text: "Vous pouvez demander une copie de toutes les données personnelles que nous détenons vous concernant.",
  },
  {
    title: "Droit de rectification",
    text: "Vous pouvez corriger ou mettre à jour vos données depuis votre page de profil ou en nous contactant.",
  },
  {
    title: "Droit à l'effacement",
    text: "Vous pouvez demander la suppression de votre compte et de vos données de profil, ou la faire vous-même dans Mon profil — ou, sans accepter les conditions d'utilisation, depuis la fenêtre qui vous demande de les accepter. Voir ci-dessus pour les données de palmarès, et pour les données de connexion, que la loi impose de garder un an (RGPD, art. 17.3.b). Les annonces #live d'un tournoi individuel qui ont publié votre pseudo restent dans le salon Discord jusqu'à leur suppression, sur une demande distincte (« Signaler un problème », catégorie RGPD), comme l'alerte de modération d'une telle annonce bloquée ou signalée par AutoMod.",
  },
  {
    title: "Droit à la limitation",
    text: "Vous pouvez demander que vos données soient conservées sans être autrement utilisées le temps que nous vérifiions leur exactitude ou que nous examinions votre opposition, lorsque leur traitement est illicite et que vous préférez cette limitation à leur effacement, ou lorsque vous en avez besoin pour faire valoir un droit en justice alors que nous n'en aurions plus l'usage (art. 18).",
  },
  {
    title: "Droit d'opposition",
    text: "Vous pouvez vous opposer au traitement de vos données fondé sur l'intérêt légitime (historique de tournois, annonces d'horaire, rappels, avis de retrait de match, check-in du match et avis du retrait d'un cast en message privé — ces messages se coupent directement par la case « Messages privés Discord de mes matchs » de Mon profil — et pastilles de certification de votre fiche, tag Discord certifié et « BattleTag vérifié », la vérification, quand un membre du staff arbitre un match, qu'il ne le joue pas (impartialité de l'arbitrage), l'affichage du pseudo de l'arbitre désigné à tout membre connecté, la présentation de l'arbitre désigné aux parties de ses matchs — pseudo et BattleTag en Overwatch tant qu'il n'a pas accepté la version 7 des conditions d'utilisation ou une version suivante, tag Discord certifié tant qu'il n'a pas accepté la version 9 ou une version suivante —, par le formulaire de signalement, catégorie RGPD). Le pseudo publié dans l'annonce #live d'un tournoi individuel n'en fait pas partie : il relève de l'exécution du service auquel vous vous inscrivez — ne pas y être nommé revient à ne pas s'inscrire ; une annonce passée est supprimée sur demande. L'alerte AutoMod d'une telle annonce bloquée ou signalée, gardée pour la modération du serveur Discord (intérêt légitime), est supprimée sur demande : c'est ainsi qu'on s'y oppose.",
  },
  {
    title: "Droit à la portabilité",
    text: "Vous pouvez demander l'export de vos données dans un format lisible par machine (JSON).",
  },
  {
    title: "Droit de retrait du consentement",
    text: "Vous pouvez retirer votre consentement à tout moment sans que cela affecte la licéité du traitement antérieur.",
  },
  {
    title: "Directives après votre décès",
    text: "Vous pouvez définir des directives sur la conservation, l'effacement et la communication de vos données après votre décès (art. 85 de la loi Informatique et Libertés). Des directives propres à ce site se transmettent à l'association par les mêmes moyens que les autres demandes.",
  },
];
