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
  parseGetiSchedule,
  parseGetiLanguages,
  parseGetiLevels,
  parseGetiMinAge,
  parseGetiPlatforms,
  parseGetiRegions,
  parseGetiStaffRoles,
  parseGetiTeamName,
} from "@/lib/shared/geti/fields";
import {
  CUSTOM_EMOJI,
  GETI_TEXT_MAX,
  MENTION,
  NOT_AFTER_WORD,
  NOT_BEFORE_WORD,
  getiDisplayText,
  getiSafeText,
  getiWithoutSpoilers,
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
 * Lien vers le serveur d'origine d'un relais GETI. Le nom du serveur porte
 * souvent lui-même des crochets (« [TAG] Nom ») — la forme la plus courante du
 * flux réel — : il court jusqu'au « ]( » qui ouvre l'invitation, sur la ligne.
 */
const GETI_SERVER_LINK = String.raw`\[([^\n]{1,200}?)\]\(https?:\/\/[^)\s]*\)`;
/**
 * Première ligne d'un relais du bot GETI :
 * « <@id>*(pseudo)* sur [Serveur](invitation) », puis le texte cité (« > … »).
 * Le pseudo peut porter une parenthèse fermante (« Bob :) ») : il court
 * jusqu'à la première « ) » suivie de « sur », « on » ou « from » et du lien.
 */
const GETI_HEADER = new RegExp(
  String.raw`^\s*<@!?(\d{15,22})>[^\S\n]*[*_]*\(((?:\\.|[^\n\\]){1,64}?)\)[*_]*[^\S\n]*(?:sur|on|from)[^\S\n]*${GETI_SERVER_LINK}[^\S\n]*(?:\n|$)`,
  "iu",
);
/**
 * Première ligne qui s'ouvre comme un en-tête GETI (mention en tête) sans s'y
 * lire en entier : écrite par le bot GETI avec le pseudo et le nom de serveur
 * que d'autres choisissent, elle n'est jamais lue pour le texte, ni pour le
 * pseudo ou le serveur ; seule sa mention de tête, qu'écrit le bot, nomme l'auteur.
 */
const GETI_HEADER_LIKE_LINE = /^\s*<@!?(\d{15,22})>[^\n]*(?:\n|$)/u;

/**
 * Réponse de service d'un bot de relais à celui qui vient de publier (« Ton
 * annonce a été publié dans 32 autres channels. », lien d'invitation du bot) :
 * ce n'est pas une annonce.
 */
const BOT_NOTICE = new RegExp(
  [
    String.raw`(?:ton|votre|ta)\s+(?:annonce|message|post)\s+a\s+[ée]t[ée]\s+(?:publi|envoy|relay|partag|supprim|modifi)[ée]e?`,
    String.raw`your\s+(?:ad|post|message|announcement)\s+(?:has\s+been|was)\s+(?:published|posted|sent|relayed|shared|deleted|edited)`,
    String.raw`discord(?:app)?\.com\/(?:api\/)?oauth2\/authorize\?`,
  ].join("|"),
  "iu",
);

/**
 * Dit si un message est une réponse de service d'un bot (confirmation de
 * publication, invitation du bot) plutôt qu'une annonce : à ne pas garder.
 * Un relais qui porte l'en-tête GETI est toujours une annonce.
 *
 * @param raw Message Discord brut, non fiable.
 * @returns `true` pour une réponse de service.
 */
export function isGetiBotNotice(raw: GetiRawPost): boolean {
  const source: GetiRawPost = typeof raw === "object" && raw !== null ? raw : {};
  if (source.author?.bot !== true) return false;
  const descriptions = embedsOf(source).map(({ embed }) => text(embed.description));
  if (descriptions.some((description) => GETI_HEADER.test(description))) return false;
  return BOT_NOTICE.test([text(source.content), ...descriptions].join("\n"));
}

/** Passage barré : ce qui n'est plus d'actualité (un jour pris, une annonce close). */
const STRUCK = /~~([^~]+(?:~(?!~)[^~]*)*)~~/gu;
/** Ce qui n'est pas du texte : citation, mentions, émojis de serveur, balisage, ponctuation. */
const NOT_TEXT = /<[^<>\s]{1,60}>|[^\p{L}\p{N}]/gu;

/**
 * Texte à analyser : sans ses passages barrés (« ~~Mardi 24/11~~ Mercredi
 * 25/11 » ne cherche plus que mercredi). Quand **tout** est barré, l'annonce
 * est close : son contenu reste lu, pour qu'elle garde ses données.
 */
function withoutStruck(displayed: string): { analysed: string; closed: boolean } {
  if (!displayed.includes("~~")) return { analysed: displayed, closed: false };
  const kept = displayed.replace(STRUCK, " ");
  if (kept === displayed) return { analysed: displayed, closed: false };
  const closed = kept.replace(NOT_TEXT, "") === "";
  return { analysed: closed ? displayed.replace(STRUCK, " $1 ") : kept, closed };
}

/**
 * Pseudo Discord lisible sur une ligne d'auteur d'encart : nouveau format
 * (« faux.pseudo ») ou ancien (« Faux Pseudo#4821 »). Un nom d'affichage libre
 * (« Admin (@staff) ») n'en est pas un : son auteur l'écrit à sa guise.
 */
const USERNAME_SHAPE = /^(?:[\w.]{2,32}|[^#@:`()\n]{2,32}#\d{4})$/u;
/** Ligne citée (« > … ») : le texte relayé d'un joueur, jamais l'en-tête du bot. */
const QUOTED_LINE = /^\s*>/u;
/**
 * Balisage au bord d'un mot (« **Nitro** », « ||x|| ») : retiré. À l'intérieur
 * d'un ancien pseudo (« Star*Lord#1234 »), il en fait partie et reste.
 */
const TAG_EDGE_MARKUP = /(?<=^|\s)[*~`|]+|[*~`|]+(?=\s|$)/gu;
/** Ni « @ » (aucun pseudo n'en porte) ni chevron (reste d'une mention). */
const TAG_SYMBOLS = /[<>@]+/gu;
/** Citation en bloc (« >>> ») : jusqu'à la fin du message. */
const BLOCK_QUOTE = /^\s*>>>\s/u;

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

/**
 * Place prise, écrite dans une recherche de scrim ou de remplaçant : « trouvé »,
 * « pourvu », « plus besoin », « found », « filled » (« pas trouvé », « si on
 * trouve » n'en sont pas). Texte sans accents, en minuscules.
 */
const FILLED = new RegExp(
  String.raw`${NOT_AFTER_WORD}(?<!(?:pas|on|je|si|tu) )(?:trouvee?s?|pourvue?s?|plus besoin|found|filled)${NOT_BEFORE_WORD}`,
  "u",
);

/**
 * Instant où le texte gardé a été écrit : la modification si elle suit la
 * publication, sinon la publication. Une modification qui dit la place prise
 * (« (trouvé merci) ») ne change pas la soirée visée : la publication reste la
 * base de « ce soir », « demain ».
 */
function writtenAt(postedAt: string | null, editedAt: string | null, lower: string, oneEvening: boolean): string | null {
  if (postedAt === null || editedAt === null) return postedAt;
  if (oneEvening && FILLED.test(lower)) return postedAt;
  return Date.parse(editedAt) > Date.parse(postedAt) ? editedAt : postedAt;
}

/** Scrim ou remplaçant, d'après le salon ou le mot-clé d'une annonce postée ailleurs (« LFSub » dans le salon des joueurs). */
function isOneEveningKind(category: GetiCategory | null, lower: string): boolean {
  return [category, detectGetiCategory(lower)].some((kind) => kind === "lfs" || kind === "lfsub");
}

/**
 * Recherche qui ne vaut que pour sa soirée : un scrim, un remplaçant — d'après
 * le salon, ou le mot-clé du texte (« LFSub » dans le salon des joueurs), comme
 * à l'analyse. Passée, elle ne vaut plus ; ailleurs, une date passée n'éteint
 * pas l'annonce (un recrutement qui citait un essai reste d'actualité).
 */
export function isGetiOneEveningPost(post: Pick<GetiParsedPost, "category" | "text">): boolean {
  if (post.category === "lfs" || post.category === "lfsub") return true;
  return isOneEveningKind(post.category, prepareGetiText(getiWithoutSpoilers(post.text, " ")).lower);
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

/**
 * Pseudo en texte seul : ni mention, ni balisage, ni « @ » (« **Nitro** @everyone »
 * → « Nitro everyone ») ; un émoji de serveur laisse son nom. Le tiret bas reste :
 * il fait partie de bien des pseudos.
 */
function tagText(value: string): string {
  return value
    .replace(CUSTOM_EMOJI, " $1 ")
    .replace(MENTION, " ")
    .replace(/\\(.)/gu, "$1")
    .replace(TAG_SYMBOLS, " ")
    .replace(TAG_EDGE_MARKUP, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Pseudo copiable : nettoyé, sans « @ » de tête, avec l'ancien suffixe s'il existe. */
function authorTag(username: unknown, discriminator: unknown): string | null {
  const name = tagText(visibleText(text(username))).slice(0, USERNAME_MAX).trim();
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

function embedsOf(raw: GetiRawPost): { embed: GetiRawEmbed; leading: boolean }[] {
  if (!Array.isArray(raw.embeds)) return [];
  // « Premier encart » = position 0 du message : un encart illisible en tête ne fait pas d'un encart suivant le premier.
  return raw.embeds.slice(0, EMBEDS_MAX).flatMap((embed: unknown, index) =>
    typeof embed === "object" && embed !== null ? [{ embed: embed as GetiRawEmbed, leading: index === 0 }] : [],
  );
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
 * (« duo avec <@id> »), une ligne citée (« > Contact : <@id> », ou sous un
 * « >>> ») est le texte du joueur, et deux libellés qui nomment deux comptes
 * différents se contredisent
 * (le second peut être écrit par le joueur) : personne n'est désigné.
 */
function mentionedAuthorId(parts: readonly string[]): string | null {
  const unquoted = parts.map(unquotedLines).join("\n");
  let found: string | null = null;
  for (const match of unquoted.matchAll(AUTHOR_MENTION)) {
    const id = match.slice(1).find((group) => group !== undefined) ?? null;
    if (id === null) continue;
    if (found !== null && found !== id) return null;
    found = id;
  }
  return found;
}

/**
 * Lignes non citées d'un morceau (message, titre, description, champ) :
 * « >>> » cite la ligne et toutes celles qui suivent **dans ce morceau**,
 * même sans « > » ; Discord ne cite pas au-delà.
 */
function unquotedLines(part: string): string {
  const lines = part.split("\n");
  const blockStart = lines.findIndex((line) => BLOCK_QUOTE.test(line));
  return (blockStart === -1 ? lines : lines.slice(0, blockStart)).filter((line) => !QUOTED_LINE.test(line)).join("\n");
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

/** Ce qu'un bot relais est autorisé à dire de l'auteur. */
type RelayTrust = {
  /** Bot GETI : son en-tête et ses libellés hors citation. */
  geti: boolean;
  /** Notre bot : sa dernière ligne « Sent from ». */
  site: boolean;
};

/** Ce qu'un encart dit de son texte, de son auteur et de son origine. */
type EmbedReading = {
  parts: string[];
  header: RelayAuthor | null;
  trailer: RelayAuthor | null;
  embedTag: string | null;
  lineServer: string | null;
};

/** Lit un encart : en-tête GETI et ligne « Sent from » ne comptent que du bot qui les écrit. */
function readEmbed(embed: GetiRawEmbed, trust: RelayTrust, leading: boolean): EmbedReading {
  const description = text(embed.description);
  const headerMatch = GETI_HEADER.exec(description);
  const header: RelayAuthor | null =
    headerMatch !== null && trust.geti
      ? {
          id: headerMatch[1],
          tag: splitTag(visibleText(unescapeMarkdown(headerMatch[2]))),
          originServer: serverName(headerMatch[3]),
        }
      : null;
  const embedTag = embedAuthorTag(embed.authorName);
  const trailerMatch = trailerOf(description);
  const trusted = trailerMatch !== null && trust.site ? trailerMatch : null;
  const trailerId = trusted?.[2] ?? null;
  // Notre bot écrit le pseudo de l'auteur sur la ligne d'auteur de ce même encart.
  const trailer: RelayAuthor | null =
    trusted !== null && trailerId !== null
      ? { id: trailerId, tag: embedTag, originServer: serverName(trusted[1]) }
      : null;
  const lineServer = trusted !== null && trailerId === null ? serverName(trusted[1]) : null;
  // En-tête ou ligne « Sent from » qui ne vient pas de son bot : le texte du joueur, affiché tel quel.
  // Un en-tête du bot GETI illisible (pseudo ou serveur hors forme) est écarté aussi : le pseudo et le
  // nom de serveur qu'il porte sont choisis par d'autres, qui y écriraient « Contact : <@quelqu'un> ».
  const headerLike = trust.geti && header === null ? GETI_HEADER_LIKE_LINE.exec(description) : null;
  const start = header !== null && headerMatch !== null ? headerMatch[0].length : (headerLike?.[0].length ?? 0);
  // Sa mention de tête, elle, est écrite par le bot GETI avant tout texte choisi par d'autres : l'auteur
  // reste connu (une opposition sur cet auteur le couvre), sans pseudo ni serveur. Dans son premier
  // encart seulement : sans le reste de l'en-tête, rien ne dit qu'un encart suivant (transféré, ajouté)
  // s'ouvre sur sa mention plutôt que sur un texte choisi par d'autres. Un en-tête complet et les
  // libellés hors citation, eux, se lisent dans tout encart (le texte du joueur y est cité).
  const leadingMention = headerLike !== null && leading ? { id: headerLike[1], tag: null, originServer: null } : null;
  const named = header ?? leadingMention;
  const end = trusted === null ? undefined : Math.max(start, trusted.index);
  const parts = [text(embed.title), description.slice(start, end), ...embedFieldLines(embed)];
  return { parts, header: named, trailer, embedTag, lineServer };
}

/**
 * Texte, auteur et origine d'un relais : tout se lit dans les encarts du bot.
 * L'en-tête GETI n'est cru que d'un bot GETI, la ligne « Sent from » que de
 * notre bot : notre relais s'ouvre sur le texte du joueur, qui peut y imiter
 * l'en-tête.
 */
function relayContent(raw: GetiRawPost, trust: RelayTrust): RelayContent {
  const readings = embedsOf(raw).map(({ embed, leading }) => readEmbed(embed, trust, leading));
  const parts = [text(raw.content), ...readings.flatMap((reading) => reading.parts)];
  const body = parts.filter((part) => part.trim() !== "").join("\n");
  if (!trust.geti && !trust.site) {
    // Un bot ou un webhook inconnu se fait passer pour qui il veut : son texte se lit, son auteur non.
    return { body, authorTag: null, authorId: null, originServer: null };
  }
  const first = <T>(pick: (reading: EmbedReading) => T | null): T | null =>
    readings.map(pick).find((value) => value !== null) ?? null;
  const lineServer = first((reading) => reading.lineServer);
  const named = relayAuthor(
    first((reading) => reading.header),
    first((reading) => reading.trailer),
  );
  if (named !== null) {
    return { body, authorTag: named.tag, authorId: named.id, originServer: named.originServer ?? lineServer };
  }
  // Sans source du bot : une mention libellée hors citation, écrite par le bot GETI
  // (dans notre relais, tout le texte est celui du joueur), dont le pseudo ne se
  // devine pas (la ligne d'auteur peut nommer un autre compte) ; sinon le seul
  // pseudo de la ligne d'auteur, qu'écrit le bot.
  const mentioned = trust.geti ? mentionedAuthorId(parts) : null;
  const lineTag = first((reading) => reading.embedTag);
  return { body, authorTag: mentioned === null ? lineTag : null, authorId: mentioned, originServer: lineServer };
}

/** Le bot est-il dans cette liste d'identifiants (une valeur enregistrée peut ne pas en être une) ? */
function listed(ids: unknown, botId: string | null): boolean {
  return botId !== null && Array.isArray(ids) && ids.includes(botId);
}

function contentOf(raw: GetiRawPost, options: GetiParseOptions): RelayContent & { relayed: boolean } {
  if (raw.author?.bot === true) {
    const botId = snowflake(raw.author.id);
    const trust = { geti: listed(options.getiBotIds, botId), site: listed(options.siteBotIds, botId) };
    return { ...relayContent(raw, trust), relayed: true };
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
 * Un passage barré (`~~…~~`) n'est pas lu, sauf si toute l'annonce l'est :
 * elle est alors `closed`. Un passage masqué (`||…||`) n'est jamais lu.
 *
 * Un bot (ou un webhook) peut se faire passer pour n'importe qui : seul le
 * relais d'un bot listé dans `options` nomme un auteur ; sans liste, aucun
 * relais n'en nomme (son texte se lit).
 *
 * @param raw Message Discord brut, non fiable.
 * @param options Bots relais de confiance (lot 2 : bots GETI et notre bot).
 * @returns L'annonce analysée ; un message vide rend des champs vides.
 */
export function parseGetiPost(raw: GetiRawPost, options: GetiParseOptions = {}): GetiParsedPost {
  const source: GetiRawPost = typeof raw === "object" && raw !== null ? raw : {};
  const content = contentOf(source, options);
  const displayed = getiDisplayText(content.body);
  // Un passage masqué (`||…||`) n'est jamais lu : aucune étiquette ne le dévoile.
  const { analysed, closed } = withoutStruck(getiWithoutSpoilers(displayed, " "));
  const prepared = prepareGetiText(analysed);
  const roleTokens = findGetiRoleTokens(prepared.lower);
  const category = isCategory(source.category)
    ? source.category
    : (getiCategoryOfChannel(source.channelId) ?? detectGetiCategory(prepared.lower));
  const postedAt = isoDate(source.postedAt);
  // Scrim ou remplaçant — d'après le salon, ou le mot-clé d'une annonce postée
  // ailleurs (« LFSub » dans le salon des joueurs) : une soirée précise, à un SR donné.
  const kinds = [category, detectGetiCategory(prepared.lower)];
  const oneEvening = isOneEveningKind(category, prepared.lower);
  // « ce soir » ou « demain » se lit depuis l'écriture du texte gardé : sa dernière modification, sinon sa publication.
  const written = writtenAt(postedAt, isoDate(source.editedAt), prepared.lower, oneEvening);
  const schedule = parseGetiSchedule(prepared, written, oneEvening);
  return {
    category,
    authorTag: content.authorTag,
    authorId: content.authorId,
    relayed: content.relayed,
    originServer: content.originServer,
    text: getiSafeText(displayed),
    ranks: parseGetiRanks(prepared.lower, roleTokens, oneEvening),
    roles: getiRolesOf(roleTokens),
    subRoles: getiSubRolesOf(roleTokens),
    regions: parseGetiRegions(prepared.lower, analysed),
    platforms: parseGetiPlatforms(prepared.lower, category === "lfs"),
    languages: parseGetiLanguages(prepared, analysed),
    availability: schedule.availability,
    dates: schedule.dates,
    levels: parseGetiLevels(prepared.lower),
    closed,
    teamName: parseGetiTeamName(prepared.clean, kinds.includes("lft"), kinds.includes("lfs")),
    staffRoles: parseGetiStaffRoles(prepared.lower),
    minAge: parseGetiMinAge(prepared.lower),
    postedAt,
    edited: isoDate(source.editedAt) !== null,
  };
}
