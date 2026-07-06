/**
 * Contenu bilingue (FR / EN) des documents légaux du bot Discord *BlueGenji Bot*.
 *
 * Source : `blueGenjiBot/LegalTerms` (ConditionsUtilisation.md / TermsOfServices.md,
 * Politique de confidentialité.md / PolicyPrivacy.md).
 *
 * Les paragraphes et puces acceptent une syntaxe inline minimale :
 *   - `**gras**`            → <strong>
 *   - `[texte](url)`        → <a> (target/rel gérés au rendu)
 *
 * La partie « hébergeur » n'est pas dupliquée ici : chaque document renvoie vers la
 * section Hébergement des mentions légales du site (`/mentions-legales#hebergement`).
 */

export type Lang = "fr" | "en";

export const HEBERGEUR_HREF = "/mentions-legales#hebergement";

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

const DISCORD_INVITE = "https://discord.gg/5kG9DDKx";
const DISCORD_TERMS = "https://discord.com/terms";
const DISCORD_GUIDELINES = "https://discord.com/guidelines";
const PRIVACY_HREF = "/privacy-policy-bot";
const CONTACT_EMAIL = "keryan.h@outlook.fr";
const CONTACT_DISCORD = "elessiah";

/* -------------------------------------------------------------------------- */
/*  Terms of Service / Conditions d'Utilisation                               */
/* -------------------------------------------------------------------------- */

