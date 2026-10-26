"use client";

import { memo } from "react";
import Image from "next/image";
import type { TeamListItem } from "@/lib/shared/types";
import { getPaletteColor } from "@/lib/shared/palette";
import { PlayerLink } from "@/components/entity-link";
import { TeamPodiumName } from "@/components/podium-tiers";
import { displayTeamTag } from "@/lib/shared/team-tag";
import { formatMonthYear } from "@/lib/shared/dates";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { useTeamsText } from "@/components/i18n/teams-text";
import { teamPointsHint } from "../_lib/team-points";
import s from "./TeamCard.module.css";

/**
 * Carte d'annuaire d'une équipe.
 *
 * La carte entière mène à la fiche de l'équipe, et chaque visage du roster mène
 * au profil du joueur : un `<a>` dans un `<a>` étant invalide, le lien de la
 * carte est une plaque transparente posée par-dessus (`.cardOverlay`) que les
 * liens du roster traversent en repassant au-dessus d'elle (`.rosterItem`).
 *
 * La ligne sous le nom porte le **sigle** de l'équipe (`bg_teams.tag`, unique
 * sur le site) ; à défaut, les initiales dérivées de son nom — l'affichage
 * qu'avaient toutes les cartes avant que le sigle ne soit une donnée saisie.
 *
 * L'emblème (`.sigil`) montre le **logo** de l'équipe quand elle en a un, et
 * retombe sur l'initiale de son nom sinon. La carte n'affichait que l'initiale :
 * `TeamListItem.logoUrl` voyageait bien de `listTeams` jusqu'ici, mais aucun
 * rendu ne le lisait — le logo n'apparaissait donc que sur `/equipes/[id]`.
 */
