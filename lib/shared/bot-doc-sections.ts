/**
 * Le registre des documents du bot exposés sous `/bot/docs`.
 *
 * Il vit dans `lib/shared` et non dans `lib/server/bot-docs.ts`, où il est né,
 * pour une raison mécanique : `components/bot/BotCommands.tsx` l'affiche, et
 * le module serveur importe `node:fs/promises` **au premier niveau**. Tant que
 * ce composant reste un composant serveur, l'import passe ; le jour où
 * quelqu'un lui ajoute un filtre et un `"use client"`, la compilation échoue
 * sur une erreur de résolution de `node:fs` qui ne nomme pas sa cause. La
 * convention du projet — « `lib/server/*` ne s'importe jamais depuis un
 * composant client » — devient ainsi vraie par construction plutôt que par
 * vigilance.
 *
 * C'est du reste ce que ces données sont : une **liste**, sans lecture de
 * disque ni dépendance serveur. Seuls la lecture du fichier et le rendu du
 * Markdown restent côté serveur.
 *
 * `lib/server/bot-docs.ts` les réexporte, si bien qu'aucun appelant n'a eu à
 * changer d'adresse.
 */

export interface BotDocSection {
  /** Segment d'URL sous `/bot/docs`. */
  slug: string;
  /** Titre affiché dans la nav et en tête de page. */
  title: string;
  /** Sur-titre mono affiché au-dessus du titre. */
  eyebrow: string;
  /** Résumé court affiché dans la nav. */
  summary: string;
  /** Chemin du fichier, relatif à la racine du projet du bot. */
  file: string;
  /**
   * Réservée au staff (au moins un rôle de permission de plateforme). Ces
   * pages décrivent le fonctionnement interne du bot (API, base de données,
   * commandes d'adhésion réservées aux serveurs BlueGenji) et n'ont rien à
   * dire à un visiteur sans rôle. Absent ou `false` = publique.
   */
  staffOnly?: boolean;
}

/**
 * Registre des documents exposés publiquement. C'est aussi le garde-fou contre
 * la traversée de chemin : seuls ces fichiers peuvent être lus, un slug inconnu
 * ne résout rien.
 */
export const BOT_DOC_SECTIONS: BotDocSection[] = [
  {
    slug: "guide",
    title: "Guide utilisateur",
    eyebrow: "PRISE EN MAIN · FR",
    summary: "Services, format des messages et commandes slash.",
    file: "helpfr.md",
  },
  {
    slug: "adhesions",
    title: "Commandes d'adhésion",
    eyebrow: "SERVEURS BLUEGENJI",
    summary: "Envoi des documents d'adhésion, rappels et validations.",
    file: "doc/adhesions-commands-user.md",
    staffOnly: true,
  },
  {
    slug: "api-interne",
    title: "API interne",
    eyebrow: "INTÉGRATION · EXPRESS",
    summary: "Endpoints HTTP consommés par la plateforme.",
    file: "doc/internal-api.md",
    staffOnly: true,
  },
  {
    slug: "architecture",
    title: "Architecture",
    eyebrow: "TECHNIQUE · MAIN",
    summary: "Client Discord, intents et listeners du bot.",
    file: "doc/main.md",
    staffOnly: true,
  },
  {
    slug: "base-de-donnees",
    title: "Base de données",
    eyebrow: "TECHNIQUE · SQLITE",
    summary: "Tables, messages dupliqués et salons partenaires.",
    file: "doc/src/Bdd.md",
    staffOnly: true,
  },
  {
    slug: "user-guide-en",
    title: "User guide (EN)",
    eyebrow: "GETTING STARTED · EN",
    summary: "English version of the user guide.",
    file: "help.md",
  },
];

/** Sous-ensemble visible par un visiteur sans rôle de permission de plateforme. */
export function visibleBotDocSections(isStaff: boolean): BotDocSection[] {
  return isStaff ? BOT_DOC_SECTIONS : BOT_DOC_SECTIONS.filter((s) => !s.staffOnly);
}

/**
 * Résout un slug vers sa section, en respectant la même frontière que la nav :
 * une page réservée au staff n'existe pas pour qui n'a aucun rôle — un `null`
 * ici mène au même 404 qu'un slug inconnu, jamais à un refus qui confirmerait
 * son existence.
 */
export function findBotDocSection(slug: string | undefined, isStaff: boolean): BotDocSection | null {
  const wanted = slug ?? BOT_DOC_SECTIONS[0].slug;
  const section = BOT_DOC_SECTIONS.find((s) => s.slug === wanted) ?? null;
  if (section?.staffOnly && !isStaff) return null;
  return section;
}

/**
 * Un document légal, publié à sa propre adresse (`app/privacy-policy-bot`,
 * `app/terms-of-service-bot`) plutôt que servi par `/bot/docs` : ce ne sont pas
 * des fichiers Markdown relus chez le bot, mais des pages du site. Elles
 * occupent la place laissée par les quatre pages techniques masquées au
 * visiteur sans rôle — la seule doc du bot qui le concerne vraiment.
 */
export interface BotLegalLink {
  slug: string;
  title: string;
  summary: string;
  href: string;
}

export const BOT_LEGAL_LINKS: readonly BotLegalLink[] = [
  {
    slug: "confidentialite",
    title: "Politique de confidentialité",
    summary: "Données collectées par le bot, leur usage et leur durée de conservation.",
    href: "/privacy-policy-bot",
  },
  {
    slug: "conditions",
    title: "Conditions d'utilisation",
    summary: "Règles d'usage du bot, éligibilité et résiliation d'accès.",
    href: "/terms-of-service-bot",
  },
];
