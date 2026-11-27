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
import {
  GETI_TEXT_MAX,
  NOT_AFTER_WORD,
  getiDisplayText,
  getiSafeText,
  prepareGetiText,
  withoutMarkup,
} from "@/lib/shared/geti/normalize";
import { parseGetiRanks } from "@/lib/shared/geti/ranks";
import { findGetiRoleTokens, getiRolesOf, getiSubRolesOf } from "@/lib/shared/geti/roles";
import {
  GETI_CATEGORIES,
  GETI_CHANNEL_IDS,
  type GetiCategory,
  type GetiParseOptions,
  type GetiParsedPost,
  type GetiRawEmbed,
  type GetiRawPost,
} from "@/lib/shared/geti/types";
import { visibleText } from "@/lib/shared/visible-text";

/** Pseudo Discord : 32 caractères, plus l'ancien suffixe « #1234 ». */
const USERNAME_MAX = 32;
const ORIGIN_SERVER_MAX = 100;
/** Longueur lue d'un texte brut (contenu, titre, description, champ) : deux fois la borne affichée. */
const RAW_TEXT_MAX = GETI_TEXT_MAX * 2;
/** Discord n'envoie jamais plus de 10 encarts, de 25 champs chacun. */
const EMBEDS_MAX = 10;
const EMBED_FIELDS_MAX = 25;
/** La ligne « Sent from » est la dernière : elle tient dans la fin de la description. */
const TRAILER_WINDOW = 600;
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
    String.raw`^[^\p{L}\p{N}<>\n]*(?:by|par|from|author|auteur|contact)\s*(?::\s*)?<@!?(\d{15,22})>`,
    String.raw`${NOT_AFTER_WORD}(?:author|auteur|contact)\s*:\s*<@!?(\d{15,22})>`,
    String.raw`${NOT_AFTER_WORD}(?:posted|sent|written|post[ée]e?|publi[ée]e?|envoy[ée]e?|[ée]crite?)\s+(?:by|par)\s*(?::\s*)?<@!?(\d{15,22})>`,
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
  String.raw`(?:^|\n)\n*[*_]*Sent from\s?:\s?${SENT_FROM_LINK}[*_]*${SENT_FROM_AUTHOR}\s*$`,
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
/**
 * Pseudo Discord lisible sur une ligne d'auteur d'encart : nouveau format
 * (« faux.pseudo ») ou ancien (« Faux Pseudo#4821 »). Un nom d'affichage libre
 * (« Admin (@staff) ») n'en est pas un : son auteur l'écrit à sa guise.
 */
