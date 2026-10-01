/**
 * Changements du traitement des données personnelles, et ce dont chaque compte
 * a déjà pris connaissance.
 *
 * **Ajouter une entrée à `PRIVACY_CHANGES` est le seul geste à faire** quand
 * une modification change ce que le site collecte, qui le lit, combien de temps
 * il le garde ou ce qu'une suppression emporte. Rien d'autre n'est à brancher :
 *
 * - la modale `PrivacyChangesModal` (montée par `app/layout.tsx`) la présente à
 *   chaque compte **une seule fois**, à partir de sa date de publication, avec
 *   un seul bouton : « J'ai pris connaissance » ;
 * - les changements **se cumulent** — un joueur revenu après trois entrées les
 *   voit toutes les trois dans la même modale, et un clic les acquitte
 *   ensemble (`bg_privacy_acknowledgments`, une ligne par changement) ;
 * - chaque compte joignable sur Discord qui n'en a pas pris connaissance sur
 *   le site en reçoit un résumé en message privé, une seule fois par changement, une
 *   semaine après sa publication et au plus un message par mois — les
 *   changements rapprochés partent ensemble
 *   (`lib/server/privacy-change-notifications.ts`) ;
 * - la mention « Dernière mise à jour » de `/rgpd` suit la dernière entrée.
 *
 * Une entrée peut ne viser qu'une partie des comptes (`audience`) et porter des
 * liens vers l'écran où agir (`links`) : c'est ainsi qu'une information due à
 * un sous-ensemble de comptes passe par le même mécanisme.
 *
 * **La modale informe, elle ne demande jamais d'accepter** (RGPD, art. 12 à
 * 14). Un traitement fondé sur l'intérêt légitime ou sur l'exécution du service
 * ne se soumet pas à l'accord du joueur : sa contrepartie est le droit
 * d'opposition (art. 21), que la politique de confidentialité décrit — jamais
 * la suppression du compte. Un traitement fondé sur le **consentement** ne se
 * recueille pas ici non plus : un accord dont le refus coûterait le compte ne
 * serait pas libre (art. 7.4). Il passe par un réglage du site, refusable sans
 * rien perdre d'autre (case décochée par défaut, geste réversible), et l'entrée
 * qui l'annonce nomme ce réglage. Un changement qui élargirait un traitement
 * fondé sur le consentement **sans** réglage pour le refuser n'est pas
 * publiable en l'état : il faut d'abord le réglage.
 *
 * Module **pur** : le registre, la décision « qu'est-ce que ce compte n'a pas
 * encore vu ? » et la rédaction du message Discord se testent sans base.
 *
 * Voir `docs/features/PRIVACY_CHANGES_CONSENT.md`.
 */

import { REPORT_RETENTION_DAYS_AFTER_RESOLUTION } from "@/lib/shared/content-reports";
import { LOGO_QUARANTINE_MONTHS } from "@/lib/shared/logo-quarantine";
import { SUSPENSION_RETENTION_MONTHS } from "@/lib/shared/account-suspension";
import { TEAM_JOIN_REQUEST_NOTICE_COOLDOWN_HOURS } from "@/lib/shared/team-join-request-notice";
import { PUSH_SUBSCRIPTION_RETENTION_DAYS } from "@/lib/shared/push-notifications";
import { CONNECTION_LOG_RETENTION_DAYS } from "@/lib/shared/connection-logs";
import { SITE_VISITOR_RETENTION_MONTHS, SITE_VISIT_DETAIL_RETENTION_DAYS } from "@/lib/shared/site-visits";
import { DATA_CONTACT_NAME, DATA_CONTACT_ROLE, REPORT_FORM_NAME } from "@/lib/shared/legal-contact";
// Constantes seules : ce module est chargé sur chaque page par la modale des
// changements, il ne doit tirer ni le registre ni les conditions d'utilisation.
import {
  BOT_FEED_EVENT_RETENTION_DAYS,
  BOT_STAFF_LOG_RETENTION_DAYS,
  SITE_MINIMUM_AGE,
  SUPPORT_TICKET_RETENTION_MONTHS,
  WEB_ACCESS_LOG_FIELDS,
  WEB_ACCESS_LOG_RETENTION_DAYS,
} from "@/lib/shared/legal-durations";
import {
  ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS,
  BACKUP_RETENTION_DAYS,
} from "@/lib/shared/account-deletion-journal";

/** Un changement du traitement des données, tel qu'il est présenté au joueur. */
export type PrivacyChange = {
  /**
   * Identifiant **stable** : c'est lui qu'on enregistre à la prise de connaissance. Le
   * renommer ferait réapparaître le changement à tous ceux qui l'ont lu.
   * Minuscules, chiffres et tirets (`PRIVACY_CHANGE_ID_PATTERN`).
   */
  id: string;
  /**
   * Date de publication, `AAAA-MM-JJ`, jour de Paris. Un compte **créé ce
   * jour-là ou après** ne voit pas le changement : il s'est inscrit sous la
   * politique déjà à jour. Poser la date de mise en production prévue : une
   * entrée datée du futur reste muette jusqu'à ce jour-là
   * (`publishedPrivacyChanges`) — annoncée plus tôt, elle décrirait une règle
   * qui ne s'applique pas encore.
   */
  publishedAt: string;
  /** Titre court, affiché en tête du changement et dans le message Discord. */
  title: string;
  /** Une ou deux phrases qui disent l'essentiel — reprises dans le message Discord. */
  summary: string;
  /** Le détail, une puce par règle. */
  details: readonly string[];
  /**
   * Les comptes concernés, quand ce ne sont pas **tous** ceux créés avant la
   * publication (`PrivacyAudience`). Absent : tout compte antérieur.
   */
  audience?: PrivacyAudience;
  /**
   * Liens vers les écrans où agir, rendus sous le détail par la modale. Le
   * message Discord ne les porte pas : il renvoie déjà au site.
   */
  links?: readonly PrivacyChangeLink[];
};

/** Un lien d'une entrée : chemin du site et libellé. */
export type PrivacyChangeLink = { href: string; label: string };

/**
 * Sous-ensemble de comptes auquel une entrée s'adresse, en plus de la date de
 * création. `GOOGLE_LINKED` : un compte qui porte une identité Google
 * (`bg_users.google_sub`). Le site ne sait pas par quelle porte un compte est
 * **né** — il ne garde que les identités rattachées —, si bien qu'un compte né
 * par Discord puis rattaché à Google est compté : une entrée ciblée ainsi doit
 * donc se rédiger au conditionnel (« a pu »). L'inverse échappe à la cible :
 * un compte né par Google puis détaché de Google (`google_sub` remis à `NULL`)
 * n'en garde aucune trace en base, et n'est donc pas compté — limite assumée,
 * faute d'un fait qui la lèverait sans nouvelle collecte.
 */
export type PrivacyAudience = "GOOGLE_LINKED";

/**
 * Ce qu'on sait d'un compte pour décider des entrées ciblées. Un fait absent
 * vaut **faux** : dans le doute, une entrée ciblée se tait plutôt que d'être
 * montrée à qui elle ne parle pas.
 */
export type PrivacyAccountFacts = { googleLinked?: boolean };

/** Une entrée s'adresse-t-elle à ce compte (date de création mise à part) ? */
export function privacyChangeReachesAccount(change: PrivacyChange, facts: PrivacyAccountFacts): boolean {
  switch (change.audience) {
    case undefined:
      return true;
    case "GOOGLE_LINKED":
      return facts.googleLinked === true;
    default:
      return false;
  }
}

/**
 * Événement de fenêtre émis quand le joueur a pris connaissance des
 * changements présentés. Les autres modales de la mise en page racine (lancement d'un match)
 * attendent ce signal pour s'ouvrir : deux modales ouvertes ensemble se
 * disputeraient le piège de focus, et celle du dessous le gagnerait.
 */
export const PRIVACY_CHANGES_ANSWERED_EVENT = "bg:privacy-changes-answered";

