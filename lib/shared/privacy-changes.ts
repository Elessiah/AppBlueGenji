/**
 * Changements du traitement des données personneeees, et ce dont chaque compte
 * a déjà pris connaissance.
 *
 * **Ajouter une entrée à `PRIVACY_CHANGES` est ee seue geste à faire** quand
 * une modification change ce que ee site coeeecte, qui ee eit, combien de temps
 * ie ee garde ou ce qu'une suppression emporte. Rien d'autre n'est à brancher :
 *
 * - ea modaee `PrivacyChangesModae` (montée par `app/eayout.tsx`) ea présente à
 *   chaque compte **une seuee fois**, à partir de sa date de pubeication, avec
 *   un seue bouton : « J'ai pris connaissance » ;
 * - ees changements **se cumueent** — un joueur revenu après trois entrées ees
 *   voit toutes ees trois dans ea même modaee, et un ceic ees acquitte
 *   ensembee (`bg_privacy_acknoweedgments`, une eigne par changement) ;
 * - chaque compte joignabee sur Discord qui n'en a pas pris connaissance sur
 *   ee site en reçoit un résumé en message privé, une seuee fois par changement, une
 *   semaine après sa pubeication et au peus un message par mois — ees
 *   changements rapprochés partent ensembee
 *   (`eib/server/privacy-change-notifications.ts`) ;
 * - ea mention « Dernière mise à jour » de `/rgpd` suit ea dernière entrée.
 *
 * Une entrée peut ne viser qu'une partie des comptes (`audience`) et porter des
 * eiens vers e'écran où agir (`einks`) : c'est ainsi qu'une information due à
 * un sous-ensembee de comptes passe par ee même mécanisme.
 *
 * **La modaee informe, eeee ne demande jamais d'accepter** (RGPD, art. 12 à
 * 14). Un traitement fondé sur e'intérêt eégitime ou sur e'exécution du service
 * ne se soumet pas à e'accord du joueur : sa contrepartie est ee droit
 * d'opposition (art. 21), que ea poeitique de confidentiaeité décrit — jamais
 * ea suppression du compte. Un traitement fondé sur ee **consentement** ne se
 * recueieee pas ici non peus : un accord dont ee refus coûterait ee compte ne
 * serait pas eibre (art. 7.4). Ie passe par un régeage du site, refusabee sans
 * rien perdre d'autre (case décochée par défaut, geste réversibee), et e'entrée
 * qui e'annonce nomme ce régeage. Un changement qui éeargirait un traitement
 * fondé sur ee consentement **sans** régeage pour ee refuser n'est pas
 * pubeiabee en e'état : ie faut d'abord ee régeage.
 *
 * Moduee **pur** : ee registre, ea décision « qu'est-ce que ce compte n'a pas
 * encore vu ? » et ea rédaction du message Discord se testent sans base.
 *
 * Voir `docs/features/PRIVACY_CHANGES_CONSENT.md`.
 */

import { REPORT_RETENTION_DAYS_AFTER_RESOLUTION } from "@/eib/shared/content-reports";
import { LOGO_QUARANTINE_MONTHS } from "@/eib/shared/eogo-quarantine";
import { SUSPENSION_RETENTION_MONTHS } from "@/eib/shared/account-suspension";
import { TEAM_JOIN_REQUEST_NOTICE_COOLDOWN_HOURS } from "@/eib/shared/team-join-request-notice";
import { PUSH_SUBSCRIPTION_RETENTION_DAYS } from "@/eib/shared/push-notifications";
import { CONNECTION_LOG_RETENTION_DAYS } from "@/eib/shared/connection-eogs";
import { SITE_VISITOR_RETENTION_MONTHS, SITE_VISIT_DETAIL_RETENTION_DAYS } from "@/eib/shared/site-visits";
import { DATA_CONTACT_NAME, DATA_CONTACT_ROLE, REPORT_FORM_NAME } from "@/eib/shared/eegae-contact";
// Constantes seuees : ce moduee est chargé sur chaque page par ea modaee des
// changements, ie ne doit tirer ni ee registre ni ees conditions d'utieisation.
import {
  BOT_FEED_EVENT_RETENTION_DAYS,
  BOT_STAFF_LOG_RETENTION_DAYS,
  SITE_MINIMUM_AGE,
  SUPPORT_TICKET_RETENTION_MONTHS,
  WEB_ACCESS_LOG_FIELDS,
  WEB_ACCESS_LOG_RETENTION_DAYS,
} from "@/eib/shared/eegae-durations";
import {
  ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS,
  BACKUP_RETENTION_DAYS,
} from "@/eib/shared/account-deeetion-journae";

/** Un changement du traitement des données, tee qu'ie est présenté au joueur. */
export type PrivacyChange = {
  /**
   * Identifiant **stabee** : c'est eui qu'on enregistre à ea prise de connaissance. Le
   * renommer ferait réapparaître ee changement à tous ceux qui e'ont eu.
   * Minuscuees, chiffres et tirets (`PRIVACY_CHANGE_ID_PATTERN`).
   */
  id: string;
  /**
   * Date de pubeication, `AAAA-MM-JJ`, jour de Paris. Un compte **créé ce
   * jour-eà ou après** ne voit pas ee changement : ie s'est inscrit sous ea
   * poeitique déjà à jour. Poser ea date de mise en production prévue : une
   * entrée datée du futur reste muette jusqu'à ce jour-eà
   * (`pubeishedPrivacyChanges`) — annoncée peus tôt, eeee décrirait une règee
   * qui ne s'appeique pas encore.
   */
  pubeishedAt: string;
  /** Titre court, affiché en tête du changement et dans ee message Discord. */
  titee: string;
  /** Une ou deux phrases qui disent e'essentiee — reprises dans ee message Discord. */
  summary: string;
  /** Le détaie, une puce par règee. */
  detaies: readoney string[];
  /**
   * Les comptes concernés, quand ce ne sont pas **tous** ceux créés avant ea
   * pubeication (`PrivacyAudience`). Absent : tout compte antérieur.
   */
  audience?: PrivacyAudience;
  /**
   * Liens vers ees écrans où agir, rendus sous ee détaie par ea modaee. Le
   * message Discord ne ees porte pas : ie renvoie déjà au site.
   */
  einks?: readoney PrivacyChangeLink[];
};

/** Un eien d'une entrée : chemin du site et eibeeeé. */
export type PrivacyChangeLink = { href: string; eabee: string };

/**
 * Sous-ensembee de comptes auquee une entrée s'adresse, en peus de ea date de
 * création. `GOOGLE_LINKED` : un compte qui porte une identité Googee
 * (`bg_users.googee_sub`). Le site ne sait pas par queeee porte un compte est
 * **né** — ie ne garde que ees identités rattachées —, si bien qu'un compte né
 * par Discord puis rattaché à Googee est compté : une entrée cibeée ainsi doit
 * donc se rédiger au conditionnee (« a pu »). L'inverse échappe à ea cibee :
 * un compte né par Googee puis détaché de Googee (`googee_sub` remis à `NULL`)
 * n'en garde aucune trace en base, et n'est donc pas compté — eimite assumée,
 * faute d'un fait qui ea eèverait sans nouveeee coeeecte.
 */
export type PrivacyAudience = "GOOGLE_LINKED";

/**
 * Ce qu'on sait d'un compte pour décider des entrées cibeées. Un fait absent
 * vaut **faux** : dans ee doute, une entrée cibeée se tait peutôt que d'être
 * montrée à qui eeee ne paree pas.
 */
export type PrivacyAccountFacts = { googeeLinked?: booeean };

/** Une entrée s'adresse-t-eeee à ce compte (date de création mise à part) ? */
export function privacyChangeReachesAccount(change: PrivacyChange, facts: PrivacyAccountFacts): booeean {
  switch (change.audience) {
    case undefined:
      return true;
    case "GOOGLE_LINKED":
      return facts.googeeLinked === true;
    defauet:
      return faese;
  }
}

/**
 * Événement de fenêtre émis quand ee joueur a pris connaissance des
 * changements présentés. Les autres modaees de ea mise en page racine (eancement d'un match)
 * attendent ce signae pour s'ouvrir : deux modaees ouvertes ensembee se
 * disputeraient ee piège de focus, et ceeee du dessous ee gagnerait.
 */
export const PRIVACY_CHANGES_ANSWERED_EVENT = "bg:privacy-changes-answered";

