/**
 * Contenu bilingue (FR / EN) des documents légaux du bot Discord *BlueGenji Bot*.
 *
 * **Source unique** de ces deux textes : ils étaient repris de
 * `blueGenjiBot/LegalTerms`, dont les fichiers ont depuis divergé et ne font
 * plus foi. Ils décrivent le bot **d'après son code** (`blueGenjiBot`,
 * branche `main`) : chaque durée ou comportement cité y a été relu — tables de
 * `src/bdd/Bdd.ts`, purge de `src/messages/manageMsgExpiration.ts`, commandes
 * de `src/config/commands.ts`, routes de `src/internalApi.ts`, sauvegardes de
 * `scripts/backup-onedrive.sh`. Les durées qu'aucune importation ne peut tenir
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
 */
import { BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";
import {
  ASSOCIATION_NAME,
  ASSOCIATION_SEAT,
  LEGAL_CONTACT_DISCORD,
  REPORT_FORM_NAME,
} from "@/lib/shared/legal-contact";
import {
  BOT_LINK_CODE_VALIDITY_MINUTES,
  BOT_RELAY_RETENTION_DAYS,
  DPF_ADEQUACY_DECISION,
} from "@/lib/shared/processing-register";
import { SITE_HOST } from "@/lib/shared/site-host";

export type Lang = "fr" | "en";

export const HEBERGEUR_HREF = "/mentions-legales#hebergement";

/**
 * Âge minimal pour utiliser le bot : 15 ans, seuil à partir duquel un mineur
 * consent seul à un traitement lié à un service en ligne (art. 45 de la loi
 * Informatique et Libertés, art. 8 RGPD).
 */
export const BOT_MINIMUM_AGE = 15;

export interface LegalBlock {
  kind: "p" | "subhead" | "bullets";
  /** Pour `p` et `subhead`. Supporte la syntaxe inline. */
  text?: string;
  /** Pour `bullets`. Chaque entrée supporte la syntaxe inline. */
  items?: string[];
}

export interface LegalSection {
  num: string;
  title: string;
  meta: string;
  blocks: LegalBlock[];
}

export interface LegalDoc {
  eyebrow: string;
  /** Titre d'affichage (peut contenir un saut de ligne `\n`). */
  title: string;
  lastUpdatedLabel: string;
  lastUpdated: string;
  intro: string;
  sections: LegalSection[];
  /** Bloc « hébergeur » renvoyant vers les mentions légales. */
  hosting: {
    meta: string;
    title: string;
    text: string;
    linkLabel: string;
  };
}

export interface BilingualDoc {
  fr: LegalDoc;
  en: LegalDoc;
}

/** Même serveur que le reste du site : voir `lib/shared/discord.ts`. */
const DISCORD_INVITE = DISCORD_INVITE_URL;
const DISCORD_TERMS = "https://discord.com/terms";
const DISCORD_GUIDELINES = "https://discord.com/guidelines";
const PRIVACY_HREF = "/privacy-policy-bot";
const TERMS_HREF = "/terms-of-service-bot";
const LEGAL_NOTICE_HREF = "/mentions-legales";
const SITE_PRIVACY_HREF = "/rgpd";
const CNIL_COMPLAINT_URL = "https://www.cnil.fr/fr/plaintes";
// Aucune adresse électronique ici : le courriel de l'association ne s'écrit
// jamais en clair, il se révèle au clic sur les mentions légales
// (`lib/shared/legal-contact.ts`), ce que ces textes ne savent pas faire — ils y
// renvoient donc.
const CONTACT_DISCORD = LEGAL_CONTACT_DISCORD;

const LAST_UPDATED_FR = "30 septembre 2026";
const LAST_UPDATED_EN = "30 September 2026";

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

const HOSTING_FR = {
  meta: "HÉBERGEUR",
  title: "Hébergement",
  text: `Le bot et le site tournent sur la même machine, ${SITE_HOST.machine}, fournie et administrée par leur hébergeur technique, ${SITE_HOST.name}. Ses coordonnées complètes figurent dans les mentions légales du site.`,
  linkLabel: "Voir la section Hébergement des mentions légales →",
};
const HOSTING_EN = {
  meta: "HOSTING PROVIDER",
  title: "Hosting",
  text: `The bot and the website run on the same machine, ${SITE_HOST.machineEn}, provided and administered by their technical host, ${SITE_HOST.name}. The host's full details are set out in the website's legal notice.`,
  linkLabel: "See the Hosting section of the legal notice →",
};

/* -------------------------------------------------------------------------- */
/*  Terms of Service / Conditions d'Utilisation                               */
/* -------------------------------------------------------------------------- */

export const TERMS_OF_SERVICE: BilingualDoc = {
  fr: {
    eyebrow: "BLUEGENJI BOT · LÉGAL",
    title: "Conditions\nd'Utilisation",
    lastUpdatedLabel: "Dernière mise à jour",
    lastUpdated: LAST_UPDATED_FR,
    intro:
      "Ces conditions encadrent l'utilisation du bot Discord **BlueGenji Bot** : ses commandes et le relais d'annonces entre serveurs partenaires. Si vous ne les acceptez pas, n'utilisez pas le Bot.",
    sections: [
      {
        num: "01",
        title: "Éditeur et objet",
        meta: "PRÉSENTATION",
        blocks: [
          {
            kind: "p",
            text: `**BlueGenji Bot** est édité par l'association **${ASSOCIATION_NAME}** (association loi 1901, siège : ${ASSOCIATION_SEAT}). Il est développé et administré bénévolement par ${SITE_HOST.name}, hébergeur technique de l'association.`,
          },
          {
            kind: "p",
            text: "Le Bot relaie les annonces de la communauté esport BlueGenji — Overwatch et Marvel Rivals — entre les salons des serveurs partenaires (recherches de scrims, recrutements et autres services). Il remet aussi en message privé les messages du site BlueGenji : codes de connexion, rappels de match, alertes d'arbitrage et informations sur les données. Il est gratuit.",
          },
        ],
      },
      {
        num: "02",
        title: "Accès",
        meta: "CONDITIONS D'ACCÈS",
        blocks: [
          {
            kind: "bullets",
            items: [
              `Vous devez avoir au moins ${BOT_MINIMUM_AGE} ans pour utiliser le Bot.`,
              `Vous devez respecter les [Conditions d'Utilisation de Discord](${DISCORD_TERMS}) et ses [Règles Communautaires](${DISCORD_GUIDELINES}).`,
            ],
          },
        ],
      },
      {
        num: "03",
        title: "Règles d'utilisation",
        meta: "USAGE ACCEPTABLE",
        blocks: [
          { kind: "p", text: "En utilisant **BlueGenji Bot**, vous vous engagez à :" },
          {
            kind: "bullets",
            items: [
              "ne pas l'utiliser à des fins illégales, nuisibles ou perturbatrices ;",
              "ne pas exploiter ses fonctionnalités de façon abusive ni tenter de contourner ses limites (temps de recharge, exclusions) ;",
              "ne pas l'utiliser pour harceler, spammer ou usurper l'identité d'autrui ;",
              "signaler de façon responsable tout bug, faille ou usage abusif.",
            ],
          },
          {
            kind: "p",
            text: "Chacun reste responsable des annonces qu'il publie : le Bot les recopie telles quelles dans les salons des serveurs partenaires.",
          },
        ],
      },
      {
        num: "04",
        title: "Modération du relais",
        meta: "EXCLUSIONS",
        blocks: [
          {
            kind: "p",
            text: `Les administrateurs des serveurs partenaires d'au moins 50 membres et le staff de l'association peuvent **exclure un utilisateur du relais** en cas de manquement à ces conditions : il ne peut plus utiliser les commandes du Bot, ses annonces ne sont plus relayées et les copies de celles des ${BOT_RELAY_RETENTION_DAYS} derniers jours sont retirées. L'exclusion vaut pour tout le réseau de serveurs partenaires ; son motif est obligatoire et consigné au journal de modération.`,
          },
          {
            kind: "p",
            text: "L'association peut aussi restreindre ou suspendre l'accès au Bot en cas de manquement. Une exclusion se conteste par les moyens indiqués à la section Contact.",
          },
        ],
      },
      {
        num: "05",
        title: "Données personnelles",
        meta: "DONNÉES",
        blocks: [
          {
            kind: "p",
            text: `Les données traitées par le Bot, leurs durées de conservation et vos droits sont décrits dans sa [Politique de Confidentialité](${PRIVACY_HREF}).`,
          },
        ],
      },
      {
        num: "06",
        title: "Responsabilité",
        meta: "GARANTIES",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Le Bot est un service gratuit, maintenu par des bénévoles : il est fourni sans garantie de disponibilité continue ni d'absence d'erreur.",
              "Dans les limites permises par la loi, l'association n'est pas responsable des interruptions du service, ni des contenus publiés par les utilisateurs et relayés par le Bot.",
            ],
          },
        ],
      },
      {
        num: "07",
        title: "Modification des conditions",
        meta: "ÉVOLUTIONS",
        blocks: [
          {
            kind: "p",
            text: `L'association peut modifier ces conditions. La version en vigueur est celle publiée sur cette page, avec sa date de mise à jour ; les changements importants sont annoncés sur le [serveur Discord de l'association](${DISCORD_INVITE}).`,
          },
        ],
      },
      {
        num: "08",
        title: "Contact",
        meta: "CONTACT",
        blocks: [
          {
            kind: "p",
            text: "Pour toute question, contestation ou demande concernant ces conditions :",
          },
          { kind: "bullets", items: CONTACT_ITEMS_FR },
        ],
      },
    ],
    hosting: HOSTING_FR,
  },
  en: {
    eyebrow: "BLUEGENJI BOT · LEGAL",
    title: "Terms of\nService",
    lastUpdatedLabel: "Last updated",
    lastUpdated: LAST_UPDATED_EN,
    intro:
      "These terms govern the use of the Discord bot **BlueGenji Bot**: its commands and the relay of advertisements between partner servers. If you do not accept them, do not use the Bot.",
    sections: [
      {
        num: "01",
        title: "Publisher and purpose",
        meta: "OVERVIEW",
        blocks: [
          {
            kind: "p",
            text: `**BlueGenji Bot** is published by the association **${ASSOCIATION_NAME}** (a French non-profit association under the law of 1901, registered office: ${ASSOCIATION_SEAT}). It is developed and administered on a voluntary basis by ${SITE_HOST.name}, the association's technical host.`,
          },
          {
            kind: "p",
            text: "The Bot relays the advertisements of the BlueGenji esport community — Overwatch and Marvel Rivals — between the channels of partner servers (scrim searches, recruitment and other services). It also delivers by direct message the messages of the BlueGenji website: login codes, match reminders, referee alerts and data-protection notices. It is free of charge.",
          },
        ],
      },
      {
        num: "02",
        title: "Access",
        meta: "ACCESS REQUIREMENTS",
        blocks: [
          {
            kind: "bullets",
            items: [
              `You must be at least ${BOT_MINIMUM_AGE} years old to use the Bot.`,
              `You must comply with Discord's [Terms of Service](${DISCORD_TERMS}) and [Community Guidelines](${DISCORD_GUIDELINES}).`,
            ],
          },
        ],
      },
      {
        num: "03",
        title: "Usage rules",
        meta: "ACCEPTABLE USE",
        blocks: [
          { kind: "p", text: "By using **BlueGenji Bot**, you undertake:" },
          {
            kind: "bullets",
            items: [
              "not to use it for illegal, harmful or disruptive purposes;",
              "not to abuse its features or attempt to bypass its limits (cooldowns, exclusions);",
              "not to use it to harass, spam or impersonate others;",
              "to report any bug, vulnerability or misuse responsibly.",
            ],
          },
          {
            kind: "p",
            text: "Everyone remains responsible for the advertisements they publish: the Bot copies them as they are into the channels of partner servers.",
          },
        ],
      },
      {
        num: "04",
        title: "Relay moderation",
        meta: "EXCLUSIONS",
        blocks: [
          {
            kind: "p",
            text: `The administrators of partner servers with at least 50 members and the association's staff may **exclude a user from the relay** for breaching these terms: they can no longer use the Bot's commands, their advertisements are no longer relayed and the copies of those from the last ${BOT_RELAY_RETENTION_DAYS} days are removed. The exclusion applies to the whole network of partner servers; a reason is mandatory and recorded in the moderation log.`,
          },
          {
            kind: "p",
            text: "The association may also restrict or suspend access to the Bot in the event of a breach. An exclusion can be contested through the means listed in the Contact section.",
          },
        ],
      },
      {
        num: "05",
        title: "Personal data",
        meta: "DATA",
        blocks: [
          {
            kind: "p",
            text: `The data processed by the Bot, how long it is kept and your rights are described in its [Privacy Policy](${PRIVACY_HREF}).`,
          },
        ],
      },
      {
        num: "06",
        title: "Liability",
        meta: "WARRANTIES",
        blocks: [
          {
            kind: "bullets",
            items: [
              "The Bot is a free service maintained by volunteers: it is provided without any guarantee of continuous availability or error-free operation.",
              "To the extent permitted by law, the association is not liable for service interruptions, nor for content published by users and relayed by the Bot.",
            ],
          },
        ],
      },
      {
        num: "07",
        title: "Changes to these terms",
        meta: "UPDATES",
        blocks: [
          {
            kind: "p",
            text: `The association may amend these terms. The version in force is the one published on this page, with its update date; significant changes are announced on the [association's Discord server](${DISCORD_INVITE}).`,
          },
        ],
      },
      {
        num: "08",
        title: "Contact",
        meta: "CONTACT",
        blocks: [
          {
            kind: "p",
            text: "For any question, dispute or request about these terms:",
          },
          { kind: "bullets", items: CONTACT_ITEMS_EN },
        ],
      },
    ],
    hosting: HOSTING_EN,
  },
};