/** Forme d'un identifiant de changement. */
export const PRIVACY_CHANGE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Longueur maximale d'un identifiant — la colonne `change_id` est un `VARCHAR(80)`. */
export const PRIVACY_CHANGE_ID_MAX_LENGTH = 80;

/**
 * Le registre, **dans l'ordre de publication** et en ajout seul : une entrée
 * publiée ne se retire ni ne se renomme (son identifiant est en base chez
 * chaque compte qui l'a lue), et son texte ne se modifie plus : qui l'a
 * acceptée ne la reverrait jamais, la correction n'atteindrait que ceux qui
 * ne l'ont pas encore lue. Un changement du traitement est une **nouvelle**
 * entrée ; une **information inexacte** sur un traitement resté le même
 * aussi — une entrée rectificative, qui dit ce qui était faux et ce qui est
 * vrai (`2026-10-rectificatifs-information`). Plusieurs rectifications prêtes
 * ensemble partent dans une seule entrée, donc une seule modale.
 */
export const PRIVACY_CHANGES: readonly PrivacyChange[] = [
  {
    id: "2026-09-recapitulatif-rgpd",
    publishedAt: "2026-09-23",
    title: "Récapitulatif des règles en vigueur",
    summary:
      "Nous avons revu la façon dont BlueGenji traite tes données. Voici, en une fois, les règles qui s'appliquent aujourd'hui à ton compte.",
    details: [
      "Aucune adresse e-mail n'est plus demandée ni conservée : celles collectées auparavant ont été supprimées. Ton compte ne tient qu'à des pseudonymes et aux identifiants techniques des services par lesquels tu te connectes (Google, Discord, Blizzard).",
      "Un compte ne se rattache plus à un autre par son adresse : c'est toi qui ajoutes ou retires un moyen de connexion, depuis « Applications connectées » dans Mon profil. Le dernier ne peut pas être retiré, sans quoi plus personne ne pourrait entrer.",
      "Ton tag Discord reste invisible de tous tant qu'il n'est pas certifié. Une fois certifié (par un code, ou en te connectant avec Discord), l'organisation peut le lire pour te joindre pendant un tournoi : les administrateurs en permanence, les arbitres tant que tu es engagé dans un tournoi en cours. Jamais le public.",
      "Si tu rattaches ton compte Battle.net, Blizzard renseigne ton BattleTag et le remplace à chaque connexion. Sa visibilité sur ton profil ne change pas.",
      "Ta photo de profil est copiée sur nos serveurs à la connexion : aucune page du site ne fait plus appel à Google pour l'afficher, et un avatar que tu masques l'est partout, accueil compris.",
      "Supprimer ton compte l'efface entièrement s'il n'a laissé aucune trace. S'il a joué ou organisé un tournoi, ou s'il possède une équipe, il est anonymisé et seul le palmarès sportif reste. Tu peux exporter tes données à tout moment depuis Mon profil.",
      "Seuls des cookies techniques sont déposés. La fréquentation du site est mesurée par une empreinte salée d'un secret que seule l'association détient : ni ton adresse IP ni ton compte ne sont enregistrés tels quels avec tes visites. Le flux d'activité public du bot n'affiche aucun identifiant Discord.",
      "Le journal d'activité que le staff suit sur Discord ne nomme aucun joueur : il parle d'équipes et écrit « un joueur », y compris en tournoi individuel.",
    ],
  },
  // Durées lues sur les constantes que `/rgpd` affiche déjà : la modale ne peut
  // pas annoncer une autre durée que la politique. Les changer est en soi un
  // changement du traitement — il appelle une **nouvelle** entrée.
  {
    id: "2026-09-sauvegardes-chiffrees",
    publishedAt: "2026-09-23",
    title: "Sauvegardes chiffrées et suppressions garanties",
    summary:
      `La plateforme est sauvegardée dans des archives chiffrées gardées ${BACKUP_RETENTION_DAYS} jours, et une suppression de compte reste acquise même si une sauvegarde est restaurée.`,
    details: [
      `La base de données est sauvegardée chaque semaine dans une archive chiffrée avant envoi, avec une clé que seule l'association détient, puis hébergée chez Microsoft (OneDrive), qui la stocke sans pouvoir la lire. Chaque archive est détruite au bout de ${BACKUP_RETENTION_DAYS} jours, sans passer par une corbeille.`,
      "Les images téléversées (avatars, logos) sont copiées, chiffrées, chaque heure. Une image retirée du site disparaît de la sauvegarde dans l'heure.",
      `Une donnée supprimée peut donc subsister jusqu'à ${BACKUP_RETENTION_DAYS} jours dans ces archives, qu'on ne peut pas corriger une à une. Pour qu'elle ne revienne jamais, chaque suppression de compte est notée dans un journal — numéro et date de création du compte, date de suppression, rien d'autre — gardé ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} jours : si une sauvegarde devait être restaurée, les suppressions intervenues depuis sont réappliquées avant la remise en service.`,
    ],
  },
  // Le masquage du BattleTag ne valait jusqu'ici pour personne d'autre que son
  // titulaire, alors que la modale de `/profil` annonçait déjà l'exception :
  // c'est l'**application** de la règle qui élargit qui le lit.
  {
    id: "2026-09-battletag-masque-matchs",
    publishedAt: "2026-09-24",
    title: "BattleTag masqué : lisible là où il sert à jouer",
    summary:
      "Un BattleTag masqué reste hors de ta fiche publique et de l'annuaire, mais les joueurs de tes matchs et l'arbitrage peuvent le lire tant que le tournoi n'est pas terminé.",
    details: [
      "Les autres joueurs d'un match que tu disputes (adversaires et coéquipiers) lisent ton BattleTag sur ta fiche, même masqué : c'est par lui qu'on s'ajoute en jeu pour lancer la partie.",
      "Les arbitres et les administrateurs le lisent aussi tant que tu es engagé dans un tournoi qui n'est pas terminé. En dehors, un administrateur ne voit pas un BattleTag masqué.",
      "Ces accès s'éteignent à la fin du tournoi. Pour ne plus communiquer ton BattleTag du tout, efface-le depuis Mon profil.",
    ],
  },
  // L'invite Google One Tap était chargée sur chaque page pour tout visiteur
  // sans session : Google était sollicité sans que personne l'ait demandé. Le
  // changement restreint qui lit la donnée — c'en est un quand même.
  {
    id: "2026-09-google-one-tap-connexion",
    publishedAt: "2026-09-24",
    title: "Google sollicité sur la seule page de connexion",
    summary:
      "L'invite « Continuer avec Google » ne se charge plus sur tout le site : seulement sur la page de connexion, et après que tu as accepté la politique de confidentialité.",
    details: [
      "Auparavant, tout visiteur non connecté chargeait l'invite de connexion de Google (Google One Tap) sur chaque page : Google recevait son adresse IP et la page consultée.",
      "Désormais, aucune page du site ne fait appel à Google, sauf la page de connexion, une fois la politique acceptée. Google peut y déposer un cookie « g_state » pour retenir que tu as fermé l'invite.",
      "Rien ne change pour ton compte : les moyens de connexion et les données conservées restent les mêmes.",
    ],
  },
  // Lancement des matchs : la modale présente à chaque partie d'un match les
  // contacts des autres — c'est un public de plus pour le tag Discord certifié,
  // et un nouveau public (le caster) pour le BattleTag.
  {
    id: "2026-09-lancement-des-matchs",
    publishedAt: "2026-09-25",
    title: "Lancement des matchs : tes contacts présentés à ton adversaire et au caster",
    summary:
      "Au lancement d'un match, les deux équipes et le caster voient le tag Discord certifié et le BattleTag d'un ou deux joueurs de chaque équipe.",
    details: [
      "Pour chaque équipe, le site présente le capitaine, un manager ou le propriétaire — en priorité un joueur dont le tag Discord ou le BattleTag est vérifié —, et un second joueur si c'est le seul moyen d'avoir à la fois un contact Discord et un BattleTag.",
      "Un tag Discord non certifié n'est jamais montré. Un BattleTag l'est même non vérifié, avec la mention « non vérifié » : c'est par lui qu'on s'ajoute en jeu.",
      "Le caster inscrit sur un match se présente de la même façon aux deux équipes, et voit leurs contacts : s'inscrire pour caster exige un tag Discord certifié et un compte Battle.net rattaché.",
      "Ces informations ne sont visibles qu'entre les parties du match, à partir de son lancement et jusqu'à ce qu'il soit terminé. Le site garde aussi l'heure à laquelle chaque partie s'est déclarée prête, avec le match.",
    ],
  },
  // La suppression change ce qu'elle emporte : l'effacement complet s'étend à
  // tout compte qui n'a joué aucun match, et le compte conservé perd son
  // pseudo au profit d'un pseudo d'emprunt, ses rôles et ses consentements.
  {
    id: "2026-09-suppression-pseudo-emprunt",
    publishedAt: "2026-09-25",
    title: "Suppression de compte : effacement élargi, pseudo de remplacement",
    summary:
      "Un compte supprimé qui n'a joué aucun match est désormais effacé entièrement. Un compte qui a joué garde ses résultats sous un pseudo d'emprunt.",
    details: [
      "Si tu n'as disputé aucun match (et que tu n'as organisé aucun tournoi, ne possèdes aucune équipe ni n'es inscrit à un tournoi individuel), la suppression efface ton compte entièrement — y compris si ton équipe avait été inscrite à un tournoi sans que tu joues.",
      "Si tu as joué, tes résultats restent, parce qu'ils appartiennent aussi aux équipes que tu as affrontées. Ton pseudo est alors remplacé par un pseudo d'emprunt tiré au hasard, et ta fiche indique clairement que le compte a été supprimé.",
      "Tout ce qui te désigne est effacé : tags Discord et de jeu, comptes de connexion, avatar, majorité, rôles sur le site et historique de tes consentements.",
      "Les comptes déjà supprimés suivent la même règle : ceux sans match sont effacés, les autres reçoivent un pseudo d'emprunt.",
    ],
  },
  // Un public de plus pour le tag Discord certifié — les autres joueurs —, sur
  // choix du joueur seulement : la case naît décochée.
  {
    id: "2026-09-tag-discord-visible-joueurs",
    publishedAt: "2026-09-25",
    title: "Tag Discord : visible des autres joueurs, si tu le choisis",
    summary: "Une case de Mon profil peut montrer ton tag Discord certifié aux autres joueurs ; elle naît décochée.",
    details: [
      "Cochée, elle rend ton tag Discord lisible sur ta fiche par tout joueur connecté, pour qu'on puisse t'ajouter sans passer par l'organisation. Un visiteur sans compte ne le voit jamais.",
      "Elle ne vaut que pour un tag certifié : un tag que tu n'as pas prouvé reste masqué de tous, case cochée ou non.",
      "La certification ne change pas : elle ouvre ton tag aux administrateurs, et aux arbitres pendant un tournoi — pas aux autres joueurs.",
    ],
  },
  // Trois traitements nouveaux d'un coup : les signalements (et ce qu'on en dit
  // aux personnes visées), le masquage d'un logo, et la trace de l'acceptation
  // des conditions d'utilisation. Durées lues sur les constantes du code.
  {
    id: "2026-09-signalements-conditions",
    publishedAt: "2026-09-25",
    title: "Signalements et contestation",
    summary: "Tu es prévenu d'un signalement qui te vise, et tu peux le contester.",
    details: [
      "Un signalement garde sa catégorie, sa description, les joueurs, équipes ou tournois désignés, le compte de son auteur et, s'il les indique, son nom et son adresse. Il est lu par les administrateurs, puis effacé " +
        `${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après son archivage — plus tard si un logo a été masqué ou supprimé à sa suite, jusqu'à l'échéance de la contestation.`,
      "Si un signalement te vise, toi ou une équipe dont tu es membre, tu reçois un message privé Discord (si ton compte Discord est rattaché ou ton tag certifié). Tu lis ce qui est reproché — jamais qui l'a signalé — et tu peux le contester ; une contestation rouvre un signalement archivé.",
      `Un logo d'équipe signalé peut être masqué : il n'est plus en ligne, et il est supprimé définitivement au bout de ${LOGO_QUARANTINE_MONTHS} mois sans contestation, ou rétabli si la contestation aboutit. Tes coéquipiers et toi en êtes prévenus.`,
      "L'acceptation des conditions d'utilisation (à la création du compte, d'une équipe, ou en recevant la gestion d'une équipe) est enregistrée avec sa date et sa version ; elle figure dans l'export de tes données.",
    ],
  },
  // Un usage nouveau de l'identifiant Discord (ou du tag certifié) : prévenir la
  // gestion d'une équipe qu'un joueur demande à la rejoindre.
  {
    id: "2026-09-demande-adhesion-discord",
    publishedAt: "2026-09-28",
    title: "Demandes pour rejoindre ton équipe annoncées sur Discord",
    summary: "Si tu gères une équipe, le bot te prévient en message privé quand un joueur demande à la rejoindre.",
    details: [
      "Le propriétaire et les managers d'une équipe reçoivent un message privé Discord à chaque demande d'adhésion, s'ils ont rattaché leur compte Discord ou certifié leur tag. Les autres membres ne reçoivent rien.",
      `Le message ne nomme pas le joueur : il renvoie à la fiche de l'équipe, où la demande s'accepte ou se refuse. Une même personne ne fait écrire le bot à une même équipe qu'une fois toutes les ${TEAM_JOIN_REQUEST_NOTICE_COOLDOWN_HOURS} heures.`,
    ],
  },  // Un traitement nouveau : l'abonnement d'un appareil aux notifications push,
  // et les sujets qu'un compte coupe. Durée lue sur la constante du code.
  {
    id: "2026-09-notifications-push",
    publishedAt: "2026-09-29",
    title: "Notifications push, si tu les actives",
    summary:
      "Tu peux être prévenu sur ton téléphone ou ton ordinateur du départ de tes matchs et de ce qui te concerne sur le site. Rien ne part sans ton accord.",
    details: [
      "Les notifications ne s'activent que sur ton geste, appareil par appareil, depuis « Mon profil » ; tu choisis les sujets, et tu les désactives quand tu veux.",
      "Le site garde l'adresse d'abonnement que ton navigateur lui donne et ses clés de chiffrement. Le message passe par le service de push de ton navigateur (Google, Mozilla, Apple ou Microsoft), chiffré pour ton seul appareil : ce service ne peut pas le lire.",
      `Un abonnement est effacé à sa désactivation, quand ton navigateur le révoque, avec ton compte, ou au bout de ${PUSH_SUBSCRIPTION_RETENTION_DAYS} jours sans notification remise. Aucune notification ne porte le pseudo d'un joueur.`,
    ],
  },
  // Une durée de conservation raccourcie : le détail de la mesure d'audience,
  // gardé jusqu'ici sans limite, est effacé après report en compteurs.
  {
    id: "2026-09-mesure-audience-duree",
    publishedAt: "2026-09-30",
    title: `Fréquentation du site : le détail des visites gardé ${SITE_VISIT_DETAIL_RETENTION_DAYS} jours`,
    summary: `Le détail des visites du site (page vue, date) est désormais effacé au bout de ${SITE_VISIT_DETAIL_RETENTION_DAYS} jours.`,
    details: [
      `Chaque visite gardait jusqu'ici, sans limite de durée, une empreinte salée du visiteur, la page vue et la date. Ce détail est maintenant effacé au bout de ${SITE_VISIT_DETAIL_RETENTION_DAYS} jours, après avoir été reporté dans un compteur par jour qui ne garde que le nombre de visites.`,
      "Pour compter les visiteurs uniques depuis la mise en service, le site garde une seule empreinte par visiteur, sans page ni date, avec la seule mention « connecté ou non ». Sans le secret du serveur, elle ne se rattache à personne ; l'association, qui le détient, peut la recalculer. Ni ton adresse IP ni ton compte ne sont enregistrés tels quels.",
    ],
  },
  // La connexion par Discord ne certifie plus le tag : l'exposition à
  // l'organisation ne naît plus que d'un geste distinct. Les certifications
  // déjà acquises à la connexion sont **gardées** — les défaire en silence
  // fermerait des inscriptions et couperait l'arbitrage en plein tournoi —,
  // et cette entrée est ce qui les signale à leur titulaire, avec le geste qui
  // les retire.
  {
    id: "2026-09-certification-discord-volontaire",
    publishedAt: "2026-09-30",
    title: "Tag Discord : la certification n'est plus automatique",
    summary:
      "Se connecter par Discord n'ouvre plus ton tag à l'organisation : tu le certifies toi-même, d'un clic, depuis ton profil.",
    details: [
      "Jusqu'ici, te connecter par Discord (bouton ou code en message privé) certifiait ton tag Discord, donc le rendait lisible des administrateurs, des arbitres pendant tes tournois, et des joueurs et du caster de tes matchs. Désormais, la connexion enregistre seulement ton pseudo Discord, invisible de tous ; c'est le bouton « Certifier mon tag » de « Mon profil » qui l'ouvre à l'organisation.",
      "Si ton tag a été certifié automatiquement, il le reste : l'organisation peut toujours te joindre pendant un tournoi. Pour retirer cette exposition, retire ton tag dans « Mon profil » : ta prochaine connexion par Discord le réenregistrera sans le certifier.",
      "Le pseudo, les identifiants de connexion et le compte reposent sur l'exécution du service que tu demandes, et non plus sur un consentement : la politique de confidentialité le précise. L'invite Google One Tap de la page de connexion ne s'affiche plus que si tu la demandes, par une case décochée par défaut.",
    ],
  },
  // L'invite Google One Tap est retirée : plus aucune page ne fait appel à
  // Google dans le navigateur. La même mise à jour nomme enfin, sur `/rgpd`,
  // les destinataires et les transferts hors UE qui existaient déjà.
  {
    id: "2026-10-retrait-google-one-tap",
    // Mergé le 2026-09-29 après-midi (#278), comme les deux entrées
    // précédentes (#272, mesure d'audience), et mis en ligne ensuite : daté,
    // comme elles, du **lendemain**. Un compte né le 29 avant le déploiement
    // s'est inscrit sous l'ancienne politique — dater du 29 le priverait pour
    // toujours de ces changements (dont la certification automatique de son
    // tag) ; dater du 30 ne montre au pire qu'un changement déjà en vigueur.
    // Octobre n'avait pas de raison d'être. L'identifiant, déjà publié, garde
    // son « 2026-10 ».
    publishedAt: "2026-09-30",
    title: "Plus d'invite Google, destinataires nommés",
    summary:
      "L'invite « Continuer avec Google » de la page de connexion est retirée : aucune page du site ne fait plus appel à Google dans ton navigateur. La politique de confidentialité nomme désormais chaque destinataire de tes données et les transferts hors de l'Union.",
    details: [
      "La case « Google One Tap » disparaît. Le cookie « g_state » que Google pouvait déposer n'est plus posé, et celui qui resterait est effacé à ta prochaine visite du site. Se connecter par Google passe toujours par le bouton de la page de connexion.",
      "Le site et le bot sont hébergés en France (à Caen). Une nouvelle section « Destinataires et transferts » de la politique de confidentialité dit ce qui part chez Discord, Google, Blizzard, le service de push de ton navigateur et Microsoft (sauvegardes chiffrées), et sur quel fondement un transfert vers les États-Unis repose.",
      "Rien ne change pour ton compte : les moyens de connexion (hors l'invite) et les données conservées restent les mêmes.",
    ],
  },  // Le reliquat de la connexion Google sans nom réel (#269) : la règle vaut
  // depuis le 30 septembre 2026, et les comptes créés avant gardent le pseudo
  // et la photo que Google leur a donnés. Décision : **rien n'est modifié
  // d'office** — ni renommage, ni masquage —, le titulaire est informé une
  // fois et invité à les changer. Ciblée sur les comptes qui portent une
  // identité Google (`GOOGLE_LINKED`) : le site ne sait pas par quelle porte
  // un compte est né, d'où le conditionnel. La date est celle de la règle, pas
  // celle du déploiement de cette entrée : c'est elle qui sépare les comptes
  // concernés des autres (`publishedAt` borne la création).
  {
    id: "2026-09-comptes-google-anterieurs",
    publishedAt: "2026-09-30",
    audience: "GOOGLE_LINKED",
    title: "Ton pseudo et ta photo ont pu venir de Google",
    summary:
      "Ton compte, créé avant le 30 septembre 2026, est relié à Google : son pseudo et sa photo ont pu venir de ton profil Google. Rien n'a été changé à ta place : vérifie-les dans « Mon profil ».",
    details: [
      "Jusqu'au 30 septembre 2026, un compte créé par une connexion Google recevait pour pseudo le nom de ce compte Google, souvent un prénom et un nom réels, et sa photo Google était copiée sur le site et affichée aux autres membres. Depuis, un compte créé par Google reçoit un pseudo neutre, et la photo importée reste masquée tant que tu ne choisis pas de l'afficher.",
      "Rien n'a été modifié sur ton compte. Si ton pseudo est ton nom réel, remplace-le. Si ta photo vient de Google et que tu ne veux pas la montrer, change-la, supprime-la, ou décoche « Avatar » dans la section « Confidentialité » pour la masquer.",
      "Si ton compte a été créé autrement (Discord, Blizzard) ou si tu as déjà changé ton pseudo et ta photo, tu n'as rien à faire.",
    ],
    links: [
      { href: "/profil#identite", label: "Changer mon pseudo ou mon avatar" },
      { href: "/profil#confidentialite", label: "Masquer mon avatar" },
    ],
  },
  // La base légale des signalements change pour cinq catégories : une
  // demande RGPD, une notification de droit d'auteur ou de modération, une
  // demande à l'hébergeur et une contestation reposent sur l'obligation légale, plus sur
  // un consentement qui n'était pas libre — le droit de le retirer disparaît
  // donc pour elles, et une adresse devient exigée d'un compte sans Discord
  // prouvé (RGPD, hébergeur). Daté du lendemain du déploiement, comme les
  // entrées précédentes : un compte né le jour même, avant la mise en ligne,
  // s'est inscrit sous l'ancienne politique.
  {
    id: "2026-10-signalements-base-legale",
    publishedAt: "2026-10-01",
    title: "Signalements : plus de case d'accord pour exercer un droit",
    summary:
      "Une demande RGPD, un signalement de droit d'auteur, un contenu signalé en modération, une demande à l'hébergeur ou une contestation n'exigent plus de cocher une case d'accord : l'association est tenue de les traiter. Pour les autres signalements, rien ne change.",
    details: [
      "Ces catégories reposent désormais sur l'obligation légale de l'association (RGPD, art. 12 ; règlement européen sur les services numériques, art. 11, 16 et 20), et non plus sur ton consentement : il n'y a donc plus de consentement à retirer pour elles, mais ta demande est toujours traitée. Tu gardes tes droits d'accès et de rectification ; l'effacement attend que la demande soit traitée, l'association étant tenue de la traiter (RGPD, art. 17.3.b).",
      "Une demande RGPD, une demande à l'hébergeur ou une contestation demande une adresse électronique si ton tag Discord n'est pas certifié : le site n'envoie aucun courriel, et sans elle l'association ne pourrait pas te répondre.",
      "L'auteur d'un signalement de droit d'auteur reçoit un accusé de réception, puis la décision prise et les voies de recours, à l'adresse qu'il indique.",
    ],
    links: [{ href: "/rgpd#signalements", label: "Lire la section « Signalements »" }],
  },
  // L'auteur d'un signalement de contenu peut contester la décision prise (DSA
  // art. 20.1) : son signalement est donc gardé le temps de ce délai, au lieu
  // de trente jours après l'archivage — une durée de conservation qui change.
  {
    id: "2026-10-signalements-contestation-auteur",
    publishedAt: "2026-10-01",
    title: "Signalements : l'auteur peut contester la décision",
    summary: `Si tu signales un contenu (droit d'auteur, modération) depuis ton compte, tu peux désormais contester la décision prise, y compris celle de ne pas agir. Ton signalement est gardé ${LOGO_QUARANTINE_MONTHS} mois après sa résolution, au lieu de 30 jours, le temps de ce délai.`,
    details: [
      "La contestation se fait par la catégorie « Contestation » du formulaire « Signaler un problème », une fois le signalement archivé. Elle est lue par les administrateurs de l'association ; les personnes visées n'en sont pas informées.",
      `Un signalement de bug, une demande RGPD ou à l'hébergeur, ou un signalement envoyé sans compte, est toujours effacé ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après son archivage — plus tard si un logo ou un avatar a été masqué ou supprimé à sa suite.`,
    ],
    links: [{ href: "/rgpd#signalements", label: "Lire la section « Signalements »" }],
  },
  // Ce qu'une suppression emporte change : l'anonymisation effaçait le détail
  // des acceptations des conditions d'utilisation mais gardait, sans limite,
  // la dernière version acceptée et sa date sur le compte anonymisé.
  {
    id: "2026-10-anonymisation-conditions",
    publishedAt: "2026-10-01",
    title: "Suppression du compte : l'acceptation des conditions part aussi",
    summary:
      "Quand un compte supprimé est gardé sous un pseudo d'emprunt (parce qu'il a joué des matchs), la dernière version des conditions d'utilisation qu'il avait acceptée et sa date sont désormais effacées, comme le détail de ses acceptations l'était déjà.",
    details: [
      "Rien ne change tant que ton compte existe : l'acceptation des conditions reste conservée pour la durée du compte.",
    ],
  },
  // Une collecte nouvelle, et une durée qui survit à la suppression du compte :
  // l'adresse IP de chaque connexion, gardée un an au titre de l'obligation
  // légale de l'hébergeur (LCEN art. 6) — le registre disait « jamais écrite ».
  {
    id: "2026-10-journal-connexions",
    publishedAt: "2026-10-01",
    title: `Connexions : adresse IP gardée ${CONNECTION_LOG_RETENTION_DAYS} jours`,
    summary: `À chaque connexion, le site note désormais ton adresse IP, la date et l'heure, et le moyen de connexion utilisé. Ces données sont gardées ${CONNECTION_LOG_RETENTION_DAYS} jours (un an), même si tu supprimes ton compte : la loi l'impose à l'association, qui héberge les contenus publiés par ses membres.`,
    details: [
      "Elles ne servent à rien d'autre : aucun écran du site ne les affiche, et elles ne sont communiquées qu'à une autorité judiciaire qui les requiert (loi pour la confiance dans l'économie numérique, art. 6).",
      "Tu les retrouves dans l'export de tes données, depuis « Mon profil », tant que ton compte existe.",
    ],
    links: [{ href: "/rgpd#donnees-connexion", label: "Lire la politique de confidentialité" }],
  },
  // Entrée **d'information** : aucun traitement ne change. Trois annonces
  // publiées disaient inexactement un traitement resté le même — les
  // sauvegardes (`2026-09-sauvegardes-chiffrees` : détenteur de la clé, portée
  // du rejeu), la lecture du tag certifié par l'arbitrage
  // (`2026-09-recapitulatif-rgpd` : « tournoi en cours » là où
  // `isInActiveTournament` dit « non terminé ») et l'empreinte de mesure
  // d'audience (pseudonymisée, pas anonyme). Une entrée publiée ne se réécrit
  // pas : ses lecteurs ne la reverraient jamais. Regroupées ici pour ne
  // présenter qu'une modale.
  {
    id: "2026-10-rectificatifs-information",
    publishedAt: "2026-10-01",
    title: "Trois précisions sur nos annonces précédentes",
    summary:
      "Trois informations données dans nos annonces précédentes étaient inexactes : les voici corrigées. Rien ne change dans le traitement de tes données.",
    details: [
      `Sauvegardes : la clé de chiffrement n'est pas détenue par « l'association » en général, mais par le seul responsable technique de l'association, qui est aussi l'hébergeur du site ; elle n'est jamais transmise à Microsoft. Et si une sauvegarde devait être restaurée, seules les suppressions de compte intervenues depuis sont réappliquées : un autre effacement postérieur à l'archive (tag ou BattleTag retiré, moyen de connexion détaché, réglage de visibilité modifié…) reviendrait avec elle (une archive est gardée ${BACKUP_RETENTION_DAYS} jours au plus).`,
      "Tag Discord certifié : les arbitres peuvent le lire dès que tu es engagé (seul ou avec ton équipe) dans un tournoi qui n'est pas terminé — y compris pendant les inscriptions —, et non seulement pendant un tournoi en cours.",
      "Mesure d'audience : l'empreinte enregistrée à chaque visite est une donnée pseudonymisée, pas anonyme. Sans le secret du serveur, elle ne se rattache à personne ; mais l'association, qui le détient, peut recalculer l'empreinte d'un compte, ou d'une adresse IP associée à un navigateur, et retrouver les visites correspondantes.",
    ],
    links: [
      { href: "/rgpd#audience", label: "Lire la section « Mesure d'audience »" },
      { href: "/rgpd#destinataires", label: "Lire la section « Destinataires et transferts »" },
    ],
  },
  // Le traitement T06 change : un droit d'opposition appliqué par le site
  // (GPC, DNT, bouton) et une durée de conservation des empreintes, jusque-là
  // illimitée. Entrée distincte de la précédente — qui annonce « rien ne
  // change dans le traitement » — mais datée du même jour, pour paraître dans
  // la même modale.
  {
    id: "2026-10-mesure-audience-opposition",
    publishedAt: "2026-10-01",
    title: "Mesure d'audience : opposition et durée limitée",
    summary: `Tu peux désormais t'opposer à la mesure d'audience depuis la page RGPD, et le site respecte les signaux Global Privacy Control et Do Not Track de ton navigateur : une visite refusée n'est pas enregistrée (le serveur relit ces signaux lui-même). L'empreinte gardée pour compter les visiteurs uniques est effacée ${SITE_VISITOR_RETENTION_MONTHS} mois après ta dernière visite, au lieu d'être gardée sans limite.`,
    details: [
      "Ton choix est retenu dans ton navigateur par un cookie qui ne contient que la valeur « 1 », jamais d'identifiant ; il se défait par le même bouton. Un signal du navigateur se règle, lui, dans le navigateur.",
      `Les empreintes enregistrées avant ce changement sont datées de sa mise en place : leur dernière visite n'avait pas été conservée. Le détail des visites reste effacé au bout de ${SITE_VISIT_DETAIL_RETENTION_DAYS} jours, comme avant.`,
    ],
    links: [{ href: "/rgpd#audience", label: "Lire la section « Mesure d'audience »" }],
  },
  // Une personne est désormais chargée des demandes relatives aux données :
  // l'hébergeur technique du site, là où la politique disait qu'aucune n'était
  // désignée. Le moyen d'exercer ses droits change, et avec lui un
  // destinataire : un courriel arrive dans une messagerie hébergée par
  // Microsoft (registre, T11) — c'est une information due à chaque compte. Entrée à part plutôt que
  // quatrième point de `2026-10-rectificatifs-information`, qui annonce des
  // corrections d'annonces passées : même date, donc même modale. Le message
  // privé, lui, peut la reporter au suivant si les entrées du jour dépassent
  // ensemble `PRIVACY_DM_MAX_LENGTH` (`privacyChangesForOneMessage`) — c'est
  // la règle commune de la file, pas une exception à celle-ci. Le résumé, seul
  // champ repris dans le message privé Discord, ne nomme personne
  // (`lib/shared/log-privacy.ts`) : le nom ne figure que dans le détail,
  // affiché par la modale du site.
  {
    id: "2026-10-contact-donnees",
    publishedAt: "2026-10-01",
    title: "Une personne à contacter pour tes données",
    summary: `Pour exercer tes droits sur tes données ou poser une question à leur sujet, tu peux maintenant t'adresser directement à la personne que l'association a chargée de ces demandes, l'${DATA_CONTACT_ROLE}, par courriel ou par téléphone. Le formulaire du site reste ouvert.`,
    details: [
      `Cette personne est ${DATA_CONTACT_NAME}. Ses coordonnées se lisent dans la politique de confidentialité et les mentions légales du site. Le formulaire « ${REPORT_FORM_NAME} », catégorie RGPD, et les coordonnées de l'association restent ouverts.`,
      `Un courriel que tu lui envoies, et la réponse qu'il t'adresse par courriel, passent par sa messagerie personnelle, hébergée par Microsoft (Outlook.com, possibles transferts vers les États-Unis), qui peut les lire ; un appel, un SMS ou un message vocal passe par son opérateur téléphonique. Ta demande et la réponse — courriel, SMS, message vocal ou trace d'appel — sont gardées le temps de la traiter, puis ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après sa clôture, comme une demande RGPD faite depuis le formulaire.`,
      "Ce n'est pas un délégué à la protection des données au sens du RGPD : l'association reste responsable du traitement de tes données et de la réponse à tes demandes.",
    ],
    links: [{ href: "/rgpd#exercer-vos-droits", label: "Lire la section « Exercer vos droits »" }],
  },
  // Un traitement nouveau : la suspension d'un compte, qui garde une décision
  // (faits retenus, clause, dates) sur le compte visé. Et une base légale
  // désormais dite pour toute la modération des contenus contraires aux
  // règles — l'intérêt légitime, contre lequel s'exerce le droit d'opposition.
  // Le résumé, repris en message privé Discord, ne nomme personne.
  {
    id: "2026-10-suspension-comptes",
    publishedAt: "2026-10-01",
    title: "Suspension d'un compte par la modération",
    summary: `La modération peut désormais suspendre un compte contraire aux conditions d'utilisation : ses sessions sont fermées et la connexion refusée tant que la suspension court. La décision (faits retenus, clause invoquée, dates) est gardée le temps de la suspension, puis ${SUSPENSION_RETENTION_MONTHS} mois pour pouvoir la contester.`,
    details: [
      "Le titulaire reçoit la décision et ses motifs en message privé Discord si son compte y est rattaché, et à chaque tentative de connexion pendant la suspension. Il la conteste sans se connecter, par « Signaler un problème » (catégorie « Autre »), puis, le cas échéant, devant le juge.",
      "La modération des contenus et des comptes contraires aux conditions d'utilisation — masquage ou retrait d'une image, suspension — repose sur l'intérêt légitime de l'association à faire respecter ses règles. Une image retirée hors de tout signalement l'est désormais sur un motif écrit, envoyé avec la décision.",
      "Une suspension figure dans l'export de tes données, et disparaît avec ton compte ou à son anonymisation.",
    ],
    links: [{ href: "/rgpd#signalements", label: "Lire la section « Signalements »" }],
  },
  // Le registre couvre désormais ce que l'association faisait déjà sans le
  // déclarer : portail de support, retransmission des matchs, journaux du
  // serveur web, courriel Gmail de l'association (Google, destinataire jamais
  // nommé) ; et l'âge minimum, annoncé sur `/rgpd` sans entrée jusqu'ici.
  // Mêmes date et modale que les entrées du 1er octobre, pas encore publiées
  // au moment de l'écrire. Le résumé, repris en message privé Discord, reste
  // court et ne nomme personne.
  {
    id: "2026-10-registre-complete",
    publishedAt: "2026-10-01",
    title: "Support, retransmissions et courriel de l'association",
    summary:
      "La politique de confidentialité décrit désormais le portail de support, la retransmission des matchs, les journaux techniques du serveur web et le courriel de l'association. Elle précise aussi l'âge minimum pour créer un compte.",
    details: [
      `Portail de support (Spiceworks) : un ticket y est gardé le temps de son traitement, puis ${SUPPORT_TICKET_RETENTION_MONTHS} mois après sa clôture.`,
      "Retransmission des matchs (YouTube, Twitch ou Kick) : ton pseudo et le nom de ton équipe peuvent apparaître à l'écran, et le lien de la rediffusion reste avec le match. Tu peux t'y opposer par « Signaler un problème », catégorie RGPD.",
      `Serveur web : chaque requête (${WEB_ACCESS_LOG_FIELDS}) est notée dans un journal technique gardé ${WEB_ACCESS_LOG_RETENTION_DAYS} jours au plus, pour la sécurité du site.`,
      `Courriel de l'association : c'est une messagerie Gmail, que Google héberge et peut lire (possibles transferts vers les États-Unis). Une demande reçue par ce courriel ou par le téléphone de l'association est gardée le temps de la traiter, puis ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après sa clôture.`,
      `Âge minimum : il faut avoir au moins ${SITE_MINIMUM_AGE} ans pour créer un compte. Le site ne demande pas de date de naissance et ne vérifie pas l'âge.`,
      `Données de connexion : le journal légal des connexions ne note que les ouvertures de session (sans port source), et les informations fournies à la création de ton compte partent avec lui (hors les copies de sauvegarde chiffrées, effacées au bout de ${BACKUP_RETENTION_DAYS} jours, et la mention de ta suppression au journal qui la rejoue après une restauration, gardée ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} jours ; le reste de ce qui subsiste est détaillé au registre).`,
    ],
    links: [
      { href: "/rgpd#destinataires", label: "Lire la section « Destinataires et transferts »" },
      { href: "/rgpd#age-minimum", label: "Lire le paragraphe « Âge minimum »" },
    ],
  },
  // Changement de sous-traitant et de lieu : les sauvegardes quittent le
  // OneDrive personnel de l'hébergeur (lieu non garanti, transfert possible
  // vers les États-Unis) pour Hetzner, en Allemagne, le 1er octobre 2026 en
  // production. Daté du lendemain de la mise en ligne de cette entrée, comme
  // les précédentes. Les précisions du même lot (Spiceworks sous-traitant,
  // retransmission sans transfert par le site) y sont jointes.
  {
    id: "2026-10-sauvegardes-hetzner",
    publishedAt: "2026-10-02",
    title: "Sauvegardes hébergées en Allemagne",
    summary:
      "Depuis le 1er octobre 2026, les sauvegardes chiffrées du site et du bot sont envoyées chez Hetzner, en Allemagne, et non plus chez Microsoft (OneDrive) : elles restent dans l'Union européenne.",
    details: [
      "Hetzner Online GmbH stocke les copies de sauvegarde dans l'Union européenne, comme sous-traitant, et ne peut pas les lire : elles sont chiffrées avant envoi, avec des clés que seul l'hébergeur du site détient. Les durées de conservation ne changent pas.",
      "Microsoft ne reçoit plus de nouvelle sauvegarde. Il reste destinataire de la messagerie de la personne à contacter pour tes demandes relatives à tes données.",
      "Portail de support : Spiceworks y agit comme sous-traitant de l'association, et ses transferts vers les États-Unis reposent sur le Data Privacy Framework.",
      "Retransmission des matchs : seuls ton pseudo, le nom de ton équipe et tes résultats en jeu apparaissent, jamais de webcam ni de chat vocal ; le site ne transmet rien aux plateformes de diffusion. Tu peux t'y opposer et apparaître sous un nom neutre.",
    ],
    links: [
      { href: "/rgpd#destinataires", label: "Lire la section « Destinataires et transferts »" },
      { href: "/rgpd#retransmission", label: "Lire le paragraphe « Retransmission des matchs »" },
    ],
  },
  // Durées nouvelles côté bot (blueGenjiBot, ménage de nuit) : fil d'activité,
  // journal privé du staff, messages d'une exclusion levée, copie laissée par
  // une restauration, désormais faite sans passer par Discord. Daté du
  // lendemain de la mise en ligne, comme les précédentes.
  {
    id: "2026-10-bot-durees-journaux",
    publishedAt: "2026-10-02",
    title: "Bot Discord : journaux et fil d'activité limités dans le temps",
    summary:
      "Le bot Discord BlueGenji efface désormais son fil d'activité et son journal du staff au bout d'une durée fixe, et les messages d'une exclusion dès qu'elle est levée.",
    details: [
      `Fil d'activité public de la page du bot (heure, serveur, niveau ou rôle de chaque annonce) : ${BOT_FEED_EVENT_RETENTION_DAYS} jours, puis supprimé.`,
      `Journal privé du staff, et messages privés du bot à son titulaire : un an (${BOT_STAFF_LOG_RETENTION_DAYS} jours), puis supprimés.`,
      "Exclusion du relais : son avis et son motif sont supprimés, du journal comme des messages privés, dès qu'elle est levée.",
      "Commandes /scrim et /recrute : le niveau et le rôle se choisissent maintenant dans une liste, plus de texte libre.",
      `Restauration d'une sauvegarde du bot : elle se fait sur la machine du bot, la base ne transite plus par Discord ; la copie de la base précédente est supprimée au plus tard après ${BACKUP_RETENTION_DAYS} jours.`,
    ],
    links: [{ href: "/privacy-policy-bot", label: "Lire la politique de confidentialité du bot" }],
  },
];

