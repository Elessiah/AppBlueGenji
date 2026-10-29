"use client";

import { readyCount, type MatchLaunchPhase } from "@/lib/shared/match-launch";
import { formatMatchStartAtFull } from "@/lib/shared/match-schedule";
import type { BracketMatch } from "@/lib/shared/types";
import { firstBanTeamName, hostTeamName, refereeStripState } from "../_lib/launch-strip";
import styles from "./MatchLaunchStrip.module.css";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { useSpectatorView } from "@/components/spectator-view";
import { refereeNameOf } from "@/lib/shared/match-referee";
import { useLiveControls } from "../_lib/live-context";

/**
 * Bandeau de **lancement** d'un match (`lib/shared/match-launch.ts`) : ce
 * qu'il dit à tous — la phase (à planifier, en attente de départ, lancement
 * avec le décompte des « Prêt », lancé), l'équipe qui héberge la partie et
 * chacun des casters inscrits.
 *
 * Ses boutons (ouvrir le lancement, planifier, caster, hôte, forcer) vivent
 * dans le pied d'action de la carte (`MatchCardActions`, voir
 * `docs/features/MATCH_CARD_LAYOUT.md`) : rangés avec les autres, une seule
 * action principale reste visible.
 */
/**
 * Pastille de la phase de lancement : à planifier, en attente de départ, en
 * lancement (avec le décompte des « Prêt »), ou lancé.
 */
export function LaunchPhaseBadge({ match, phase }: Readonly<{ match: BracketMatch; phase: MatchLaunchPhase }>) {
  // Libellés de `LAUNCH_PHASE_LABELS` (`match-planning.ts`, français égal testé).
  const { t, locale } = useTournamentPageText();
  const spectator = useSpectatorView();
  if (phase === "TO_PLAN") {
    return (
      <span className={styles.toPlan} title={t("launch.toPlanTitle")}>
        <span aria-hidden="true">📅</span> {t("launch.toPlan")}
        <span className="sr-only">{t("launch.toPlanSr")}</span>
      </span>
    );
  }
  if (phase === "SCHEDULED") {
    const startAtTitle = formatMatchStartAtFull(match.startAt, locale);
    return (
      <span className={styles.scheduled} title={startAtTitle ?? undefined}>
        <span aria-hidden="true">⏱</span> {t("launch.scheduled")}
        {/* L'heure est déjà dans le bandeau d'horaire juste au-dessus : on ne
            la répète que pour les lecteurs d'écran, qui lisent ce libellé
            seul. */}
        {startAtTitle && <span className="sr-only">{t("launch.scheduledSr", { date: startAtTitle })}</span>}
      </span>
    );
  }
  if (phase === "LOBBY" && spectator) {
    // Sans compte, les « Prêt » ne sont pas servis (`spectatorSnapshot`) : la
    // phase seule, sans un décompte qui dirait toujours « 0 ».
    return (
      <span className={styles.lobby}>
        <span aria-hidden="true">⏳</span> {t("launch.lobby")}
      </span>
    );
  }
  if (phase === "LOBBY") {
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
      <span className={styles.lobby}>
        <span aria-hidden="true">⏳</span> {t("launch.lobby")} ·{" "}
        <span className="num">
          {count.ready}/{count.expected}
        </span>{" "}
        {t("launch.ready")}
      </span>
    );
  }
  if (phase === "LAUNCHED" && match.status === "READY") {
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
  return phase === "TO_PLAN" || phase === "SCHEDULED" || phase === "LOBBY" || (phase === "LAUNCHED" && match.status === "READY");
}

export function MatchLaunchStrip({
  match,
  phase,
  staff = false,
}: Readonly<{
  match: BracketMatch;
  /** Phase de lancement, calculée par la carte (`MatchRow`). */
  phase: MatchLaunchPhase;
  /** Permission `tournaments` : le staff seul lit « Sans arbitre ». */
  staff?: boolean;
}>) {
  const { t } = useTournamentPageText();
  // Sans compte, aucun « Prêt » n'est servi : pas d'« En attente » trompeur.
  const spectator = useSpectatorView();
  const showReady = phase === "LOBBY" && !spectator;
  const showHost = phase !== "NONE";
  const hostName = hostTeamName(match);
  const firstBanName = showHost ? firstBanTeamName(match) : null;
  const referee = refereeStripState(match, phase, staff);
  // Pseudo de l'arbitre pour un membre connecté (décision 52) ; « Arbitre
  // désigné » sans compte, ou tant que le pseudo de la désignation manque.
  const { refereeNames } = useLiveControls();
  const refereeName = refereeNameOf(match, refereeNames);
  const badge = <LaunchPhaseBadge match={match} phase={phase} />;
  const hasBadge = hasLaunchPhaseBadge(match, phase);

  if (!hasBadge && !(showHost && hostName) && match.casters.length === 0 && referee === null) return null;

  return (
    <div className={styles.strip} data-phase={phase}>
      {badge}

      {showHost && hostName && (
        // Le côté de l'hôte, dit aux voyants par l'infobulle comme au lecteur d'écran.
        <span className={styles.fact} title={t("launch.hostTitle")}>
          <span aria-hidden="true">🏠</span>
          <span className="sr-only">{t("launch.hostSr")}</span>
          <span className={styles.name}>{hostName}</span>
          <span className="sr-only">{t("launch.hostLeftSr")}</span>
        </span>
      )}

      {firstBanName && (
        <span className={styles.fact} title={t("launch.firstBanTitle")}>
          <span aria-hidden="true">🚫</span>
          <span className="sr-only">{t("launch.firstBanSr")}</span>
          <span className={styles.name}>{firstBanName}</span>
        </span>
      )}

      {showHost && match.firstMap && (
        // Le nom est coupé à 150 px (64 caractères permis) : l'infobulle le porte en entier.
        <span className={styles.fact} title={t("launch.firstMapTitle", { map: match.firstMap })}>
          <span aria-hidden="true">🗺</span>
          <span className="sr-only">{t("launch.firstMapSr")}</span>
          <span className={styles.name}>{match.firstMap}</span>
        </span>
      )}

      {referee === "REFEREE" && (
        <span className={styles.fact} title={t("launch.refereeTitle")}>
          <span aria-hidden="true">🧑‍⚖️</span>{" "}
          {refereeName ? t("launch.refereeNamed", { name: refereeName }) : t("launch.referee")}
        </span>
      )}
      {referee === "SELF_MANAGED" && (
        <span className={styles.fact} title={t("launch.selfManagedTitle")}>
          <span aria-hidden="true">🤝</span> {t("launch.selfManaged")}
        </span>
      )}
      {referee === "UNDECIDED" && (
        // Alerte du staff : teinte d'avertissement et préfixe lu, comme « sans date »
        // (`MatchLiveStrip`) ; la décision attendue est dite aussi au lecteur d'écran.
        <span className={styles.alert} title={t("launch.undecidedTitle")}>
          <span aria-hidden="true">⚠</span>
          <span className="sr-only">{t("launch.undecidedSr")}</span> {t("launch.undecided")}
          <span className="sr-only">{t("launch.undecidedDetailSr")}</span>
        </span>
      )}

      {match.casters.map((caster, index) => (
        <span key={`${index}:${caster.userId}`} className={styles.fact} title={t("launch.casterTitle")}>
          <span aria-hidden="true">🎙</span>
          <span className="sr-only">{t("launch.casterSr")}</span>
          <span className={styles.name}>{caster.pseudo}</span>
          {showReady && (
            <span className={caster.ready ? styles.ok : styles.wait}>
              {caster.ready ? t("launch.casterReady") : t("launch.casterWaiting")}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
