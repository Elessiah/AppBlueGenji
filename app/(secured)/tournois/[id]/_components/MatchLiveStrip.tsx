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

type LiveState = MatchLiveState;

/** Horaire annoncé, à chiffres à chasse fixe pour que la colonne s'aligne. */
function StartAtFact({ startAt }: Readonly<{ startAt: BracketMatch["startAt"] }>) {
  const label = formatMatchStartAt(startAt);
  if (label === null) return null;
  return (
    <span className={styles.startAt} title={formatMatchStartAtFull(startAt) ?? undefined}>
      <span aria-hidden="true">🕑</span>
      <span className="sr-only">Début programmé : </span>
      <span className="num">{label}</span>
    </span>
  );
}

/** État de diffusion (programmé / en direct) et lien vers la chaîne. */
function LiveStateFact({
  state,
  liveUrl,
  matchLabel,
}: Readonly<{ state: LiveState; liveUrl: string | null; matchLabel: string }>) {
  if (state === "OFF") return null;
  const platform = streamPlatform(liveUrl);
  const live = state === "LIVE";
  const where = platform ? ` sur ${PLATFORM_LABELS[platform]}` : "";
  const linkText = platform ? PLATFORM_LABELS[platform] : "Chaîne";
  return (
    <>
      <span className={live ? `${styles.state} ${styles.stateLive}` : styles.state}>
        <span aria-hidden="true">{live ? "●" : "○"}</span>
        {live ? "En direct" : "Programmé"}
      </span>
      {liveUrl && (
        <a
          href={liveUrl}
          target="_blank"
          rel="noopener noreferrer"
          // Le texte visible ouvre le nom accessible (WCAG 2.5.3).
          aria-label={`${linkText} : regarder ${matchLabel}${where} (nouvel onglet)`}
          className={styles.link}
        >
          {linkText}
        </a>
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

  const hasStartAt = formatMatchStartAt(match.startAt) !== null;
  const missingStartAt =
    requiresMatchStartAt(match.liveTrigger) &&
    !hasStartAt &&
    isMatchCastable(match) &&
    (canManage || canSchedule);
  const matchLabel = `${match.team1Name ?? "TBD"} contre ${match.team2Name ?? "TBD"}`;

  if (state === "OFF" && !hasStartAt && !missingStartAt) return null;

  return (
    <div className={styles.strip} data-state={state}>
      <StartAtFact startAt={match.startAt} />

      {missingStartAt && (
        <span
          className={styles.missing}
          title="Ce match passe à l'antenne à sa date de début, mais aucune date n'est fixée."
        >
          <span aria-hidden="true">⚠</span>
          <span className="sr-only">Attention : </span> sans date
        </span>
      )}

      <LiveStateFact state={state} liveUrl={match.liveUrl} matchLabel={matchLabel} />
    </div>
  );
}