const USERNAME_SHAPE = /^(?:[\w.]{2,32}|[^#@:`()\n]{2,32}#\d{4})$/u;
/** Ligne citée (« > … ») : le texte relayé d'un joueur, jamais l'en-tête du bot. */
const QUOTED_LINE = /^\s*>/u;

/** Un texte brut, borné : aucun motif ne lit plus que ce qu'une annonce peut porter. */
function text(value: unknown): string {
  return typeof value === "string" ? value.slice(0, RAW_TEXT_MAX) : "";
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

/** Pseudo écrit tel quel (« pseudo », « pseudo#1234 ») : l'ancien suffixe séparé. */
function splitTag(value: string): string | null {
  const [name, suffix] = value.split(/#(?=\d{4}$)/u);
  return authorTag(name, suffix);
}

/** Pseudo lu dans la ligne d'auteur d'un encart, s'il a la forme d'un pseudo Discord. */
function embedAuthorTag(authorName: unknown): string | null {
  const shown = visibleText(text(authorName)).replace(/^@+/u, "");
  return USERNAME_SHAPE.test(shown) ? splitTag(shown) : null;
}

/** Auteur nommé par une partie du relais que le bot écrit (en-tête, dernière ligne). */
type RelayAuthor = { id: string | null; tag: string | null; originServer: string | null };

type RelayContent = {
  body: string;
  authorTag: string | null;
  authorId: string | null;
  originServer: string | null;
};

function embedsOf(raw: GetiRawPost): GetiRawEmbed[] {
  return Array.isArray(raw.embeds)
    ? raw.embeds
        .slice(0, EMBEDS_MAX)
        .filter((embed): embed is GetiRawEmbed => typeof embed === "object" && embed !== null)
    : [];
}

/** Champs d'un encart, une ligne chacun : « Nom : valeur ». */
function embedFieldLines(embed: GetiRawEmbed): string[] {
  const fields = Array.isArray(embed.fields) ? embed.fields.slice(0, EMBED_FIELDS_MAX) : [];
  return fields.flatMap((field) => {
    if (typeof field !== "object" || field === null) return [];
    const parts = [text(field.name).trim(), text(field.value).trim()].filter((part) => part !== "");
    return parts.length === 0 ? [] : [parts.join(" : ")];
  });
}

/**
 * Auteur d'un relais sans en-tête ni ligne « Sent from » : la mention derrière
 * un libellé, sinon personne. Une mention sans libellé peut viser un tiers
 * (« duo avec <@id> »), une ligne citée (« > Contact : <@id> ») est le texte du
 * joueur, et deux libellés qui nomment deux comptes différents se contredisent
 * (le second peut être écrit par le joueur) : personne n'est désigné.
 */
function mentionedAuthorId(body: string): string | null {
  const unquoted = body
    .split("\n")
    .filter((line) => !QUOTED_LINE.test(line))
    .join("\n");
  let found: string | null = null;
  for (const match of unquoted.matchAll(AUTHOR_MENTION)) {
    const id = match.slice(1).find((group) => group !== undefined) ?? null;
    if (id === null) continue;
    if (found !== null && found !== id) return null;
    found = id;
  }
  return found;
}

/** Retire les échappements Markdown (« \_ », « \] »). */
function unescapeMarkdown(value: string): string {
  return value.replace(/\\(.)/gu, "$1");
}

/** Nom du serveur d'origine, en texte seul : ni balisage, ni mention, ni « @everyone ». */
function serverName(value: string): string | null {
  return withoutMarkup(visibleText(unescapeMarkdown(value))).slice(0, ORIGIN_SERVER_MAX).trim() || null;
}

/** Ligne « Sent from » qui clôt une description, en tête de ligne seulement (jamais « > Sent from »). */
function trailerOf(description: string): RegExpExecArray | null {
  const windowStart = Math.max(0, description.length - TRAILER_WINDOW);
  const trailer = SENT_FROM.exec(description.slice(windowStart));
  if (trailer === null) return null;
  trailer.index += windowStart;
  const startsLine = trailer[0].startsWith("\n") || trailer.index === 0 || description[trailer.index - 1] === "\n";
  return startsLine ? trailer : null;
}

/**
 * Auteur d'un relais : celui que nomment l'en-tête GETI et la ligne « Sent
 * from » de notre bot. Deux sources qui nomment deux comptes différents se
 * contredisent (l'une est écrite par le joueur : notre relais s'ouvre sur son
 * texte) : personne n'est désigné. Pseudo et identifiant viennent de la même
 * source.
 */
function relayAuthor(header: RelayAuthor | null, trailer: RelayAuthor | null): RelayAuthor | null {
  const named = [trailer, header].filter((source): source is RelayAuthor => source !== null && source.id !== null);
  if (named.length === 0) return null;
  const originServer = trailer?.originServer ?? header?.originServer ?? null;
  if (named.some((source) => source.id !== named[0].id)) return { id: null, tag: null, originServer };
  return { id: named[0].id, tag: named[0].tag, originServer };
}

/** Texte, auteur et origine d'un relais : tout se lit dans les encarts du bot. */
function relayContent(raw: GetiRawPost): RelayContent {
  const parts: string[] = [text(raw.content)];
  let header: RelayAuthor | null = null;
  let trailer: RelayAuthor | null = null;
  let lineTag: string | null = null;
  let lineServer: string | null = null;
  for (const embed of embedsOf(raw)) {
    const description = text(embed.description);
    const headerMatch = GETI_HEADER.exec(description);
    if (headerMatch !== null) {
      header ??= {
        id: headerMatch[1],
        tag: splitTag(visibleText(unescapeMarkdown(headerMatch[2]))),
        originServer: serverName(headerMatch[3]),
      };
    }
    const embedTag = embedAuthorTag(embed.authorName);
    lineTag ??= embedTag;
    const trailerMatch = trailerOf(description);
    if (trailerMatch !== null) {
      const id = trailerMatch[2] ?? null;
      // Notre bot écrit le pseudo de l'auteur sur la ligne d'auteur de ce même encart.
      if (id === null) lineServer ??= serverName(trailerMatch[1]);
      else trailer ??= { id, tag: embedTag, originServer: serverName(trailerMatch[1]) };
    }
    const start = headerMatch === null ? 0 : headerMatch[0].length;
    const end = trailerMatch === null ? undefined : Math.max(start, trailerMatch.index);
    parts.push(text(embed.title), description.slice(start, end), ...embedFieldLines(embed));
  }
  const body = parts.filter((part) => part.trim() !== "").join("\n");
  const named = relayAuthor(header, trailer);
  if (named !== null) {
    return { body, authorTag: named.tag, authorId: named.id, originServer: named.originServer ?? lineServer };
  }
  // Sans source du bot : une mention libellée, dont le pseudo ne se devine pas (la
  // ligne d'auteur peut nommer un autre compte) ; sinon le seul pseudo de cette ligne.
  const mentioned = mentionedAuthorId(body);
  return { body, authorTag: mentioned === null ? lineTag : null, authorId: mentioned, originServer: lineServer };
}

function contentOf(raw: GetiRawPost, options: GetiParseOptions): RelayContent & { relayed: boolean } {
  if (raw.author?.bot === true) {
    const relay = relayContent(raw);
    const allowed = options.relayBotIds;
    const trusted = allowed === undefined || allowed.includes(snowflake(raw.author.id) ?? "");
    // Un bot ou un webhook inconnu se fait passer pour qui il veut : son texte se lit, son auteur non.
    return trusted
      ? { ...relay, relayed: true }
      : { ...relay, authorTag: null, authorId: null, originServer: null, relayed: true };
  }
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
 * Un bot (ou un webhook) peut se faire passer pour n'importe qui : avec
 * `options.relayBotIds`, seul le relais de l'un de ces bots nomme un auteur.
 *
 * @param raw Message Discord brut, non fiable.
 * @param options Bots relais de confiance (lot 2 : bot GETI et notre bot).
 * @returns L'annonce analysée ; un message vide rend des champs vides.
 */
export function parseGetiPost(raw: GetiRawPost, options: GetiParseOptions = {}): GetiParsedPost {
  const source: GetiRawPost = typeof raw === "object" && raw !== null ? raw : {};
  const content = contentOf(source, options);
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
    text: getiSafeText(displayed),
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
