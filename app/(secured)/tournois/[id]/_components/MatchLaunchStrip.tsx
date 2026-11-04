"use client";

import { readyCount, type MatchLaunchPhase } from "@/lib/shared/match-launch";
import { formatMatchStartAtFull } from "@/lib/shared/match-schedule";
import type { BracketMatch } from "@/lib/shared/types";
import { launchPhaseBadgeKind } from "../_lib/launch-strip";
import styles from "./MatchLaunchStrip.module.css";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { useSpectatorView } from "@/components/spectator-view";

/**
 * Bandeau de **lancement** d'un match (`lib/shared/match-launch.ts`) : la
 * phase, et elle seule — à planifier, en attente de départ, lancement avec le
 * décompte des « Prêt », lancé.
 *
 * Ses boutons (ouvrir le lancement, planifier, caster, hôte, forcer) vivent
 * dans le pied d'action de la carte (`MatchCardActions`) ; les faits du match
 * (hôte, premier ban, carte de départ, arbitrage, casters) vivent sur la page
 * du match — voir `docs/features/MATCH_CARD_LAYOUT.md`.
 */
/**
 * Pastille de la phase de lancement : à planifier, en attente de départ, en
 * lancement (avec le décompte des « Prêt »), ou lancé — la phase vient de
 * `launchPhaseBadgeKind`, seule règle partagée avec `hasLaunchPhaseBadge`.
 * Tant que les salons vocaux d'équipe retiennent le départ (`voice.pending`),
 * la pastille le dit : « Prêt » seul ne lancera pas le match.
 */
export function LaunchPhaseBadge({ match, phase }: Readonly<{ match: BracketMatch; phase: MatchLaunchPhase }>) {
  // Libellés de `LAUNCH_PHASE_LABELS` (`match-planning.ts`, français égal testé).
  const { t, locale } = useTournamentPageText();
  const spectator = useSpectatorView();
  const kind = launchPhaseBadgeKind(match, phase);
  const held = match.voice?.pending === true;
  // Le séparateur est décoratif ; le lecteur d'écran entend une phrase à part.
  const voiceHeld = held ? (
    <span className={styles.voiceHeld}>
      <span aria-hidden="true"> · </span>
      <span className="sr-only">. </span>
      {t("launch.voicePending")}
    </span>
  ) : null;
  // Le texte s'allonge d'une raison : la pastille passe alors à la ligne (375 px, /en).
  const wrap = held ? ` ${styles.wrap}` : "";
  if (kind === "TO_PLAN") {
    return (
      <span className={styles.toPlan} title={t("launch.toPlanTitle")}>
        <span aria-hidden="true">📅</span> {t("launch.toPlan")}
        <span className="sr-only">{t("launch.toPlanSr")}</span>
      </span>
    );
  }
  if (kind === "SCHEDULED") {
    const startAtTitle = formatMatchStartAtFull(match.startAt, locale);
    return (
      <span className={`${styles.scheduled}${wrap}`} title={startAtTitle ?? undefined}>
        <span aria-hidden="true">⏱</span> {t("launch.scheduled")}
        {/* L'heure est déjà dans le bandeau d'horaire juste au-dessus : on ne
            la répète que pour les lecteurs d'écran, qui lisent ce libellé
            seul. */}
        {startAtTitle && <span className="sr-only">{t("launch.scheduledSr", { date: startAtTitle })}</span>}
        {voiceHeld}
      </span>
    );
  }
  if (kind === "LOBBY" && spectator) {
    // Sans compte, les « Prêt » ne sont pas servis (`spectatorSnapshot`) : la
    // phase seule, sans un décompte qui dirait toujours « 0 ».
    return (
      <span className={`${styles.lobby}${wrap}`}>
        <span aria-hidden="true">⏳</span> {t("launch.lobby")}
        {voiceHeld}
      </span>
    );
  }
  if (kind === "LOBBY") {
    // Les « Prêt » arrivent déjà résolus dans l'instantané (une fantôme y est
    // prête d'office) : on ne fait que les compter. Celui de l'arbitre n'y est
    // pas (décision 47) : le décompte public est celui des équipes et des
    // casters ; les parties du match lisent le sien dans la fenêtre de lancement.
    const count = readyCount({
      team1Ready: match.team1Ready,
      team2Ready: match.team2Ready,
      casters: match.casters,
      referee: null,
    });
    return (
      <span className={`${styles.lobby}${wrap}`}>
        <span aria-hidden="true">⏳</span> {t("launch.lobby")} ·{" "}
        <span className="num">
          {count.ready}/{count.expected}
        </span>{" "}
        {t("launch.ready")}
        {voiceHeld}
      </span>
    );
  }
  if (kind === "LAUNCHED") {
    return (
      <span className={styles.launched}>
        <span aria-hidden="true">▶</span> {t("launch.launched")}
      </span>
    );
  }
  return null;
}

/** La phase a-t-elle une pastille (`LaunchPhaseBadge`) ? Partagé avec les faits clés de la page du match. */
export function hasLaunchPhaseBadge(match: Pick<BracketMatch, "status">, phase: MatchLaunchPhase): boolean {
  return launchPhaseBadgeKind(match, phase) !== null;
}

/**
 * Bandeau de **lancement** d'une carte de match : la seule pastille de phase
 * (à planifier, en attente de départ, en lancement avec le décompte des
 * « Prêt », lancé).
 *
 * Les faits du match — équipe hôte, premier ban, carte de départ, arbitre ou
 * autogestion, casters — ont quitté la carte : à 260 px, ils y tenaient sur
 * autant de lignes qu'ils étaient et noyaient les engagés, le score et
 * l'action. Ils sont tous dits en toutes lettres sur la page du match
 * (`MatchKeyFacts`, `docs/features/MATCH_CARD_LAYOUT.md`), à laquelle chaque
 * carte mène.
 */
export function MatchLaunchStrip({
  match,
  phase,
}: Readonly<{
  match: BracketMatch;
  /** Phase de lancement, calculée par la carte (`MatchRow`). */
  phase: MatchLaunchPhase;
}>) {
  if (!hasLaunchPhaseBadge(match, phase)) return null;
  return (
    <div className={styles.strip} data-phase={phase}>
      <LaunchPhaseBadge match={match} phase={phase} />
    </div>
  );
}
