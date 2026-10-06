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

import type { Locale } from "@/lib/shared/locales";
import type { BotMessages } from "@/lib/shared/bot-text";

/** Clé des textes d'une section (`bot.docs.sections.<clé>`) : titre, sur-titre, résumé. */
export type BotDocTextKey = keyof BotMessages["docs"]["sections"];

export interface BotDocSection {
  /** Segment d'URL sous `/bot/docs` — le même dans les deux langues. */
  slug: string;
  /**
   * Textes de la nav et de l'en-tête, dans la langue de la page
   * (`bot.docs.sections.<textKey>` : `title`, `eyebrow`, `summary`).
   */
  textKey: BotDocTextKey;
  /** Chemin du fichier, relatif à la racine du projet du bot — le document français. */
  file: string;
  /**
   * Version anglaise du document, servie sous `/en` (`help.md` pour le guide).
   * Absente : le document n'existe qu'en français ; sous `/en`, il est servi
   * tel quel, annoncé `lang="fr"` (pages réservées au staff, l'administration
   * n'est pas traduite — D4).
   */
  fileEn?: string;
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
 *
 * Le guide anglais (`help.md`) avait sa propre entrée, `user-guide-en`, tant
 * que le site n'avait qu'une langue ; depuis le lot 5a, c'est le guide servi
 * sous `/en/bot/docs/guide`, et l'ancienne adresse y redirige
 * ({@link LEGACY_BOT_DOC_REDIRECTS}).
 */
export const BOT_DOC_SECTIONS: BotDocSection[] = [
  { slug: "guide", textKey: "guide", file: "helpfr.md", fileEn: "help.md" },
  { slug: "adhesions", textKey: "adhesions", file: "doc/adhesions-commands-user.md", staffOnly: true },
  { slug: "api-interne", textKey: "apiInterne", file: "doc/internal-api.md", staffOnly: true },
  { slug: "architecture", textKey: "architecture", file: "doc/main.md", staffOnly: true },
  { slug: "base-de-donnees", textKey: "baseDeDonnees", file: "doc/src/Bdd.md", staffOnly: true },
  {
    slug: "reprise-apres-sinistre",
    textKey: "repriseApresSinistre",
    file: "doc/disaster-recovery.md",
    staffOnly: true,
  },
];

/**
 * Anciennes adresses de section, redirigées en permanence (308) — un lien ou un
 * favori vers le guide anglais d'avant le lot 5a mène à sa nouvelle place.
 */
export const LEGACY_BOT_DOC_REDIRECTS: Readonly<Record<string, string>> = {
  "user-guide-en": "/en/bot/docs/guide",
};

/** Le fichier servi dans une langue : l'anglais s'il existe, sinon le français. */
export function botDocFile(section: BotDocSection, locale: Locale): string {
  return locale === "en" && section.fileEn ? section.fileEn : section.file;
}

/** La langue réelle du document servi (`lang` de l'article). */
export function botDocLanguage(section: BotDocSection, locale: Locale): Locale {
  return locale === "en" && section.fileEn ? "en" : "fr";
}

/** Sous-ensemble visible par un visiteur sans rôle de permission de plateforme. */
export function visibleBotDocSections(isStaff: boolean): BotDocSection[] {
  return BOT_DOC_SECTIONS.filter((s) => isStaff || !s.staffOnly);
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
 * occupent la place laissée par les pages techniques masquées au
 * visiteur sans rôle — la seule doc du bot qui le concerne vraiment.
 */
export interface BotLegalLink {
  slug: string;
  /** Textes : `bot.docs.legal.<textKey>` (`title`, `summary`). */
  textKey: keyof BotMessages["docs"]["legal"];
  href: string;
}

export const BOT_LEGAL_LINKS: readonly BotLegalLink[] = [
  { slug: "confidentialite", textKey: "confidentialite", href: "/privacy-policy-bot" },
  { slug: "conditions", textKey: "conditions", href: "/terms-of-service-bot" },
];