export const TERMS_OF_SERVICE: BilingualDoc = {
  fr: {
    eyebrow: "BLUEGENJI BOT · LÉGAL",
    title: "Conditions\nd'Utilisation",
    lastUpdatedLabel: "Dernière mise à jour",
    lastUpdated: "6 janvier 2024",
    intro:
      "En utilisant le bot Discord **BlueGenji Bot**, vous acceptez de respecter ces Conditions d'Utilisation. Si vous n'acceptez pas ces Conditions, veuillez ne pas utiliser le Bot.",
    sections: [
      {
        num: "01",
        title: "Introduction",
        meta: "PRÉSENTATION",
        blocks: [
          {
            kind: "p",
            text: "**BlueGenji Bot** est un bot Discord développé par Keryan HOUSSIN pour synchroniser les annonces et autres contenus liés à la communauté esport Marvel Rivals entre des serveurs affiliés. Ces Conditions régissent votre utilisation du Bot et de ses services.",
          },
        ],
      },
      {
        num: "02",
        title: "Éligibilité",
        meta: "CONDITIONS D'ACCÈS",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Vous devez avoir au moins 13 ans pour utiliser le Bot.",
              `Vous devez respecter les [Conditions d'Utilisation de Discord](${DISCORD_TERMS}) et les [Règles Communautaires](${DISCORD_GUIDELINES}).`,
              "En utilisant le Bot, vous confirmez que vous remplissez ces critères.",
            ],
          },
        ],
      },
      {
        num: "03",
        title: "Règles d'Utilisation",
        meta: "USAGE ACCEPTABLE",
        blocks: [
          { kind: "p", text: "En utilisant **BlueGenji Bot**, vous acceptez de :" },
          {
            kind: "bullets",
            items: [
              "Ne pas utiliser le Bot à des fins illégales, nuisibles ou perturbatrices.",
              "Ne pas exploiter ou abuser des fonctionnalités du Bot ou tenter de contourner ses limitations.",
              "Ne pas utiliser le Bot pour harceler, spammer ou usurper l'identité d'autres utilisateurs.",
              "Signaler tout bug, vulnérabilité ou utilisation abusive de manière responsable.",
            ],
          },
          {
            kind: "p",
            text: "Nous nous réservons le droit de restreindre, suspendre ou résilier votre accès au Bot en cas de violation de ces règles ou pour toute autre raison à notre discrétion.",
          },
        ],
      },
      {
        num: "04",
        title: "Collecte de Données et Confidentialité",
        meta: "DONNÉES",
        blocks: [
          { kind: "p", text: "**BlueGenji Bot** peut collecter et traiter les types de données suivants :" },
          { kind: "subhead", text: "Données Collectées" },
          {
            kind: "bullets",
            items: [
              "**Données Utilisateur** : Identifiants d'utilisateur (User IDs), identifiants et contenu des messages (utilisés pour la modération et les fonctionnalités de cooldown).",
              "**Données Serveur** : Identifiants des canaux (utilisés pour synchroniser et lier les canaux entre les serveurs).",
              "**Paramètres Serveur** : Vérifiés pour contrôler les permissions des utilisateurs (par exemple, statut d'administrateur).",
            ],
          },
          { kind: "subhead", text: "Utilisation de vos Données" },
          {
            kind: "bullets",
            items: [
              "**User IDs** : Stockés et utilisés pour les cooldowns et la modération.",
              "**Contenu et Identifiants des Messages** : Les contenus des messages sont traités mais non stockés. Les identifiants des messages sont stockés pour les cooldowns et le suivi des modifications. Les messages supprimés ne peuvent pas être récupérés.",
              "**Identifiants des Canaux** : Stockés pour permettre la liaison et la synchronisation des canaux entre serveurs.",
              "**Paramètres Serveur** : Traités pour vérifier les rôles et permissions des utilisateurs.",
            ],
          },
          { kind: "subhead", text: "Durée de Conservation des Données" },
          {
            kind: "bullets",
            items: [
              "Les identifiants des canaux sont conservés tant qu'ils restent utilisés pour la synchronisation.",
              "Les identifiants des messages sont supprimés après 72 heures ou au redémarrage du bot.",
              "Aucune donnée personnelle n'est stockée de manière permanente, sauf si nécessaire pour les fonctionnalités essentielles.",
            ],
          },
          {
            kind: "p",
            text: `Pour plus de détails, veuillez consulter notre [Politique de Confidentialité](${PRIVACY_HREF}).`,
          },
        ],
      },
      {
        num: "05",
        title: "Responsabilité et Exclusions de Garantie",
        meta: "GARANTIES",
        blocks: [
          {
            kind: "bullets",
            items: [
              'Le Bot est fourni "tel quel", sans aucune garantie ou promesse de fonctionnement.',
              "Nous ne garantissons pas une performance ininterrompue ou exempte d'erreurs.",
              "Nous ne sommes pas responsables des dommages, pertes ou problèmes découlant de l'utilisation du Bot, y compris les interruptions de serveur ou la perte de données.",
              "Nous ne sommes pas responsables des abus commis par les utilisateurs du Bot, même si des outils de modération sont fournis.",
            ],
          },
        ],
      },
      {
        num: "06",
        title: "Modifications des Conditions",
        meta: "ÉVOLUTIONS",
        blocks: [
          {
            kind: "p",
            text: `Nous nous réservons le droit de modifier ces Conditions à tout moment. Les mises à jour seront annoncées sur notre [Serveur Discord](${DISCORD_INVITE}). La poursuite de l'utilisation du Bot après les modifications constitue une acceptation des nouvelles Conditions.`,
          },
        ],
      },
      {
        num: "07",
        title: "Résiliation",
        meta: "FIN D'ACCÈS",
        blocks: [
          {
            kind: "p",
            text: "Nous, ainsi que les modérateurs des serveurs affiliés, nous réservons le droit de résilier votre accès à **BlueGenji Bot** à tout moment, avec ou sans préavis, en cas de violation de ces Conditions ou pour d'autres raisons. Pour toute contestation ou demande, contactez-nous :",
          },
          {
            kind: "bullets",
            items: [`Discord : **${CONTACT_DISCORD}**`, `Email : **${CONTACT_EMAIL}**`],
          },
        ],
      },
      {
        num: "08",
        title: "Nous Contacter",
        meta: "CONTACT",
        blocks: [
          {
            kind: "p",
            text: "Si vous avez des questions ou des préoccupations concernant ces Conditions, veuillez nous contacter :",
          },
          {
            kind: "bullets",
            items: [`**Email** : ${CONTACT_EMAIL}`, `**Discord** : ${CONTACT_DISCORD}`],
          },
        ],
      },
    ],
    hosting: {
      meta: "HÉBERGEUR",
      title: "Hébergement",
      text: "Le bot et le site sont hébergés par le même prestataire. Les coordonnées complètes de l'hébergeur sont détaillées dans les mentions légales du site.",
      linkLabel: "Voir la section Hébergement des mentions légales →",
    },
  },
  en: {
    eyebrow: "BLUEGENJI BOT · LEGAL",
    title: "Terms of\nService",
    lastUpdatedLabel: "Last updated",
    lastUpdated: "6 January 2024",
    intro:
      "By using the Discord bot **BlueGenji Bot**, you agree to comply with these Terms of Service. If you do not agree with these Terms, please refrain from using the Bot.",
    sections: [
      {
        num: "01",
        title: "Introduction",
        meta: "OVERVIEW",
        blocks: [
          {
            kind: "p",
            text: "**BlueGenji Bot** is a Discord bot developed by Keryan HOUSSIN to synchronize advertisements and other related content across affiliated servers for the Marvel Rivals Esport community. These Terms govern your use of the Bot and its services.",
          },
        ],
      },
      {
        num: "02",
        title: "Eligibility",
        meta: "ACCESS REQUIREMENTS",
        blocks: [
          {
            kind: "bullets",
            items: [
              "You must be at least 13 years old to use the Bot.",
              `You must comply with Discord's [Terms of Service](${DISCORD_TERMS}) and [Community Guidelines](${DISCORD_GUIDELINES}).`,
              "By using the Bot, you confirm that you meet these requirements.",
            ],
          },
        ],
      },
      {
        num: "03",
        title: "Usage Rules",
        meta: "ACCEPTABLE USE",
        blocks: [
          { kind: "p", text: "By using **BlueGenji Bot**, you agree to the following:" },
          {
            kind: "bullets",
            items: [
              "Not to use the Bot for illegal, harmful, or disruptive activities.",
              "Not to exploit or abuse the Bot's features or attempt to bypass its limitations.",
              "Not to use the Bot to harass, spam, or impersonate others.",
              "To report any bugs, vulnerabilities, or misuse responsibly.",
            ],
          },
          {
            kind: "p",
            text: "We reserve the right to restrict, suspend, or terminate your access to the Bot for violating these rules or for other reasons at our discretion.",
          },
        ],
      },
      {
        num: "04",
        title: "Data Collection and Privacy",
        meta: "DATA",
        blocks: [
          { kind: "p", text: "**BlueGenji Bot** may collect and process the following types of data:" },
          { kind: "subhead", text: "Data Collected" },
          {
            kind: "bullets",
            items: [
              "**User Data**: User IDs, message IDs, and message content (used for moderation and cooldown functionalities).",
              "**Server Data**: Channel IDs (used to synchronize and link channels across servers).",
              "**Server Settings**: Verified to check user permissions (e.g., administrator status).",
            ],
          },
          { kind: "subhead", text: "How We Use Your Data" },
          {
            kind: "bullets",
            items: [
              "**User IDs**: Stored and used for cooldowns and moderation.",
              "**Message Content and IDs**: Message content is processed but not stored. Message IDs are stored for cooldowns and edit tracking. Deleted messages cannot be retrieved.",
              "**Channel IDs**: Stored to enable channel linking and synchronization between servers.",
              "**Server Settings**: Processed to verify user roles and permissions.",
            ],
          },
          { kind: "subhead", text: "Data Retention" },
          {
            kind: "bullets",
            items: [
              "Channel IDs are stored as long as they remain in use for synchronization.",
              "Message IDs are deleted after 72 hours or upon bot restart.",
              "No personal data is permanently stored unless required for core functionality.",
            ],
          },
          {
            kind: "p",
            text: `For more details, please refer to our [Privacy Policy](${PRIVACY_HREF}).`,
          },
        ],
      },
      {
        num: "05",
        title: "Liability and Disclaimers",
        meta: "WARRANTIES",
        blocks: [
          {
            kind: "bullets",
            items: [
              'The Bot is provided "as is" without any guarantees or warranties.',
              "We do not guarantee uninterrupted or error-free performance.",
              "We are not responsible for damages, losses, or issues arising from your use of the Bot, including server disruptions or data loss.",
              "We are not liable for any misconduct by users of the Bot, even if moderation tools are provided.",
            ],
          },
        ],
      },
      {
        num: "06",
        title: "Changes to the Terms",
        meta: "UPDATES",
        blocks: [
          {
            kind: "p",
            text: `We reserve the right to update these Terms at any time. Updates will be announced on our [Discord Server](${DISCORD_INVITE}). Continued use of the Bot after changes are made constitutes acceptance of the updated Terms.`,
          },
        ],
      },
      {
        num: "07",
        title: "Termination",
        meta: "END OF ACCESS",
        blocks: [
          {
            kind: "p",
            text: "We, alongside moderators of affiliated servers, reserve the right to terminate your access to **BlueGenji Bot** at any time, with or without notice, for violations of these Terms or other reasons. For any disputes or inquiries, contact:",
          },
          {
            kind: "bullets",
            items: [`Discord: **${CONTACT_DISCORD}**`, `Email: **${CONTACT_EMAIL}**`],
          },
        ],
      },
      {
        num: "08",
        title: "Contact Us",
        meta: "CONTACT",
        blocks: [
          {
            kind: "p",
            text: "If you have any questions or concerns about these Terms, feel free to reach out:",
          },
          {
            kind: "bullets",
            items: [`**Email**: ${CONTACT_EMAIL}`, `**Discord**: ${CONTACT_DISCORD}`],
          },
        ],
      },
    ],
    hosting: {
      meta: "HOSTING PROVIDER",
      title: "Hosting",
      text: "The bot and the website are hosted by the same provider. The full hosting-provider details are set out in the website's legal notice.",
      linkLabel: "See the Hosting section of the legal notice →",
    },
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
    lastUpdated: "8 janvier 2025",
    intro:
      "Votre vie privée nous importe. Cette Politique de Confidentialité explique comment **BlueGenji Bot** collecte, utilise et protège vos informations lorsque vous utilisez les services du Bot.",
    sections: [
      {
        num: "01",
        title: "Données que nous collectons",
        meta: "COLLECTE",
        blocks: [
          { kind: "subhead", text: "Données utilisateur" },
          {
            kind: "bullets",
            items: [
              "**ID utilisateur** : Utilisés pour gérer les temps de recharge, les fonctionnalités de modération et pour la fonctionnalité du bot.",
              "**Contenu des messages** : Traités temporairement pour exécuter des commandes spécifiques et **ne sont pas stockés dans la base de données**.",
              "**ID des messages** : Stockés temporairement pour les temps de recharge et le suivi des modifications de messages.",
            ],
          },
          { kind: "subhead", text: "Données du serveur" },
          {
            kind: "bullets",
            items: [
              "**ID des canaux** : Stockés pour permettre la liaison et la synchronisation de contenu entre les serveurs.",
              "**Paramètres du serveur** : Traités pour vérifier les autorisations (par exemple, vérifier si un utilisateur est administrateur).",
              "**Nom du serveur et utilisation du bot** : Nous enregistrons l'ajout/la suppression du service et le nom du serveur qui invite ou expulse le bot.",
            ],
          },
        ],
      },
      {
        num: "02",
        title: "Comment nous utilisons vos données",
        meta: "FINALITÉS",
        blocks: [
          { kind: "p", text: "Les données collectées par **BlueGenji Bot** sont utilisées aux fins suivantes :" },
          {
            kind: "bullets",
            items: [
              "Fournir les fonctionnalités principales du Bot, telles que la synchronisation de contenu, la modération et les temps de recharge.",
              "Garantir un contrôle d'accès et une validation des autorisations appropriés.",
              "Identifier et corriger les bugs, améliorer les fonctionnalités du Bot et assurer une expérience utilisateur fluide.",
            ],
          },
          {
            kind: "p",
            text: "**Le contenu des messages est uniquement utilisé pour remplir la fonctionnalité de la commande spécifique pour laquelle il a été fourni et n'est pas stocké à d'autres fins.**",
          },
        ],
      },
      {
        num: "03",
        title: "Conservation des données",
        meta: "DURÉES",
        blocks: [
          {
            kind: "bullets",
            items: [
              "**ID utilisateur** : Stockés aussi longtemps que nécessaire pour les temps de recharge et les fonctionnalités de modération.",
              "**ID des messages** : Supprimés automatiquement après 72 heures ou au redémarrage du Bot.",
              "**ID des canaux** : Stockés jusqu'à ce que la synchronisation liée soit supprimée par les administrateurs du serveur.",
              "**Aucune donnée personnelle n'est conservée de manière permanente, sauf si cela est explicitement nécessaire pour le fonctionnement du Bot.**",
            ],
          },
        ],
      },
      {
        num: "04",
        title: "Partage des données",
        meta: "TIERS",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Nous ne partageons pas vos données avec des sociétés tierces, sauf si la loi l'exige ou en réponse à une demande juridique valide.",
            ],
          },
        ],
      },
      {
        num: "05",
        title: "Vos droits",
        meta: "RGPD",
        blocks: [
          { kind: "p", text: "Vous disposez des droits suivants concernant vos données :" },
          {
            kind: "bullets",
            items: [
              "**Accès** : Vous pouvez demander des détails sur les données que **BlueGenji Bot** a collectées à votre sujet.",
              "**Correction** : Vous pouvez demander la correction de toute donnée inexacte.",
              "**Suppression** : Vous pouvez demander la suppression de vos données de nos systèmes. Notez que certaines fonctionnalités du Bot peuvent ne plus fonctionner si des données essentielles à son fonctionnement sont supprimées.",
            ],
          },
          {
            kind: "p",
            text: 'Pour exercer ces droits, veuillez nous contacter en utilisant les informations de la section "Contactez-nous".',
          },
        ],
      },
      {
        num: "06",
        title: "Sécurité des données",
        meta: "PROTECTION",
        blocks: [
          { kind: "p", text: "Nous prenons des précautions raisonnables pour protéger vos données, notamment :" },
          {
            kind: "bullets",
            items: [
              "Nous nous assurons que les données stockées sont sécurisées et accessibles uniquement au personnel autorisé.",
              "Nous examinons régulièrement nos pratiques de gestion et de stockage des données.",
            ],
          },
          {
            kind: "p",
            text: "Cependant, aucune méthode de stockage ou de transmission électronique sur Internet n'est 100 % sécurisée, et nous ne pouvons garantir une sécurité absolue.",
          },
        ],
      },
      {
        num: "07",
        title: "Modifications de cette Politique de Confidentialité",
        meta: "ÉVOLUTIONS",
        blocks: [
          {
            kind: "p",
            text: `Nous pouvons mettre à jour cette Politique de Confidentialité de temps à autre. Toute modification sera publiée [sur notre serveur Discord](${DISCORD_INVITE}) et entrera en vigueur immédiatement après sa publication. Votre utilisation continue de **BlueGenji Bot** après toute modification constitue votre acceptation de la Politique de Confidentialité mise à jour.`,
          },
        ],
      },
      {
        num: "08",
        title: "Contactez-nous",
        meta: "CONTACT",
        blocks: [
          {
            kind: "p",
            text: "Si vous avez des questions ou des préoccupations concernant cette Politique de Confidentialité ou la manière dont nous traitons vos données, veuillez nous contacter à :",
          },
          {
            kind: "bullets",
            items: [`**Email** : ${CONTACT_EMAIL}`, `**Discord** : ${CONTACT_DISCORD}`],
          },
          {
            kind: "p",
            text: "En utilisant **BlueGenji Bot**, vous acceptez les termes énoncés dans cette Politique de Confidentialité.",
          },
        ],
      },
    ],
    hosting: {
      meta: "HÉBERGEUR",
      title: "Hébergement",
      text: "Le bot et le site sont hébergés par le même prestataire. Les coordonnées complètes de l'hébergeur sont détaillées dans les mentions légales du site.",
      linkLabel: "Voir la section Hébergement des mentions légales →",
    },
  },
  en: {
    eyebrow: "BLUEGENJI BOT · PRIVACY",
    title: "Privacy\nPolicy",
    lastUpdatedLabel: "Last updated",
    lastUpdated: "8 January 2025",
    intro:
      "Your privacy is important to us. This Privacy Policy explains how **BlueGenji Bot** collects, uses, and protects your information when you use the Bot's services.",
    sections: [
      {
        num: "01",
        title: "Data We Collect",
        meta: "COLLECTION",
        blocks: [
          { kind: "subhead", text: "User Data" },
          {
            kind: "bullets",
            items: [
              "**User IDs**: Used to manage cooldowns, moderation features, and for bot functionality.",
              "**Message Content**: Processed temporarily to fulfill specific commands and **is not stored in the database**.",
              "**Message IDs**: Stored temporarily for cooldowns and message edit tracking.",
            ],
          },
          { kind: "subhead", text: "Server Data" },
          {
            kind: "bullets",
            items: [
              "**Channel IDs**: Stored to enable linking and synchronization of content across servers.",
              "**Server Settings**: Processed to verify permissions (e.g., checking if a user is an administrator).",
              "**Server Name and bot utilization**: We are logging the add/deletion of service and the server name of the server which invite the bot or kick it.",
            ],
          },
        ],
      },
      {
        num: "02",
        title: "How We Use Your Data",
        meta: "PURPOSES",
        blocks: [
          { kind: "p", text: "The data collected by **BlueGenji Bot** is used for the following purposes:" },
          {
            kind: "bullets",
            items: [
              "To provide the core functionalities of the Bot, such as content synchronization, moderation, and cooldowns.",
              "To ensure proper access control and permission validation.",
              "To identify and fix bugs, improve the Bot's features, and ensure a smooth user experience.",
            ],
          },
          {
            kind: "p",
            text: "**Message content is only used to fulfill the functionality of the specific command it was provided for and is not stored for any other purpose.**",
          },
        ],
      },
      {
        num: "03",
        title: "Data Retention",
        meta: "RETENTION",
        blocks: [
          {
            kind: "bullets",
            items: [
              "**User IDs**: Stored as long as necessary for cooldown and moderation purposes.",
              "**Message IDs**: Automatically deleted after 72 hours or when the Bot restarts.",
              "**Channel IDs**: Stored until the linked synchronization is removed by the server administrators.",
              "**No personal data is permanently retained unless explicitly required for the Bot's functionality.**",
            ],
          },
        ],
      },
      {
        num: "04",
        title: "Data Sharing",
        meta: "THIRD PARTIES",
        blocks: [
          {
            kind: "bullets",
            items: [
              "We do not share your data with third-party companies except as required by law or in response to a valid legal request.",
            ],
          },
        ],
      },
      {
        num: "05",
        title: "Your Rights",
        meta: "GDPR",
        blocks: [
          { kind: "p", text: "You have the following rights regarding your data:" },
          {
            kind: "bullets",
            items: [
              "**Access**: You can request details of the data **BlueGenji Bot** has collected about you.",
              "**Correction**: You can request corrections to any inaccurate data.",
              "**Deletion**: You can request that your data be deleted from our systems. Note that some functionality of the Bot may no longer work if data essential for its operation is removed.",
            ],
          },
          {
            kind: "p",
            text: 'To exercise these rights, please contact us using the information in the "Contact Us" section.',
          },
        ],
      },
      {
        num: "06",
        title: "Data Security",
        meta: "PROTECTION",
        blocks: [
          { kind: "p", text: "We take reasonable precautions to protect your data, including:" },
          {
            kind: "bullets",
            items: [
              "Ensuring that stored data is secured and accessible only to authorized personnel.",
              "Regularly reviewing our data handling and storage practices.",
            ],
          },
          {
            kind: "p",
            text: "However, no method of electronic storage or transmission over the Internet is 100% secure, and we cannot guarantee absolute security.",
          },
        ],
      },
      {
        num: "07",
        title: "Changes to This Privacy Policy",
        meta: "UPDATES",
        blocks: [
          {
            kind: "p",
            text: `We may update this Privacy Policy from time to time. Any changes will be posted [on our Discord server](${DISCORD_INVITE}) and take effect immediately upon posting. Your continued use of **BlueGenji Bot** after any changes constitutes your acceptance of the updated Privacy Policy.`,
          },
        ],
      },
      {
        num: "08",
        title: "Contact Us",
        meta: "CONTACT",
        blocks: [
          {
            kind: "p",
            text: "If you have any questions or concerns about this Privacy Policy or how we handle your data, please contact us at:",
          },
          {
            kind: "bullets",
            items: [`**Email**: ${CONTACT_EMAIL}`, `**Discord**: ${CONTACT_DISCORD}`],
          },
          {
            kind: "p",
            text: "By using **BlueGenji Bot**, you agree to the terms outlined in this Privacy Policy.",
          },
        ],
      },
    ],
    hosting: {
      meta: "HOSTING PROVIDER",
      title: "Hosting",
      text: "The bot and the website are hosted by the same provider. The full hosting-provider details are set out in the website's legal notice.",
      linkLabel: "See the Hosting section of the legal notice →",
    },
  },
};
