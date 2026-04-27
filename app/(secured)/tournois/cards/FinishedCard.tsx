"use client";

import Link from "next/link";
import type { TournamentCard } from "@/lib/shared/types";
import s from "../tournois.module.css";

interface FinishedCardProps {
  t: TournamentCard;
}

export function FinishedCard({ t }: FinishedCardProps) {
  const gameLabel = t.game === "OW2" ? "OVERWATCH 2" : "MARVEL RIVALS";
  const formatLabel = t.format === "DOUBLE" ? "Double élimination" : "Élimination simple";

  const finishDate = new Date(t.startAt).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <Link href={`/tournois/${t.id}`} style={{ textDecoration: "none" }}>
      <article className={`${s.card} ${s.cardDone}`} data-state="done">
        <div className={`${s.cardRibbon} ${s.cardRibbonDone}`}>
          Terminé · {finishDate}
        </div>

        <div className={s.cardHead}>
          <div className={s.cardGame}>
            {gameLabel}
            <span className={s.dot}>◆</span>
            {formatLabel}
          </div>
        </div>

        <h3 className={s.cardTitle}>{t.name}</h3>
        <div className={s.cardSub}>{t.description || formatLabel}</div>

        <div className={s.cardMeta}>
          <div>
            <div className={s.cardMetaLbl}>Jeu</div>
            <div className={s.cardMetaVal}>{gameLabel}</div>
          </div>
          <div>
            <div className={s.cardMetaLbl}>Format</div>
            <div className={s.cardMetaVal}>{formatLabel}</div>
          </div>
          <div>
            <div className={s.cardMetaLbl}>Équipes participantes</div>
            <div className={`${s.cardMetaVal} ${s.num}`}>
              {t.registeredTeams}/{t.maxTeams}
            </div>
          </div>
          <div>
            <div className={s.cardMetaLbl}>Date</div>
            <div className={s.cardMetaVal}>{finishDate}</div>
          </div>
        </div>

        <div className={s.cardFoot}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--ink)" }}>
            <div
              style={{
                fontSize: "9px",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "var(--ink-mute)",
                marginBottom: "2px",
              }}
            >
              Statut
            </div>
            <div style={{ fontSize: "13px", color: "var(--ink-mute)" }}>Terminé</div>
          </div>
          <span className={`${s.cardCta}`}>
            Voir le récap
          </span>
        </div>
      </article>
    </Link>
  );
}
