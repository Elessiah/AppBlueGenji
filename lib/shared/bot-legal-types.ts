/**
 * Forme des documents légaux du bot, et l'ancre vers l'hébergeur — module pur,
 * **sans aucune importation**.
 *
 * Séparé du contenu (`lib/shared/bot-legal-content.ts`) parce que le rendu,
 * `components/legal/BotLegalDoc.tsx`, est un composant client : n'importer que
 * ce module lui évite d'embarquer dans le paquet du navigateur le registre des
 * traitements et tout ce que le contenu lit pour citer ses durées. Le contenu
 * arrive, lui, déjà résolu par la page serveur, en props.
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
