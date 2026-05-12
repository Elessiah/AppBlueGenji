"use client";

import Image from "next/image";
import Link from "next/link";
import type { PublicUserProfile } from "@/lib/shared/types";
import s from "../../_shared/annuaire.module.css";

const TEAM_COLORS = ["#5ac8ff", "#ff9d2e", "#a773ff", "#4fe0a2", "#ff4d5e", "#8fd5ff", "#f5a524"];

function colorFromIndex(i: number) {
  return TEAM_COLORS[i % TEAM_COLORS.length];
}

const ROLE_CLASS: Record<string, string> = {
  DPS: s.dps,
  TANK: s.tank,
  HEAL: s.heal,
  COACH: s.coach,
  CAPITAINE: s.cap,
  OWNER: s.cap,
  MANAGER: "",
};

const ROLE_LABEL: Record<string, string> = {
  DPS: "DPS",
  TANK: "TANK",
  HEAL: "HEAL",
  COACH: "COACH",
  CAPITAINE: "CAP",
  OWNER: "OWNER",
  MANAGER: "MANAGER",
};

export function PlayerCard({ player }: { player: PublicUserProfile }) {
  const teamColor = player.team ? colorFromIndex(player.team.colorIndex) : "var(--ink-mute)";

  return (
    <Link href={`/joueurs/${player.id}`} className={s.plCard} style={{ "--c": teamColor } as React.CSSProperties}>
      <div className={s.plHead}>
        <div className={s.plAvatarWrap}>
          <div className={s.plAvatar}>
            {player.avatarUrl ? (
              <Image
                src={player.avatarUrl}
                alt={player.pseudo}
                width={64}
                height={64}
                unoptimized
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className={s.plAvatarFallback}>{player.pseudo[0].toUpperCase()}</span>
            )}
          </div>
        </div>
        <div className={s.plPseudo}>{player.pseudo}</div>
        <div className={s.plTeam}>
          {player.team ? (
            <>
              ROSTER · <em>{player.team.name.toUpperCase()}</em>
            </>
          ) : (
            <span style={{ color: "var(--ink-dim)" }}>FREE AGENT</span>
          )}
        </div>
      </div>

      {(player.roles || []).length > 0 && (
        <div className={s.plRoles}>
          {(player.roles || []).slice(0, 4).map((r) => (
            <span key={r} className={`${s.plRole} ${ROLE_CLASS[r] || ""}`}>
              {ROLE_LABEL[r] || r}
            </span>
          ))}
        </div>
      )}

      <div className={s.plStats}>
        <div>
          <div className={s.plStatLbl}>Tournois</div>
          <div className={s.plStatVal}>{player.tournamentsCount || 0}</div>
        </div>
        <div>
          <div className={s.plStatLbl}>V – D</div>
          <div className={s.plStatVal}>
            {player.wins || 0}–{player.losses || 0}
          </div>
        </div>
      </div>

      {(player.games || []).length > 0 && (
        <div className={s.plTags}>
          {(player.games || []).map((g) => (
            <span key={g} className={`${s.plTag} ${g === "OW2" ? s.ow : s.mr}`}>
              {g}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
