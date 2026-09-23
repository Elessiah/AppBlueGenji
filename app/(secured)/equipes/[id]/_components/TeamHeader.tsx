"use client";

import Link from "next/link";
import { LogoWithGlow } from "@/components/logo-with-glow";
import type { TeamDetailResponse } from "@/lib/shared/types";
import { formatRate } from "@/lib/shared/stats";
import { displayTeamTag } from "@/lib/shared/team-tag";
import headerStyles from "./TeamHeader.module.css";

interface TeamHeaderProps {
  team: TeamDetailResponse;
}

/**
 * Identité de l'équipe et ses chiffres clés — rien d'autre.
 *
 * L'en-tête portait aussi le formulaire des paramètres : pour qui gère
 * l'équipe, le haut de la fiche était un formulaire, et le roster — ce qu'on
 * vient voir — commençait sous la ligne de flottaison. Les paramètres vivent
 * désormais dans `TeamSettings`, sous le roster.
 */
export function TeamHeader({ team }: TeamHeaderProps) {
  const stats = [
    { label: "Tournois joués", value: team.stats.tournamentsPlayed },
    { label: "Podiums", value: team.stats.podiums },
    { label: "Victoires", value: team.stats.matchesWon },
    { label: "Défaites", value: team.stats.matchesLost },
    { label: "Ratio de victoires", value: formatRate(team.stats.winRate) },
    // Absent des réponses de mutation, qui ne calculent pas le classement.
    ...(team.ranking
      ? [
          {
            label: "Classement du site",
            value: team.ranking.position ? `#${team.ranking.position}` : "—",
          },
        ]
      : []),
  ];

  return (
    <div className="ds-header orange">
      <div className="ds-header-body">
        <div className={headerStyles.top}>
          <div className={headerStyles.identity}>
            {team.team.logoUrl ? (
              <LogoWithGlow
                src={team.team.logoUrl}
                alt={`Logo de ${team.team.name}`}
                width={56}
                height={56}
                size="sm"
                borderRadius={12}
                borderColor="rgba(255,157,46,0.3)"
              />
            ) : (
              <div className={headerStyles.logoFallback} aria-hidden>
                🛡
              </div>
            )}
            <div className={headerStyles.titles}>
              <h1 className={`ds-title orange ${headerStyles.name}`}>
                {team.team.name}
                {team.team.isGhost && (
                  <span className={`mono ${headerStyles.ghostBadge}`} title="Équipe fantôme, créée par le staff">
                    FANTÔME
                  </span>
                )}
              </h1>
              <div className={headerStyles.subline}>
                {/* Sigle de l'équipe — à défaut, les initiales de son nom :
                    la ligne ne disparaît pas selon que l'équipe en a choisi
                    un ou non. */}
                <span
                  className={`mono ${headerStyles.tag}`}
                  data-chosen={team.team.tag ? "true" : "false"}
                  title={team.team.tag ? "Sigle de l'équipe" : "Initiales — cette équipe n'a pas encore de sigle"}
                >
                  {displayTeamTag(team.team.tag, team.team.name)}
                </span>
                {/* Pas de phrase de remplacement : « Historique compétitif et
                    gestion du roster » s'affichait à tout visiteur d'une équipe
                    sans description, comme si l'équipe l'avait écrite. */}
                {team.team.description ? (
                  <p className={headerStyles.description}>{team.team.description}</p>
                ) : null}
              </div>
            </div>
          </div>
          <Link href="/equipes" className={`btn ghost ${headerStyles.back}`}>
            ← Équipes
          </Link>
        </div>

        <div className={`ds-stats ${headerStyles.stats}`}>
          {stats.map((stat) => (
            <div key={stat.label} className="ds-stat orange">
              <div className="ds-stat-label">{stat.label}</div>
              <div className="ds-stat-value">{stat.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
