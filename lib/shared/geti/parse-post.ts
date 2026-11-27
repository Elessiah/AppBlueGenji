/**
 * Analyse d'une annonce GETI : d'un message Discord brut (texte libre d'un
 * joueur, ou relais d'un bot en encart) vers des données simples.
 *
 * Rien de ce qui entre n'est fiable. La sortie ne porte que des énumérations,
 * des nombres et quatre textes nettoyés (`text`, `authorTag`, `teamName`,
 * `originServer`) passés par les règles d'`UNTRUSTED_NAMES.md` — à afficher en
 * texte, jamais à interpréter.
 *
 * Module pur : importable côté serveur comme côté client.
 */
import {
  detectGetiCategory,
  parseGetiAvailability,
  parseGetiLanguages,
  parseGetiMinAge,
  parseGetiPlatforms,
  parseGetiRegions,
  parseGetiStaffRoles,
  parseGetiTeamName,
} from "@/lib/shared/geti/fields";
import { NOT_AFTER_WORD, getiDisplayText, prepareGetiText } from "@/lib/shared/geti/normalize";
import { parseGetiRanks } from "@/lib/shared/geti/ranks";
import { findGetiRoleTokens, getiRolesOf, getiSubRolesOf } from "@/lib/shared/geti/roles";
import {
  GETI_CATEGORIES,
  GETI_CHANNEL_IDS,
  type GetiCategory,
  type GetiParsedPost,
  type GetiRawEmbed,
  type GetiRawPost,
} from "@/lib/shared/geti/types";
import { visibleText } from "@/lib/shared/visible-text";

/** Pseudo Discord : 32 caractères, plus l'ancien suffixe « #1234 ». */
const USERNAME_MAX = 32;
const ORIGIN_SERVER_MAX = 100;
const SNOWFLAKE = /^\d{15,22}$/u;
const DISCRIMINATOR = /^\d{4}$/u;
/**
 * Mention de l'auteur dans un relais, derrière un libellé net : en tête de
 * ligne (« by <@id> », « Contact : <@id> »), suivi de deux-points
 * (« Auteur : <@id> ») ou « posté par <@id> ». Dans une phrase, « par », « de »
 * ou « by » désignent n'importe qui (« remplaçant de <@id> », « remplacé par
 * <@id> ») : jamais lus.
 */
const AUTHOR_MENTION = new RegExp(
  [
    String.raw`^[^\p{L}\p{N}<>\n]*(?:by|par|from|author|auteur|contact)\s*:?\s*<@!?(\d{15,22})>`,
    String.raw`${NOT_AFTER_WORD}(?:author|auteur|contact)\s*:\s*<@!?(\d{15,22})>`,
    String.raw`${NOT_AFTER_WORD}(?:posted|sent|written|post[ée]e?|publi[ée]e?|envoy[ée]e?|[ée]crite?)\s+(?:by|par)\s*:?\s*<@!?(\d{15,22})>`,
  ].join("|"),
  "gimu",
);
/**
 * Dernière ligne d'un relais de notre bot (`buildServiceMessage`) :
 * « *Sent from : [Serveur](invitation)* by <@id> ».
 */
const SENT_FROM_LINK = String.raw`\[((?:\\.|[^\]\\])*)\]\([^)\s]*\)`;
const SENT_FROM_AUTHOR = String.raw`(?:\s*by\s*<@!?(\d{15,22})>)?`;
const SENT_FROM = new RegExp(
  String.raw`\n*[*_]*Sent from\s?:\s?${SENT_FROM_LINK}[*_]*${SENT_FROM_AUTHOR}\s*$`,
  "iu",
);
/**
 * Première ligne d'un relais du bot GETI :
 * « <@id>*(pseudo)* sur [Serveur](invitation) », puis le texte cité (« > … »).
 */
