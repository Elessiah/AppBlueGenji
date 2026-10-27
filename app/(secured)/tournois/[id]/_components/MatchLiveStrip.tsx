"use client";

import {
  isMatchCastable,
  PLATFORM_LABELS,
  requiresMatchStartAt,
  streamLinkText,
  streamPlatform,
} from "@/lib/shared/live-streams";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { useSpectatorView } from "@/components/spectator-view";
import { matchPagePath } from "@/lib/shared/match-page";
import { useOnMatchPage } from "../_lib/match-page-context";
import type { MatchLiveState } from "@/lib/shared/live-streams";
import { formatMatchStartAt, formatMatchStartAtFull } from "@/lib/shared/match-schedule";
import type { BracketMatch } from "@/lib/shared/types";
import { useLiveControls } from "../_lib/live-context";
import styles from "./MatchLiveStrip.module.css";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { versusText } from "@/lib/shared/tournament-page-text";

type LiveState = MatchLiveState;

/** Horaire annoncé, à chiffres à chasse fixe pour que la colonne s'aligne. */
function StartAtFact({ startAt }: Readonly<{ startAt: BracketMatch["startAt"] }>) {
  const { t, locale } = useTournamentPageText();
  const label = formatMatchStartAt(startAt, locale);
  if (label === null) return null;
  return (
    <span className={styles.startAt} title={formatMatchStartAtFull(startAt, locale) ?? undefined}>
      <span aria-hidden="true">🕑</span>
      <span className="sr-only">{t("match.startAtSr")}</span>
      <span className="num">{label}</span>
    </span>
  );
}

/**
 * Liens des streams d'un match, sans doublon, le premier lien en tête — celui
 * que montrent les vues compactes (accueil, bandeau). Sans liste de streams
 * (lecture partielle), le premier lien seul.
 */
export function matchStreamLinks(match: Pick<BracketMatch, "liveUrl" | "streams">): string[] {
  const links = match.streams.flatMap((stream) => (stream.liveUrl === null ? [] : [stream.liveUrl]));
  const ordered = match.liveUrl === null ? links : [match.liveUrl, ...links];
  return [...new Set(ordered)];
}

/**
 * Lien vers une chaîne, au nom de la chaîne (`streamLinkText` : « bluegenji »,
 * sinon « Twitch »). Abrégé d'une ellipse quand il est long ; le nom
 * accessible le porte en entier (WCAG 2.5.3). Partagé avec la page du match.
 */
export function StreamLink({
  url,
  matchLabel,
  className,
  ordinal,
}: Readonly<{
  url: string;
  matchLabel: string;
  className?: string;
  /** Numéro ajouté au texte quand deux liens du match en auraient le même. */
  ordinal?: number;
}>) {
  const { t } = useTournamentPageText();
  const platform = streamPlatform(url);
  const baseText = streamLinkText(url, t("match.channel"));
  const linkText = ordinal === undefined ? baseText : `${baseText} ${ordinal}`;
  const watchLabel = platform
    ? t("match.watchOn", { link: linkText, match: matchLabel, platform: PLATFORM_LABELS[platform] })
    : t("match.watch", { link: linkText, match: matchLabel });
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      // Le texte visible ouvre le nom accessible (WCAG 2.5.3).
      aria-label={watchLabel}
      title={linkText}
      className={className ?? styles.link}
    >
      {linkText}
    </a>
  );
}

/**
 * État de diffusion (programmé / en direct) et **premier** lien du match, celui
 * des vues compactes ; les autres streams se lisent sur la page du match, à
 * laquelle mène « +N ».
 */
function LiveStateFact({
  state,
  links,
  matchLabel,
  pageHref,
}: Readonly<{ state: LiveState; links: readonly string[]; matchLabel: string; pageHref: string }>) {
  const { t } = useTournamentPageText();
  // Sur la page du match, ses streams sont tous listés juste en dessous.
  const onPage = useOnMatchPage();
  if (state === "OFF") return null;
  const live = state === "LIVE";
  return (
    <>
      <span className={live ? `${styles.state} ${styles.stateLive}` : styles.state}>
        <span aria-hidden="true">{live ? "●" : "○"}</span>
        {live ? t("match.live") : t("match.scheduled")}
      </span>
      {links.length > 0 && <StreamLink url={links[0]} matchLabel={matchLabel} />}
      {links.length > 1 && !onPage && (
        <LocaleLink
          href={pageHref}
          className={`${styles.more} tap-target`}
          aria-label={t("match.moreStreamsLabel", { count: links.length - 1, match: matchLabel })}
        >
          {t("match.moreStreams", { count: links.length - 1 })}
        </LocaleLink>
      )}
    </>
  );
}

/**
 * Bandeau d'horaire et de diffusion d'un match, sous la feuille de score : ce
 * que tout le monde lit — l'horaire, l'état (annoncé / en direct) et le lien
 * de la chaîne — et, pour la permission `live` ou `tournaments`, l'alerte
 * « sans date » d'un match casté à l'heure de début.
 *
 * Ses boutons (antenne, configuration, date) vivent dans le pied d'action de la
 * carte (`MatchCardActions`, voir `docs/features/MATCH_CARD_LAYOUT.md`).
 */
export function MatchLiveStrip({
  match,
  state,
}: Readonly<{
  match: BracketMatch;
  /** État de diffusion, calculé une fois par la carte (`MatchRow`) — une seule minuterie par match. */
  state: LiveState;
}>) {
  const { canManage, canSchedule } = useLiveControls();
  const text = useTournamentPageText();
  const spectator = useSpectatorView();

  const hasStartAt = formatMatchStartAt(match.startAt) !== null;
  const missingStartAt =
    requiresMatchStartAt(match.liveTrigger) &&
    !hasStartAt &&
    isMatchCastable(match) &&
    (canManage || canSchedule);
  const matchLabel = versusText(text, match.team1Name ?? text.t("match.tbd"), match.team2Name ?? text.t("match.tbd"));

  if (state === "OFF" && !hasStartAt && !missingStartAt) return null;

  return (
    <div className={styles.strip} data-state={state}>
      <StartAtFact startAt={match.startAt} />

      {missingStartAt && (
        <span
          className={styles.missing}
          title={text.t("launch.missingDateTitle")}
        >
          <span aria-hidden="true">⚠</span>
          <span className="sr-only">{text.t("launch.missingDateSr")}</span>
          {text.t("launch.missingDate")}
        </span>
      )}

      <LiveStateFact
        state={state}
        links={matchStreamLinks(match)}
        matchLabel={matchLabel}
        pageHref={matchPagePath(match.tournamentId, match.id, spectator)}
      />
    </div>
  );
}
