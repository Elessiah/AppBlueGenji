"use client";

import { memo } from "react";
import Image from "next/image";
import { PlayerPodiumName } from "@/components/podium-tiers";
import { UserX } from "lucide-react";
import type { DirectoryPlayer } from "@/lib/shared/types";
import { avatarInitial } from "@/lib/shared/avatar";
import { getPaletteColor } from "@/lib/shared/palette";
import { playerRosterStatus } from "@/lib/shared/player-roster-status";
import { TeamLink } from "@/components/entity-link";
import { teamRoleTone } from "@/lib/shared/team-role-display";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { usePlayersText, type PlayersText } from "@/components/i18n/players-text";
import s from "../../_shared/annuaire.module.css";

const CARD_ROLES = ["DPS", "TANK", "HEAL", "COACH", "CAPITAINE", "OWNER", "MANAGER"] as const;

/** Libellé court d'un rôle sur la carte ; un code inconnu reste tel quel. */
function cardRoleLabel(text: PlayersText, role: string): string {
  const known = CARD_ROLES.find((code) => code === role);
  return known ? text.t(`card.role.${known}`) : role;
}

/**
 * Carte d'annuaire d'un joueur.
 *
 * La carte entière mène au profil, et le nom de son équipe mène à la fiche de
 * l'équipe : deux destinations, donc deux liens. Un `<a>` dans un `<a>` étant
 * invalide, le lien de la carte n'enveloppe pas le contenu — c'est une plaque
 * transparente posée par-dessus (`.cardOverlay`), que le lien d'équipe traverse
 * en repassant au-dessus d'elle (`.aboveOverlay`).
 */
function PlayerCardView({ player }: Readonly<{ player: DirectoryPlayer }>) {
  const text = usePlayersText();
  const { t } = text;
  // Le statut d'un compte sans équipe est une **invitation à recruter** —
  // « FREE AGENT » ouvertement, « SANS ÉQUIPE » par défaut —, et un compte
  // supprimé est justement celui qu'on ne peut plus rattacher :
  // `getUserIdByPseudo` refuse son pseudo en `USER_NOT_FOUND`. Affiché sous
  // « Compte supprimé », il envoyait le recruteur vers un refus. Le roster,
  // lui, se garde : l'anonymisation retire l'identité, pas l'appartenance —
  // c'est un fait, pas une offre.
  const rosterStatus = playerRosterStatus(player);
  const noTeamStatus = player.isDeleted ? null : (
    <span className={s.plNoTeam}>{t(`card.rosterStatus.${rosterStatus}`)}</span>
  );
  const teamColor = player.team ? getPaletteColor(player.team.colorIndex) : "var(--ink-mute)";

  return (
    <article
      className={`${s.plCard} ${player.isDeleted ? s.plCardDeleted : ""}`}
      style={{ "--c": teamColor } as React.CSSProperties}
    >
      {/* Un compte supprimé n'a plus d'adresse dans l'annuaire (`DirectoryPlayer`) :
          sa carte n'ouvre aucune fiche. */}
      {player.isDeleted ? null : (
        <LocaleLink
          href={`/joueurs/${player.id}`}
          className={s.cardOverlay}
          aria-label={t("card.viewProfile", { name: player.pseudo })}
        />
      )}
      <div className={s.plHead}>
        <div className={s.plAvatarWrap}>
          <div className={s.plAvatar}>
            {player.avatarUrl ? (
              <Image
                src={player.avatarUrl}
                alt={player.pseudo}
                width={64}
                height={64}
              />
            ) : (
              <span className={s.plAvatarFallback}>{avatarInitial(player.pseudo)}</span>
            )}
          </div>
        </div>
        <div className={s.plPseudo}>
          {player.isDeleted ? (
            player.pseudo
          ) : (
            <PlayerPodiumName userId={player.id}>{player.pseudo}</PlayerPodiumName>
          )}
        </div>
        {player.isDeleted && (
          <div className={s.plDeletedMark}>
            <UserX size={10} aria-hidden="true" />
            {t("card.deleted")}
          </div>
        )}
        <div className={s.plTeam}>
          {/* Le statut est demandé **une fois** : brancher ici sur `player.team`
              et là sur le statut partagé remettrait la règle à deux endroits,
              ce que le module existe justement pour éviter. */}
          {rosterStatus === "ROSTER" && player.team ? (
            <>
              {t("card.rosterStatus.ROSTER")} ·{" "}
              {/* Carte d'un compte supprimé : ligne d'équipe en retrait, sans marche. */}
              <TeamLink
                teamId={player.team.id}
                podiumTier={player.isDeleted ? null : undefined}
                className={`${s.aboveOverlay} tap-target`}
                title={t("card.viewTeam", { name: player.team.name })}
              >
                <em>{player.team.name.toUpperCase()}</em>
              </TeamLink>
            </>
          ) : (
            noTeamStatus
          )}
        </div>
      </div>

      {(player.roles || []).length > 0 && (
        <div className={s.plRoles}>
          {(player.roles || []).slice(0, 4).map((r) => (
            <span key={r} className={s.plRole} data-tone={teamRoleTone(r)}>
              {cardRoleLabel(text, r)}
            </span>
          ))}
        </div>
      )}

      <div className={s.plStats}>
        <div>
          <div className={s.plStatLbl}>{t("card.tournaments")}</div>
          <div className={s.plStatVal}>{player.tournamentsCount || 0}</div>
        </div>
        <div>
          <div className={s.plStatLbl}>{t("card.record")}</div>
          <div className={s.plStatVal}>
            {player.wins || 0}–<span className="result-loss">{player.losses || 0}</span>
          </div>
        </div>
      </div>

      {(player.games || []).length > 0 && (
        <div className={s.plTags}>
          {(player.games || []).map((g) => (
            <span key={g} className={`${s.plTag} ${g === "OW" ? s.ow : s.mr}`}>
              {g}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

/** Mémoïsée, comme `TeamCard` : le joueur vient de l'état, même référence d'un rendu à l'autre. */
export const PlayerCard = memo(PlayerCardView);
