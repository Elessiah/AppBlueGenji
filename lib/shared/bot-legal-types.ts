/**
 * Forme des documents légaux du bot, et l'ancre vers l'hébergeur — module pur,
 * **sans aucune importation**.
 *
 * Séparé du contenu (`lib/shared/bot-legal-content.ts`) pour que le rendu,
 * `components/legal/BotLegalDoc.tsx`, ne dépende que de la forme : le contenu
 * arrive déjà résolu par la page serveur, en props, dans la langue de
 * l'adresse (lot 7a).
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