/** Fuseau des dates de publication : celui de l'association. */
export const PRIVACY_CHANGE_TIME_ZONE = "Europe/Paris";

const PARIS_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: PRIVACY_CHANGE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Le jour de Paris à l'instant `now`, `AAAA-MM-JJ` — celui auquel se comparent
 * les dates de publication. Pas le jour UTC : entre minuit et deux heures, ce
 * serait encore la veille, et un changement publié « aujourd'hui » attendrait.
 */
export function privacyChangeDay(now: Date): string {
  const parts = Object.fromEntries(PARIS_DAY.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Les changements déjà publiés le jour `today` (`publishedAt <= today`), dans
 * l'ordre du registre. Une entrée datée du lendemain n'existe pas encore pour
 * les joueurs : ni modale, ni message Discord, ni date de mise à jour de
 * `/rgpd`, ni prise de connaissance enregistrée par la route.
 */
export function publishedPrivacyChanges(
  today: string,
  changes: readonly PrivacyChange[] = PRIVACY_CHANGES,
): PrivacyChange[] {
  return changes.filter((change) => change.publishedAt <= today);
}

/**
 * Les changements publiés dont un compte n'a pas encore pris connaissance, dans
 * l'ordre du registre.
 *
 * Un changement publié **avant** la création du compte le concerne ; publié le
 * jour même ou après, non — le compte s'est inscrit sous la politique déjà à
 * jour. Un changement pas encore publié (après `today`) ne concerne personne.
 * La comparaison se fait sur le **jour** (`AAAA-MM-JJ`, donc en chaînes) :
 * `created_at` arrive de MySQL en `dateStrings`, au fuseau du serveur de base
 * (hébergé en France, donc le jour de Paris ; aucun fuseau n'est posé sur le
 * pool). Sur une base en UTC, un compte né entre minuit et deux heures (Paris)
 * serait daté de la veille et verrait un changement du jour même — un
 * changement déjà en vigueur, donc sans dommage ; l'erreur inverse, taire un
 * changement dû, est impossible par ce biais.
 *
 * @param accountCreatedAt `created_at` du compte (`AAAA-MM-JJ HH:MM:SS` ou ISO),
 *   `null` si inconnu — auquel cas tout ce qui n'est pas acquitté est dû.
 * @param acknowledged Identifiants déjà acquittés par ce compte.
 * @param today Jour de Paris (`privacyChangeDay`).
 * @param facts Ce qu'on sait du compte, pour les entrées ciblées (`audience`).
 */
export function pendingPrivacyChanges(
  accountCreatedAt: string | null,
  acknowledged: Iterable<string>,
  today: string,
  changes: readonly PrivacyChange[] = PRIVACY_CHANGES,
  facts: PrivacyAccountFacts = {},
): PrivacyChange[] {
  const done = new Set(acknowledged);
  const createdDay = accountCreatedAt ? accountCreatedAt.slice(0, 10) : null;
  return publishedPrivacyChanges(today, changes).filter(
    (change) =>
      !done.has(change.id) &&
      (createdDay === null || createdDay < change.publishedAt) &&
      privacyChangeReachesAccount(change, facts),
  );
}

/** Refus d'une demande de prise de connaissance mal formée. */
export const INVALID_PRIVACY_CHANGES = "INVALID_PRIVACY_CHANGES";
/**
 * Refus d'une prise de connaissance qui nomme un changement absent du registre,
 * ou pas encore publié — qu'aucune modale n'a donc pu montrer.
 */
export const UNKNOWN_PRIVACY_CHANGE = "UNKNOWN_PRIVACY_CHANGE";

export type PrivacyAcknowledgementCheck =
  | { ok: true; ids: string[] }
  | { ok: false; error: typeof INVALID_PRIVACY_CHANGES | typeof UNKNOWN_PRIVACY_CHANGE };

/**
 * Valide les identifiants envoyés à la prise de connaissance.
 *
 * L'écran envoie **ce qu'il a montré**, jamais « tout ce qui est dû » : un
 * changement publié entre l'affichage de la modale et le clic ne doit pas être
 * acquitté par un joueur qui ne l'a pas lu. Le serveur se contente donc de
 * vérifier que chaque identifiant est publié — un identifiant inconnu ou daté
 * du futur est refusé plutôt qu'ignoré, sans quoi une faute de frappe côté
 * client enregistrerait un acquittement partiel en répondant « c'est fait ».
 *
 * @param today Jour de Paris (`privacyChangeDay`).
 */
export function checkPrivacyAcknowledgement(
  requested: unknown,
  today: string,
  changes: readonly PrivacyChange[] = PRIVACY_CHANGES,
): PrivacyAcknowledgementCheck {
  if (!Array.isArray(requested) || requested.length === 0 || requested.length > changes.length) {
    return { ok: false, error: INVALID_PRIVACY_CHANGES };
  }
  if (!requested.every((id): id is string => typeof id === "string")) {
    return { ok: false, error: INVALID_PRIVACY_CHANGES };
  }
  const known = new Set(publishedPrivacyChanges(today, changes).map((change) => change.id));
  if (!requested.every((id) => known.has(id))) {
    return { ok: false, error: UNKNOWN_PRIVACY_CHANGE };
  }
  return { ok: true, ids: [...new Set(requested)] };
}

const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

/** `2026-09-23` → `23 septembre 2026`. Écrit à la main : aucun fuseau n'entre en jeu. */
export function formatPrivacyChangeDate(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return `${date} ${MONTHS[month - 1]} ${year}`;
}

/**
 * Le mois de la dernière mise à jour de la politique, pour `/rgpd`
 * (« septembre 2026 ») — dérivé du registre, pour que la page ne puisse plus
 * annoncer une date antérieure au dernier changement présenté aux joueurs — ni
 * postérieure au jour où on la lit.
 *
 * @param today Jour de Paris (`privacyChangeDay`).
 */
export function privacyPolicyUpdatedLabel(
  today: string,
  changes: readonly PrivacyChange[] = PRIVACY_CHANGES,
): string | null {
  const last = publishedPrivacyChanges(today, changes).at(-1);
  if (!last) return null;
  const [year, month] = last.publishedAt.split("-").map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

/** Titre de la modale, qui compte les changements. */
export function privacyChangesHeading(count: number): string {
  return count <= 1
    ? "Nos règles de confidentialité ont changé"
    : `${count} changements de nos règles de confidentialité`;
}

/** Plafond d'un message privé côté bot (`MAX_MESSAGE_LENGTH`, `blueGenjiBot/src/notifications`). */
export const PRIVACY_DM_MAX_LENGTH = 1800;

/**
 * Le message privé Discord qui annonce des changements.
 *
 * Un **résumé**, pas le texte complet : le détail vit sur le site, où le
 * joueur est connecté. Aucun accord n'est demandé, ni ici ni là-bas. Le
 * message nomme chaque changement par son titre et son résumé, puis dit où
 * décider. Borné sous le plafond du bot : au-delà, les derniers changements
 * sont comptés plutôt que coupés au milieu d'une phrase.
 *
 * @param siteUrl Adresse absolue du site, `null` si elle n'est pas configurée.
 */
export function buildPrivacyChangesMessage(
  changes: readonly PrivacyChange[],
  siteUrl: string | null,
): string {
  return layoutPrivacyChangesMessage(changes, siteUrl).text;
}

/**
 * Le message **et** le nombre de changements qu'il nomme, sortis de la même
 * mise en page : `privacyChangesForOneMessage` décide sur ce nombre, jamais en
 * cherchant un titre dans le texte, qui dépendrait du format de ligne.
 */
function layoutPrivacyChangesMessage(
  changes: readonly PrivacyChange[],
  siteUrl: string | null,
): { text: string; named: number } {
  const header =
    changes.length > 1
      ? `🔐 **BlueGenji — ${changes.length} changements de nos règles de confidentialité**`
      : "🔐 **BlueGenji — nos règles de confidentialité ont changé**";
  const where = siteUrl ? ` sur ${siteUrl}` : " sur le site";
  const footer =
    `Le détail t'attend à ta prochaine visite${where}. Aucun accord ne t'est demandé : ` +
    "la politique de confidentialité dit comment t'opposer à un traitement ou exercer tes autres droits. Politique complète : " +
    (siteUrl ? `${siteUrl.replace(/\/$/, "")}/rgpd` : "page « RGPD » du site") +
    ".";

  const omittedLine = (count: number) => `• … et ${count} autre(s) changement(s).`;
  const assemble = (lines: string[], omitted: number) =>
    [header, ...lines, ...(omitted > 0 ? [omittedLine(omitted)] : []), footer].join("\n\n");

  // Chaque changement n'est gardé que si le message **complet** — y compris la
  // mention de ceux qui ne tiendraient plus après lui — reste sous le plafond.
  const lines: string[] = [];
  for (const [index, change] of changes.entries()) {
    const line = `• **${change.title}** (${formatPrivacyChangeDate(change.publishedAt)}) — ${change.summary}`;
    if (assemble([...lines, line], changes.length - index - 1).length > PRIVACY_DM_MAX_LENGTH) {
      return { text: assemble(lines, changes.length - index), named: lines.length };
    }
    lines.push(line);
  }
  return { text: assemble(lines, 0), named: lines.length };
}

/**
 * Les changements qu'**un** message privé peut nommer tous, dans l'ordre.
 *
 * Le registre entier ne tient plus sous le plafond du bot, et le repli de
 * `buildPrivacyChangesMessage` — compter ce qui ne tient pas — convient à un
 * aperçu, pas à l'envoi : le balayage réserve chaque changement **avant**
 * l'envoi, si bien qu'un changement seulement compté était marqué annoncé sans
 * que son titre ait jamais été écrit. Et c'est toujours le **plus récent** qui
 * tombait ainsi. Le balayage n'envoie donc que ce lot, et le reste part au
 * suivant.
 *
 * Toujours au moins un changement quand il y en a : une entrée seule tient dans
 * un message (le registre le vérifie).
 */
export function privacyChangesForOneMessage(
  changes: readonly PrivacyChange[],
  siteUrl: string | null,
): PrivacyChange[] {
  // Le lot se cherche en retirant par la fin : l'en-tête et le pied dépendent
  // du nombre de changements, un lot plus court n'est pas seulement un préfixe
  // du message plus long.
  for (let count = changes.length; count > 1; count -= 1) {
    const batch = changes.slice(0, count);
    if (layoutPrivacyChangesMessage(batch, siteUrl).named === count) return batch;
  }
  return changes.slice(0, 1);
}

/**
 * Au-delà de cette ancienneté, un changement ne s'annonce plus sur Discord.
 *
 * Le message privé n'est qu'un relais : la modale présente le changement sur
 * le site, sans limite de temps. Un compte qui rattache Discord un an après un
 * changement n'a pas à recevoir une nouvelle vieille d'un an ; et la borne
 * garde la requête de balayage courte, le registre ne faisant que grandir.
 */
export const PRIVACY_DM_WINDOW_DAYS = 60;

/**
 * Délai laissé à la modale avant d'écrire sur Discord.
 *
 * Discord est le seul canal de l'association : un message de plus sur la
 * confidentialité à chaque déploiement apprend aux joueurs à rendre le bot
 * muet, et le jour où il annonce un match, personne ne le lit plus. Or la
 * modale informe déjà tout joueur qui revient sur le site — le message privé
 * ne sert qu'à celui qui ne revient pas. On lui laisse donc une semaine : un
 * joueur actif lit la modale et ne reçoit **rien**, et les changements
 * publiés en rafale pendant ce délai partent dans **un** message.
 */
export const PRIVACY_DM_SETTLE_DAYS = 7;

/**
 * Intervalle minimal entre deux messages de confidentialité à un même compte.
 *
 * Un changement publié le lendemain d'un message attend le suivant, au plus un
 * mois, et s'y ajoute ; la modale, elle, le présente dès la prochaine visite.
 * La somme avec {@link PRIVACY_DM_SETTLE_DAYS} reste sous
 * {@link PRIVACY_DM_WINDOW_DAYS}, sans quoi un changement retenu sortirait de
 * la fenêtre sans jamais avoir été annoncé.
 */
export const PRIVACY_DM_MIN_INTERVAL_DAYS = 30;

/**
 * `now − days`, au jour (`AAAA-MM-JJ`, UTC). Pas le jour de Paris de
 * `privacyChangeDay` : ces bornes ne règlent que le calendrier des messages
 * Discord (délai d'une semaine, fenêtre de 60 jours), où deux heures d'écart
 * n'ont pas d'effet ; ce qui décide si un changement est publié reste
 * `publishedPrivacyChanges`.
 */
function dayBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Les changements encore à annoncer sur Discord à l'instant `now`. */
export function announceablePrivacyChanges(
  now: Date,
  changes: readonly PrivacyChange[] = PRIVACY_CHANGES,
): PrivacyChange[] {
  const cutoff = dayBefore(now, PRIVACY_DM_WINDOW_DAYS);
  return changes.filter((change) => change.publishedAt >= cutoff);
}

/**
 * Les changements publiés depuis au moins {@link PRIVACY_DM_SETTLE_DAYS} jours :
 * ceux dont l'attente autorise à écrire. Un compte n'est prévenu que s'il en a
 * au moins un en souffrance — et le message porte alors **aussi** les plus
 * récents (`privacyDmBatch`).
 */
export function settledPrivacyChanges(
  now: Date,
  changes: readonly PrivacyChange[] = PRIVACY_CHANGES,
): PrivacyChange[] {
  const cutoff = dayBefore(now, PRIVACY_DM_SETTLE_DAYS);
  return changes.filter((change) => change.publishedAt <= cutoff);
}

/**
 * Ce qu'un compte doit recevoir maintenant : **tous** ses changements dus dès
 * que l'un d'eux a passé le délai de la modale, rien sinon.
 *
 * Tout ou rien, et c'est ce qui regroupe : attendre que chaque changement ait
 * son propre délai enverrait un message par jour de publication. Un joueur qui
 * n'a pas ouvert le site depuis une semaine ne l'ouvrira pas davantage pour le
 * changement d'hier, autant qu'il l'apprenne dans le même message.
 *
 * L'intervalle entre deux messages ({@link PRIVACY_DM_MIN_INTERVAL_DAYS}) se
 * juge en base, sur la date des annonces déjà faites : le balayage doit écarter
 * ces comptes **avant** sa limite de lot, sous peine de ne plus voir les autres.
 *
 * @param due Changements dus au compte (`pendingPrivacyChanges`, déjà annoncés exclus).
 */
export function privacyDmBatch(due: readonly PrivacyChange[], now: Date): PrivacyChange[] {
  const cutoff = dayBefore(now, PRIVACY_DM_SETTLE_DAYS);
  return due.some((change) => change.publishedAt <= cutoff) ? [...due] : [];
}