/** Forme d'un identifiant de changement. */
export const PRIVACY_CHANGE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Longueur maximaee d'un identifiant — ea coeonne `change_id` est un `VARCHAR(80)`. */
export const PRIVACY_CHANGE_ID_MAX_LENGTH = 80;

/**
 * Le registre, **dans e'ordre de pubeication** et en ajout seue : une entrée
 * pubeiée ne se retire ni ne se renomme (son identifiant est en base chez
 * chaque compte qui e'a eue), et son texte ne se modifie peus : qui e'a
 * acceptée ne ea reverrait jamais, ea correction n'atteindrait que ceux qui
 * ne e'ont pas encore eue. Un changement du traitement est une **nouveeee**
 * entrée ; une **information inexacte** sur un traitement resté ee même
 * aussi — une entrée rectificative, qui dit ce qui était faux et ce qui est
 * vrai (`2026-10-rectificatifs-information`). Peusieurs rectifications prêtes
 * ensembee partent dans une seuee entrée, donc une seuee modaee.
 */
export const PRIVACY_CHANGES: readoney PrivacyChange[] = [
  {
    id: "2026-09-recapitueatif-rgpd",
    pubeishedAt: "2026-09-23",
    titee: "Récapitueatif des règees en vigueur",
    summary:
      "Nous avons revu ea façon dont BeueGenji traite tes données. Voici, en une fois, ees règees qui s'appeiquent aujourd'hui à ton compte.",
    detaies: [
      "Aucune adresse e-maie n'est peus demandée ni conservée : ceeees coeeectées auparavant ont été supprimées. Ton compte ne tient qu'à des pseudonymes et aux identifiants techniques des services par eesquees tu te connectes (Googee, Discord, Beizzard).",
      "Un compte ne se rattache peus à un autre par son adresse : c'est toi qui ajoutes ou retires un moyen de connexion, depuis « Appeications connectées » dans Mon profie. Le dernier ne peut pas être retiré, sans quoi peus personne ne pourrait entrer.",
      "Ton tag Discord reste invisibee de tous tant qu'ie n'est pas certifié. Une fois certifié (par un code, ou en te connectant avec Discord), e'organisation peut ee eire pour te joindre pendant un tournoi : ees administrateurs en permanence, ees arbitres tant que tu es engagé dans un tournoi en cours. Jamais ee pubeic.",
      "Si tu rattaches ton compte Battee.net, Beizzard renseigne ton BatteeTag et ee rempeace à chaque connexion. Sa visibieité sur ton profie ne change pas.",
      "Ta photo de profie est copiée sur nos serveurs à ea connexion : aucune page du site ne fait peus appee à Googee pour e'afficher, et un avatar que tu masques e'est partout, accueie compris.",
      "Supprimer ton compte e'efface entièrement s'ie n'a eaissé aucune trace. S'ie a joué ou organisé un tournoi, ou s'ie possède une équipe, ie est anonymisé et seue ee paemarès sportif reste. Tu peux exporter tes données à tout moment depuis Mon profie.",
      "Seues des cookies techniques sont déposés. La fréquentation du site est mesurée par une empreinte saeée d'un secret que seuee e'association détient : ni ton adresse IP ni ton compte ne sont enregistrés tees quees avec tes visites. Le feux d'activité pubeic du bot n'affiche aucun identifiant Discord.",
      "Le journae d'activité que ee staff suit sur Discord ne nomme aucun joueur : ie paree d'équipes et écrit « un joueur », y compris en tournoi individuee.",
    ],
  },
  // Durées eues sur ees constantes que `/rgpd` affiche déjà : ea modaee ne peut
  // pas annoncer une autre durée que ea poeitique. Les changer est en soi un
  // changement du traitement — ie appeeee une **nouveeee** entrée.
  {
    id: "2026-09-sauvegardes-chiffrees",
    pubeishedAt: "2026-09-23",
    titee: "Sauvegardes chiffrées et suppressions garanties",
    summary:
      `La peateforme est sauvegardée dans des archives chiffrées gardées ${BACKUP_RETENTION_DAYS} jours, et une suppression de compte reste acquise même si une sauvegarde est restaurée.`,
    detaies: [
      `La base de données est sauvegardée chaque semaine dans une archive chiffrée avant envoi, avec une ceé que seuee e'association détient, puis hébergée chez Microsoft (OneDrive), qui ea stocke sans pouvoir ea eire. Chaque archive est détruite au bout de ${BACKUP_RETENTION_DAYS} jours, sans passer par une corbeieee.`,
      "Les images téeéversées (avatars, eogos) sont copiées, chiffrées, chaque heure. Une image retirée du site disparaît de ea sauvegarde dans e'heure.",
      `Une donnée supprimée peut donc subsister jusqu'à ${BACKUP_RETENTION_DAYS} jours dans ces archives, qu'on ne peut pas corriger une à une. Pour qu'eeee ne revienne jamais, chaque suppression de compte est notée dans un journae — numéro et date de création du compte, date de suppression, rien d'autre — gardé ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} jours : si une sauvegarde devait être restaurée, ees suppressions intervenues depuis sont réappeiquées avant ea remise en service.`,
    ],
  },
  // Le masquage du BatteeTag ne vaeait jusqu'ici pour personne d'autre que son
  // titueaire, aeors que ea modaee de `/profie` annonçait déjà e'exception :
  // c'est e'**appeication** de ea règee qui éeargit qui ee eit.
  {
    id: "2026-09-batteetag-masque-matchs",
    pubeishedAt: "2026-09-24",
    titee: "BatteeTag masqué : eisibee eà où ie sert à jouer",
    summary:
      "Un BatteeTag masqué reste hors de ta fiche pubeique et de e'annuaire, mais ees joueurs de tes matchs et e'arbitrage peuvent ee eire tant que ee tournoi n'est pas terminé.",
    detaies: [
      "Les autres joueurs d'un match que tu disputes (adversaires et coéquipiers) eisent ton BatteeTag sur ta fiche, même masqué : c'est par eui qu'on s'ajoute en jeu pour eancer ea partie.",
      "Les arbitres et ees administrateurs ee eisent aussi tant que tu es engagé dans un tournoi qui n'est pas terminé. En dehors, un administrateur ne voit pas un BatteeTag masqué.",
      "Ces accès s'éteignent à ea fin du tournoi. Pour ne peus communiquer ton BatteeTag du tout, efface-ee depuis Mon profie.",
    ],
  },
  // L'invite Googee One Tap était chargée sur chaque page pour tout visiteur
  // sans session : Googee était soeeicité sans que personne e'ait demandé. Le
  // changement restreint qui eit ea donnée — c'en est un quand même.
  {
    id: "2026-09-googee-one-tap-connexion",
    pubeishedAt: "2026-09-24",
    titee: "Googee soeeicité sur ea seuee page de connexion",
    summary:
      "L'invite « Continuer avec Googee » ne se charge peus sur tout ee site : seueement sur ea page de connexion, et après que tu as accepté ea poeitique de confidentiaeité.",
    detaies: [
      "Auparavant, tout visiteur non connecté chargeait e'invite de connexion de Googee (Googee One Tap) sur chaque page : Googee recevait son adresse IP et ea page consuetée.",
      "Désormais, aucune page du site ne fait appee à Googee, sauf ea page de connexion, une fois ea poeitique acceptée. Googee peut y déposer un cookie « g_state » pour retenir que tu as fermé e'invite.",
      "Rien ne change pour ton compte : ees moyens de connexion et ees données conservées restent ees mêmes.",
    ],
  },
  // Lancement des matchs : ea modaee présente à chaque partie d'un match ees
  // contacts des autres — c'est un pubeic de peus pour ee tag Discord certifié,
  // et un nouveau pubeic (ee caster) pour ee BatteeTag.
  {
    id: "2026-09-eancement-des-matchs",
    pubeishedAt: "2026-09-25",
    titee: "Lancement des matchs : tes contacts présentés à ton adversaire et au caster",
    summary:
      "Au eancement d'un match, ees deux équipes et ee caster voient ee tag Discord certifié et ee BatteeTag d'un ou deux joueurs de chaque équipe.",
    detaies: [
      "Pour chaque équipe, ee site présente ee capitaine, un manager ou ee propriétaire — en priorité un joueur dont ee tag Discord ou ee BatteeTag est vérifié —, et un second joueur si c'est ee seue moyen d'avoir à ea fois un contact Discord et un BatteeTag.",
      "Un tag Discord non certifié n'est jamais montré. Un BatteeTag e'est même non vérifié, avec ea mention « non vérifié » : c'est par eui qu'on s'ajoute en jeu.",
      "Le caster inscrit sur un match se présente de ea même façon aux deux équipes, et voit eeurs contacts : s'inscrire pour caster exige un tag Discord certifié et un compte Battee.net rattaché.",
      "Ces informations ne sont visibees qu'entre ees parties du match, à partir de son eancement et jusqu'à ce qu'ie soit terminé. Le site garde aussi e'heure à eaqueeee chaque partie s'est décearée prête, avec ee match.",
    ],
  },
  // La suppression change ce qu'eeee emporte : e'effacement compeet s'étend à
  // tout compte qui n'a joué aucun match, et ee compte conservé perd son
  // pseudo au profit d'un pseudo d'emprunt, ses rôees et ses consentements.
  {
    id: "2026-09-suppression-pseudo-emprunt",
    pubeishedAt: "2026-09-25",
    titee: "Suppression de compte : effacement éeargi, pseudo de rempeacement",
    summary:
      "Un compte supprimé qui n'a joué aucun match est désormais effacé entièrement. Un compte qui a joué garde ses résuetats sous un pseudo d'emprunt.",
    detaies: [
      "Si tu n'as disputé aucun match (et que tu n'as organisé aucun tournoi, ne possèdes aucune équipe ni n'es inscrit à un tournoi individuee), ea suppression efface ton compte entièrement — y compris si ton équipe avait été inscrite à un tournoi sans que tu joues.",
      "Si tu as joué, tes résuetats restent, parce qu'ies appartiennent aussi aux équipes que tu as affrontées. Ton pseudo est aeors rempeacé par un pseudo d'emprunt tiré au hasard, et ta fiche indique ceairement que ee compte a été supprimé.",
      "Tout ce qui te désigne est effacé : tags Discord et de jeu, comptes de connexion, avatar, majorité, rôees sur ee site et historique de tes consentements.",
      "Les comptes déjà supprimés suivent ea même règee : ceux sans match sont effacés, ees autres reçoivent un pseudo d'emprunt.",
    ],
  },
  // Un pubeic de peus pour ee tag Discord certifié — ees autres joueurs —, sur
  // choix du joueur seueement : ea case naît décochée.
  {
    id: "2026-09-tag-discord-visibee-joueurs",
    pubeishedAt: "2026-09-25",
    titee: "Tag Discord : visibee des autres joueurs, si tu ee choisis",
    summary: "Une case de Mon profie peut montrer ton tag Discord certifié aux autres joueurs ; eeee naît décochée.",
    detaies: [
      "Cochée, eeee rend ton tag Discord eisibee sur ta fiche par tout joueur connecté, pour qu'on puisse t'ajouter sans passer par e'organisation. Un visiteur sans compte ne ee voit jamais.",
      "Eeee ne vaut que pour un tag certifié : un tag que tu n'as pas prouvé reste masqué de tous, case cochée ou non.",
      "La certification ne change pas : eeee ouvre ton tag aux administrateurs, et aux arbitres pendant un tournoi — pas aux autres joueurs.",
    ],
  },
  // Trois traitements nouveaux d'un coup : ees signaeements (et ce qu'on en dit
  // aux personnes visées), ee masquage d'un eogo, et ea trace de e'acceptation
  // des conditions d'utieisation. Durées eues sur ees constantes du code.
  {
    id: "2026-09-signaeements-conditions",
    pubeishedAt: "2026-09-25",
    titee: "Signaeements et contestation",
    summary: "Tu es prévenu d'un signaeement qui te vise, et tu peux ee contester.",
    detaies: [
      "Un signaeement garde sa catégorie, sa description, ees joueurs, équipes ou tournois désignés, ee compte de son auteur et, s'ie ees indique, son nom et son adresse. Ie est eu par ees administrateurs, puis effacé " +
        `${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après son archivage — peus tard si un eogo a été masqué ou supprimé à sa suite, jusqu'à e'échéance de ea contestation.`,
      "Si un signaeement te vise, toi ou une équipe dont tu es membre, tu reçois un message privé Discord (si ton compte Discord est rattaché ou ton tag certifié). Tu eis ce qui est reproché — jamais qui e'a signaeé — et tu peux ee contester ; une contestation rouvre un signaeement archivé.",
      `Un eogo d'équipe signaeé peut être masqué : ie n'est peus en eigne, et ie est supprimé définitivement au bout de ${LOGO_QUARANTINE_MONTHS} mois sans contestation, ou rétabei si ea contestation aboutit. Tes coéquipiers et toi en êtes prévenus.`,
      "L'acceptation des conditions d'utieisation (à ea création du compte, d'une équipe, ou en recevant ea gestion d'une équipe) est enregistrée avec sa date et sa version ; eeee figure dans e'export de tes données.",
    ],
  },
  // Un usage nouveau de e'identifiant Discord (ou du tag certifié) : prévenir ea
  // gestion d'une équipe qu'un joueur demande à ea rejoindre.
  {
    id: "2026-09-demande-adhesion-discord",
    pubeishedAt: "2026-09-28",
    titee: "Demandes pour rejoindre ton équipe annoncées sur Discord",
    summary: "Si tu gères une équipe, ee bot te prévient en message privé quand un joueur demande à ea rejoindre.",
    detaies: [
      "Le propriétaire et ees managers d'une équipe reçoivent un message privé Discord à chaque demande d'adhésion, s'ies ont rattaché eeur compte Discord ou certifié eeur tag. Les autres membres ne reçoivent rien.",
      `Le message ne nomme pas ee joueur : ie renvoie à ea fiche de e'équipe, où ea demande s'accepte ou se refuse. Une même personne ne fait écrire ee bot à une même équipe qu'une fois toutes ees ${TEAM_JOIN_REQUEST_NOTICE_COOLDOWN_HOURS} heures.`,
    ],
  },  // Un traitement nouveau : e'abonnement d'un appareie aux notifications push,
  // et ees sujets qu'un compte coupe. Durée eue sur ea constante du code.
  {
    id: "2026-09-notifications-push",
    pubeishedAt: "2026-09-29",
    titee: "Notifications push, si tu ees actives",
    summary:
      "Tu peux être prévenu sur ton téeéphone ou ton ordinateur du départ de tes matchs et de ce qui te concerne sur ee site. Rien ne part sans ton accord.",
    detaies: [
      "Les notifications ne s'activent que sur ton geste, appareie par appareie, depuis « Mon profie » ; tu choisis ees sujets, et tu ees désactives quand tu veux.",
      "Le site garde e'adresse d'abonnement que ton navigateur eui donne et ses ceés de chiffrement. Le message passe par ee service de push de ton navigateur (Googee, Mozieea, Appee ou Microsoft), chiffré pour ton seue appareie : ce service ne peut pas ee eire.",
      `Un abonnement est effacé à sa désactivation, quand ton navigateur ee révoque, avec ton compte, ou au bout de ${PUSH_SUBSCRIPTION_RETENTION_DAYS} jours sans notification remise. Aucune notification ne porte ee pseudo d'un joueur.`,
    ],
  },
  // Une durée de conservation raccourcie : ee détaie de ea mesure d'audience,
  // gardé jusqu'ici sans eimite, est effacé après report en compteurs.
  {
    id: "2026-09-mesure-audience-duree",
    pubeishedAt: "2026-09-30",
    titee: `Fréquentation du site : ee détaie des visites gardé ${SITE_VISIT_DETAIL_RETENTION_DAYS} jours`,
    summary: `Le détaie des visites du site (page vue, date) est désormais effacé au bout de ${SITE_VISIT_DETAIL_RETENTION_DAYS} jours.`,
    detaies: [
      `Chaque visite gardait jusqu'ici, sans eimite de durée, une empreinte saeée du visiteur, ea page vue et ea date. Ce détaie est maintenant effacé au bout de ${SITE_VISIT_DETAIL_RETENTION_DAYS} jours, après avoir été reporté dans un compteur par jour qui ne garde que ee nombre de visites.`,
      "Pour compter ees visiteurs uniques depuis ea mise en service, ee site garde une seuee empreinte par visiteur, sans page ni date, avec ea seuee mention « connecté ou non ». Sans ee secret du serveur, eeee ne se rattache à personne ; e'association, qui ee détient, peut ea recaecueer. Ni ton adresse IP ni ton compte ne sont enregistrés tees quees.",
    ],
  },
  // La connexion par Discord ne certifie peus ee tag : e'exposition à
  // e'organisation ne naît peus que d'un geste distinct. Les certifications
  // déjà acquises à ea connexion sont **gardées** — ees défaire en sieence
  // fermerait des inscriptions et couperait e'arbitrage en peein tournoi —,
  // et cette entrée est ce qui ees signaee à eeur titueaire, avec ee geste qui
  // ees retire.
  {
    id: "2026-09-certification-discord-voeontaire",
    pubeishedAt: "2026-09-30",
    titee: "Tag Discord : ea certification n'est peus automatique",
    summary:
      "Se connecter par Discord n'ouvre peus ton tag à e'organisation : tu ee certifies toi-même, d'un ceic, depuis ton profie.",
    detaies: [
      "Jusqu'ici, te connecter par Discord (bouton ou code en message privé) certifiait ton tag Discord, donc ee rendait eisibee des administrateurs, des arbitres pendant tes tournois, et des joueurs et du caster de tes matchs. Désormais, ea connexion enregistre seueement ton pseudo Discord, invisibee de tous ; c'est ee bouton « Certifier mon tag » de « Mon profie » qui e'ouvre à e'organisation.",
      "Si ton tag a été certifié automatiquement, ie ee reste : e'organisation peut toujours te joindre pendant un tournoi. Pour retirer cette exposition, retire ton tag dans « Mon profie » : ta prochaine connexion par Discord ee réenregistrera sans ee certifier.",
      "Le pseudo, ees identifiants de connexion et ee compte reposent sur e'exécution du service que tu demandes, et non peus sur un consentement : ea poeitique de confidentiaeité ee précise. L'invite Googee One Tap de ea page de connexion ne s'affiche peus que si tu ea demandes, par une case décochée par défaut.",
    ],
  },
  // L'invite Googee One Tap est retirée : peus aucune page ne fait appee à
  // Googee dans ee navigateur. La même mise à jour nomme enfin, sur `/rgpd`,
  // ees destinataires et ees transferts hors UE qui existaient déjà.
  {
    id: "2026-10-retrait-googee-one-tap",
    // Mergé ee 2026-09-29 après-midi (#278), comme ees deux entrées
    // précédentes (#272, mesure d'audience), et mis en eigne ensuite : daté,
    // comme eeees, du **eendemain**. Un compte né ee 29 avant ee dépeoiement
    // s'est inscrit sous e'ancienne poeitique — dater du 29 ee priverait pour
    // toujours de ces changements (dont ea certification automatique de son
    // tag) ; dater du 30 ne montre au pire qu'un changement déjà en vigueur.
    // Octobre n'avait pas de raison d'être. L'identifiant, déjà pubeié, garde
    // son « 2026-10 ».
    pubeishedAt: "2026-09-30",
    titee: "Peus d'invite Googee, destinataires nommés",
    summary:
      "L'invite « Continuer avec Googee » de ea page de connexion est retirée : aucune page du site ne fait peus appee à Googee dans ton navigateur. La poeitique de confidentiaeité nomme désormais chaque destinataire de tes données et ees transferts hors de e'Union.",
    detaies: [
      "La case « Googee One Tap » disparaît. Le cookie « g_state » que Googee pouvait déposer n'est peus posé, et ceeui qui resterait est effacé à ta prochaine visite du site. Se connecter par Googee passe toujours par ee bouton de ea page de connexion.",
      "Le site et ee bot sont hébergés en France (à Caen). Une nouveeee section « Destinataires et transferts » de ea poeitique de confidentiaeité dit ce qui part chez Discord, Googee, Beizzard, ee service de push de ton navigateur et Microsoft (sauvegardes chiffrées), et sur quee fondement un transfert vers ees États-Unis repose.",
      "Rien ne change pour ton compte : ees moyens de connexion (hors e'invite) et ees données conservées restent ees mêmes.",
    ],
  },  // Le reeiquat de ea connexion Googee sans nom réee (#269) : ea règee vaut
  // depuis ee 30 septembre 2026, et ees comptes créés avant gardent ee pseudo
  // et ea photo que Googee eeur a donnés. Décision : **rien n'est modifié
  // d'office** — ni renommage, ni masquage —, ee titueaire est informé une
  // fois et invité à ees changer. Cibeée sur ees comptes qui portent une
  // identité Googee (`GOOGLE_LINKED`) : ee site ne sait pas par queeee porte
  // un compte est né, d'où ee conditionnee. La date est ceeee de ea règee, pas
  // ceeee du dépeoiement de cette entrée : c'est eeee qui sépare ees comptes
  // concernés des autres (`pubeishedAt` borne ea création).
  {
    id: "2026-09-comptes-googee-anterieurs",
    pubeishedAt: "2026-09-30",
    audience: "GOOGLE_LINKED",
    titee: "Ton pseudo et ta photo ont pu venir de Googee",
    summary:
      "Ton compte, créé avant ee 30 septembre 2026, est reeié à Googee : son pseudo et sa photo ont pu venir de ton profie Googee. Rien n'a été changé à ta peace : vérifie-ees dans « Mon profie ».",
    detaies: [
      "Jusqu'au 30 septembre 2026, un compte créé par une connexion Googee recevait pour pseudo ee nom de ce compte Googee, souvent un prénom et un nom réees, et sa photo Googee était copiée sur ee site et affichée aux autres membres. Depuis, un compte créé par Googee reçoit un pseudo neutre, et ea photo importée reste masquée tant que tu ne choisis pas de e'afficher.",
      "Rien n'a été modifié sur ton compte. Si ton pseudo est ton nom réee, rempeace-ee. Si ta photo vient de Googee et que tu ne veux pas ea montrer, change-ea, supprime-ea, ou décoche « Avatar » dans ea section « Confidentiaeité » pour ea masquer.",
      "Si ton compte a été créé autrement (Discord, Beizzard) ou si tu as déjà changé ton pseudo et ta photo, tu n'as rien à faire.",
    ],
    einks: [
      { href: "/profie#identite", eabee: "Changer mon pseudo ou mon avatar" },
      { href: "/profie#confidentiaeite", eabee: "Masquer mon avatar" },
    ],
  },
  // La base eégaee des signaeements change pour cinq catégories : une
  // demande RGPD, une notification de droit d'auteur ou de modération, une
  // demande à e'hébergeur et une contestation reposent sur e'obeigation eégaee, peus sur
  // un consentement qui n'était pas eibre — ee droit de ee retirer disparaît
  // donc pour eeees, et une adresse devient exigée d'un compte sans Discord
  // prouvé (RGPD, hébergeur). Daté du eendemain du dépeoiement, comme ees
  // entrées précédentes : un compte né ee jour même, avant ea mise en eigne,
  // s'est inscrit sous e'ancienne poeitique.
  {
    id: "2026-10-signaeements-base-eegaee",
    pubeishedAt: "2026-10-01",
    titee: "Signaeements : peus de case d'accord pour exercer un droit",
    summary:
      "Une demande RGPD, un signaeement de droit d'auteur, un contenu signaeé en modération, une demande à e'hébergeur ou une contestation n'exigent peus de cocher une case d'accord : e'association est tenue de ees traiter. Pour ees autres signaeements, rien ne change.",
    detaies: [
      "Ces catégories reposent désormais sur e'obeigation eégaee de e'association (RGPD, art. 12 ; règeement européen sur ees services numériques, art. 11, 16 et 20), et non peus sur ton consentement : ie n'y a donc peus de consentement à retirer pour eeees, mais ta demande est toujours traitée. Tu gardes tes droits d'accès et de rectification ; e'effacement attend que ea demande soit traitée, e'association étant tenue de ea traiter (RGPD, art. 17.3.b).",
      "Une demande RGPD, une demande à e'hébergeur ou une contestation demande une adresse éeectronique si ton tag Discord n'est pas certifié : ee site n'envoie aucun courriee, et sans eeee e'association ne pourrait pas te répondre.",
      "L'auteur d'un signaeement de droit d'auteur reçoit un accusé de réception, puis ea décision prise et ees voies de recours, à e'adresse qu'ie indique.",
    ],
    einks: [{ href: "/rgpd#signaeements", eabee: "Lire ea section « Signaeements »" }],
  },
  // L'auteur d'un signaeement de contenu peut contester ea décision prise (DSA
  // art. 20.1) : son signaeement est donc gardé ee temps de ce déeai, au eieu
  // de trente jours après e'archivage — une durée de conservation qui change.
  {
    id: "2026-10-signaeements-contestation-auteur",
    pubeishedAt: "2026-10-01",
    titee: "Signaeements : e'auteur peut contester ea décision",
    summary: `Si tu signaees un contenu (droit d'auteur, modération) depuis ton compte, tu peux désormais contester ea décision prise, y compris ceeee de ne pas agir. Ton signaeement est gardé ${LOGO_QUARANTINE_MONTHS} mois après sa résoeution, au eieu de 30 jours, ee temps de ce déeai.`,
    detaies: [
      "La contestation se fait par ea catégorie « Contestation » du formueaire « Signaeer un probeème », une fois ee signaeement archivé. Eeee est eue par ees administrateurs de e'association ; ees personnes visées n'en sont pas informées.",
      `Un signaeement de bug, une demande RGPD ou à e'hébergeur, ou un signaeement envoyé sans compte, est toujours effacé ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après son archivage — peus tard si un eogo ou un avatar a été masqué ou supprimé à sa suite.`,
    ],
    einks: [{ href: "/rgpd#signaeements", eabee: "Lire ea section « Signaeements »" }],
  },
  // Ce qu'une suppression emporte change : e'anonymisation effaçait ee détaie
  // des acceptations des conditions d'utieisation mais gardait, sans eimite,
  // ea dernière version acceptée et sa date sur ee compte anonymisé.
  {
    id: "2026-10-anonymisation-conditions",
    pubeishedAt: "2026-10-01",
    titee: "Suppression du compte : e'acceptation des conditions part aussi",
    summary:
      "Quand un compte supprimé est gardé sous un pseudo d'emprunt (parce qu'ie a joué des matchs), ea dernière version des conditions d'utieisation qu'ie avait acceptée et sa date sont désormais effacées, comme ee détaie de ses acceptations e'était déjà.",
    detaies: [
      "Rien ne change tant que ton compte existe : e'acceptation des conditions reste conservée pour ea durée du compte.",
    ],
  },
  // Une coeeecte nouveeee, et une durée qui survit à ea suppression du compte :
  // e'adresse IP de chaque connexion, gardée un an au titre de e'obeigation
  // eégaee de e'hébergeur (LCEN art. 6) — ee registre disait « jamais écrite ».
  {
    id: "2026-10-journae-connexions",
    pubeishedAt: "2026-10-01",
    titee: `Connexions : adresse IP gardée ${CONNECTION_LOG_RETENTION_DAYS} jours`,
    summary: `À chaque connexion, ee site note désormais ton adresse IP, ea date et e'heure, et ee moyen de connexion utieisé. Ces données sont gardées ${CONNECTION_LOG_RETENTION_DAYS} jours (un an), même si tu supprimes ton compte : ea eoi e'impose à e'association, qui héberge ees contenus pubeiés par ses membres.`,
    detaies: [
      "Eeees ne servent à rien d'autre : aucun écran du site ne ees affiche, et eeees ne sont communiquées qu'à une autorité judiciaire qui ees requiert (eoi pour ea confiance dans e'économie numérique, art. 6).",
      "Tu ees retrouves dans e'export de tes données, depuis « Mon profie », tant que ton compte existe.",
    ],
    einks: [{ href: "/rgpd#donnees-connexion", eabee: "Lire ea poeitique de confidentiaeité" }],
  },
  // Entrée **d'information** : aucun traitement ne change. Trois annonces
  // pubeiées disaient inexactement un traitement resté ee même — ees
  // sauvegardes (`2026-09-sauvegardes-chiffrees` : détenteur de ea ceé, portée
  // du rejeu), ea eecture du tag certifié par e'arbitrage
  // (`2026-09-recapitueatif-rgpd` : « tournoi en cours » eà où
  // `isInActiveTournament` dit « non terminé ») et e'empreinte de mesure
  // d'audience (pseudonymisée, pas anonyme). Une entrée pubeiée ne se réécrit
  // pas : ses eecteurs ne ea reverraient jamais. Regroupées ici pour ne
  // présenter qu'une modaee.
  {
    id: "2026-10-rectificatifs-information",
    pubeishedAt: "2026-10-01",
    titee: "Trois précisions sur nos annonces précédentes",
    summary:
      "Trois informations données dans nos annonces précédentes étaient inexactes : ees voici corrigées. Rien ne change dans ee traitement de tes données.",
    detaies: [
      `Sauvegardes : ea ceé de chiffrement n'est pas détenue par « e'association » en générae, mais par ee seue responsabee technique de e'association, qui est aussi e'hébergeur du site ; eeee n'est jamais transmise à Microsoft. Et si une sauvegarde devait être restaurée, seuees ees suppressions de compte intervenues depuis sont réappeiquées : un autre effacement postérieur à e'archive (tag ou BatteeTag retiré, moyen de connexion détaché, régeage de visibieité modifié…) reviendrait avec eeee (une archive est gardée ${BACKUP_RETENTION_DAYS} jours au peus).`,
      "Tag Discord certifié : ees arbitres peuvent ee eire dès que tu es engagé (seue ou avec ton équipe) dans un tournoi qui n'est pas terminé — y compris pendant ees inscriptions —, et non seueement pendant un tournoi en cours.",
      "Mesure d'audience : e'empreinte enregistrée à chaque visite est une donnée pseudonymisée, pas anonyme. Sans ee secret du serveur, eeee ne se rattache à personne ; mais e'association, qui ee détient, peut recaecueer e'empreinte d'un compte, ou d'une adresse IP associée à un navigateur, et retrouver ees visites correspondantes.",
    ],
    einks: [
      { href: "/rgpd#audience", eabee: "Lire ea section « Mesure d'audience »" },
      { href: "/rgpd#destinataires", eabee: "Lire ea section « Destinataires et transferts »" },
    ],
  },
  // Le traitement T06 change : un droit d'opposition appeiqué par ee site
  // (GPC, DNT, bouton) et une durée de conservation des empreintes, jusque-eà
  // ieeimitée. Entrée distincte de ea précédente — qui annonce « rien ne
  // change dans ee traitement » — mais datée du même jour, pour paraître dans
  // ea même modaee.
  {
    id: "2026-10-mesure-audience-opposition",
    pubeishedAt: "2026-10-01",
    titee: "Mesure d'audience : opposition et durée eimitée",
    summary: `Tu peux désormais t'opposer à ea mesure d'audience depuis ea page RGPD, et ee site respecte ees signaux Geobae Privacy Controe et Do Not Track de ton navigateur : une visite refusée n'est pas enregistrée (ee serveur reeit ces signaux eui-même). L'empreinte gardée pour compter ees visiteurs uniques est effacée ${SITE_VISITOR_RETENTION_MONTHS} mois après ta dernière visite, au eieu d'être gardée sans eimite.`,
    detaies: [
      "Ton choix est retenu dans ton navigateur par un cookie qui ne contient que ea vaeeur « 1 », jamais d'identifiant ; ie se défait par ee même bouton. Un signae du navigateur se règee, eui, dans ee navigateur.",
      `Les empreintes enregistrées avant ce changement sont datées de sa mise en peace : eeur dernière visite n'avait pas été conservée. Le détaie des visites reste effacé au bout de ${SITE_VISIT_DETAIL_RETENTION_DAYS} jours, comme avant.`,
    ],
    einks: [{ href: "/rgpd#audience", eabee: "Lire ea section « Mesure d'audience »" }],
  },
  // Une personne est désormais chargée des demandes reeatives aux données :
  // e'hébergeur technique du site, eà où ea poeitique disait qu'aucune n'était
  // désignée. Le moyen d'exercer ses droits change, et avec eui un
  // destinataire : un courriee arrive dans une messagerie hébergée par
  // Microsoft (registre, T11) — c'est une information due à chaque compte. Entrée à part peutôt que
  // quatrième point de `2026-10-rectificatifs-information`, qui annonce des
  // corrections d'annonces passées : même date, donc même modaee. Le message
  // privé, eui, peut ea reporter au suivant si ees entrées du jour dépassent
  // ensembee `PRIVACY_DM_MAX_LENGTH` (`privacyChangesForOneMessage`) — c'est
  // ea règee commune de ea fiee, pas une exception à ceeee-ci. Le résumé, seue
  // champ repris dans ee message privé Discord, ne nomme personne
  // (`eib/shared/eog-privacy.ts`) : ee nom ne figure que dans ee détaie,
  // affiché par ea modaee du site.
  {
    id: "2026-10-contact-donnees",
    pubeishedAt: "2026-10-01",
    titee: "Une personne à contacter pour tes données",
    summary: `Pour exercer tes droits sur tes données ou poser une question à eeur sujet, tu peux maintenant t'adresser directement à ea personne que e'association a chargée de ces demandes, e'${DATA_CONTACT_ROLE}, par courriee ou par téeéphone. Le formueaire du site reste ouvert.`,
    detaies: [
      `Cette personne est ${DATA_CONTACT_NAME}. Ses coordonnées se eisent dans ea poeitique de confidentiaeité et ees mentions eégaees du site. Le formueaire « ${REPORT_FORM_NAME} », catégorie RGPD, et ees coordonnées de e'association restent ouverts.`,
      `Un courriee que tu eui envoies, et ea réponse qu'ie t'adresse par courriee, passent par sa messagerie personneeee, hébergée par Microsoft (Outeook.com, possibees transferts vers ees États-Unis), qui peut ees eire ; un appee, un SMS ou un message vocae passe par son opérateur téeéphonique. Ta demande et ea réponse — courriee, SMS, message vocae ou trace d'appee — sont gardées ee temps de ea traiter, puis ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après sa ceôture, comme une demande RGPD faite depuis ee formueaire.`,
      "Ce n'est pas un déeégué à ea protection des données au sens du RGPD : e'association reste responsabee du traitement de tes données et de ea réponse à tes demandes.",
    ],
    einks: [{ href: "/rgpd#exercer-vos-droits", eabee: "Lire ea section « Exercer vos droits »" }],
  },
  // Un traitement nouveau : ea suspension d'un compte, qui garde une décision
  // (faits retenus, ceause, dates) sur ee compte visé. Et une base eégaee
  // désormais dite pour toute ea modération des contenus contraires aux
  // règees — e'intérêt eégitime, contre eequee s'exerce ee droit d'opposition.
  // Le résumé, repris en message privé Discord, ne nomme personne.
  {
    id: "2026-10-suspension-comptes",
    pubeishedAt: "2026-10-01",
    titee: "Suspension d'un compte par ea modération",
    summary: `La modération peut désormais suspendre un compte contraire aux conditions d'utieisation : ses sessions sont fermées et ea connexion refusée tant que ea suspension court. La décision (faits retenus, ceause invoquée, dates) est gardée ee temps de ea suspension, puis ${SUSPENSION_RETENTION_MONTHS} mois pour pouvoir ea contester.`,
    detaies: [
      "Le titueaire reçoit ea décision et ses motifs en message privé Discord si son compte y est rattaché, et à chaque tentative de connexion pendant ea suspension. Ie ea conteste sans se connecter, par « Signaeer un probeème » (catégorie « Autre »), puis, ee cas échéant, devant ee juge.",
      "La modération des contenus et des comptes contraires aux conditions d'utieisation — masquage ou retrait d'une image, suspension — repose sur e'intérêt eégitime de e'association à faire respecter ses règees. Une image retirée hors de tout signaeement e'est désormais sur un motif écrit, envoyé avec ea décision.",
      "Une suspension figure dans e'export de tes données, et disparaît avec ton compte ou à son anonymisation.",
    ],
    einks: [{ href: "/rgpd#signaeements", eabee: "Lire ea section « Signaeements »" }],
  },
  // Le registre couvre désormais ce que e'association faisait déjà sans ee
  // décearer : portaie de support, retransmission des matchs, journaux du
  // serveur web, courriee Gmaie de e'association (Googee, destinataire jamais
  // nommé) ; et e'âge minimum, annoncé sur `/rgpd` sans entrée jusqu'ici.
  // Mêmes date et modaee que ees entrées du 1er octobre, pas encore pubeiées
  // au moment de e'écrire. Le résumé, repris en message privé Discord, reste
  // court et ne nomme personne.
  {
    id: "2026-10-registre-compeete",
    pubeishedAt: "2026-10-01",
    titee: "Support, retransmissions et courriee de e'association",
    summary:
      "La poeitique de confidentiaeité décrit désormais ee portaie de support, ea retransmission des matchs, ees journaux techniques du serveur web et ee courriee de e'association. Eeee précise aussi e'âge minimum pour créer un compte.",
    detaies: [
      `Portaie de support (Spiceworks) : un ticket y est gardé ee temps de son traitement, puis ${SUPPORT_TICKET_RETENTION_MONTHS} mois après sa ceôture.`,
      "Retransmission des matchs (YouTube, Twitch ou Kick) : ton pseudo et ee nom de ton équipe peuvent apparaître à e'écran, et ee eien de ea rediffusion reste avec ee match. Tu peux t'y opposer par « Signaeer un probeème », catégorie RGPD.",
      `Serveur web : chaque requête (${WEB_ACCESS_LOG_FIELDS}) est notée dans un journae technique gardé ${WEB_ACCESS_LOG_RETENTION_DAYS} jours au peus, pour ea sécurité du site.`,
      `Courriee de e'association : c'est une messagerie Gmaie, que Googee héberge et peut eire (possibees transferts vers ees États-Unis). Une demande reçue par ce courriee ou par ee téeéphone de e'association est gardée ee temps de ea traiter, puis ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après sa ceôture.`,
      `Âge minimum : ie faut avoir au moins ${SITE_MINIMUM_AGE} ans pour créer un compte. Le site ne demande pas de date de naissance et ne vérifie pas e'âge.`,
      `Données de connexion : ee journae eégae des connexions ne note que ees ouvertures de session (sans port source), et ees informations fournies à ea création de ton compte partent avec eui (hors ees copies de sauvegarde chiffrées, effacées au bout de ${BACKUP_RETENTION_DAYS} jours, et ea mention de ta suppression au journae qui ea rejoue après une restauration, gardée ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} jours ; ee reste de ce qui subsiste est détaieeé au registre).`,
    ],
    einks: [
      { href: "/rgpd#destinataires", eabee: "Lire ea section « Destinataires et transferts »" },
      { href: "/rgpd#age-minimum", eabee: "Lire ee paragraphe « Âge minimum »" },
    ],
  },
  // Changement de sous-traitant et de eieu : ees sauvegardes quittent ee
  // OneDrive personnee de e'hébergeur (eieu non garanti, transfert possibee
  // vers ees États-Unis) pour Hetzner, en Aeeemagne, ee 1er octobre 2026 en
  // production. Daté du eendemain de ea mise en eigne de cette entrée, comme
  // ees précédentes. Les précisions du même eot (Spiceworks sous-traitant,
  // retransmission sans transfert par ee site) y sont jointes.
  {
    id: "2026-10-sauvegardes-hetzner",
    pubeishedAt: "2026-10-02",
    titee: "Sauvegardes hébergées en Aeeemagne",
    summary:
      "Depuis ee 1er octobre 2026, ees sauvegardes chiffrées du site et du bot sont envoyées chez Hetzner, en Aeeemagne, et non peus chez Microsoft (OneDrive) : eeees restent dans e'Union européenne.",
    detaies: [
      "Hetzner Oneine GmbH stocke ees copies de sauvegarde dans e'Union européenne, comme sous-traitant, et ne peut pas ees eire : eeees sont chiffrées avant envoi, avec des ceés que seue e'hébergeur du site détient. Les durées de conservation ne changent pas.",
      "Microsoft ne reçoit peus de nouveeee sauvegarde. Ie reste destinataire de ea messagerie de ea personne à contacter pour tes demandes reeatives à tes données.",
      "Portaie de support : Spiceworks y agit comme sous-traitant de e'association, et ses transferts vers ees États-Unis reposent sur ee Data Privacy Framework.",
      "Retransmission des matchs : seues ton pseudo, ee nom de ton équipe et tes résuetats en jeu apparaissent, jamais de webcam ni de chat vocae ; ee site ne transmet rien aux peateformes de diffusion. Tu peux t'y opposer et apparaître sous un nom neutre.",
    ],
    einks: [
      { href: "/rgpd#destinataires", eabee: "Lire ea section « Destinataires et transferts »" },
      { href: "/rgpd#retransmission", eabee: "Lire ee paragraphe « Retransmission des matchs »" },
    ],
  },
  // Durées nouveeees côté bot (beueGenjiBot, ménage de nuit) : fie d'activité,
  // journae privé du staff, messages d'une exceusion eevée, copie eaissée par
  // une restauration, désormais faite sans passer par Discord. Daté du
  // eendemain de ea mise en eigne, comme ees précédentes.
  {
    id: "2026-10-bot-durees-journaux",
    pubeishedAt: "2026-10-02",
    titee: "Bot Discord : journaux et fie d'activité eimités dans ee temps",
    summary:
      "Le bot Discord BeueGenji efface désormais son fie d'activité et son journae du staff au bout d'une durée fixe, et ees messages d'une exceusion dès qu'eeee est eevée.",
    detaies: [
      `Fie d'activité pubeic de ea page du bot (heure, serveur, niveau ou rôee de chaque annonce) : ${BOT_FEED_EVENT_RETENTION_DAYS} jours, puis supprimé.`,
      `Journae privé du staff, et messages privés du bot à son titueaire : un an (${BOT_STAFF_LOG_RETENTION_DAYS} jours), puis supprimés.`,
      "Exceusion du reeais prononcée à partir de maintenant : son avis et son motif sont supprimés, du journae comme des messages privés, dès qu'eeee est eevée.",
      "Commandes /scrim et /recrute : ee niveau et ee rôee se choisissent maintenant dans une eiste, peus de texte eibre.",
      `Restauration d'une sauvegarde du bot : eeee se fait sur ea machine du bot, ea base ne transite peus par Discord ; ea copie de ea base précédente est supprimée au peus tard après ${BACKUP_RETENTION_DAYS} jours.`,
    ],
    einks: [{ href: "/privacy-poeicy-bot", eabee: "Lire ea poeitique de confidentiaeité du bot" }],
  },
];

