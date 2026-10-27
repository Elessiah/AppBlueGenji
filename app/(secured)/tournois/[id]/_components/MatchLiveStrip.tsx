"use client";

import {
  isMatchCastable,
  PLATFORM_LABELS,
  requiresMatchStartAt,
  streamPlatform,
} from "@/lib/shared/live-streams";
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

/** Lien vers une chaîne ; numéroté quand le match en a plusieurs (« Twitch 2 »). */
function StreamLink({ url, rank, matchLabel }: Readonly<{ url: string; rank: number | null; matchLabel: string }>) {
  const { t } = useTournamentPageText();
  const platform = streamPlatform(url);
  const name = platform ? PLATFORM_LABELS[platform] : t("match.channel");
  const linkText = rank === null ? name : `${name} ${rank}`;
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
      className={styles.link}
    >
      {linkText}
    </a>
  );
}

/** État de diffusion (programmé / en direct) et liens vers les chaînes du match. */
function LiveStateFact({
  state,
  links,
  matchLabel,
}: Readonly<{ state: LiveState; links: readonly string[]; matchLabel: string }>) {
  const { t } = useTournamentPageText();
  if (state === "OFF") return null;
  const live = state === "LIVE";
  return (
    <>
      <span className={live ? `${styles.state} ${styles.stateLive}` : styles.state}>
        <span aria-hidden="true">{live ? "●" : "○"}</span>
        {live ? t("match.live") : t("match.scheduled")}
      </span>
      {links.map((url, index) => (
        <StreamLink key={url} url={url} rank={links.length > 1 ? index + 1 : null} matchLabel={matchLabel} />
      ))}
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

      <LiveStateFact state={state} links={matchStreamLinks(match)} matchLabel={matchLabel} />
    </div>
  );
}
