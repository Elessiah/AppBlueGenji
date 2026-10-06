import Link from "next/link";
import type { TeamListItem } from "@/lib/shared/types";
import {
  isRankedTeam,
  RANKING_POINTS_LABEL,
  rankingPointsHint,
} from "@/lib/shared/ranking";
import { TeamPodiumName } from "@/components/podium-tiers";
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
export function HighlightStrip({ teams }: Readonly<{ teams: TeamListItem[] }>) {
  const top = teams.slice(0, 3);
  if (top.length < 3) return null;

  return (
    <div className={s.strip}>
      {top.map((t) => (
        <div key={t.id} className={s.card} data-rank={t.rank}>
          <Link
            href={`/equipes/${t.id}`}
            className={s.cardOverlay}
            aria-label={`Voir la fiche de ${t.name}`}
          />
          <div className={s.rank}>{String(t.rank).padStart(2, "0")}</div>
          <div>
            <div className={s.name}>
              <TeamPodiumName teamId={t.id}>{t.name}</TeamPodiumName>
            </div>
            <div className={s.meta}>
              {t.wins}V – <span className="result-loss">{t.losses}D</span>{t.region ? ` · ${t.region}` : ""}
            </div>
          </div>
          {/* Même nuance que sur la carte : un filtre par jeu peut laisser
              moins de trois équipes classées, et une équipe à 0V–0D monterait
              alors sur le podium avec la cote de départ. Annoncer une cote
              gagnée sur ce nombre-là, c'est expliquer deux fois le même chiffre
              de deux façons contradictoires sur la même page. */}
          <div
            className={s.ptsBlock}
            title={`${RANKING_POINTS_LABEL} · ${rankingPointsHint(isRankedTeam(t), t.points)}`}
          >
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
