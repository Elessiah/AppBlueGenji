import type { TeamListItem } from "@/lib/shared/types";
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
          <div>
            <div className={s.pts}>{t.points}</div>
            <div className={s.ptsLbl}>PTS</div>
          </div>
        </div>
      ))}
    </div>
  );
}