function TeamCardView({ team }: Readonly<{ team: TeamListItem }>) {
  const text = useTeamsText();
  const { t } = text;
  const color = getPaletteColor(team.id);
  const isTop3 = team.rank !== null && team.rank <= 3;
  // Classée = présente au classement, donc avec un rang. `isRankedTeam` ne
  // suffit pas ici : `TeamListItem` ne porte pas les nuls, et une équipe dont
  // l'unique match s'est clos sur un nul afficherait son rang à côté de
  // « Aucun match ».
  const ranked = team.rank !== null;

  return (
    <article className={s.card} style={{ "--c": color } as React.CSSProperties}>
      <LocaleLink
        href={`/equipes/${team.id}`}
        className={s.cardOverlay}
        aria-label={t("card.viewTeam", { name: team.name })}
      />

      {/* Sans match compté, l'équipe n'est pas au classement : pas de rang. */}
      {team.rank !== null && (
        <div className={`${s.rank} ${isTop3 ? s.rankTop : ""}`}>
          #{String(team.rank).padStart(2, "0")}
        </div>
      )}

      <div className={s.head}>
        {/* Décoratif de bout en bout : logo comme initiale ne font que redire le
            nom de l'équipe, écrit juste à côté. Une lecture d'écran qui
            annoncerait « D, Dragon Squad » n'apprendrait rien. */}
        <div
          className={s.sigil}
          style={{ "--c": color } as React.CSSProperties}
          aria-hidden="true"
        >
          {team.logoUrl ? (
            <Image
              src={team.logoUrl}
              alt=""
              width={56}
              height={56}
              className={s.sigilLogo}
            />
          ) : (
            team.name[0].toUpperCase()
          )}
        </div>
        <div className={s.headText}>
          <div className={s.name}>
            <TeamPodiumName teamId={team.id}>{team.name}</TeamPodiumName>
            {team.isGhost && (
              <span className={s.ghostBadge} title={t("card.ghostTitle")}>
                {t("card.ghostBadge")}
              </span>
            )}
          </div>
          <div className={s.tag}>
            {displayTeamTag(team.tag, team.name)}
            {team.region && ` · ${team.region}`}
          </div>
        </div>
      </div>

      {/* Le sens de lecture est écrit au-dessus de la barre, jamais en
          `title` : la plaque `.cardOverlay` recouvre la carte, la souris
          n'atteindrait pas la barre et l'infobulle ne s'ouvrirait jamais. */}
      {team.form.length > 0 && (
        <div className={s.form}>
          <div className={s.formLbl} aria-hidden="true">
            {t("card.form")} <span className={s.formOrder}>{t("card.formOrder")}</span>
          </div>
          <div
            className={s.formBar}
            role="img"
            aria-label={t("card.formSpoken", {
              count: team.form.length,
              results: team.form.map((r) => t(`card.formResult.${r}`)).join(", "),
            })}
          >
            {team.form.map((r, i) => (
              <div key={i} /* NOSONAR S6479 — liste positionnelle (du plus récent au plus ancien), sans état ni identifiant propre */ className={`${s.formCell} ${s[r]}`} />
            ))}
          </div>
        </div>
      )}

      {/* Les libellés abrégés restent lisibles par les lecteurs d'écran, leur
          forme longue étant donnée en `sr-only` juste à côté : `aria-label` sur
          un `<div>` sans rôle (`generic`) n'accepte pas de nom d'auteur — la
          carte n'annoncerait alors que trois nombres nus. */}
      <div className={s.stats}>
        {/* Tout le monde part de la même cote : sans cette nuance, une équipe
            qui n'a jamais joué afficherait le même nombre qu'une équipe qui l'a
            gagné, et rien ne dirait la différence. La nuance est donc écrite
            dans la carte — jamais en `title`, que la plaque `.cardOverlay`
            rendrait inatteignable : visible en deux mots pour une équipe non
            classée, entière pour les lecteurs d'écran. */}
        <div>
          <div className={s.statLbl}>
            <span aria-hidden="true">{t("card.pointsShort")}</span>
            <span className="sr-only">{t("points.label")}</span>
          </div>
          <div className={s.statVal}>{team.points}</div>
          {!ranked && (
            <div className={s.statHint} aria-hidden="true">
              {t("points.unrankedShort")}
            </div>
          )}
          <span className="sr-only">{teamPointsHint(text, ranked, team.points)}</span>
        </div>
        <div>
          <div className={s.statLbl}>
            <span aria-hidden="true">{t("card.winsShort")}</span>
            <span className="sr-only">{t("card.wins")}</span>
          </div>
          <div className={`${s.statVal} ${s.win}`}>{team.wins}</div>
        </div>
        <div>
          <div className={s.statLbl}>
            <span aria-hidden="true">{t("card.lossesShort")}</span>
            <span className="sr-only">{t("card.losses")}</span>
          </div>
          <div className={`${s.statVal} ${s.loss}`}>{team.losses}</div>
        </div>
      </div>

      <div className={s.roster}>
        <span className={s.rosterLbl}>{t("card.roster")}</span>
        {team.rosterPreview.slice(0, 5).map((m) => {
          const viewProfile = t("card.viewProfile", { name: m.pseudo });
          return (
            <PlayerLink
              key={m.userId}
              userId={m.userId}
              className={s.rosterItem}
              // Lien-avatar sans texte : la marche peinte sur le texte effacerait
              // l'initiale de repli. Le nom de l'équipe, au-dessus, la porte déjà.
              podiumTier={null}
              title={viewProfile}
              aria-label={viewProfile}
            >
              {m.avatarUrl ? (
                <Image
                  src={m.avatarUrl}
                  alt=""
                  width={26}
                  height={26}
                  className={s.avatar}
                />
              ) : (
                <span className={s.avatar}>{m.pseudo[0].toUpperCase()}</span>
              )}
            </PlayerLink>
          );
        })}
        {team.rosterPreview.length > 5 && (
          <span className={`${s.rosterItem} ${s.avatar} ${s.avatarMore}`}>
            +{team.rosterPreview.length - 5}
          </span>
        )}
      </div>

      {team.games.length > 0 && (
        <div className={s.games}>
          {team.games.map((g) => (
            <span key={g} className={`${s.gamePill} ${g === "OW" ? s.ow : s.mr}`}>
              {t(g === "OW" ? "game.OW" : "game.MR")}
            </span>
          ))}
        </div>
      )}

      <div className={s.foot}>
        <span className={s.footMeta}>
          {t("card.founded", {
            date: formatMonthYear(team.createdAt, text.locale).toUpperCase(),
          })}
        </span>
        <span className={s.cta}>{t("card.cta")}</span>
      </div>
    </article>
  );
}

/**
 * Mémoïsée : la grille se rend à chaque frappe (recherche différée) et chaque
 * carte formate une trentaine de messages ; l'équipe vient de l'état, même
 * référence d'un rendu à l'autre.
 */
export const TeamCard = memo(TeamCardView);
