"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TeamSigil } from "@/components/cyber";
import { TeamLink } from "@/components/entity-link";
import { useToast } from "@/components/ui/toast";
import type { LandingLeaderboardRow } from "@/lib/shared/landing";
import { rankingFilterHref, type RankingGameFilter } from "@/lib/shared/ranking-page";
import styles from "./Leaderboard.module.css";

type LeaderboardProps = {
  initialRows: LandingLeaderboardRow[];
};

type LeaderboardResponse = {
  leaderboard: LandingLeaderboardRow[];
};

/** Mêmes identifiants que les pastilles de `/classement` : le lien garde l'onglet. */
type GameFilter = RankingGameFilter;

const TREND_CLASSES: Record<LandingLeaderboardRow["trend"], string | undefined> = {
  up: styles.trendUp,
  down: styles.trendDown,
  flat: styles.trendFlat,
};

/** Évolution affichée : un tiret quand rien n'a bougé, sinon la variation signée. */
function trendLabel(row: Pick<LandingLeaderboardRow, "trend" | "trendValue">): string {
  if (row.trend === "flat") return "—";
  return row.trend === "up" ? `+${row.trendValue}` : `-${row.trendValue}`;
}

export function Leaderboard({ initialRows }: Readonly<LeaderboardProps>) {
  const [game, setGame] = useState<GameFilter>("all");
  const [rows, setRows] = useState(initialRows);
  const [loading, setLoading] = useState(false);
  const { showError } = useToast();
  // Dernier filtre chargé avec succès : `initialRows` couvre déjà « all » au
  // premier rendu (le même que cette valeur initiale), donc la garde ci-dessous
  // saute aussi bien la requête au montage qu'un retour au filtre précédent
  // après un échec — et un échec y revient plutôt que de laisser la pastille
  // allumée sur des données qui ne lui correspondent pas.
  const lastLoadedGame = useRef<GameFilter>("all");

  useEffect(() => {
    if (game === lastLoadedGame.current) return;

    let mounted = true;
    setLoading(true);

    async function loadRows() {
      try {
        const response = await fetch(`/api/landing/leaderboard?game=${game}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`statut ${response.status}`);
        const payload = (await response.json()) as LeaderboardResponse;
        if (!mounted) return;
        setRows(payload.leaderboard ?? []);
        lastLoadedGame.current = game;
      } catch {
        if (!mounted) return;
        setGame(lastLoadedGame.current);
        showError("Impossible de charger ce classement, réessaie plus tard.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadRows();
    return () => {
      mounted = false;
    };
  }, [game, showError]);

  const chips = [
    { id: "all" as const, label: "Général" },
    { id: "ow" as const, label: "Overwatch" },
    { id: "mr" as const, label: "Marvel Rivals" },
  ];

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <h3 className="mono" style={{ fontSize: 11, letterSpacing: "0.2em", color: "var(--ink-mute)", margin: 0, fontWeight: 400 }}>
          TOP ÉQUIPES
        </h3>
        <div className={styles.chips}>
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={chip.id === game ? styles.chipOn : styles.chip}
              aria-pressed={chip.id === game}
              onClick={() => setGame(chip.id)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.table} role="table" aria-label="Classement des équipes" aria-busy={loading}>
        <div className={styles.tableHead} role="row">
          <span role="columnheader">#</span>
          <span role="columnheader">ÉQUIPE</span>
          <span role="columnheader">V–D</span>
          <span role="columnheader">PTS</span>
          <span role="columnheader" className={styles.trendHead} aria-label="Tendance" title="Tendance">TR</span>
        </div>

        {rows.length === 0 ? (
          <div role="row">
            <p className={styles.empty} role="cell">Aucune équipe classée pour le moment.</p>
          </div>
        ) : (
          rows.map((row) => {
            const trend = trendLabel(row);
            const trendClass = TREND_CLASSES[row.trend];

            return (
              <div key={row.teamId} className={`${styles.row} ${row.rank <= 3 ? styles.top : ""}`} role="row">
                <span className={styles.rank} role="cell">{String(row.rank).padStart(2, "0")}</span>
                <span className={styles.team} role="cell">
                  <TeamSigil label={row.teamName.charAt(0)} size={24} logoUrl={row.logoUrl} />
                  <TeamLink teamId={row.teamId} title={`Voir la fiche de ${row.teamName}`}>
                    {row.teamName}
                  </TeamLink>
                </span>
                <span className={styles.wl} role="cell">
                  <span className={styles.wins}>{row.wins}</span>
                  <span className={styles.losses}>–</span>
                  {/* Une défaite se lit dans sa couleur ; zéro reste neutre. */}
                  <span className={row.losses > 0 ? "result-loss" : styles.losses}>{row.losses}</span>
                </span>
                <span className="num" role="cell">{row.points}</span>
                <span className={`${styles.trend} ${trendClass}`} role="cell">{trend}</span>
              </div>
            );
          })
        )}
      </div>

      <div className={styles.footer}>
        <Link href={rankingFilterHref(game)} className="mono">VOIR LE CLASSEMENT COMPLET →</Link>
      </div>
    </div>
  );
}
