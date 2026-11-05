/**
 * Contenu bilingue (FR / EN) des documents légaux du bot Discord *BlueGenji Bot*.
 *
 * **Source unique** de ces deux textes : ils étaient repris de
 * `blueGenjiBot/LegalTerms`, dont les fichiers ont depuis divergé et ne font
 * plus foi. Ils décrivent le bot **d'après son code** (`blueGenjiBot`,
 * branche `main`) : chaque durée ou comportement cité y a été relu — tables de
 * `src/bdd/Bdd.ts`, purge de `src/messages/manageMsgExpiration.ts`, commandes
 * de `src/config/commands.ts`, routes de `src/internalApi.ts`, sauvegardes de
 * `scripts/backup-onedrive.sh`, effacement au départ d'un serveur par
 * `eraseGuild` (évènement `guildDelete` de `src/main.ts`, et rattrapage au
 * démarrage et chaque nuit par `src/privacy/dataRetention.ts`, qui efface aussi
 * l'auteur des scrims et recherches au-delà de 30 jours), licence de
 * `LICENSE` et `NOTICE`. Les durées qu'aucune importation ne peut tenir
 * alignées (le bot vit dans un autre dépôt) sont recopiées une fois, avec leur
 * source, dans `lib/shared/processing-register.ts`, que le registre (T08) lit
 * aussi : un changement du bot se reporte là, et les deux pages suivent.
 *
 * Les paragraphes et puces acceptent une syntaxe inline minimale :
 *   - `**gras**`            → <strong>
 *   - `[texte](url)`        → <a> (target/rel gérés au rendu)
 *
 * La partie « hébergeur » n'est pas dupliquée ici : chaque document renvoie vers la
 * section Hébergement des mentions légales du site (`/mentions-legales#hebergement`).
 *
 * Chaque document s'écrit **une fois** pour les deux langues : sections
 * nommées dans l'ordre de lecture (`numberedSections`), et chaque texte qui
 * change d'une langue à l'autre en `frEn("français", "anglais")`, le français
 * sur la ligne de l'appel, l'anglais sur la suivante ; `inBothLanguages` en
 * tire `fr` et `en` (`lib/shared/bilingual.ts`, `docs/features/LEGAL_DATA_FILES.md`).
 */
import { BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";
import {
  ASSOCIATION_NAME,
  ASSOCIATION_SEAT,
  DATA_CONTACT_NAME,
  LEGAL_CONTACT_DISCORD,
  REPORT_FORM_NAME,
} from "@/lib/shared/legal-contact";
import {
  BOT_ACTIVITY_AUTHOR_RETENTION_DAYS,
  BOT_FEED_EVENT_RETENTION_DAYS,
  BOT_RELAY_RETENTION_DAYS,
  BOT_STAFF_LOG_RETENTION_DAYS,
  DPF_ADEQUACY_DECISION,
  DPF_ADEQUACY_DECISION_EN,
} from "@/lib/shared/processing-register";
import { SITE_HOST } from "@/lib/shared/site-host";
import {
  VOICE_BOT_ABANDONED_MAX_HOURS,
  VOICE_BOT_RELEASED_MAX_HOURS,
  VOICE_BOT_SWEEP_MINUTES,
  VOICE_BOT_UNRELEASED_MAX_HOURS,
} from "@/lib/shared/match-voice";

import { frEn, inBothLanguages, type Localizable } from "@/lib/shared/bilingual";
import type { BilingualDoc, LegalDoc, LegalSection } from "@/lib/shared/bot-legal-types";

export {
  HEBERGEUR_HREF,
  type BilingualDoc,
  type Lang,
  type LegalBlock,
  type LegalDoc,
  type LegalSection,
} from "@/lib/shared/bot-legal-types";

/**
 * Âge minimal pour utiliser le bot : 15 ans, seuil à partir duquel un mineur
 * consent seul à un traitement lié à un service en ligne (art. 45 de la loi
 * Informatique et Libertés, art. 8 RGPD).
 */
export const BOT_MINIMUM_AGE = 15;

/** Même serveur que le reste du site : voir `lib/shared/discord.ts`. */
const DISCORD_INVITE = DISCORD_INVITE_URL;
const DISCORD_TERMS = "https://discord.com/terms";
const DISCORD_GUIDELINES = "https://discord.com/guidelines";
const PRIVACY_HREF = "/privacy-policy-bot";
const TERMS_HREF = "/terms-of-service-bot";
const LEGAL_NOTICE_HREF = "/mentions-legales";
const SITE_PRIVACY_HREF = "/rgpd";
const CNIL_COMPLAINT_URL = "https://www.cnil.fr/fr/plaintes";
/** Dépôt public du bot (`blueGenjiBot`), sous licence AGPL-3.0-only (fichiers `LICENSE` et `NOTICE`). */
export const BOT_SOURCE_URL = "https://github.com/Elessiah/blueGenjiBot";
/** Titulaire des droits d'auteur sur le code du bot, tel que le nomme son fichier `NOTICE`. */
export const BOT_COPYRIGHT_HOLDER = "Keryan Houssin";
// Aucune adresse électronique ici : le courriel de l'association ne s'écrit
// jamais en clair, il se révèle au clic sur les mentions légales
// (`lib/shared/legal-contact.ts`), ce que ces textes ne savent pas faire — ils y
// renvoient donc.
const CONTACT_DISCORD = LEGAL_CONTACT_DISCORD;

const LAST_UPDATED_FR = "6 novembre 2026";
const LAST_UPDATED_EN = "6 November 2026";
// La politique a sa propre date : une modification qui ne touche qu'elle (le
// passage des sauvegardes chez Hetzner) laisse aux conditions la leur. Les
// horaires de match remis en message privé touchent les deux ; l'annonce des
// matchs diffusés dans #live, la politique seule ; le pseudo solo dans #live et
// l'interrupteur des messages de match (RGPD-DM-SWITCH), la politique seule ;
// base du pseudo solo, AutoMod et avis « Match retiré » (LEGAL-FOLLOWUP-444),
// les deux (l'avis « Match retiré » est aussi cité à l'article 01 des conditions) ;
// messages de match aux seuls tags certifiés (DM-CERTIFIED-ONLY), les deux (article 01) ;
// langue du compte transmise avec le code et messages privés dans cette langue
// (BOT-NOTIF-LANG), la politique seule ; base de la conservation du choix des
// messages de match, obligation légale (LEGAL-OPTOUT-BASIS), la politique seule ;
// sauvegarde deux fois par semaine au lieu d'une (BACKUP-SCHEDULE), la politique seule ;
// réglages du salon remis aux gérants des engagées (MATCH-REFEREE MR-4), la
// politique, puis l'article 01 des conditions (TERMS v7) — les deux datés du
// lendemain de la mise en ligne du 28 octobre 2026 (§ Dates corrigées) ;
// invitations d'équipe, reprises proposées et propriétés transférées remises en
// message privé (TEAM-INVITE-NOTIFY), la politique seule — l'article 01 des
// conditions, figé avec TERMS v8, les ajoutera à la prochaine version ; datée du
// lendemain de la nuit de déploiement suivant la fusion du 3 novembre 2026 ;
// salons vocaux d'équipe des matchs (EF-43, registre T18), la politique seule —
// datée du lendemain de la mise en ligne du 5 novembre 2026 ; check-in du match
// remis à tous les membres des engagées (MATCH-CHECKIN), la politique et
// l'article 01 des conditions (TERMS v9, pas encore publiée) — même date.
const PRIVACY_LAST_UPDATED_FR = "6 novembre 2026";
const PRIVACY_LAST_UPDATED_EN = "6 November 2026";

const CONTACT_ITEMS_FR = [
  `Formulaire **« ${REPORT_FORM_NAME} »** en bas de chaque page du site (catégorie « RGPD » pour vos données)`,
  `**Discord** : ${CONTACT_DISCORD} (hébergeur technique de l'association)`,
  `Courriel et téléphone de l'association : voir les [mentions légales](${LEGAL_NOTICE_HREF})`,
];
const CONTACT_ITEMS_EN = [
  `The **“${REPORT_FORM_NAME}”** form at the bottom of every page of the site (“RGPD” category for your data)`,
  `**Discord**: ${CONTACT_DISCORD} (the association's technical host)`,
  `The association's email address and phone number: see the [legal notice](${LEGAL_NOTICE_HREF})`,
];
// Contact de la politique de confidentialité : la personne chargée par
// l'association des demandes relatives aux données (l'hébergeur technique,
// `DATA_CONTACT_NAME`) vient en tête. Ses coordonnées ne s'écrivent pas ici —
// une page Markdown ne sait pas les révéler au clic — : on renvoie à la section
// du site qui le fait. Le tag Discord de l'hébergeur reste hors de cette liste,
// il ne sert qu'aux questions techniques (`lib/shared/legal-contact.ts`).
const SITE_RIGHTS_HREF = `${SITE_PRIVACY_HREF}#exercer-vos-droits`;
const PRIVACY_CONTACT_ITEMS_FR = [
  `Personne à contacter pour vos demandes relatives à vos données : **${DATA_CONTACT_NAME}**, hébergeur technique du site — courriel et téléphone dans la [politique de confidentialité du site](${SITE_RIGHTS_HREF}). Ce n'est pas un délégué à la protection des données au sens de l'article 37 du RGPD : l'association reste responsable du traitement. Ce traitement (base légale, données, durée de conservation) est décrit dans la politique de confidentialité du site ; ses destinataires et transferts figurent aussi aux sections 04 et 05 de la présente politique`,
  ...CONTACT_ITEMS_FR.filter((item) => !item.startsWith("**Discord**")),
];
const PRIVACY_CONTACT_ITEMS_EN = [
  `Person to contact for requests about your data: **${DATA_CONTACT_NAME}**, the website's technical host — email address and phone number in the [website's privacy policy](${SITE_RIGHTS_HREF}). This person is not a data protection officer within the meaning of Article 37 GDPR: the association remains the data controller. This processing (legal basis, data, retention period) is described in the website's privacy policy; its recipients and transfers are also listed in sections 04 and 05 of this policy`,
  ...CONTACT_ITEMS_EN.filter((item) => !item.startsWith("**Discord**")),
];

const HOSTING = {
  meta: frEn("HÉBERGEUR", "HOSTING PROVIDER"),
  title: frEn("Hébergement", "Hosting"),
  text: frEn(`Le bot et le site tournent sur la même machine, ${SITE_HOST.machine}, fournie et administrée par leur hébergeur technique, ${SITE_HOST.name}. Ses coordonnées complètes figurent dans les mentions légales du site.`,
    `The bot and the website run on the same machine, ${SITE_HOST.machineEn}, provided and administered by their technical host, ${SITE_HOST.name}. The host's full details are set out in the website's legal notice.`),
  linkLabel: frEn("Voir la section Hébergement des mentions légales →",
    "See the Hosting section of the legal notice →"),
};

/** Une section à écrire : tout sauf son numéro, que donne sa place. */
type SectionText = { [K in Exclude<keyof LegalSection, "num">]: Localizable<LegalSection[K]> };

/**
 * Les sections d'un document, nommées dans l'ordre de lecture : leur numéro
 * (« 01 », « 02 »…) suit cet ordre. Le nom ne s'affiche nulle part ; il dit
 * quelle section on relit, et fait de chacune un bloc unique pour SonarCloud.
 */
function numberedSections(sections: Record<string, SectionText>): Localizable<LegalSection>[] {
  return Object.values(sections).map((section, index) => ({ num: String(index + 1).padStart(2, "0"), ...section }));
}

/* -------------------------------------------------------------------------- */
/*  Terms of Service / Conditions d'Utilisation                               */
/* -------------------------------------------------------------------------- */

export const TERMS_OF_SERVICE: BilingualDoc = inBothLanguages<LegalDoc>({
  eyebrow: frEn("BLUEGENJI BOT · LÉGAL", "BLUEGENJI BOT · LEGAL"),
  title: frEn("Conditions\nd'Utilisation", "Terms of\nService"),
  lastUpdatedLabel: frEn("Dernière mise à jour", "Last updated"),
  lastUpdated: frEn(LAST_UPDATED_FR, LAST_UPDATED_EN),
  intro: frEn("Ces conditions encadrent l'utilisation du bot Discord **BlueGenji Bot** : ses commandes et le relais d'annonces entre serveurs partenaires. Si vous ne les acceptez pas, n'utilisez pas le Bot.",
    "These terms govern the use of the Discord bot **BlueGenji Bot**: its commands and the relay of advertisements between partner servers. If you do not accept them, do not use the Bot."),
  sections: numberedSections({
    publisher: {
      title: frEn("Éditeur et objet", "Publisher and purpose"),
      meta: frEn("PRÉSENTATION", "OVERVIEW"),
      blocks: [
        {
          kind: "p",
          text: frEn(`**BlueGenji Bot** est édité par l'association **${ASSOCIATION_NAME}** (association loi 1901, siège : ${ASSOCIATION_SEAT}). Il est développé et administré bénévolement par ${SITE_HOST.name}, hébergeur technique de l'association.`,
            `**BlueGenji Bot** is published by the association **${ASSOCIATION_NAME}** (a French non-profit association under the law of 1901, registered office: ${ASSOCIATION_SEAT}). It is developed and administered on a voluntary basis by ${SITE_HOST.name}, the association's technical host.`),
        },
        {
          kind: "p",
          text: frEn("Le Bot relaie les annonces de la communauté esport BlueGenji — Overwatch et Marvel Rivals — entre les salons des serveurs partenaires (recherches de scrims, recrutements et autres services). Il remet aussi en message privé les messages du site BlueGenji : codes de connexion, horaires de match (posés, changés ou retirés), rappels de match, check-in d'un match, avis de retrait d'un match (« Match retiré ») et avis envoyé à un caster dont l'inscription est retirée par un autre que lui — ces messages de match aux seuls comptes dont le tag Discord est certifié sur le site —, alertes d'arbitrage, avis de modération, demandes d'adhésion à une équipe, invitations d'une équipe, reprises d'une équipe fantôme que le staff propose et propriétés d'équipe transférées (qui ne nomment que l'équipe — une reprise cite « un admin », sans nommer personne) et informations sur les données. Il est gratuit.",
            "The Bot relays the advertisements of the BlueGenji esport community — Overwatch and Marvel Rivals — between the channels of partner servers (scrim searches, recruitment and other services). It also delivers by direct message the messages of the BlueGenji website: login codes, match times (set, changed or removed), match reminders, the check-in of a match, notices of removal from a match (“Match retiré”) and the notice sent to a caster whose registration for a match is removed by someone else — these match messages only to accounts with a Discord tag certified on the website —, referee alerts, moderation notices, team join requests, team invitations, takeovers of a ghost team offered by the staff and team ownership transfers (which only name the team — a takeover mentions “an admin”, naming no one) and data-protection notices. It is free of charge."),
        },
      ],
    },
    access: {
      title: frEn("Accès", "Access"),
      meta: frEn("CONDITIONS D'ACCÈS", "ACCESS REQUIREMENTS"),
      blocks: [
        {
          kind: "bullets",
          items: [
            frEn(`Vous devez avoir au moins ${BOT_MINIMUM_AGE} ans pour utiliser le Bot.`,
              `You must be at least ${BOT_MINIMUM_AGE} years old to use the Bot.`),
            frEn(`Vous devez respecter les [Conditions d'Utilisation de Discord](${DISCORD_TERMS}) et ses [Règles Communautaires](${DISCORD_GUIDELINES}).`,
              `You must comply with Discord's [Terms of Service](${DISCORD_TERMS}) and [Community Guidelines](${DISCORD_GUIDELINES}).`),
          ],
        },
      ],
    },
    usageRules: {
      title: frEn("Règles d'utilisation", "Usage rules"),
      meta: frEn("USAGE ACCEPTABLE", "ACCEPTABLE USE"),
      blocks: [
        {
          kind: "p",
          text: frEn("En utilisant **BlueGenji Bot**, vous vous engagez à :",
            "By using **BlueGenji Bot**, you undertake:"),
        },
        {
          kind: "bullets",
          items: [
            frEn("ne pas l'utiliser à des fins illégales, nuisibles ou perturbatrices ;",
              "not to use it for illegal, harmful or disruptive purposes;"),
            frEn("ne pas exploiter ses fonctionnalités de façon abusive ni tenter de contourner ses limites (temps de recharge, exclusions) ;",
              "not to abuse its features or attempt to bypass its limits (cooldowns, exclusions);"),
            frEn("ne pas l'utiliser pour harceler, spammer ou usurper l'identité d'autrui ;",
              "not to use it to harass, spam or impersonate others;"),
            frEn("signaler de façon responsable tout bug, faille ou usage abusif.",
              "to report any bug, vulnerability or misuse responsibly."),
          ],
        },
        {
          kind: "p",
          text: frEn("Chacun reste responsable des annonces qu'il publie : le Bot les recopie telles quelles dans les salons des serveurs partenaires.",
            "Everyone remains responsible for the advertisements they publish: the Bot copies them as they are into the channels of partner servers."),
        },
      ],
    },
    relayModeration: {
      title: frEn("Modération du relais", "Relay moderation"),
      meta: "EXCLUSIONS",
      blocks: [
        {
          kind: "p",
          text: frEn(`Les administrateurs de tout serveur où le Bot est installé et qui compte au moins 50 membres, comptes de bots compris — seuil dont les serveurs de l'association sont dispensés — (ou les titulaires du rôle d'administration du Bot que ces serveurs désignent), ainsi que le titulaire du Bot et la présidence de l'association depuis ces mêmes serveurs, peuvent **exclure un utilisateur du relais** en cas de manquement à ces conditions : il ne peut plus utiliser les commandes du Bot, ses annonces ne sont plus relayées et les copies de celles que le Bot suit encore (au moins les ${BOT_RELAY_RETENTION_DAYS} derniers jours) sont retirées. L'exclusion vaut pour tout le réseau de serveurs partenaires ; son motif est obligatoire et consigné au journal de modération.`,
            `The administrators of any server where the Bot is installed and which has at least 50 members, bot accounts included — a threshold the association's servers are exempt from — (or the holders of the Bot administration role those servers designate), as well as the Bot's owner and the association's presidency from those same servers, may **exclude a user from the relay** for breaching these terms: they can no longer use the Bot's commands, their advertisements are no longer relayed and the copies of those the Bot still tracks (at least the last ${BOT_RELAY_RETENTION_DAYS} days) are removed. The exclusion applies to the whole network of partner servers; a reason is mandatory and recorded in the moderation log.`),
        },
        {
          kind: "p",
          text: frEn("L'association peut aussi restreindre ou suspendre l'accès au Bot en cas de manquement. Une exclusion se conteste par les moyens indiqués à la section Contact.",
            "The association may also restrict or suspend access to the Bot in the event of a breach. An exclusion can be contested through the means listed in the Contact section."),
        },
      ],
    },
    personalData: {
      title: frEn("Données personnelles", "Personal data"),
      meta: frEn("DONNÉES", "DATA"),
      blocks: [
        {
          kind: "p",
          text: frEn(`Les données traitées par le Bot, leurs durées de conservation et vos droits sont décrits dans sa [Politique de Confidentialité](${PRIVACY_HREF}).`,
            `The data processed by the Bot, how long it is kept and your rights are described in its [Privacy Policy](${PRIVACY_HREF}).`),
        },
      ],
    },
    liability: {
      title: frEn("Responsabilité", "Liability"),
      meta: frEn("GARANTIES", "WARRANTIES"),
      blocks: [
        {
          kind: "bullets",
          items: [
            frEn("Le Bot est un service gratuit, maintenu par des bénévoles : il est fourni sans garantie de disponibilité continue ni d'absence d'erreur.",
              "The Bot is a free service maintained by volunteers: it is provided without any guarantee of continuous availability or error-free operation."),
            frEn("Dans les limites permises par la loi, l'association n'est pas responsable des interruptions du service, ni des contenus publiés par les utilisateurs et relayés par le Bot.",
              "To the extent permitted by law, the association is not liable for service interruptions, nor for content published by users and relayed by the Bot."),
          ],
        },
      ],
    },
    sourceCode: {
      title: frEn("Code source et licence", "Source code and licence"),
      meta: "LICENCE",
      blocks: [
        {
          kind: "p",
          text: frEn(`Le code source du Bot est publié dans son [dépôt public](${BOT_SOURCE_URL}) sous la licence **GNU Affero General Public License, version 3 uniquement** (AGPL-3.0-only), © 2026 ${BOT_COPYRIGHT_HOLDER}. Chacun peut l'étudier, le réutiliser et le modifier aux conditions de cette licence, qui l'accompagne dans le dépôt.`,
            `The Bot's source code is published in its [public repository](${BOT_SOURCE_URL}) under the **GNU Affero General Public License, version 3 only** (AGPL-3.0-only), © 2026 ${BOT_COPYRIGHT_HOLDER}. Anyone may study, reuse and modify it under the terms of that licence, which is included in the repository.`),
        },
        {
          kind: "p",
          text: frEn("La licence couvre le code du Bot, et lui seul : ni le nom, le logo ou l'identité visuelle de l'association, ni les annonces relayées, ni les données traitées par le Bot, qui restent régies par ces conditions et par sa Politique de Confidentialité. Les dépendances du Bot gardent leurs propres licences.",
            "The licence covers the Bot's code, and only that: not the association's name, logo or visual identity, nor the relayed announcements, nor the data processed by the Bot, which remain governed by these terms and by its Privacy Policy. The Bot's dependencies keep their own licences."),
        },
      ],
    },
    termsChanges: {
      title: frEn("Modification des conditions", "Changes to these terms"),
      meta: frEn("ÉVOLUTIONS", "UPDATES"),
      blocks: [
        {
          kind: "p",
          text: frEn(`L'association peut modifier ces conditions. La version en vigueur est celle publiée sur cette page, avec sa date de mise à jour ; les changements importants sont annoncés sur le [serveur Discord de l'association](${DISCORD_INVITE}).`,
            `The association may amend these terms. The version in force is the one published on this page, with its update date; significant changes are announced on the [association's Discord server](${DISCORD_INVITE}).`),
        },
      ],
    },
    termsContact: {
      title: "Contact",
      meta: "CONTACT",
      blocks: [
        {
          kind: "p",
          text: frEn("Pour toute question, contestation ou demande concernant ces conditions :",
            "For any question, dispute or request about these terms:"),
        },
        {
          kind: "bullets",
          items: frEn(CONTACT_ITEMS_FR, CONTACT_ITEMS_EN),
        },
      ],
    },
  }),
  hosting: HOSTING,
});

/* -------------------------------------------------------------------------- */
/*  Privacy Policy / Politique de Confidentialité                            */
/* -------------------------------------------------------------------------- */

export const PRIVACY_POLICY: BilingualDoc = inBothLanguages<LegalDoc>({
  eyebrow: frEn("BLUEGENJI BOT · CONFIDENTIALITÉ", "BLUEGENJI BOT · PRIVACY"),
  title: frEn("Politique de\nConfidentialité", "Privacy\nPolicy"),
  lastUpdatedLabel: frEn("Dernière mise à jour", "Last updated"),
  lastUpdated: frEn(PRIVACY_LAST_UPDATED_FR, PRIVACY_LAST_UPDATED_EN),
  intro: frEn("Cette politique vous informe des données que traite le bot Discord **BlueGenji Bot**, de leurs finalités, de leurs durées de conservation, de leurs destinataires et de vos droits (articles 13 et 14 du RGPD).",
    "This policy informs you of the data processed by the Discord bot **BlueGenji Bot**, why it is processed, how long it is kept, who receives it and what your rights are (Articles 13 and 14 GDPR)."),
  sections: numberedSections({
    controller: {
      title: frEn("Responsable du traitement", "Data controller"),
      meta: frEn("QUI", "WHO"),
      blocks: [
        {
          kind: "p",
          text: frEn(`Le responsable du traitement est l'association **${ASSOCIATION_NAME}**, association loi 1901 dont le siège est situé au ${ASSOCIATION_SEAT}. Elle a chargé **${DATA_CONTACT_NAME}**, hébergeur technique du site, de recevoir les demandes relatives à vos données ; ce n'est pas un délégué à la protection des données au sens de l'article 37 du RGPD. Les moyens de les joindre figurent à la section Contact.`,
            `The data controller is the association **${ASSOCIATION_NAME}**, a French non-profit association under the law of 1901 whose registered office is at ${ASSOCIATION_SEAT}. It has put **${DATA_CONTACT_NAME}**, the website's technical host, in charge of receiving requests about your data; this person is not a data protection officer within the meaning of Article 37 GDPR. The means of contacting them are listed in the Contact section.`),
        },
        {
          kind: "p",
          text: frEn(`Le Bot est réservé aux personnes d'au moins ${BOT_MINIMUM_AGE} ans ([Conditions d'Utilisation](${TERMS_HREF})).`,
            `The Bot is intended for people aged ${BOT_MINIMUM_AGE} or over ([Terms of Service](${TERMS_HREF})).`),
        },
      ],
    },
    dataProcessed: {
      title: frEn("Données traitées et finalités", "Data processed and purposes"),
      meta: frEn("COLLECTE", "COLLECTION"),
      blocks: [
        {
          kind: "subhead",
          text: frEn("Annonces relayées", "Relayed advertisements"),
        },
        {
          kind: "p",
          text: frEn(`Identifiant du message d'origine et de son auteur, date, identifiants des copies relayées et de leurs salons : ils servent à relayer l'annonce, à répercuter sa modification ou sa suppression, à appliquer le temps de recharge entre deux annonces, au compteur de messages de **/stats**, aux statistiques du tableau de bord du bot et, en cas d'exclusion, à retrouver et retirer les copies des annonces de l'exclu. **Le contenu du message n'est pas enregistré dans la base du Bot** : il est recopié, avec le nom de son auteur, dans les salons des serveurs partenaires, où leurs membres le lisent. Ces copies sont des messages Discord : supprimer l'annonce d'origine dans les ${BOT_RELAY_RETENTION_DAYS} jours supprime aussi ses copies ; passé ce délai, elles restent jusqu'à leur suppression par les administrateurs du serveur qui les porte.`,
            `ID of the original message and of its author, date, IDs of the relayed copies and of their channels: they are used to relay the advertisement, to pass on its edits or deletion, to apply the cooldown between two advertisements, for the message count of **/stats**, for the bot's dashboard statistics and, on an exclusion, to find and remove the copies of the excluded user's advertisements. **Message content is not stored in the Bot's database**: it is copied, with its author's name, into the channels of partner servers, where their members read it. These copies are Discord messages: deleting the original advertisement within ${BOT_RELAY_RETENTION_DAYS} days also deletes its copies; after that, they remain until the administrators of the server holding them delete them.`),
        },
        {
          kind: "subhead",
          text: frEn("Scrims et recrutement", "Scrims and recruitment"),
        },
        {
          kind: "p",
          text: frEn(`Pour les commandes **/scrim** et **/recrute** : identifiant de l'auteur, jeu, niveau ou rôle recherché, serveur et date, qui alimentent les statistiques d'activité (commande **/stats**, qui ne montre à chacun que sa propre activité, et tableau de bord du bot). Au-delà de ${BOT_ACTIVITY_AUTHOR_RETENTION_DAYS} jours, ces lignes sont repliées en simples nombres par jour, serveur et niveau (ou rôle), sans l'identifiant de l'auteur ; ces nombres sont conservés sans limite de durée, comme historique de l'activité du Bot. Le niveau (Débutant, Intermédiaire, Avancé) et le rôle (Tank, DPS, Heal, Coach, Manager) se choisissent dans une liste fermée ; une valeur saisie en texte libre avant cette règle a été ramenée au choix de la liste qu'elle désignait exactement, et sinon remplacée par « non précisé », y compris dans les nombres par jour.`,
            `For the **/scrim** and **/recrute** commands: author ID, game, level or role sought, server and date, which feed the activity statistics (**/stats** command, which only shows each user their own activity, and the bot's dashboard). After ${BOT_ACTIVITY_AUTHOR_RETENTION_DAYS} days these rows are folded into plain counts per day, server and level (or role), without the author's ID; these counts are kept with no time limit, as a history of the Bot's activity. The level (Débutant, Intermédiaire, Avancé) and the role (Tank, DPS, Heal, Coach, Manager) are chosen from a closed list; a value typed as free text before this rule has been mapped onto the list choice it named exactly, and otherwise replaced with "unspecified", including in the per-day counts.`),
        },
        {
          kind: "subhead",
          text: frEn("Exclusions du relais", "Relay exclusions"),
        },
        {
          kind: "p",
          text: frEn("Identifiants de l'utilisateur exclu et du modérateur, date, et référence du message de journal qui porte le motif. Les identifiants de l'exclu et du modérateur et le motif sont publiés dans le salon de journal privé du staff ; le motif part aussi en message privé au titulaire du Bot. Ces messages sont supprimés, dans le salon comme en message privé, à la levée de l'exclusion (section 03, qui précise le cas d'une exclusion antérieure à cette règle). Une exclusion vaut pour **tout le réseau** de serveurs partenaires : c'est une modération communautaire, prononcée (**/ban-user-of-this-server**, **/ban-user-of-another-server**) et levée (**/unban**) par les administrateurs — et les titulaires du rôle d'administration du Bot — de tout serveur d'au moins 50 membres (comptes de bots compris) où le Bot est installé, ainsi que, depuis ces mêmes serveurs, par le titulaire du Bot et la présidence de l'association ; les serveurs de l'association sont dispensés de ce seuil (section « Modération du relais » des Conditions d'Utilisation). La commande **/ban-list** affiche donc la liste complète des exclusions du réseau (pseudos, motif, date, identifiant) aux administrateurs de tout serveur où le Bot est installé — y compris un serveur que l'on crée soi-même pour l'y inviter — et aux titulaires du rôle d'administration du Bot, pour qu'ils sachent qui ne peut plus publier par le Bot et pourquoi.",
            "IDs of the excluded user and of the moderator, date, and a reference to the log message holding the reason. The IDs of the excluded user and of the moderator, and the reason, are posted in the staff's private log channel; the reason is also sent by direct message to the Bot's owner. These messages are deleted, in the channel and in the direct messages alike, when the exclusion is lifted (section 03, which details the case of an exclusion issued before this rule). An exclusion applies to the **whole network** of partner servers: this is community moderation, decided (**/ban-user-of-this-server**, **/ban-user-of-another-server**) and lifted (**/unban**) by the administrators — and the holders of the Bot administration role — of any server with at least 50 members (bot accounts included) where the Bot is installed, as well as, from those same servers, by the Bot's owner and the association's presidency; the association's servers are exempt from this threshold (« Relay moderation » section of the Terms of Service). The **/ban-list** command therefore shows the full list of network exclusions (usernames, reason, date, ID) to the administrators of any server where the Bot is installed — including a server one creates oneself to invite it — and to the holders of the Bot administration role, so that they know who can no longer post through the Bot and why."),
        },
        {
          kind: "subhead",
          text: frEn("Adhésions et rappels programmés", "Memberships and scheduled reminders"),
        },
        {
          kind: "bullets",
          items: [
            frEn("**Adhésions à l'association** (commandes réservées aux serveurs de l'association) : quand l'adhésion d'un membre est validée, le Bot lui envoie en message privé la confirmation, et l'attestation d'adhésion si elle est jointe, sans la conserver ; il enregistre alors un rappel pour la date de péremption de l'adhésion — ce qui revient à garder, jusqu'à ce rappel, le fait que ce membre adhère à l'association et jusqu'à quand.",
              "**Association memberships** (commands restricted to the association's servers): when a member's membership is validated, the Bot sends them the confirmation by direct message, with the membership certificate if one is attached, without keeping it; it then records a reminder for the membership's expiry date — which means keeping, until that reminder, the fact that this member belongs to the association and until when."),
            frEn("**Rappels programmés** (mêmes commandes) : identifiant du membre ou du rôle visé et de l'auteur, message, date du prochain envoi et fréquence.",
              "**Scheduled reminders** (same commands): ID of the targeted member or role and of the author, message, next sending date and frequency."),
          ],
        },
        {
          kind: "subhead",
          text: frEn("Configuration des serveurs", "Server configuration"),
        },
        {
          kind: "p",
          text: frEn("Identifiants des serveurs, salons et rôles configurés, invitation du serveur, et identifiant de l'administrateur qui a posé l'invitation ou le rôle d'arbitrage.",
            "IDs of the configured servers, channels and roles, the server's invite, and the ID of the administrator who set the invite or the referee role."),
        },
        {
          kind: "subhead",
          text: frEn("Messages du site BlueGenji", "Messages from the BlueGenji website"),
        },
        {
          kind: "p",
          text: frEn(`Le site transmet au Bot un identifiant ou un pseudo Discord, le pseudo BlueGenji du destinataire, pour le seul code (connexion, certification ou changement du tag Discord) la langue du compte BlueGenji déjà rattaché à ce compte Discord (français ou anglais, dans laquelle le Bot rédige le code ; sans compte rattaché, le code part en français puis en anglais), et le message à remettre (code de connexion, horaire ou rappel de match, avis de retrait d'un match (« Match retiré »), check-in d'un match en autogestion envoyé à ceux qui gèrent ses engagées (ou au joueur d'une entrée individuelle), avis envoyé à un caster dont l'inscription est retirée par un autre que lui, alerte d'arbitrage, signalement ; avis de modération — signalement vous désignant, logo d'équipe masqué, retiré ou supprimé, avatar masqué, retiré ou rétabli, suspension de votre compte ou sa levée — ; demande d'adhésion à une équipe que vous gérez ; invitation d'une équipe, reprise d'une équipe fantôme que le staff vous propose ou propriété de votre équipe qui vous est transférée, qui ne nomment que l'équipe ; information sur les données) ; le Bot remet les messages personnels (code, horaire, rappel, retrait d'un match, check-in du match, retrait d'un cast, avis de modération, demande d'adhésion, invitation, reprise ou propriété d'équipe, information) en message privé **sans les enregistrer** ; ceux des matchs (horaire, rappel, retrait d'un match, check-in du match, retrait d'un cast) ne partent qu'aux comptes dont le tag Discord est certifié sur le site — un tag non certifié, même rattaché par la connexion Discord, n'en reçoit aucun, pour éviter le spam ; chaque destinataire (joueur, membre d'une engagée ou caster) peut couper ceux de ses matchs (horaire, rappel, retrait d'un match, check-in du match, retrait d'un cast) dans « Mon profil » sur le site. Les alertes d'arbitrage et les signalements, qui ne nomment aucun joueur (noms d'équipe et liens de tournoi seulement), sont en outre publiés dans le salon de journal privé du staff ; les alertes d'arbitrage partent aussi en message privé aux membres du rôle d'arbitrage de chaque serveur qui en a défini un (**/set-referee-role**), les signalements à la direction de l'association. Au début et à la fin d'un match diffusé, le site transmet aussi au Bot le texte de l'annonce de la soirée (noms des deux équipes — en tournoi individuel, le pseudo public BlueGenji de chaque joueur, « un joueur » pour une entrée sans compte, un compte supprimé ou une inscription antérieure au 16 octobre 2026 —, nom du tournoi, heure, état et score de chaque match, lien de la diffusion), que le Bot publie dans le salon #live du serveur Discord de l'association, en un message par soirée (quatre heures depuis le premier direct) qui liste les matchs en direct, ceux programmés d'ici la fin de la soirée et ceux terminés (« Terminé », avec leur score), et qu'il modifie à chaque début et à chaque fin de match, jusqu'à quatre heures après la fin de la soirée (un nouveau message sans mention prend le relais quand il ne peut plus être modifié), avec une mention @everyone pour la chaîne officielle de l'association ou du seul rôle StreamViewer pour toute autre chaîne. Les messages privés du site partent dans la langue du compte BlueGenji du destinataire, ou en un seul message en français puis en anglais quand elle n'est pas connue (direction de l'association, membres du rôle d'arbitrage, compte inconnu), en français seul si les deux ne tiennent pas dans un message ; les messages publiés dans les salons restent en français. Ces traitements relèvent de la [politique de confidentialité du site](${SITE_PRIVACY_HREF}).`,
            `The website sends the Bot a Discord ID or username, the recipient's BlueGenji username, for the code only (login, certification or change of the Discord tag) the language of the BlueGenji account already linked to that Discord account (French or English, in which the Bot writes the code; without a linked account, the code is sent in French then in English), and the message to deliver (login code, match time or reminder, notice of removal from a match (“Match retiré”), check-in of a self-managed match sent to those who manage its entrants (or to the player of a solo entry), notice to a caster that someone else removed their registration for a match, referee alert, report; moderation notice — a report naming you, a team logo masked, removed or deleted, an avatar hidden, removed or restored, the suspension of your account or its lifting —; join request for a team you manage; a team's invitation, the takeover of a ghost team the staff offers you or the ownership of your team transferred to you, which only name the team; data-protection notice); the Bot delivers personal messages (code, match time, reminder, removal from a match, match check-in, removal of a cast, moderation notice, join request, team invitation, takeover or ownership, data-protection notice) by direct message **without storing them**; those about matches (time, reminder, removal from a match, match check-in, removal of a cast) only go to accounts with a Discord tag certified on the website — an uncertified tag, even one linked by signing in with Discord, receives none, to avoid spam; each recipient (player, member of an entrant or caster) can turn off those about their matches (time, reminder, removal from a match, match check-in, removal of a cast) in “My profile” on the website. Referee alerts and reports, which name no player (team names and tournament links only), are also posted in the staff's private log channel; referee alerts are also sent by direct message to the members of the referee role of every server that has set one (**/set-referee-role**), reports to the association's management. When a streamed match starts and ends, the website also sends the Bot the text of the evening's announcement (names of both teams — in a solo tournament, each player's public BlueGenji username, “a player” for an entry without an account, a deleted account or a registration made before 16 October 2026 —, tournament name, time, state and score of each match, stream link), which the Bot posts in the #live channel of the association's Discord server, in one message per evening (four hours from the first live stream) that lists the matches live, those scheduled until the end of the evening and those finished (“Terminé”, with their score), and that it edits at each match start and end, up to four hours after the evening ends (a new message without a mention takes over when it can no longer be edited), with an @everyone mention for the association's official channel or a mention of the StreamViewer role only for any other channel. The website's direct messages are written in the language of the recipient's BlueGenji account, or as a single message in French then in English when it is not known (the association's leadership, members of the referee role, an unknown account), in French alone when both do not fit in one message; messages posted in channels stay in French. This processing falls under the [website's privacy policy](${SITE_PRIVACY_HREF}).`),
        },
        {
          kind: "subhead",
          text: frEn("Journaux", "Logs"),
        },
        {
          kind: "p",
          text: frEn("Le fil d'activité public de la page du bot ne contient aucun identifiant Discord ; il reprend l'heure, le nom du serveur et le niveau ou le rôle choisi avec **/scrim** ou **/recrute**. Le salon de journal privé du staff et les journaux du serveur reçoivent le nom des serveurs qui ajoutent ou retirent le Bot, les erreurs de fonctionnement, qui peuvent citer un identifiant Discord, et le journal d'activité du site (inscriptions, matchs, tournois), rédigé par le site sans pseudo de joueur. Le Bot n'y écrit plus de pseudo de lui-même (les messages antérieurs à cette règle peuvent en citer) : le motif d'une exclusion, texte libre du modérateur, peut en citer un, et une erreur de remise d'un message privé peut mentionner le compte visé.",
            "The public activity feed on the bot's page contains no Discord ID; it repeats the time, the server name and the level or role chosen with **/scrim** or **/recrute**. The staff's private log channel and the server logs receive the names of servers that add or remove the Bot, operating errors, which may mention a Discord ID, and the website's activity journal (sign-ups, matches, tournaments), written by the website without any player's username. The Bot no longer writes usernames there on its own (messages older than this rule may quote some): the reason for an exclusion, free text written by the moderator, may quote one, and a failed direct-message delivery may mention the account concerned."),
        },
        {
          kind: "subhead",
          text: frEn("Salons vocaux d'équipe des matchs", "Team voice channels for matches"),
        },
        {
          kind: "p",
          text: frEn("Dans les tournois BlueGenji qui en ont l'option, le Bot crée sur le serveur Discord de l'association un salon vocal par équipe d'un match, au nom que le site lui transmet (le nom de l'équipe), et le supprime une fois rendu et vide. Il en garde une fiche : identifiant du salon, clé du match et de l'équipe (des numéros, aucun nom), heures de création et de rendu. Pour savoir si un salon est vide, il tient en mémoire en permanence, que l'option soit allumée ou non dans un tournoi, sans jamais l'enregistrer ni le transmettre au site, l'état vocal des membres du serveur de l'association (identifiant du membre et de sa session vocale, salon, micro, son, caméra ou partage d'écran), avec la fiche de membre que Discord y joint (dont pseudo, surnom, avatar et rôles) — pour les autres serveurs, seule cette fiche jointe est gardée en mémoire. Il ne compte personne et ne dit jamais au site qui se trouve dans un salon. Le détail figure au [paragraphe « Salons vocaux d'équipe » de la politique de confidentialité du site](/rgpd#salons-vocaux) (traitement T18).",
            "In BlueGenji tournaments with that option, the Bot creates on the association's Discord server one voice channel per team of a match, under the name the website sends it (the team's name), and deletes it once handed back and empty. It keeps a record of it: channel ID, key of the match and team (numbers, no name), creation and hand-back times. To know whether a channel is empty, it holds in memory at all times, whether or not a tournament has the option on, without ever recording it or sending it to the website, the voice state of the members of the association's server (ID of the member and of their voice session, channel, microphone, sound, camera or screen sharing), with the member profile Discord attaches to it (including username, nickname, avatar and roles) — for other servers, only that attached profile is kept in memory. It counts no one and never tells the website who is in a channel. The details are in the [“Team voice channels” paragraph of the website's privacy policy](/rgpd#salons-vocaux) (processing activity T18)."),
        },
        {
          kind: "subhead",
          text: frEn("Base légale", "Legal basis"),
        },
        {
          kind: "p",
          text: frEn("Ces traitements reposent sur l'**intérêt légitime** de l'association (article 6.1.f du RGPD) : faire fonctionner le relais entre serveurs partenaires, le modérer et en mesurer l'activité. Les salons vocaux d'équipe reposent aussi sur son intérêt légitime (bon déroulement des tournois). Les messages du site reposent sur la base légale de leur traitement d'origine, indiquée dans le registre du site : intérêt légitime pour les messages privés de match d'un joueur (horaire, rappels, « Match retiré »), le check-in d'un match en autogestion envoyé à ceux qui gèrent ses engagées (ou au joueur d'une entrée individuelle) et l'avis envoyé à un caster dont l'inscription est retirée par un autre que lui, auxquels chacun s'oppose par l'interrupteur de « Mon profil » — le site garde ce choix au titre d'une obligation légale (article 6.1.c du RGPD), pour continuer d'honorer cette opposition ; exécution du service auquel le joueur s'inscrit pour son pseudo public dans l'annonce #live d'un tournoi individuel ; intérêt légitime de l'association à modérer son serveur pour l'alerte AutoMod d'une telle annonce bloquée ou signalée, supprimée sur demande.",
            "This processing is based on the association's **legitimate interest** (Article 6(1)(f) GDPR): running the relay between partner servers, moderating it and measuring its activity. Team voice channels also rest on its legitimate interest (smooth running of tournaments). Messages from the website rely on the legal basis of their original processing, set out in the website's register: legitimate interest for a player's match direct messages (time, reminders, “Match retiré”), the check-in of a self-managed match sent to those who manage its entrants (or to the player of a solo entry) and the notice sent to a caster whose registration someone else removes, which each of them objects to with the switch in “My profile” — the website keeps that choice under a legal obligation (Article 6(1)(c) GDPR), to keep honouring that objection; performance of the service the player registers for, for their public username in the #live announcement of a solo tournament; the association's legitimate interest in moderating its server for the AutoMod alert of such an announcement when blocked or flagged, deleted on request."),
        },
      ],
    },
    retention: {
      title: frEn("Durées de conservation", "Retention periods"),
      meta: frEn("DURÉES", "RETENTION"),
      blocks: [
        {
          kind: "bullets",
          items: [
            frEn(`**Suivi des annonces relayées** (identifiants, date) : ${BOT_RELAY_RETENTION_DAYS} jours ; il est effacé au premier relais qui suit cette échéance, et au plus tard dans la nuit ou au redémarrage du Bot. Les copies publiées dans les salons partenaires restent sur Discord (section 02).`,
              `**Tracking of relayed advertisements** (IDs, date): ${BOT_RELAY_RETENTION_DAYS} days; it is erased at the first relay after that deadline, and at the latest during the night or when the Bot restarts. The copies posted in partner channels remain on Discord (section 02).`),
            frEn(`**Scrims et recrutement** : ${BOT_ACTIVITY_AUTHOR_RETENTION_DAYS} jours avec l'identifiant de l'auteur ; lors du ménage de la nuit qui suit (ou d'un redémarrage du Bot), l'identifiant de l'auteur est effacé et les lignes sont repliées en nombres par jour, serveur et niveau (ou rôle), gardés sans limite de durée comme historique de l'activité du Bot.`,
              `**Scrims and recruitment**: ${BOT_ACTIVITY_AUTHOR_RETENTION_DAYS} days with the author's ID; at the clean-up of the following night (or a restart of the Bot), the author's ID is erased and the rows are folded into counts per day, server and level (or role), kept with no time limit as a history of the Bot's activity.`),
            frEn("**Exclusions** : l'enregistrement de l'exclusion, jusqu'à sa levée ; l'avis et le motif publiés au salon de journal privé du staff, et le motif copié en message privé au titulaire du Bot, sont supprimés à la levée. Pour une exclusion prononcée avant cette règle, seul le motif publié au salon l'est : le reste suit la durée du salon de journal (ci-dessous).",
              "**Exclusions**: the exclusion record, until it is lifted; the notice and the reason posted in the staff's private log channel, and the reason copied by direct message to the Bot's owner, are deleted when it is lifted. For an exclusion issued before this rule, only the reason posted in the channel is: the rest follows the log channel's period (below)."),
            frEn(`**Fil d'activité public** (heure, serveur, niveau ou rôle de chaque évènement) : ${BOT_FEED_EVENT_RETENTION_DAYS} jours, supprimé lors du ménage de la nuit qui suit.`,
              `**Public activity feed** (time, server, level or role of each event): ${BOT_FEED_EVENT_RETENTION_DAYS} days, deleted at the clean-up of the following night.`),
            frEn("**Configuration des serveurs** (salons relayés et leurs filtres de rang, invitation et rôle d'arbitrage avec l'identifiant de qui les a posés, rôle d'administration du Bot, modules activés) : jusqu'à son retrait par les administrateurs, au plus tard jusqu'au départ du Bot du serveur, qui l'efface. Un départ survenu pendant une interruption du Bot, que Discord ne lui signale pas, est rattrapé à son redémarrage.",
              "**Server configuration** (relayed channels and their rank filters, the invite and the referee role with the ID of whoever set them, the Bot administration role, enabled modules): until the administrators remove it, and at the latest until the Bot leaves the server, which erases it. A departure while the Bot is down, which Discord does not notify, is caught up when it restarts."),
            frEn("**Adhésions et rappels programmés** : jusqu'au dernier envoi du rappel (pour une adhésion, sa date de péremption) ou sa suppression, au plus tard jusqu'au départ du Bot du serveur où ils ont été enregistrés, qui les efface — départ survenu pendant une interruption compris, rattrapé au redémarrage.",
              "**Memberships and scheduled reminders**: until the reminder's last sending (for a membership, its expiry date) or its deletion, and at the latest until the Bot leaves the server where they were recorded, which erases them — including a departure while the Bot is down, caught up when it restarts."),
            frEn(`**Salon de journal privé du staff** (et messages privés du Bot à son titulaire) : un an (${BOT_STAFF_LOG_RETENTION_DAYS} jours) ; les messages du Bot plus anciens sont supprimés par le ménage de nuit, par lots (plusieurs nuits pour un arriéré important), sauf le motif publié au salon d'une exclusion en cours — et, pour une exclusion prononcée à partir de cette règle, son avis et la copie de son motif en message privé —, supprimés à sa levée.`,
              `**Staff private log channel** (and the Bot's direct messages to its owner): one year (${BOT_STAFF_LOG_RETENTION_DAYS} days); older messages from the Bot are deleted by the nightly clean-up, in batches (several nights for a large backlog), except the reason posted in the channel for an exclusion still in force — and, for an exclusion issued from this rule on, its notice and the copy of its reason by direct message —, deleted when it is lifted.`),
            frEn(`**Salons vocaux d'équipe** : le salon est supprimé dès qu'il est vide une fois rendu, au plus tard ${VOICE_BOT_RELEASED_MAX_HOURS} heures et ${VOICE_BOT_SWEEP_MINUTES} minutes après son rendu même occupé ; jamais rendu, il est supprimé s'il est vide ${VOICE_BOT_UNRELEASED_MAX_HOURS} heures après sa création ou sa reprise ; sa fiche part avec lui, ou est oubliée ${VOICE_BOT_ABANDONED_MAX_HOURS} heures après sa création ou sa reprise si le Bot ne peut plus lire le salon, et reste sans limite tant qu'un salon jamais rendu reste occupé ou que Discord empêche sa suppression. L'état vocal et les fiches de membre ne sont tenus qu'en mémoire, à jour de Discord, et perdus à l'arrêt du Bot. Le journal d'audit de Discord garde la création et la suppression de chaque salon, avec son nom, pour la durée que Discord fixe.`,
              `**Team voice channels**: the channel is deleted as soon as it is empty once handed back, within ${VOICE_BOT_RELEASED_MAX_HOURS} hours and ${VOICE_BOT_SWEEP_MINUTES} minutes of being handed back at the latest even if occupied; never handed back, it is deleted if it is empty ${VOICE_BOT_UNRELEASED_MAX_HOURS} hours after its creation or its reuse; its record goes with it, or is forgotten ${VOICE_BOT_ABANDONED_MAX_HOURS} hours after its creation or its reuse if the Bot can no longer read the channel, and stays with no limit while a channel never handed back stays occupied or while Discord prevents its deletion. Voice state and member profiles are only held in memory, kept up to date by Discord, and lost when the Bot stops. Discord's audit log keeps the creation and deletion of each channel, with its name, for the period Discord sets.`),
            frEn("**Journaux du serveur** : selon leur rotation automatique.",
              "**Server logs**: according to their automatic rotation."),
            frEn("**Annonces #live** (message de la soirée des matchs diffusés : noms d'équipe ou, en tournoi individuel, pseudo public BlueGenji des joueurs) : gardées dans le salon tant qu'il existe, même après la suppression du compte du joueur ; supprimées sur demande de l'équipe ou du joueur concerné (formulaire « Signaler un problème » du site, catégorie RGPD). Une annonce bloquée ou signalée par une règle AutoMod : son alerte reste dans le salon d'alertes de modération jusqu'à sa suppression par les modérateurs, et est supprimée sur demande de la même façon.",
              "**#live announcements** (evening message of the streamed matches: team names or, in a solo tournament, the players' public BlueGenji username): kept in the channel as long as it exists, even after the player's account is deleted; deleted at the request of the team or player concerned (the website's “Report a problem” form, GDPR category). An announcement blocked or flagged by an AutoMod rule: its alert stays in the moderation alert channel until the moderators delete it, and is deleted on request in the same way."),
            // « Au plus » tient bien que l'archive ne soit faite que deux fois par
            // semaine (dimanche et mardi soir) : la purge
            // (`rclone delete --min-age`) est refaite **chaque heure** par
            // `blueGenjiBot/scripts/sync-uploads-onedrive.sh` (nom historique), et pas seulement
            // par la sauvegarde — même promesse que T09 et `/rgpd`.
            frEn(`**Sauvegardes** : la base du Bot est sauvegardée deux fois par semaine (dimanche et mardi soir), chiffrée, et chaque copie est supprimée définitivement au bout de ${BACKUP_RETENTION_DAYS} jours au plus. Une restauration se fait depuis ces archives, déchiffrées sur la machine du Bot : la base ne transite plus par Discord ; la copie de la base précédente qu'elle laisse à côté est supprimée à la restauration réussie suivante, au plus tard dans la nuit qui suit ses ${BACKUP_RETENTION_DAYS} jours.`,
              `**Backups**: the Bot's database is backed up twice a week (Sunday and Tuesday evenings), encrypted, and each copy is permanently deleted after ${BACKUP_RETENTION_DAYS} days at most. A restore is made from these archives, decrypted on the Bot's machine: the database no longer travels through Discord; the copy of the previous database it leaves alongside is deleted at the next successful restore, and at the latest during the night after it turns ${BACKUP_RETENTION_DAYS} days old.`),
          ],
        },
      ],
    },
    recipients: {
      title: frEn("Destinataires", "Recipients"),
      meta: frEn("QUI Y ACCÈDE", "WHO HAS ACCESS"),
      blocks: [
        {
          kind: "bullets",
          items: [
            frEn("Le staff de l'association, pour la modération et l'administration du Bot.",
              "The association's staff, for moderating and administering the Bot."),
            frEn("Le titulaire du Bot (son hébergeur technique), qui reçoit en message privé les motifs d'exclusion.",
              "The Bot's owner (its technical host), who receives exclusion reasons by direct message."),
            frEn("L'utilisateur exclu, à qui le Bot remet le motif de son exclusion en message privé quand il publie une annonce (message portant un service) dans un salon relayé.",
              "The excluded user, to whom the Bot sends the reason for their exclusion by direct message when they post an advertisement (a message naming a service) in a relayed channel."),
            frEn("Les membres du salon où **/scrim** ou **/recrute** est utilisée : la commande y répond publiquement, et Discord y affiche qui l'a utilisée.",
              "The members of the channel where **/scrim** or **/recrute** is used: the command replies publicly there, and Discord shows who used it."),
            frEn("Les membres des serveurs partenaires, qui lisent les annonces relayées.",
              "Members of partner servers, who read the relayed advertisements."),
            frEn("Les membres du rôle d'arbitrage de chaque serveur qui en a défini un, pour les alertes d'arbitrage du site.",
              "Members of the referee role of every server that has set one, for the website's referee alerts."),
            frEn("Les membres du serveur Discord de l'association, qui lisent dans le salon #live l'annonce des matchs diffusés.",
              "Members of the association's Discord server, who read the announcement of streamed matches in the #live channel."),
            frEn("Les membres du serveur Discord de l'association autorisés dans la catégorie des matchs, qui voient les salons vocaux d'équipe et leurs occupants, et son administration, qui lit dans le journal d'audit de Discord la création et la suppression de chaque salon, avec son nom.",
              "Members of the association's Discord server allowed in the match category, who see the team voice channels and their occupants, and its administration, which reads in Discord's audit log the creation and deletion of each channel, with its name."),
            frEn("Les modérateurs du serveur Discord de l'association : si une règle AutoMod de Discord bloque ou signale une annonce #live, son texte (pseudo public compris en tournoi individuel) peut parvenir au salon d'alertes de modération du serveur.",
              "Moderators of the association's Discord server: if a Discord AutoMod rule blocks or flags a #live announcement, its text (including the public username in a solo tournament) may reach the server's moderation alert channel."),
            frEn("Les administrateurs de tout serveur où le Bot est installé, et les titulaires du rôle d'administration du Bot que chaque serveur désigne (**/set-bot-admin**), qui peuvent lire la liste des exclusions (commande **/ban-list**, réponse visible du seul demandeur).",
              "The administrators of any server where the Bot is installed, and the holders of the Bot administration role each server designates (**/set-bot-admin**), who can read the list of exclusions (**/ban-list** command, reply visible only to the person who asked)."),
            frEn(`L'hébergeur technique, ${SITE_HOST.name}, qui fournit la machine sur laquelle tourne le Bot (${SITE_HOST.machine}) : sous-traitant.`,
              `The technical host, ${SITE_HOST.name}, who provides the machine the Bot runs on (${SITE_HOST.machineEn}): processor.`),
            frEn("Discord, plateforme sur laquelle le Bot fonctionne.",
              "Discord, the platform the Bot runs on."),
            frEn("Hetzner Online GmbH (Allemagne), qui stocke les sauvegardes, chiffrées avant envoi avec des clés que Hetzner ne détient pas, dans l'Union européenne : sous-traitant ultérieur, par l'hébergeur technique.",
              "Hetzner Online GmbH (Germany), which stores the backups, encrypted before upload with keys Hetzner does not hold, within the European Union: sub-processor, through the technical host."),
            frEn("Microsoft, qui héberge la messagerie personnelle (Outlook.com) de l'hébergeur technique, par où passent, non chiffrées par l'association et lisibles par Microsoft, toute demande relative à vos données que vous envoyez par courriel à l'hébergeur technique et la réponse que celui-ci vous adresse par courriel.",
              "Microsoft, which hosts the technical host's personal mailbox (Outlook.com), through which any request about your data that you email to them, and their emailed reply, pass without encryption by the association, readable by Microsoft."),
            frEn("L'opérateur téléphonique de l'hébergeur technique, si vous l'appelez ou lui laissez un SMS ou un message vocal au sujet de vos données.",
              "The technical host's phone operator, if you call them or leave them a text or voicemail about your data."),
            frEn("Aucune donnée n'est vendue, ni cédée à d'autres destinataires que ceux listés ici.",
              "No data is sold, or handed over to any recipient other than those listed here."),
          ],
        },
      ],
    },
    transfers: {
      title: frEn("Transferts hors de l'Union européenne", "Transfers outside the European Union"),
      meta: frEn("TRANSFERTS", "TRANSFERS"),
      blocks: [
        {
          kind: "bullets",
          items: [
            frEn(`**Discord** (États-Unis) : ${DPF_ADEQUACY_DECISION}.`,
              `**Discord** (United States): ${DPF_ADEQUACY_DECISION_EN}.`),
            frEn(`**Microsoft** : transfert possible vers les États-Unis, Microsoft ne garantissant pas le lieu de stockage d'un compte personnel ; une demande envoyée par courriel à l'hébergeur technique, et sa réponse par courriel, lui parviennent non chiffrées par l'association, donc lisibles par Microsoft — ${DPF_ADEQUACY_DECISION}.`,
              `**Microsoft**: possible transfer to the United States, as Microsoft does not guarantee the storage location of a personal account; a request emailed to the technical host, and their emailed reply, reach it without encryption by the association, and so readable by Microsoft — ${DPF_ADEQUACY_DECISION_EN}.`),
            frEn("Depuis le 1er octobre 2026, les sauvegardes sont envoyées chez Hetzner, en Allemagne : elles ne font l'objet d'aucun transfert hors de l'Union.",
              "Since 1 October 2026, backups are sent to Hetzner, in Germany: they are not transferred outside the Union."),
          ],
        },
      ],
    },
    rights: {
      title: frEn("Vos droits", "Your rights"),
      meta: frEn("RGPD", "GDPR"),
      blocks: [
        {
          kind: "p",
          text: frEn("Vous disposez sur vos données des droits suivants :",
            "You have the following rights over your data:"),
        },
        {
          kind: "bullets",
          items: [
            frEn("**Accès** : savoir quelles données le Bot conserve sur vous et en obtenir une copie.",
              "**Access**: find out what data the Bot keeps about you and obtain a copy."),
            frEn("**Rectification** : faire corriger une donnée inexacte.",
              "**Rectification**: have inaccurate data corrected."),
            frEn("**Effacement** : faire supprimer vos données ; certaines fonctions du Bot peuvent alors ne plus vous être rendues.",
              "**Erasure**: have your data deleted; some Bot features may then no longer be available to you."),
            frEn("**Limitation** : faire geler l'utilisation d'une donnée le temps d'examiner une contestation.",
              "**Restriction**: have the use of data frozen while a dispute is examined."),
            frEn("**Opposition** : vous opposer, pour des raisons tenant à votre situation particulière, à un traitement fondé sur l'intérêt légitime. Le pseudo d'un joueur dans l'annonce #live d'un tournoi individuel n'en relève pas : il repose sur l'exécution du service auquel il s'inscrit — ne pas y être nommé revient à ne pas s'inscrire ; une annonce passée est supprimée sur demande (formulaire « Signaler un problème » du site, catégorie RGPD). La conservation par le site de votre choix des messages privés de match n'en relève pas non plus : elle repose sur une obligation légale, celle de continuer d'honorer votre opposition à ces messages.",
              "**Objection**: object, on grounds relating to your particular situation, to processing based on legitimate interest. A player's username in the #live announcement of a solo tournament is not covered: it rests on performance of the service they register for — not being named in it means not registering; a past announcement is deleted on request (the website's “Report a problem” form, GDPR category). Nor is the site's keeping of your match direct messages choice: it rests on a legal obligation, that of continuing to honour your objection to those messages."),
          ],
        },
        {
          kind: "p",
          text: frEn(`Le droit à la portabilité ne s'applique pas aux traitements propres au Bot : ils reposent sur l'intérêt légitime, non sur un consentement ou un contrat ; pour les messages du site qu'il remet, voir la [politique de confidentialité du site](${SITE_RIGHTS_HREF}). Pour exercer vos droits, utilisez les moyens de la section Contact ; une réponse vous est apportée dans un délai d'un mois.`,
            `The right to data portability does not apply to the Bot's own processing: it is based on legitimate interest, not on consent or a contract; for the website's messages it delivers, see the [website's privacy policy](${SITE_RIGHTS_HREF}). To exercise your rights, use the means listed in the Contact section; you will receive a reply within one month.`),
        },
        {
          kind: "p",
          text: frEn(`Si vous estimez que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à la [CNIL](${CNIL_COMPLAINT_URL}).`,
            `If you consider that your rights are not respected, you may lodge a complaint with the [CNIL](${CNIL_COMPLAINT_URL}), the French data protection authority.`),
        },
      ],
    },
    security: {
      title: frEn("Sécurité", "Security"),
      meta: "PROTECTION",
      blocks: [
        {
          kind: "bullets",
          items: [
            frEn("La base du Bot vit sur la machine de l'hébergeur technique, dont l'accès est réservé au responsable technique (authentification par clé SSH).",
              "The Bot's database lives on the technical host's machine, access to which is restricted to the technical manager (SSH key authentication)."),
            frEn("Les échanges entre le site et le Bot restent sur cette machine et sont protégés par un jeton.",
              "Exchanges between the website and the Bot stay on that machine and are protected by a token."),
            frEn("Les sauvegardes sont chiffrées sur cette machine avant tout envoi.",
              "Backups are encrypted on that machine before any upload."),
          ],
        },
        {
          kind: "p",
          text: frEn("Aucune mesure ne rend un système infaillible : en cas de violation de données présentant un risque pour vous, l'association est tenue de la notifier à la CNIL et, si le risque est élevé, aux personnes concernées (articles 33 et 34 du RGPD).",
            "No measure makes a system infallible: in the event of a data breach likely to put you at risk, the association is required to notify the CNIL and, if the risk is high, the people concerned (Articles 33 and 34 GDPR)."),
        },
      ],
    },
    policyChanges: {
      title: frEn("Modifications de cette politique", "Changes to this policy"),
      meta: frEn("ÉVOLUTIONS", "UPDATES"),
      blocks: [
        {
          kind: "p",
          text: frEn(`Cette politique peut évoluer avec le Bot. La version en vigueur est celle publiée sur cette page, avec sa date de mise à jour ; les changements importants sont annoncés sur le [serveur Discord de l'association](${DISCORD_INVITE}).`,
            `This policy may change along with the Bot. The version in force is the one published on this page, with its update date; significant changes are announced on the [association's Discord server](${DISCORD_INVITE}).`),
        },
      ],
    },
    privacyContact: {
      title: "Contact",
      meta: "CONTACT",
      blocks: [
        {
          kind: "p",
          text: frEn("Pour toute question sur vos données ou pour exercer vos droits :",
            "For any question about your data or to exercise your rights:"),
        },
        {
          kind: "bullets",
          items: frEn(PRIVACY_CONTACT_ITEMS_FR, PRIVACY_CONTACT_ITEMS_EN),
        },
      ],
    },
  }),
  hosting: HOSTING,
});
