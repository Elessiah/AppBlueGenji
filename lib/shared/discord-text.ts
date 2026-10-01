/**
 * Texte venu d'un utilisateur, rendu inoffensif avant de partir sur Discord.
 *
 * Les noms d'équipe (3 à 60 caractères quelconques) et le texte libre d'un
 * signalement partaient tels quels vers le bot — salon de logs, messages privés
 * aux arbitres et à la direction —, où Discord les **interprète** : une équipe
 * nommée `@everyone`, `<@&idRôle>` ou `<@idJoueur>` notifiait tout le serveur,
 * un rôle ou une personne à chaque ligne de journal la concernant ;
 * `[Valider le score](https://…)` devenait un lien masqué dans le salon du
 * staff ; un saut de ligne forgeait une fausse ligne de journal.
 *
 * Deux formes, selon la place du texte :
 * - {@link discordInline} pour un fragment dans une phrase (nom d'équipe, de
 *   tournoi) : une seule ligne, balisage échappé, mentions désamorcées ;
 * - {@link discordQuote} pour un texte libre sur plusieurs lignes : mêmes
 *   neutralisations, chaque ligne **citée** (`> `), si bien qu'aucune ne peut
 *   se faire passer pour une ligne écrite par le site.
 *
 * La neutralisation vit côté site parce que c'est lui qui **rédige** : le bot ne
 * fait que distribuer, et ne sait pas quelle partie d'un message est une saisie.
 *
 * Module pur, sans dépendance.
 */

/** Caractères de balisage Discord, précédés d'une barre oblique inverse. */
const MARKDOWN = /[\\*_~`|[\]()<>#-]/g;

/** Contrôles et séparateurs de ligne : rien de tout cela ne tient dans une phrase. */
const LINE_BREAKS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;

/**
 * Espace de largeur nulle glissée après `@` : `@everyone`, `@here` et
 * `@pseudo` ne sont plus reconnus comme des mentions, et s'affichent pourtant
 * à l'identique.
 */
const MENTION_BREAK = "@\u200B";

/** Barre oblique inverse, qui échappe le caractère qu'elle précède. */
const BACKSLASH = String.fromCodePoint(92);

function neutralize(value: string): string {
  return value.replace(MARKDOWN, (char) => BACKSLASH + char).replace(/@/g, MENTION_BREAK);
}

/**
 * Fragment de phrase sûr : une ligne, sans balisage actif ni mention.
 *
 * `<` étant échappé, les mentions par identifiant (`<@…>`, `<@&…>`, `<#…>`) et
 * les horodatages dynamiques ne sont plus reconnus non plus.
 */
export function discordInline(value: string): string {
  return neutralize(value.replace(LINE_BREAKS, " ").replace(/\s+/g, " ").trim());
}

/**
 * Texte libre sûr, cité ligne à ligne : ses sauts de ligne sont gardés (un
 * signalement se lit mieux en paragraphes), mais chaque ligne commence par
 * `> `, marque qu'aucune ligne rédigée par le site ne porte.
 */
export function discordQuote(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split(/[\n\u2028\u2029]/)
    .map((line) => neutralize(line.replace(LINE_BREAKS, " ").trim()))
    // Une ligne vide ne se cite pas (`>` nu s'affiche comme un chevron et coupe
    // la citation) : les paragraphes se suivent dans le même bloc cité.
    .filter((text) => text.length > 0)
    .map((text) => `> ${text}`)
    .join("\n");
}
