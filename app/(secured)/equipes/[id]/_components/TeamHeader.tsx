"use client";

import { LogoWithGlow } from "@/components/logo-with-glow";
import { TeamPodiumName } from "@/components/podium-tiers";
import type { TeamDetailResponse } from "@/lib/shared/types";
import { displayTeamTag } from "@/lib/shared/team-tag";
import { statsRate, statsText } from "@/lib/shared/stats-text";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { useTeamPageText } from "@/components/i18n/team-page-text";
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
export function TeamHeader({ team }: Readonly<TeamHeaderProps>) {
  const { t, locale } = useTeamPageText();
  const stats: { label: string; value: string | number; loss?: true }[] = [
    { label: t("header.stats.tournamentsPlayed"), value: team.stats.tournamentsPlayed },
    { label: t("header.stats.podiums"), value: team.stats.podiums },
    { label: t("header.stats.wins"), value: team.stats.matchesWon },
    { label: t("header.stats.losses"), value: team.stats.matchesLost, loss: true },
    // « 62 % » / « 62% » : le taux du bloc de statistiques, dans la langue de la page.
    { label: t("header.stats.winRate"), value: statsRate(statsText(locale), team.stats.winRate) },
  ];
  // Absent des réponses de mutation, qui ne calculent pas le classement.
  if (team.ranking) {
    stats.push({
      label: t("header.stats.sitePosition"),
      value: team.ranking.position ? `#${team.ranking.position}` : "—",
    });
  }

  return (
    <div className="ds-header purple">
      <div className="ds-header-body">
        <div className={headerStyles.top}>
          <div className={headerStyles.identity}>
            {team.team.logoUrl ? (
              <LogoWithGlow
                src={team.team.logoUrl}
                alt={t("header.logoAlt", { name: team.team.name })}
                width={56}
                height={56}
                size="sm"
                borderRadius={12}
                borderColor="rgba(var(--violet-400-rgb), 0.35)"
              />
            ) : (
              <div className={headerStyles.logoFallback} aria-hidden>
                🛡
              </div>
            )}
            <div className={headerStyles.titles}>
              <h1 className={`ds-title purple ${headerStyles.name}`}>
                <TeamPodiumName teamId={team.team.id}>{team.team.name}</TeamPodiumName>
                {team.team.isGhost && (
                  <span className={`mono ${headerStyles.ghostBadge}`} title={t("header.ghostTitle")}>
                    {t("header.ghostBadge")}
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
                  title={team.team.tag ? t("header.tagChosen") : t("header.tagInitials")}
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
          <LocaleLink href="/equipes" className={`btn ghost ${headerStyles.back}`}>
            {t("header.back")}
          </LocaleLink>
        </div>

        <div className={`ds-stats ${headerStyles.stats}`}>
          {stats.map((stat) => (
            <div key={stat.label} className="ds-stat purple">
              <div className="ds-stat-label">{stat.label}</div>
              <div className={stat.loss ? "ds-stat-value result-loss" : "ds-stat-value"}>{stat.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