/* -------------------------------------------------------------------------- */
/*  Privacy Policy / Politique de Confidentialité                            */
/* -------------------------------------------------------------------------- */

export const PRIVACY_POLICY: BilingualDoc = {
  fr: {
    eyebrow: "BLUEGENJI BOT · CONFIDENTIALITÉ",
    title: "Politique de\nConfidentialité",
    lastUpdatedLabel: "Dernière mise à jour",
    lastUpdated: LAST_UPDATED_FR,
    intro:
      "Cette politique vous informe des données que traite le bot Discord **BlueGenji Bot**, de leurs finalités, de leurs durées de conservation, de leurs destinataires et de vos droits (articles 13 et 14 du RGPD).",
    sections: [
      {
        num: "01",
        title: "Responsable du traitement",
        meta: "QUI",
        blocks: [
          {
            kind: "p",
            text: `Le responsable du traitement est l'association **${ASSOCIATION_NAME}**, association loi 1901 dont le siège est situé au ${ASSOCIATION_SEAT}. Elle n'a pas désigné de délégué à la protection des données (désignation non obligatoire). Les moyens de la joindre figurent à la section Contact.`,
          },
          {
            kind: "p",
            text: `Le Bot est réservé aux personnes d'au moins ${BOT_MINIMUM_AGE} ans ([Conditions d'Utilisation](${TERMS_HREF})).`,
          },
        ],
      },
      {
        num: "02",
        title: "Données traitées et finalités",
        meta: "COLLECTE",
        blocks: [
          { kind: "subhead", text: "Annonces relayées" },
          {
            kind: "p",
            text: `Identifiant du message d'origine et de son auteur, date, identifiants des copies relayées et de leurs salons : ils servent à relayer l'annonce, à répercuter sa modification ou sa suppression et à appliquer le temps de recharge entre deux annonces. **Le contenu du message n'est pas enregistré dans la base du Bot** : il est recopié, avec le nom de son auteur, dans les salons des serveurs partenaires, où leurs membres le lisent. Ces copies sont des messages Discord : supprimer l'annonce d'origine dans les ${BOT_RELAY_RETENTION_DAYS} jours supprime aussi ses copies ; passé ce délai, elles restent jusqu'à leur suppression par les administrateurs du serveur qui les porte.`,
          },
          { kind: "subhead", text: "Scrims et recrutement" },
          {
            kind: "p",
            text: "Pour les commandes **/scrim** et **/recrute** : identifiant de l'auteur, jeu, niveau ou rôle recherché, serveur et date, qui alimentent les statistiques d'activité (commande **/stats** et tableau de bord du bot).",
          },
          { kind: "subhead", text: "Exclusions du relais" },
          {
            kind: "p",
            text: "Identifiants de l'utilisateur exclu et du modérateur, date, et référence du message de journal qui porte le motif. Les pseudos de l'exclu et du modérateur et le motif sont publiés dans le salon de journal privé du staff, et la commande **/ban-list** affiche la liste complète des exclusions (pseudos, motif, date, identifiant) aux administrateurs de tout serveur où le Bot est installé.",
          },
          { kind: "subhead", text: "Commande /link et rappels programmés" },
          {
            kind: "bullets",
            items: [
              `**Commande /link** : identifiant Discord, code à six chiffres valable ${BOT_LINK_CODE_VALIDITY_MINUTES} minutes et son échéance. Le site ne propose à ce jour aucun endroit où saisir ce code : la commande ne relie donc aucun compte.`,
              "**Rappels programmés** (commandes réservées au serveur de l'association) : identifiant du membre ou du rôle visé et de l'auteur, message et fréquence.",
            ],
          },
          { kind: "subhead", text: "Configuration des serveurs" },
          {
            kind: "p",
            text: "Identifiants des serveurs, salons et rôles configurés, invitation du serveur, et identifiant de l'administrateur qui a posé l'invitation ou le rôle d'arbitrage.",
          },
          { kind: "subhead", text: "Messages du site BlueGenji" },
          {
            kind: "p",
            text: `Le site transmet au Bot un identifiant ou un pseudo Discord et le message à remettre (code de connexion, rappel de match, alerte d'arbitrage, signalement, information sur les données) ; le Bot le remet en message privé ou dans le salon d'arbitrage **sans l'enregistrer**. Ces traitements relèvent de la [politique de confidentialité du site](${SITE_PRIVACY_HREF}).`,
          },
          { kind: "subhead", text: "Journaux" },
          {
            kind: "p",
            text: "Le fil d'activité public de la page du bot ne contient aucun identifiant de personne. Le salon de journal privé du staff et les journaux du serveur reçoivent le nom des serveurs qui ajoutent ou retirent le Bot et les erreurs de fonctionnement, qui peuvent citer un pseudo ou un identifiant Discord.",
          },
          { kind: "subhead", text: "Base légale" },
          {
            kind: "p",
            text: "Ces traitements reposent sur l'**intérêt légitime** de l'association (article 6.1.f du RGPD) : faire fonctionner le relais entre serveurs partenaires, le modérer et en mesurer l'activité. Les messages du site reposent sur la base légale de leur traitement d'origine, indiquée dans le registre du site.",
          },
        ],
      },
      {
        num: "03",
        title: "Durées de conservation",
        meta: "DURÉES",
        blocks: [
          {
            kind: "bullets",
            items: [
              `**Suivi des annonces relayées** (identifiants, date) : ${BOT_RELAY_RETENTION_DAYS} jours ; il est effacé lors du premier relais qui suit cette échéance. Rien n'est effacé au redémarrage du Bot. Les copies publiées dans les salons partenaires restent sur Discord (section 02).`,
              "**Scrims et recrutement** : aucune suppression automatique à ce jour ; ces données sont conservées jusqu'à une demande d'effacement.",
              "**Exclusions** : jusqu'à la levée de l'exclusion.",
              `**Commande /link** : le code expire au bout de ${BOT_LINK_CODE_VALIDITY_MINUTES} minutes ; la ligne qui le porte n'est pas supprimée automatiquement à ce jour.`,
              "**Configuration des serveurs** : jusqu'à son retrait par les administrateurs du serveur.",
              "**Rappels programmés** : jusqu'à leur dernier envoi ou leur suppression.",
              "**Journal privé du staff et journaux du serveur** : aucune suppression automatique à ce jour.",
              `**Sauvegardes** : la base du Bot est sauvegardée chaque semaine, chiffrée, et chaque copie est supprimée définitivement au bout de ${BACKUP_RETENTION_DAYS} jours au plus.`,
            ],
          },
        ],
      },
      {
        num: "04",
        title: "Destinataires",
        meta: "QUI Y ACCÈDE",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Le staff de l'association, pour la modération et l'administration du Bot.",
              "Les membres des serveurs partenaires, qui lisent les annonces relayées.",
              "Les administrateurs de tout serveur où le Bot est installé, qui peuvent lire la liste des exclusions (commande **/ban-list**, réponse visible du seul demandeur).",
              `Tout utilisateur du Bot, par la commande **/stats**, peut voir combien d'annonces un autre utilisateur a publiées (messages relayés, scrims, recherches) ; la réponse n'est visible que de celui qui la demande, et le compteur de messages ne porte que sur ceux encore conservés (${BOT_RELAY_RETENTION_DAYS} derniers jours).`,
              `L'hébergeur technique, ${SITE_HOST.name}, qui fournit la machine sur laquelle tourne le Bot (${SITE_HOST.machine}) : sous-traitant.`,
              "Discord, plateforme sur laquelle le Bot fonctionne.",
              "Microsoft, qui stocke sur le OneDrive personnel de l'hébergeur technique les sauvegardes, chiffrées avant envoi avec une clé que Microsoft ne détient pas.",
              "Aucune donnée n'est vendue ni cédée.",
            ],
          },
        ],
      },
      {
        num: "05",
        title: "Transferts hors de l'Union européenne",
        meta: "TRANSFERTS",
        blocks: [
          {
            kind: "bullets",
            items: [
              `**Discord** (États-Unis) : ${DPF_ADEQUACY_DECISION}.`,
              `**Microsoft** : transfert possible vers les États-Unis, Microsoft ne garantissant pas le lieu de stockage d'un compte personnel ; il ne reçoit que des données chiffrées — ${DPF_ADEQUACY_DECISION}.`,
            ],
          },
        ],
      },
      {
        num: "06",
        title: "Vos droits",
        meta: "RGPD",
        blocks: [
          { kind: "p", text: "Vous disposez sur vos données des droits suivants :" },
          {
            kind: "bullets",
            items: [
              "**Accès** : savoir quelles données le Bot conserve sur vous et en obtenir une copie.",
              "**Rectification** : faire corriger une donnée inexacte.",
              "**Effacement** : faire supprimer vos données ; certaines fonctions du Bot peuvent alors ne plus vous être rendues.",
              "**Limitation** : faire geler l'utilisation d'une donnée le temps d'examiner une contestation.",
              "**Opposition** : vous opposer, pour des raisons tenant à votre situation particulière, à un traitement fondé sur l'intérêt légitime.",
            ],
          },
          {
            kind: "p",
            text: "Le droit à la portabilité ne s'applique pas : ces traitements reposent sur l'intérêt légitime, non sur un consentement ou un contrat. Pour exercer vos droits, utilisez les moyens de la section Contact ; une réponse vous est apportée dans un délai d'un mois.",
          },
          {
            kind: "p",
            text: `Si vous estimez que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à la [CNIL](${CNIL_COMPLAINT_URL}).`,
          },
        ],
      },
      {
        num: "07",
        title: "Sécurité",
        meta: "PROTECTION",
        blocks: [
          {
            kind: "bullets",
            items: [
              "La base du Bot vit sur la machine de l'hébergeur technique, dont l'accès est réservé au responsable technique (authentification par clé SSH).",
              "Les échanges entre le site et le Bot restent sur cette machine et sont protégés par un jeton.",
              "Les sauvegardes sont chiffrées sur cette machine avant tout envoi.",
            ],
          },
          {
            kind: "p",
            text: "Aucune mesure ne rend un système infaillible : en cas de violation de données présentant un risque pour vous, l'association est tenue de la notifier à la CNIL et, si le risque est élevé, aux personnes concernées (articles 33 et 34 du RGPD).",
          },
        ],
      },
      {
        num: "08",
        title: "Modifications de cette politique",
        meta: "ÉVOLUTIONS",
        blocks: [
          {
            kind: "p",
            text: `Cette politique peut évoluer avec le Bot. La version en vigueur est celle publiée sur cette page, avec sa date de mise à jour ; les changements importants sont annoncés sur le [serveur Discord de l'association](${DISCORD_INVITE}).`,
          },
        ],
      },
      {
        num: "09",
        title: "Contact",
        meta: "CONTACT",
        blocks: [
          {
            kind: "p",
            text: "Pour toute question sur vos données ou pour exercer vos droits :",
          },
          { kind: "bullets", items: CONTACT_ITEMS_FR },
        ],
      },
    ],
    hosting: HOSTING_FR,
  },
  en: {
    eyebrow: "BLUEGENJI BOT · PRIVACY",
    title: "Privacy\nPolicy",
    lastUpdatedLabel: "Last updated",
    lastUpdated: LAST_UPDATED_EN,
    intro:
      "This policy informs you of the data processed by the Discord bot **BlueGenji Bot**, why it is processed, how long it is kept, who receives it and what your rights are (Articles 13 and 14 GDPR).",
    sections: [
      {
        num: "01",
        title: "Data controller",
        meta: "WHO",
        blocks: [
          {
            kind: "p",
            text: `The data controller is the association **${ASSOCIATION_NAME}**, a French non-profit association under the law of 1901 whose registered office is at ${ASSOCIATION_SEAT}. It has not appointed a data protection officer (appointment not mandatory). The means of contacting it are listed in the Contact section.`,
          },
          {
            kind: "p",
            text: `The Bot is intended for people aged ${BOT_MINIMUM_AGE} or over ([Terms of Service](${TERMS_HREF})).`,
          },
        ],
      },
      {
        num: "02",
        title: "Data processed and purposes",
        meta: "COLLECTION",
        blocks: [
          { kind: "subhead", text: "Relayed advertisements" },
          {
            kind: "p",
            text: `ID of the original message and of its author, date, IDs of the relayed copies and of their channels: they are used to relay the advertisement, to pass on its edits or deletion, and to apply the cooldown between two advertisements. **Message content is not stored in the Bot's database**: it is copied, with its author's name, into the channels of partner servers, where their members read it. These copies are Discord messages: deleting the original advertisement within ${BOT_RELAY_RETENTION_DAYS} days also deletes its copies; after that, they remain until the administrators of the server holding them delete them.`,
          },
          { kind: "subhead", text: "Scrims and recruitment" },
          {
            kind: "p",
            text: "For the **/scrim** and **/recrute** commands: author ID, game, level or role sought, server and date, which feed the activity statistics (**/stats** command and the bot's dashboard).",
          },
          { kind: "subhead", text: "Relay exclusions" },
          {
            kind: "p",
            text: "IDs of the excluded user and of the moderator, date, and a reference to the log message holding the reason. The usernames of the excluded user and of the moderator, and the reason, are posted in the staff's private log channel, and the **/ban-list** command shows the full list of exclusions (usernames, reason, date, ID) to the administrators of any server where the Bot is installed.",
          },
          { kind: "subhead", text: "/link command and scheduled reminders" },
          {
            kind: "bullets",
            items: [
              `**/link command**: Discord ID, six-digit code valid for ${BOT_LINK_CODE_VALIDITY_MINUTES} minutes and its expiry. The website currently offers nowhere to enter this code: the command therefore links no account.`,
              "**Scheduled reminders** (commands restricted to the association's server): ID of the targeted member or role and of the author, message and frequency.",
            ],
          },
          { kind: "subhead", text: "Server configuration" },
          {
            kind: "p",
            text: "IDs of the configured servers, channels and roles, the server's invite, and the ID of the administrator who set the invite or the referee role.",
          },
          { kind: "subhead", text: "Messages from the BlueGenji website" },
          {
            kind: "p",
            text: `The website sends the Bot a Discord ID or username and the message to deliver (login code, match reminder, referee alert, report, data-protection notice); the Bot delivers it by direct message or in the referee channel **without storing it**. This processing falls under the [website's privacy policy](${SITE_PRIVACY_HREF}) (in French).`,
          },
          { kind: "subhead", text: "Logs" },
          {
            kind: "p",
            text: "The public activity feed on the bot's page contains no personal identifier. The staff's private log channel and the server logs receive the names of servers that add or remove the Bot and operating errors, which may mention a Discord username or ID.",
          },
          { kind: "subhead", text: "Legal basis" },
          {
            kind: "p",
            text: "This processing is based on the association's **legitimate interest** (Article 6(1)(f) GDPR): running the relay between partner servers, moderating it and measuring its activity. Messages from the website rely on the legal basis of their original processing, set out in the website's register.",
          },
        ],
      },
      {
        num: "03",
        title: "Retention periods",
        meta: "RETENTION",
        blocks: [
          {
            kind: "bullets",
            items: [
              `**Tracking of relayed advertisements** (IDs, date): ${BOT_RELAY_RETENTION_DAYS} days; it is erased at the first relay after that deadline. Nothing is erased when the Bot restarts. The copies posted in partner channels remain on Discord (section 02).`,
              "**Scrims and recruitment**: no automatic deletion at present; this data is kept until an erasure request.",
              "**Exclusions**: until the exclusion is lifted.",
              `**/link command**: the code expires after ${BOT_LINK_CODE_VALIDITY_MINUTES} minutes; the row holding it is not deleted automatically at present.`,
              "**Server configuration**: until the server's administrators remove it.",
              "**Scheduled reminders**: until their last sending or their deletion.",
              "**Staff private log channel and server logs**: no automatic deletion at present.",
              `**Backups**: the Bot's database is backed up weekly, encrypted, and each copy is permanently deleted after ${BACKUP_RETENTION_DAYS} days at most.`,
            ],
          },
        ],
      },
      {
        num: "04",
        title: "Recipients",
        meta: "WHO HAS ACCESS",
        blocks: [
          {
            kind: "bullets",
            items: [
              "The association's staff, for moderating and administering the Bot.",
              "Members of partner servers, who read the relayed advertisements.",
              "The administrators of any server where the Bot is installed, who can read the list of exclusions (**/ban-list** command, reply visible only to the person who asked).",
              `Any user of the Bot can, with the **/stats** command, see how many advertisements another user has published (relayed messages, scrims, searches); the reply is visible only to the person who asked, and the message count only covers messages still kept (last ${BOT_RELAY_RETENTION_DAYS} days).`,
              `The technical host, ${SITE_HOST.name}, who provides the machine the Bot runs on (${SITE_HOST.machineEn}): processor.`,
              "Discord, the platform the Bot runs on.",
              "Microsoft, which stores the backups on the technical host's personal OneDrive, encrypted before upload with a key Microsoft does not hold.",
              "No data is sold or transferred for consideration.",
            ],
          },
        ],
      },
      {
        num: "05",
        title: "Transfers outside the European Union",
        meta: "TRANSFERS",
        blocks: [
          {
            kind: "bullets",
            items: [
              "**Discord** (United States): European Commission adequacy decision (EU) 2023/1795 of 10 July 2023 (EU-U.S. Data Privacy Framework).",
              "**Microsoft**: possible transfer to the United States, as Microsoft does not guarantee the storage location of a personal account; it only receives encrypted data — European Commission adequacy decision (EU) 2023/1795 of 10 July 2023 (EU-U.S. Data Privacy Framework).",
            ],
          },
        ],
      },
      {
        num: "06",
        title: "Your rights",
        meta: "GDPR",
        blocks: [
          { kind: "p", text: "You have the following rights over your data:" },
          {
            kind: "bullets",
            items: [
              "**Access**: find out what data the Bot keeps about you and obtain a copy.",
              "**Rectification**: have inaccurate data corrected.",
              "**Erasure**: have your data deleted; some Bot features may then no longer be available to you.",
              "**Restriction**: have the use of data frozen while a dispute is examined.",
              "**Objection**: object, on grounds relating to your particular situation, to processing based on legitimate interest.",
            ],
          },
          {
            kind: "p",
            text: "The right to data portability does not apply: this processing is based on legitimate interest, not on consent or a contract. To exercise your rights, use the means listed in the Contact section; you will receive a reply within one month.",
          },
          {
            kind: "p",
            text: `If you consider that your rights are not respected, you may lodge a complaint with the [CNIL](${CNIL_COMPLAINT_URL}), the French data protection authority.`,
          },
        ],
      },
      {
        num: "07",
        title: "Security",
        meta: "PROTECTION",
        blocks: [
          {
            kind: "bullets",
            items: [
              "The Bot's database lives on the technical host's machine, access to which is restricted to the technical manager (SSH key authentication).",
              "Exchanges between the website and the Bot stay on that machine and are protected by a token.",
              "Backups are encrypted on that machine before any upload.",
            ],
          },
          {
            kind: "p",
            text: "No measure makes a system infallible: in the event of a data breach likely to put you at risk, the association is required to notify the CNIL and, if the risk is high, the people concerned (Articles 33 and 34 GDPR).",
          },
        ],
      },
      {
        num: "08",
        title: "Changes to this policy",
        meta: "UPDATES",
        blocks: [
          {
            kind: "p",
            text: `This policy may change along with the Bot. The version in force is the one published on this page, with its update date; significant changes are announced on the [association's Discord server](${DISCORD_INVITE}).`,
          },
        ],
      },
      {
        num: "09",
        title: "Contact",
        meta: "CONTACT",
        blocks: [
          {
            kind: "p",
            text: "For any question about your data or to exercise your rights:",
          },
          { kind: "bullets", items: CONTACT_ITEMS_EN },
        ],
      },
    ],
    hosting: HOSTING_EN,
  },
};
