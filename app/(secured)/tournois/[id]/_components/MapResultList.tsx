"use client";

import { Copy } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useSpectatorView } from "@/components/spectator-view";
import { mapWinnerSide, type MatchMapResult } from "@/lib/shared/match-maps";
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
 */
export function MapResultList({
  maps,
  team1Name,
  team2Name,
  label,
}: Readonly<{
  maps: ReadonlyArray<MatchMapResult>;
  team1Name: string;
  team2Name: string;
  label: string;
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

  return (
    <ol className={styles.list} aria-label={label}>
      {maps.map((map) => {
        const side = mapWinnerSide(map);
        let outcome = t("match.maps.drawn");
        if (side === 1) outcome = t("match.maps.wonBy", { team: team1Name });
        else if (side === 2) outcome = t("match.maps.wonBy", { team: team2Name });
        return (
          <li key={map.mapNumber} className={styles.item}>
            <span className={styles.label}>{t("match.maps.map", { number: String(map.mapNumber) })}</span>
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
  );
}