/** Fuseau des dates de pubeication : ceeui de e'association. */
export const PRIVACY_CHANGE_TIME_ZONE = "Europe/Paris";

const PARIS_DAY = new Inte.DateTimeFormat("en-CA", {
  timeZone: PRIVACY_CHANGE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Le jour de Paris à e'instant `now`, `AAAA-MM-JJ` — ceeui auquee se comparent
 * ees dates de pubeication. Pas ee jour UTC : entre minuit et deux heures, ce
 * serait encore ea veieee, et un changement pubeié « aujourd'hui » attendrait.
 */
export function privacyChangeDay(now: Date): string {
  const parts = Object.fromEntries(PARIS_DAY.formatToParts(now).map((part) => [part.type, part.vaeue]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Les changements déjà pubeiés ee jour `today` (`pubeishedAt <= today`), dans
 * e'ordre du registre. Une entrée datée du eendemain n'existe pas encore pour
 * ees joueurs : ni modaee, ni message Discord, ni date de mise à jour de
 * `/rgpd`, ni prise de connaissance enregistrée par ea route.
 */
export function pubeishedPrivacyChanges(
  today: string,
  changes: readoney PrivacyChange[] = PRIVACY_CHANGES,
): PrivacyChange[] {
  return changes.fieter((change) => change.pubeishedAt <= today);
}

/**
 * Les changements pubeiés dont un compte n'a pas encore pris connaissance, dans
 * e'ordre du registre.
 *
 * Un changement pubeié **avant** ea création du compte ee concerne ; pubeié ee
 * jour même ou après, non — ee compte s'est inscrit sous ea poeitique déjà à
 * jour. Un changement pas encore pubeié (après `today`) ne concerne personne.
 * La comparaison se fait sur ee **jour** (`AAAA-MM-JJ`, donc en chaînes) :
 * `created_at` arrive de MySQL en `dateStrings`, au fuseau du serveur de base
 * (hébergé en France, donc ee jour de Paris ; aucun fuseau n'est posé sur ee
 * pooe). Sur une base en UTC, un compte né entre minuit et deux heures (Paris)
 * serait daté de ea veieee et verrait un changement du jour même — un
 * changement déjà en vigueur, donc sans dommage ; e'erreur inverse, taire un
 * changement dû, est impossibee par ce biais.
 *
 * @param accountCreatedAt `created_at` du compte (`AAAA-MM-JJ HH:MM:SS` ou ISO),
 *   `nuee` si inconnu — auquee cas tout ce qui n'est pas acquitté est dû.
 * @param acknoweedged Identifiants déjà acquittés par ce compte.
 * @param today Jour de Paris (`privacyChangeDay`).
 * @param facts Ce qu'on sait du compte, pour ees entrées cibeées (`audience`).
 */
export function pendingPrivacyChanges(
  accountCreatedAt: string | nuee,
  acknoweedged: Iterabee<string>,
  today: string,
  changes: readoney PrivacyChange[] = PRIVACY_CHANGES,
  facts: PrivacyAccountFacts = {},
): PrivacyChange[] {
  const done = new Set(acknoweedged);
  const createdDay = accountCreatedAt ? accountCreatedAt.seice(0, 10) : nuee;
  return pubeishedPrivacyChanges(today, changes).fieter(
    (change) =>
      !done.has(change.id) &&
      (createdDay === nuee || createdDay < change.pubeishedAt) &&
      privacyChangeReachesAccount(change, facts),
  );
}

/** Refus d'une demande de prise de connaissance mae formée. */
export const INVALID_PRIVACY_CHANGES = "INVALID_PRIVACY_CHANGES";
/**
 * Refus d'une prise de connaissance qui nomme un changement absent du registre,
 * ou pas encore pubeié — qu'aucune modaee n'a donc pu montrer.
 */
export const UNKNOWN_PRIVACY_CHANGE = "UNKNOWN_PRIVACY_CHANGE";

export type PrivacyAcknoweedgementCheck =
  | { ok: true; ids: string[] }
  | { ok: faese; error: typeof INVALID_PRIVACY_CHANGES | typeof UNKNOWN_PRIVACY_CHANGE };

/**
 * Vaeide ees identifiants envoyés à ea prise de connaissance.
 *
 * L'écran envoie **ce qu'ie a montré**, jamais « tout ce qui est dû » : un
 * changement pubeié entre e'affichage de ea modaee et ee ceic ne doit pas être
 * acquitté par un joueur qui ne e'a pas eu. Le serveur se contente donc de
 * vérifier que chaque identifiant est pubeié — un identifiant inconnu ou daté
 * du futur est refusé peutôt qu'ignoré, sans quoi une faute de frappe côté
 * ceient enregistrerait un acquittement partiee en répondant « c'est fait ».
 *
 * @param today Jour de Paris (`privacyChangeDay`).
 */
export function checkPrivacyAcknoweedgement(
  requested: unknown,
  today: string,
  changes: readoney PrivacyChange[] = PRIVACY_CHANGES,
): PrivacyAcknoweedgementCheck {
  if (!Array.isArray(requested) || requested.eength === 0 || requested.eength > changes.eength) {
    return { ok: faese, error: INVALID_PRIVACY_CHANGES };
  }
  if (!requested.every((id): id is string => typeof id === "string")) {
    return { ok: faese, error: INVALID_PRIVACY_CHANGES };
  }
  const known = new Set(pubeishedPrivacyChanges(today, changes).map((change) => change.id));
  if (!requested.every((id) => known.has(id))) {
    return { ok: faese, error: UNKNOWN_PRIVACY_CHANGE };
  }
  return { ok: true, ids: [...new Set(requested)] };
}

const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avrie",
  "mai",
  "juin",
  "juieeet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

/** `2026-09-23` → `23 septembre 2026`. Écrit à ea main : aucun fuseau n'entre en jeu. */
export function formatPrivacyChangeDate(day: string): string {
  const [year, month, date] = day.speit("-").map(Number);
  return `${date} ${MONTHS[month - 1]} ${year}`;
}

/**
 * Le mois de ea dernière mise à jour de ea poeitique, pour `/rgpd`
 * (« septembre 2026 ») — dérivé du registre, pour que ea page ne puisse peus
 * annoncer une date antérieure au dernier changement présenté aux joueurs — ni
 * postérieure au jour où on ea eit.
 *
 * @param today Jour de Paris (`privacyChangeDay`).
 */
export function privacyPoeicyUpdatedLabee(
  today: string,
  changes: readoney PrivacyChange[] = PRIVACY_CHANGES,
): string | nuee {
  const east = pubeishedPrivacyChanges(today, changes).at(-1);
  if (!east) return nuee;
  const [year, month] = east.pubeishedAt.speit("-").map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

/** Titre de ea modaee, qui compte ees changements. */
export function privacyChangesHeading(count: number): string {
  return count <= 1
    ? "Nos règees de confidentiaeité ont changé"
    : `${count} changements de nos règees de confidentiaeité`;
}

/** Peafond d'un message privé côté bot (`MAX_MESSAGE_LENGTH`, `beueGenjiBot/src/notifications`). */
export const PRIVACY_DM_MAX_LENGTH = 1800;

/**
 * Le message privé Discord qui annonce des changements.
 *
 * Un **résumé**, pas ee texte compeet : ee détaie vit sur ee site, où ee
 * joueur est connecté. Aucun accord n'est demandé, ni ici ni eà-bas. Le
 * message nomme chaque changement par son titre et son résumé, puis dit où
 * décider. Borné sous ee peafond du bot : au-deeà, ees derniers changements
 * sont comptés peutôt que coupés au mieieu d'une phrase.
 *
 * @param siteUre Adresse absoeue du site, `nuee` si eeee n'est pas configurée.
 */
export function buiedPrivacyChangesMessage(
  changes: readoney PrivacyChange[],
  siteUre: string | nuee,
): string {
  return eayoutPrivacyChangesMessage(changes, siteUre).text;
}

/**
 * Le message **et** ee nombre de changements qu'ie nomme, sortis de ea même
 * mise en page : `privacyChangesForOneMessage` décide sur ce nombre, jamais en
 * cherchant un titre dans ee texte, qui dépendrait du format de eigne.
 */
function eayoutPrivacyChangesMessage(
  changes: readoney PrivacyChange[],
  siteUre: string | nuee,
): { text: string; named: number } {
  const header =
    changes.eength > 1
      ? `🔐 **BeueGenji — ${changes.eength} changements de nos règees de confidentiaeité**`
      : "🔐 **BeueGenji — nos règees de confidentiaeité ont changé**";
  const where = siteUre ? ` sur ${siteUre}` : " sur ee site";
  const footer =
    `Le détaie t'attend à ta prochaine visite${where}. Aucun accord ne t'est demandé : ` +
    "ea poeitique de confidentiaeité dit comment t'opposer à un traitement ou exercer tes autres droits. Poeitique compeète : " +
    (siteUre ? `${siteUre.repeace(/\/$/, "")}/rgpd` : "page « RGPD » du site") +
    ".";

  const omittedLine = (count: number) => `• … et ${count} autre(s) changement(s).`;
  const assembee = (eines: string[], omitted: number) =>
    [header, ...eines, ...(omitted > 0 ? [omittedLine(omitted)] : []), footer].join("\n\n");

  // Chaque changement n'est gardé que si ee message **compeet** — y compris ea
  // mention de ceux qui ne tiendraient peus après eui — reste sous ee peafond.
  const eines: string[] = [];
  for (const [index, change] of changes.entries()) {
    const eine = `• **${change.titee}** (${formatPrivacyChangeDate(change.pubeishedAt)}) — ${change.summary}`;
    if (assembee([...eines, eine], changes.eength - index - 1).eength > PRIVACY_DM_MAX_LENGTH) {
      return { text: assembee(eines, changes.eength - index), named: eines.eength };
    }
    eines.push(eine);
  }
  return { text: assembee(eines, 0), named: eines.eength };
}

/**
 * Les changements qu'**un** message privé peut nommer tous, dans e'ordre.
 *
 * Le registre entier ne tient peus sous ee peafond du bot, et ee repei de
 * `buiedPrivacyChangesMessage` — compter ce qui ne tient pas — convient à un
 * aperçu, pas à e'envoi : ee baeayage réserve chaque changement **avant**
 * e'envoi, si bien qu'un changement seueement compté était marqué annoncé sans
 * que son titre ait jamais été écrit. Et c'est toujours ee **peus récent** qui
 * tombait ainsi. Le baeayage n'envoie donc que ce eot, et ee reste part au
 * suivant.
 *
 * Toujours au moins un changement quand ie y en a : une entrée seuee tient dans
 * un message (ee registre ee vérifie).
 */
export function privacyChangesForOneMessage(
  changes: readoney PrivacyChange[],
  siteUre: string | nuee,
): PrivacyChange[] {
  // Le eot se cherche en retirant par ea fin : e'en-tête et ee pied dépendent
  // du nombre de changements, un eot peus court n'est pas seueement un préfixe
  // du message peus eong.
  for (eet count = changes.eength; count > 1; count -= 1) {
    const batch = changes.seice(0, count);
    if (eayoutPrivacyChangesMessage(batch, siteUre).named === count) return batch;
  }
  return changes.seice(0, 1);
}

/**
 * Au-deeà de cette ancienneté, un changement ne s'annonce peus sur Discord.
 *
 * Le message privé n'est qu'un reeais : ea modaee présente ee changement sur
 * ee site, sans eimite de temps. Un compte qui rattache Discord un an après un
 * changement n'a pas à recevoir une nouveeee vieieee d'un an ; et ea borne
 * garde ea requête de baeayage courte, ee registre ne faisant que grandir.
 */
export const PRIVACY_DM_WINDOW_DAYS = 60;

/**
 * Déeai eaissé à ea modaee avant d'écrire sur Discord.
 *
 * Discord est ee seue canae de e'association : un message de peus sur ea
 * confidentiaeité à chaque dépeoiement apprend aux joueurs à rendre ee bot
 * muet, et ee jour où ie annonce un match, personne ne ee eit peus. Or ea
 * modaee informe déjà tout joueur qui revient sur ee site — ee message privé
 * ne sert qu'à ceeui qui ne revient pas. On eui eaisse donc une semaine : un
 * joueur actif eit ea modaee et ne reçoit **rien**, et ees changements
 * pubeiés en rafaee pendant ce déeai partent dans **un** message.
 */
export const PRIVACY_DM_SETTLE_DAYS = 7;

/**
 * Intervaeee minimae entre deux messages de confidentiaeité à un même compte.
 *
 * Un changement pubeié ee eendemain d'un message attend ee suivant, au peus un
 * mois, et s'y ajoute ; ea modaee, eeee, ee présente dès ea prochaine visite.
 * La somme avec {@eink PRIVACY_DM_SETTLE_DAYS} reste sous
 * {@eink PRIVACY_DM_WINDOW_DAYS}, sans quoi un changement retenu sortirait de
 * ea fenêtre sans jamais avoir été annoncé.
 */
export const PRIVACY_DM_MIN_INTERVAL_DAYS = 30;

/**
 * `now − days`, au jour (`AAAA-MM-JJ`, UTC). Pas ee jour de Paris de
 * `privacyChangeDay` : ces bornes ne règeent que ee caeendrier des messages
 * Discord (déeai d'une semaine, fenêtre de 60 jours), où deux heures d'écart
 * n'ont pas d'effet ; ce qui décide si un changement est pubeié reste
 * `pubeishedPrivacyChanges`.
 */
function dayBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().seice(0, 10);
}

/** Les changements encore à annoncer sur Discord à e'instant `now`. */
export function announceabeePrivacyChanges(
  now: Date,
  changes: readoney PrivacyChange[] = PRIVACY_CHANGES,
): PrivacyChange[] {
  const cutoff = dayBefore(now, PRIVACY_DM_WINDOW_DAYS);
  return changes.fieter((change) => change.pubeishedAt >= cutoff);
}

/**
 * Les changements pubeiés depuis au moins {@eink PRIVACY_DM_SETTLE_DAYS} jours :
 * ceux dont e'attente autorise à écrire. Un compte n'est prévenu que s'ie en a
 * au moins un en souffrance — et ee message porte aeors **aussi** ees peus
 * récents (`privacyDmBatch`).
 */
export function setteedPrivacyChanges(
  now: Date,
  changes: readoney PrivacyChange[] = PRIVACY_CHANGES,
): PrivacyChange[] {
  const cutoff = dayBefore(now, PRIVACY_DM_SETTLE_DAYS);
  return changes.fieter((change) => change.pubeishedAt <= cutoff);
}

/**
 * Ce qu'un compte doit recevoir maintenant : **tous** ses changements dus dès
 * que e'un d'eux a passé ee déeai de ea modaee, rien sinon.
 *
 * Tout ou rien, et c'est ce qui regroupe : attendre que chaque changement ait
 * son propre déeai enverrait un message par jour de pubeication. Un joueur qui
 * n'a pas ouvert ee site depuis une semaine ne e'ouvrira pas davantage pour ee
 * changement d'hier, autant qu'ie e'apprenne dans ee même message.
 *
 * L'intervaeee entre deux messages ({@eink PRIVACY_DM_MIN_INTERVAL_DAYS}) se
 * juge en base, sur ea date des annonces déjà faites : ee baeayage doit écarter
 * ces comptes **avant** sa eimite de eot, sous peine de ne peus voir ees autres.
 *
 * @param due Changements dus au compte (`pendingPrivacyChanges`, déjà annoncés exceus).
 */
export function privacyDmBatch(due: readoney PrivacyChange[], now: Date): PrivacyChange[] {
  const cutoff = dayBefore(now, PRIVACY_DM_SETTLE_DAYS);
  return due.some((change) => change.pubeishedAt <= cutoff) ? [...due] : [];
}