const GETI_HEADER = new RegExp(
  String.raw`^\s*<@!?(\d{15,22})>[^\S\n]*[*_]*\(((?:\\.|[^)\n\\]){1,64})\)[*_]*[^\S\n]*(?:sur|on|from)[^\S\n]*${SENT_FROM_LINK}[^\S\n]*(?:\n|$)`,
  "iu",
);
/** Pseudo entre parenthèses derrière un nom d'affichage : « Nom (@pseudo) ». */
const HANDLE_IN_PARENTHESES = /\(@?([\w.]{2,32}(?:#\d{4})?)\)\s*$/u;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function snowflake(value: unknown): string | null {
  return typeof value === "string" && SNOWFLAKE.test(value) ? value : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function isCategory(value: unknown): value is GetiCategory {
  return GETI_CATEGORIES.some((category) => category === value);
}

/**
 * Catégorie du salon source.
 *
 * @param channelId Identifiant du salon Discord.
 * @returns La catégorie, ou `null` pour un salon inconnu.
 */
export function getiCategoryOfChannel(channelId: unknown): GetiCategory | null {
  return GETI_CATEGORIES.find((category) => GETI_CHANNEL_IDS[category] === channelId) ?? null;
}

/** Pseudo copiable : nettoyé, sans « @ » de tête, avec l'ancien suffixe s'il existe. */
function authorTag(username: unknown, discriminator: unknown): string | null {
  const name = visibleText(text(username)).replace(/^@+/u, "").slice(0, USERNAME_MAX).trim();
  if (name === "") return null;
  const suffix = text(discriminator);
  return DISCRIMINATOR.test(suffix) && suffix !== "0000" ? `${name}#${suffix}` : name;
}

/** Pseudo lu dans la ligne d'auteur d'un encart : « pseudo », « pseudo#1234 », « Nom (@pseudo) ». */
function embedAuthorTag(authorName: unknown): string | null {
  const shown = visibleText(text(authorName));
  const handle = HANDLE_IN_PARENTHESES.exec(shown);
  const [name, suffix] = (handle === null ? shown : handle[1]).split(/#(?=\d{4}$)/u);
  return authorTag(name, suffix);
}

type RelayContent = {
  body: string;
  authorTag: string | null;
  authorId: string | null;
  originServer: string | null;
};

function embedsOf(raw: GetiRawPost): GetiRawEmbed[] {
  return Array.isArray(raw.embeds)
    ? raw.embeds.filter((embed): embed is GetiRawEmbed => typeof embed === "object" && embed !== null)
    : [];
}

/** Champs d'un encart, une ligne chacun : « Nom : valeur ». */
function embedFieldLines(embed: GetiRawEmbed): string[] {
  const fields = Array.isArray(embed.fields) ? embed.fields : [];
  return fields.flatMap((field) => {
    if (typeof field !== "object" || field === null) return [];
    const parts = [text(field.name).trim(), text(field.value).trim()].filter((part) => part !== "");
    return parts.length === 0 ? [] : [parts.join(" : ")];
  });
}

/**
 * Auteur d'un relais sans ligne « Sent from » : la mention derrière un libellé,
 * sinon personne. Une mention sans libellé peut viser un tiers (« duo avec
 * <@id> ») : la deviner enverrait les lecteurs vers quelqu'un qui n'a rien écrit.
 */
function mentionedAuthorId(body: string): string | null {
  const labelled = [...body.matchAll(AUTHOR_MENTION)].at(-1);
  return labelled?.slice(1).find((id) => id !== undefined) ?? null;
}

/** Retire les échappements Markdown (« \_ », « \] »). */
function unescapeMarkdown(value: string): string {
  return value.replace(/\\(.)/gu, "$1");
}

function serverName(value: string): string | null {
  return visibleText(unescapeMarkdown(value)).slice(0, ORIGIN_SERVER_MAX) || null;
}

/** Texte, auteur et origine d'un relais : tout se lit dans les encarts du bot. */
function relayContent(raw: GetiRawPost): RelayContent {
  const parts: string[] = [text(raw.content)];
  let originServer: string | null = null;
  let authorId: string | null = null;
  let tag: string | null = null;
  for (const embed of embedsOf(raw)) {
    const description = text(embed.description);
    // L'en-tête GETI nomme l'auteur : il passe avant toute mention du texte cité.
    const header = GETI_HEADER.exec(description);
    if (header !== null) {
      authorId ??= header[1];
      tag ??= embedAuthorTag(unescapeMarkdown(header[2]));
      originServer ??= serverName(header[3]);
    }
    tag ??= embedAuthorTag(embed.authorName);
    const trailer = SENT_FROM.exec(description);
    if (trailer !== null) {
      originServer ??= serverName(trailer[1]);
      authorId ??= trailer[2] ?? null;
    }
    const start = header === null ? 0 : header[0].length;
    const end = trailer === null ? undefined : Math.max(start, trailer.index);
    parts.push(text(embed.title), description.slice(start, end), ...embedFieldLines(embed));
  }
  const body = parts.filter((part) => part.trim() !== "").join("\n");
  return { body, authorTag: tag, authorId: authorId ?? mentionedAuthorId(body), originServer };
}

function contentOf(raw: GetiRawPost): RelayContent & { relayed: boolean } {
  if (raw.author?.bot === true) return { ...relayContent(raw), relayed: true };
  return {
    body: text(raw.content),
    authorTag: authorTag(raw.author?.username, raw.author?.discriminator),
    authorId: snowflake(raw.author?.id),
    originServer: null,
    relayed: false,
  };
}

/**
 * Analyse une annonce GETI.
 *
 * La catégorie est celle que donne l'appelant, sinon celle du salon, sinon
 * celle du seul mot-clé (« lfp », « lft »…) du texte. Les rôles d'une annonce
 * « je cherche un joueur » sont les rôles **recherchés** ; ceux d'une annonce
 * « je cherche une équipe » sont ceux de l'auteur — même champ, lu pareil.
 *
 * @param raw Message Discord brut, non fiable.
 * @returns L'annonce analysée ; un message vide rend des champs vides.
 */
export function parseGetiPost(raw: GetiRawPost): GetiParsedPost {
  const source: GetiRawPost = typeof raw === "object" && raw !== null ? raw : {};
  const content = contentOf(source);
  const displayed = getiDisplayText(content.body);
  const prepared = prepareGetiText(displayed);
  const roleTokens = findGetiRoleTokens(prepared.lower);
  return {
    category: isCategory(source.category)
      ? source.category
      : (getiCategoryOfChannel(source.channelId) ?? detectGetiCategory(prepared.lower)),
    authorTag: content.authorTag,
    authorId: content.authorId,
    relayed: content.relayed,
    originServer: content.originServer,
    text: displayed,
    ranks: parseGetiRanks(prepared.lower, roleTokens),
    roles: getiRolesOf(roleTokens),
    subRoles: getiSubRolesOf(roleTokens),
    regions: parseGetiRegions(prepared.lower, displayed),
    platforms: parseGetiPlatforms(prepared.lower),
    languages: parseGetiLanguages(prepared, displayed),
    availability: parseGetiAvailability(prepared),
    teamName: parseGetiTeamName(prepared.clean),
    staffRoles: parseGetiStaffRoles(prepared.lower),
    minAge: parseGetiMinAge(prepared.lower),
    postedAt: isoDate(source.postedAt),
    edited: isoDate(source.editedAt) !== null,
  };
}
