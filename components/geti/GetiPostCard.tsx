import { Check } from "lucide-react";
import { isGetiOneEveningPost, isGetiPostPast, type GetiFilter } from "@/lib/shared/geti";
import type { GetiStoredPost } from "@/lib/shared/geti/ingest";
import {
  getiChipMatches,
  getiPostBodyText,
  getiPostChips,
  getiRelativeAge,
  getiTextIsLong,
  type GetiChip,
} from "@/lib/shared/geti/page";
import {
  getiChipLabel,
  getiChipTitle,
  getiText,
  type GetiDataText,
  type GetiMessages,
} from "@/lib/shared/geti/page-text";
import { INTL_LOCALE, SITE_TIME_ZONE, type Locale } from "@/lib/shared/locales";
import { visibleText } from "@/lib/shared/visible-text";
import { GetiCopyTag } from "./GetiCopyTag";
import { GetiPostText } from "./GetiPostText";
import styles from "./geti.module.css";

/** Teinte d'une étiquette selon ce qu'elle dit (`DESIGN_SYSTEM.md` § Pastilles : jamais tout gris). */
const CHIP_TONE: Readonly<Record<GetiChip["kind"], string>> = {
  team: "cy-tag-highlight",
  rank: "cy-tag-accent",
  role: "cy-tag-info",
  subRole: "cy-tag-info",
  staffRole: "cy-tag-info",
  level: "cy-tag-accent",
  region: "",
  platform: "",
  language: "",
  day: "cy-tag-success",
  time: "cy-tag-success",
  date: "cy-tag-success",
  minAge: "cy-tag-neutral",
};

function absoluteDate(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    dateStyle: "long",
    timeStyle: "short",
    hourCycle: "h23",
    timeZone: SITE_TIME_ZONE,
  }).format(date);
}

function relativeDate(iso: string, locale: Locale, now: number): string {
  const age = getiRelativeAge(iso, now);
  if (!age) return "";
  return new Intl.RelativeTimeFormat(INTL_LOCALE[locale], { numeric: "auto", style: "short" }).format(
    age.value,
    age.unit,
  );
}

/**
 * Pastille d'une annonce passée (toutes ses dates visées sont finies), `null`
 * sinon : « Passé » pour un scrim ou un remplaçant, qui ne vaut plus ; « Date
 * passée » ailleurs — un recrutement qui citait un essai reste d'actualité.
 */
function pastLabelOf(post: GetiStoredPost, text: GetiMessages["post"], now: number): string | null {
  if (!isGetiPostPast(post.parsed, now)) return null;
  return isGetiOneEveningPost(post) ? text.past : text.datePast;
}

/** Carte estompée : annonce close, ou soirée finie d'un scrim ou d'un remplaçant. */
function isFaded(post: GetiStoredPost, now: number): boolean {
  return post.parsed.closed || (isGetiOneEveningPost(post) && isGetiPostPast(post.parsed, now));
}

/**
 * Une étiquette : mise en avant quand elle répond à la recherche (cochée et
 * préfixée, jamais la couleur seule) ; un horaire converti porte l'heure écrite
 * dans l'annonce, au survol et pour un lecteur d'écran.
 */
function PostChip({
  chip,
  chips,
  filter,
  text,
  data,
  locale,
}: Readonly<{
  chip: GetiChip;
  chips: readonly GetiChip[];
  filter: GetiFilter;
  text: GetiMessages["post"];
  data: GetiDataText;
  locale: Locale;
}>) {
  const matched = getiChipMatches(chip, filter, chips);
  const title = getiChipTitle(chip, data, locale);
  return (
    <li
      className={["cy-tag", CHIP_TONE[chip.kind], matched ? styles.chipMatch : ""].filter(Boolean).join(" ")}
      data-match={matched ? "true" : undefined}
      title={title ?? undefined}
    >
      {matched ? (
        <>
          <Check size={12} aria-hidden="true" />
          <span className="sr-only">{text.matchPrefix} </span>
        </>
      ) : null}
      {getiChipLabel(chip, data, locale)}
      {title === null ? null : <span className="sr-only"> ({title})</span>}
    </li>
  );
}

/**
 * Carte d'une annonce : pseudo à copier, âge, provenance, données lues (celles
 * qui répondent à la recherche sont mises en avant), puis le texte — toujours
 * du texte simple (`getiPostBodyText`), jamais du balisage.
 */
export function GetiPostCard({
  post,
  filter,
  text,
  data,
  locale,
  now,
}: Readonly<{
  post: GetiStoredPost;
  filter: GetiFilter;
  text: GetiMessages["post"];
  data: GetiDataText;
  locale: Locale;
  now: number;
}>) {
  const parsed = post.parsed;
  const tag = post.authorTag ? visibleText(post.authorTag) : "";
  const origin = parsed.originServer ? visibleText(parsed.originServer) : "";
  const body = getiPostBodyText(parsed.text, {
    member: text.mentionMember,
    role: text.mentionRole,
    channel: text.mentionChannel,
    spoiler: text.spoiler,
  }, locale);
  const chips = getiPostChips(parsed);
  const pastLabel = pastLabelOf(post, text, now);
  const postedAbsolute = absoluteDate(post.postedAt, locale);
  const editedAbsolute = post.editedAt ? absoluteDate(post.editedAt, locale) : "";

  return (
    <article
      id={`post-${post.messageId}`}
      className={isFaded(post, now) ? `${styles.card} ${styles.cardClosed}` : styles.card}
      data-testid="geti-post"
      data-past={pastLabel === null ? undefined : "true"}
    >
      <header className={styles.cardHead}>
        <div className={styles.author}>
          {tag ? (
            <GetiCopyTag
              tag={tag}
              text={{
                copy: text.copy,
                copyLabel: text.copyLabel,
                copied: text.copied,
                copyFailed: text.copyFailed,
                tagLabel: text.tagLabel,
                tagPrefix: text.tagPrefix,
              }}
            />
          ) : (
            <span className={styles.noTag}>{text.noTag}</span>
          )}
        </div>
        <div className={styles.meta}>
          {parsed.closed ? <span className="pill pill-neutral">{text.closed}</span> : null}
          {pastLabel === null ? null : (
            <span className="pill pill-neutral" data-testid="geti-past">
              {pastLabel}
            </span>
          )}
          <time dateTime={post.postedAt}>{relativeDate(post.postedAt, locale, now)}</time>
          {post.editedAt ? <span className={styles.edited}>{text.edited}</span> : null}
        </div>
      </header>

      {chips.length > 0 ? (
        <ul className={styles.chips} aria-label={text.chipsLabel}>
          {chips.map((chip, index) => (
            // Les étiquettes d'une annonce ne changent pas d'ordre entre deux rendus.
            <PostChip key={`${chip.kind}-${index}`} chip={chip} chips={chips} filter={filter} text={text} data={data} locale={locale} />
          ))}
        </ul>
      ) : null}

      <GetiPostText body={body} long={getiTextIsLong(body)} text={{ more: text.more, less: text.less }} />

      <footer className={styles.cardFoot}>
        {/* La date exacte est lisible sans survol : au toucher et au clavier, une infobulle ne s'ouvre pas. */}
        <span>{getiText(locale, text.postedAt, { date: postedAbsolute })}</span>
        {post.editedAt ? <span>{getiText(locale, text.editedAt, { date: editedAbsolute })}</span> : null}
        <span>{post.source === "relay" ? text.sourceRelay : text.sourceDirect}</span>
        {origin ? <span>{getiText(locale, text.origin, { server: origin })}</span> : null}
      </footer>
    </article>
  );
}
