"use client";

import Image from "next/image";
import Link from "next/link";
import type { TeamListItem } from "@/lib/shared/types";
import { getPaletteColor } from "@/lib/shared/palette";
import { PlayerLink } from "@/components/entity-link";
import { displayTeamTag } from "@/lib/shared/team-tag";
import {
  isRankedTeam,
  RANKING_POINTS_HINT,
  RANKING_POINTS_LABEL,
  RANKING_UNRANKED_HINT,
} from "@/lib/shared/ranking";
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
export function TeamCard({ team }: { team: TeamListItem }) {
  const color = getPaletteColor(team.id);
  const isTop3 = team.rank <= 3;

  return (
    <article className={s.card} style={{ "--c": color } as React.CSSProperties}>
      <Link
        href={`/equipes/${team.id}`}
        className={s.cardOverlay}
        aria-label={`Voir la fiche de ${team.name}`}
      />

      <div className={`${s.rank} ${isTop3 ? s.rankTop : ""}`}>
        #{String(team.rank).padStart(2, "0")}
      </div>

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
              unoptimized
              referrerPolicy="no-referrer"
              className={s.sigilLogo}
            />
          ) : (
            team.name[0].toUpperCase()
          )}
        </div>
        <div className={s.headText}>
          <div className={s.name}>
            {team.name}
            {team.isGhost && (
              <span className={s.ghostBadge} title="Équipe fantôme, créée par le staff">
                FANTÔME
              </span>
            )}
          </div>
          <div className={s.tag}>
            {displayTeamTag(team.tag, team.name)}
            {team.region && ` · ${team.region}`}
          </div>
        </div>
      </div>

      {team.form.length > 0 && (
        <div
          className={s.formBar}
          role="img"
          title={`${team.form.length} derniers matchs, du plus récent au plus ancien`}
          aria-label={`${team.form.length} derniers matchs : ${team.form
            .map((r) => (r === "w" ? "victoire" : r === "l" ? "défaite" : "nul"))
            .join(", ")}`}
        >
          {team.form.map((r, i) => (
            <div key={i} className={`${s.formCell} ${s[r]}`} />
          ))}
        </div>
      )}

      {/* Les libellés abrégés restent lisibles par les lecteurs d'écran, leur
          forme longue étant donnée en `sr-only` juste à côté : `aria-label` sur
          un `<div>` sans rôle (`generic`) n'accepte pas de nom d'auteur — la
          carte n'annoncerait alors que trois nombres nus. */}
      <div className={s.stats}>
        {/* Tout le monde part de la même cote : sans cette nuance, une équipe
            qui n'a jamais joué afficherait le même nombre qu'une équipe qui l'a
            gagné, et rien ne dirait la différence. */}
        <div
          title={`${RANKING_POINTS_LABEL} · ${
            isRankedTeam(team) ? RANKING_POINTS_HINT : RANKING_UNRANKED_HINT
          }`}
        >
          <div className={s.statLbl}>
            <span aria-hidden="true">Pts</span>
            <span className="sr-only">{RANKING_POINTS_LABEL}</span>
          </div>
          <div className={s.statVal}>{team.points}</div>
        </div>
        <div>
          <div className={s.statLbl}>
            <span aria-hidden="true">Vict.</span>
            <span className="sr-only">Victoires</span>
          </div>
          <div className={`${s.statVal} ${s.win}`}>{team.wins}</div>
        </div>
        <div>
          <div className={s.statLbl}>
            <span aria-hidden="true">Déf.</span>
            <span className="sr-only">Défaites</span>
          </div>
          <div className={`${s.statVal} ${s.loss}`}>{team.losses}</div>
        </div>
      </div>

      <div className={s.roster}>
        <span className={s.rosterLbl}>Roster</span>
        {team.rosterPreview.slice(0, 5).map((m) => (
          <PlayerLink
            key={m.userId}
            userId={m.userId}
            className={s.rosterItem}
            title={`Voir la fiche de ${m.pseudo}`}
            aria-label={`Voir la fiche de ${m.pseudo}`}
          >
            {m.avatarUrl ? (
              <Image
                src={m.avatarUrl}
                alt=""
                width={26}
                height={26}
                unoptimized
                referrerPolicy="no-referrer"
                className={s.avatar}
              />
            ) : (
              <span className={s.avatar}>{m.pseudo[0].toUpperCase()}</span>
            )}
          </PlayerLink>
        ))}
        {team.rosterPreview.length > 5 && (
          <span className={`${s.rosterItem} ${s.avatar} ${s.avatarMore}`}>
            +{team.rosterPreview.length - 5}
          </span>
        )}
      </div>

      {team.games.length > 0 && (
        <div className={s.games}>
          {team.games.map((g) => (
            <span key={g} className={`${s.gamePill} ${g === "OW2" ? s.ow : s.mr}`}>
              {g === "OW2" ? "Overwatch" : "Marvel Rivals"}
            </span>
          ))}
        </div>
      )}

      <div className={s.foot}>
        <span className={s.footMeta}>
          FONDÉE · {new Date(team.createdAt).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }).toUpperCase()}
        </span>
        <span className={s.cta}>Voir l&apos;équipe →</span>
      </div>
    </article>
  );
}
