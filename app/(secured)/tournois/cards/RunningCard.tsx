"use client";

import Link from "next/link";
import type { TournamentCard } from "@/lib/shared/types";
import s from "../tournois.module.css";

interface RunningCardProps {
  t: TournamentCard;
}

export function RunningCard({ t }: RunningCardProps) {
  const gameLabel = t.game === "OW2" ? "OVERWATCH 2" : "MARVEL RIVALS";
  const formatLabel = t.format === "DOUBLE" ? "Double élimination" : "Élimination simple";
  const startDate = new Date(t.startAt).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Link href={`/tournois/${t.id}`} style={{ textDecoration: "none" }}>
      <article className={s.card} data-state="live" style={{ gridColumn: "span 2" }}>
        <div className={`${s.cardRibbon} ${s.cardRibbonLive}`}>
          <span className={s.dot} />
          LIVE
        </div>

        <div className={s.cardHead}>
          <div className={s.cardGame}>
            {gameLabel}
            <span className={s.dot}>◆</span>
            {formatLabel}
          </div>
        </div>

        <h3 className={s.cardTitle}>{t.name}</h3>
        <div className={s.cardSub}>En cours</div>

        <div className={s.cardMeta}>
          <div>
            <div className={s.cardMetaLbl}>Début</div>
            <div className={s.cardMetaVal}>{startDate}</div>
          </div>
          <div>
            <div className={s.cardMetaLbl}>Format</div>
            <div className={s.cardMetaVal}>{formatLabel}</div>
          </div>
          <div>
            <div className={s.cardMetaLbl}>Équipes</div>
            <div className={`${s.cardMetaVal} ${s.num}`}>
              {t.registeredTeams}/{t.maxTeams}
            </div>
          </div>
          <div>
            <div className={s.cardMetaLbl}>État</div>
            <div className={s.cardMetaVal}>En cours</div>
          </div>
        </div>

        <div className={s.cardFoot}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--red-live)" }}>
            <div style={{ fontSize: "9px", letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--ink-mute)", marginBottom: "2px" }}>Statut</div>
            <div style={{ fontSize: "13px", color: "var(--ink)" }}>LIVE</div>
          </div>
          <span className={`${s.cardCta}`}>
            Voir bracket
          </span>
        </div>
      </article>
    </Link>
  );
}
