"use client";

import Image from "next/image";
import Link from "next/link";
import type { TeamListItem } from "@/lib/shared/types";
import s from "./TeamCard.module.css";

const TEAM_COLORS = ["#5ac8ff", "#ff9d2e", "#a773ff", "#4fe0a2", "#ff4d5e", "#8fd5ff", "#f5a524"];

function colorFor(id: number) {
  return TEAM_COLORS[id % TEAM_COLORS.length];
}

export function TeamCard({ team }: { team: TeamListItem }) {
  const color = colorFor(team.id);
  const isTop3 = team.rank <= 3;

  return (
    <Link href={`/equipes/${team.id}`} className={s.card} style={{ "--c": color } as React.CSSProperties}>
      <div className={`${s.rank} ${isTop3 ? s.rankTop : ""}`}>
        #{String(team.rank).padStart(2, "0")}
      </div>

      <div className={s.head}>
        <div className={s.sigil} style={{ "--c": color } as React.CSSProperties}>
          {team.name[0].toUpperCase()}
        </div>
        <div>
          <div className={s.name}>{team.name}</div>
          <div className={s.tag}>
            {team.name.slice(0, 3).toUpperCase()}
            {team.region && ` · ${team.region}`}
          </div>
        </div>
      </div>

      {team.form.length > 0 && (
        <div className={s.formBar} title="10 derniers matchs">
          {team.form.map((r, i) => (
            <div key={i} className={`${s.formCell} ${s[r]}`} />
          ))}
        </div>
      )}

      <div className={s.stats}>
        <div>
          <div className={s.statLbl}>Pts</div>
          <div className={s.statVal}>{team.points}</div>
        </div>
        <div>
          <div className={s.statLbl}>Vict.</div>
          <div className={`${s.statVal} ${s.win}`}>{team.wins}</div>
        </div>
        <div>
          <div className={s.statLbl}>Déf.</div>
          <div className={`${s.statVal} ${s.loss}`}>{team.losses}</div>
        </div>
      </div>

      <div className={s.roster}>
        <span className={s.rosterLbl}>Roster</span>
        {team.rosterPreview.slice(0, 5).map((m) =>
          m.avatarUrl ? (
            <Image
              key={m.userId}
              src={m.avatarUrl}
              alt={m.pseudo}
              width={26}
              height={26}
              unoptimized
              referrerPolicy="no-referrer"
              className={s.avatar}
            />
          ) : (
            <div key={m.userId} className={s.avatar}>
              {m.pseudo[0].toUpperCase()}
            </div>
          )
        )}
        {team.rosterPreview.length > 5 && <div className={`${s.avatar} ${s.avatarMore}`}>+{team.rosterPreview.length - 5}</div>}
      </div>

      {team.games.length > 0 && (
        <div className={s.games}>
          {team.games.map((g) => (
            <span key={g} className={`${s.gamePill} ${g === "OW2" ? s.ow : s.mr}`}>
              {g === "OW2" ? "Overwatch 2" : "Marvel Rivals"}
            </span>
          ))}
        </div>
      )}

      <div className={s.foot}>
        <span className={s.footMeta}>
          FONDÉE · {new Date(team.createdAt).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }).toUpperCase()}
        </span>
        <span className={s.cta}>Voir l'équipe →</span>
      </div>
    </Link>
  );
}
