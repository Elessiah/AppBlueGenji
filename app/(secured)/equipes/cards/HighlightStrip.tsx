"use client";

import { memo } from "react";
import type { TeamListItem } from "@/lib/shared/types";
import { isRankedTeam } from "@/lib/shared/ranking";
import { TeamPodiumName } from "@/components/podium-tiers";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { richNodes } from "@/components/i18n/shell-text";
import { useTeamsText } from "@/components/i18n/teams-text";
import { teamPointsHint } from "../_lib/team-points";
import s from "./HighlightStrip.module.css";

/**
 * Podium du classement (trois premières équipes), en tête de `/equipes` quand
 * la liste est triée par classement.
 *
 * Chaque carte mène à la fiche de son équipe, comme les cartes d'annuaire : le
 * lien est une plaque transparente (`.cardOverlay`) nommée « Voir la fiche de
 * … » plutôt qu'un `<a>` enveloppant la carte, dont le nom accessible serait
 * tout le texte de la carte mis bout à bout. Le bloc des points repasse
 * au-dessus d'elle pour garder son `title`, seule explication visible de la cote.
 */
function HighlightStripView({ teams }: Readonly<{ teams: TeamListItem[] }>) {
  const text = useTeamsText();
  const { t } = text;
  // Seules les équipes classées montent : une équipe sans rang (aucun match
  // compté) ne figure pas au classement, donc pas à son podium.
  const top = teams.filter((team) => team.rank !== null).slice(0, 3);
  if (top.length < 3) return null;

  return (
    <div className={s.strip}>
      {top.map((team) => (
        <div key={team.id} className={s.card} data-rank={team.rank}>
          <LocaleLink
            href={`/equipes/${team.id}`}
            className={s.cardOverlay}
            aria-label={t("card.viewTeam", { name: team.name })}
          />
          <div className={s.rank}>{String(team.rank).padStart(2, "0")}</div>
          <div>
            <div className={s.name}>
              <TeamPodiumName teamId={team.id}>{team.name}</TeamPodiumName>
            </div>
            <div className={s.meta}>
              {richNodes(
                text.rich("card.record", { wins: team.wins, losses: team.losses }, {
                  loss: (chunks) => <span className="result-loss">{chunks}</span>,
                }),
              )}
              {team.region ? ` · ${team.region}` : ""}
            </div>
          </div>
          {/* Même nuance que sur la carte : un filtre par jeu peut laisser
              moins de trois équipes classées, et une équipe à 0V–0D monterait
              alors sur le podium avec la cote de départ. Annoncer une cote
              gagnée sur ce nombre-là, c'est expliquer deux fois le même chiffre
              de deux façons contradictoires sur la même page. */}
          <div
            className={s.ptsBlock}
            title={`${t("points.label")} · ${teamPointsHint(text, isRankedTeam(team), team.points)}`}
          >
            <div className={s.pts}>{team.points}</div>
            {/* Même règle que sur la carte : le mot complet est lu, l'abréviation
                est vue. Un `aria-label` posé ici ne serait pas exposé. */}
            <div className={s.ptsLbl}>
              <span aria-hidden="true">{t("card.ptsShort")}</span>
              <span className="sr-only">{t("points.label")}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Mémoïsé, comme les cartes : la liste filtrée garde sa référence tant que la recherche différée n'a pas suivi. */
export const HighlightStrip = memo(HighlightStripView);
