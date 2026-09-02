import type { TeamListItem } from "@/lib/shared/types";
import { RANKING_POINTS_HINT, RANKING_POINTS_LABEL } from "@/lib/shared/ranking";
import s from "./HighlightStrip.module.css";

export function HighlightStrip({ teams }: { teams: TeamListItem[] }) {
  const top = teams.slice(0, 3);
  if (top.length < 3) return null;

  return (
    <div className={s.strip}>
      {top.map((t) => (
        <div key={t.id} className={s.card} data-rank={t.rank}>
          <div className={s.rank}>{String(t.rank).padStart(2, "0")}</div>
          <div>
            <div className={s.name}>{t.name}</div>
            <div className={s.meta}>
              {t.wins}V – {t.losses}D{t.region ? ` · ${t.region}` : ""}
            </div>
          </div>
          <div title={`${RANKING_POINTS_LABEL} · ${RANKING_POINTS_HINT}`}>
            <div className={s.pts}>{t.points}</div>
            {/* Même règle que sur la carte : le mot complet est lu, l'abréviation
                est vue. Un `aria-label` posé ici ne serait pas exposé. */}
            <div className={s.ptsLbl}>
              <span aria-hidden="true">PTS</span>
              <span className="sr-only">{RANKING_POINTS_LABEL}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
