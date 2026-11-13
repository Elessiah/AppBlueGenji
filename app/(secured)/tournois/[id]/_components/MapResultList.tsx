"use client";

import { Copy } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useSpectatorView } from "@/components/spectator-view";
import { mapWinnerSide, type MatchMapResult } from "@/lib/shared/match-maps";
import { hasPerMapTargets, mapPointTargetAt } from "@/lib/shared/map-points";
import styles from "./MatchMapDetails.module.css";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";

/**
 * Liste des maps d'un match ou d'une proposition (`docs/features/MAP_SCORES.md`) :
 * score de chaque map et son code de replay, copiable — c'est lui que les
 * arbitres vérifient en jeu. Une map posée sans code par l'arbitrage le dit
 * (« Pas de code de replay »).
 *
 * Sans compte (`useSpectatorView`), les codes ne s'affichent pas : la politique
 * de confidentialité les réserve aux membres connectés, et la lecture publique
 * ne les transmet de toute façon pas (`spectatorSnapshot`).
 *
 * Format Duel / Arcade (`pointTarget`) : le score de chaque carte est en
 * points ; la règle (« premier à 5 ») est dite par le nom de la liste — ou,
 * réglée carte par carte (`pointTargets`), sur chaque ligne.
 */
export function MapResultList({
  maps,
  team1Name,
  team2Name,
  label,
  pointTarget = null,
  pointTargets = null,
}: Readonly<{
  maps: ReadonlyArray<MatchMapResult>;
  team1Name: string;
  team2Name: string;
  label: string;
  /** Points par carte du format Duel / Arcade (`null` = éteint). */
  pointTarget?: number | null;
  /** N effectif carte par carte (carte 1 en tête) ; une carte au-delà suit `pointTarget`. */
  pointTargets?: ReadonlyArray<number> | null;
}>) {
  const { showError, showSuccess } = useToast();
  const { t } = useTournamentPageText();
  const spectator = useSpectatorView();
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      showSuccess(t("match.maps.copied", { code }));
    } catch {
      showError(t("match.maps.copyFailed"));
    }
  };

  const perMap = hasPerMapTargets(pointTarget, pointTargets);
  let listLabel = label;
  if (perMap) listLabel = `${label} — ${t("match.maps.pointTargetPerMap")}`;
  else if (pointTarget !== null) listLabel = `${label} — ${t("match.maps.pointTarget", { points: String(pointTarget) })}`;

  return (
    <>
      <ol className={styles.list} aria-label={listLabel}>
        {maps.map((map) => {
          const side = mapWinnerSide(map);
          let outcome = t("match.maps.drawn");
          if (side === 1) outcome = t("match.maps.wonBy", { team: team1Name });
          else if (side === 2) outcome = t("match.maps.wonBy", { team: team2Name });
          const target = perMap ? mapPointTargetAt(pointTarget, pointTargets, map.mapNumber - 1) : null;
          return (
            <li key={map.mapNumber} className={styles.item}>
              <span className={styles.label}>
                {t("match.maps.map", { number: String(map.mapNumber) })}
                {target !== null && (
                  <span className={styles.target}> · {t("match.maps.rowTarget", { points: String(target) })}</span>
                )}
              </span>
              <span className={styles.score} title={outcome}>
                {map.team1Score} – {map.team2Score}
                <span className="sr-only"> : {outcome}</span>
              </span>
              {/* L'arbitrage peut poser une map sans code (replay perdu) : rien à
                  copier. Sans compte, la colonne n'existe pas. */}
              {!spectator && map.replayCode === "" && (
                <span className={styles.noCode}>{t("match.maps.noReplayCode")}</span>
              )}
              {!spectator && map.replayCode !== "" && (
                <>
                  <code className={styles.code}>{map.replayCode}</code>
                  <button
                    type="button"
                    className={styles.copy}
                    onClick={() => void copy(map.replayCode)}
                    aria-label={t("match.maps.copyLabel", { number: String(map.mapNumber) })}
                    title={t("match.maps.copy")}
                  >
                    <Copy size={14} aria-hidden="true" />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
